import { Hono } from "hono";
import type { Bindings, Variables } from "../env";
import { requireStudent, requireStaffOrAdmin } from "../middleware/auth";
import { getConfig } from "../lib/config";
import { getIssuePeriod, todayIso } from "../lib/settings";
import { tokenUrlsafe } from "../lib/ids";
import { htmlEscape } from "../lib/html";
import { getEntryStatus } from "../lib/entry-stats";

// Ports main.py's `/ticket/*` routes (main.py:584-797).
// No qr_image/qr_url/qr_content in any response here — the client derives
// the QR payload string itself (`${origin}/scan/${ticket_id}`) and renders
// the QR client-side.
// /ticket/scan uses an atomic conditional UPDATE (`WHERE ... AND used=0`)
// instead of SQLite's BEGIN IMMEDIATE lock — see inline comment below. Error
// strings are kept byte-identical to main.py since staff-scan.js
// string-matches them.
export const ticketRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

type TicketRow = {
  ticket_id: string;
  guest_name: string;
  is_valid: number;
  used: number;
  used_at: string | null;
  created_at: string;
  student_name?: string;
};

ticketRoutes.post("/issue", requireStudent, async (c) => {
  const studentId = c.get("payload").sub;
  const body = await c.req.json().catch(() => ({}));
  const guestName = typeof body.guest_name === "string" ? body.guest_name : "";
  const requestedStudentId = typeof body.student_id === "string" ? body.student_id : undefined;

  if (!guestName.trim()) return c.json({ detail: "招待者名は必須です" }, 400);
  if (requestedStudentId && requestedStudentId !== studentId) {
    return c.json({ detail: "他の生徒のチケットは発行できません" }, 403);
  }

  const db = c.env.DB;
  const config = getConfig(c.env);

  const { issueStart, issueEnd } = await getIssuePeriod(db, config);
  const today = todayIso();
  if (today < issueStart || today > issueEnd) {
    return c.json({ detail: "QR発行期間外です" }, 400);
  }

  const countRow = await db
    .prepare("SELECT COUNT(*) as cnt FROM tickets WHERE student_id = ? AND is_valid = 1")
    .bind(studentId)
    .first<{ cnt: number }>();
  const count = countRow?.cnt ?? 0;
  if (count >= config.maxTickets) {
    return c.json({ detail: `発行上限（${config.maxTickets}枚）に達しています` }, 403);
  }

  const ticketId = tokenUrlsafe(12);
  const safeGuestName = htmlEscape(guestName);

  await db
    .prepare("INSERT INTO tickets (id, student_id, guest_name) VALUES (?, ?, ?)")
    .bind(ticketId, studentId, safeGuestName)
    .run();

  const issued = await db
    .prepare(
      "SELECT t.created_at as created_at, s.name as name FROM tickets t JOIN students s ON t.student_id = s.id WHERE t.id = ?",
    )
    .bind(ticketId)
    .first<{ created_at: string; name: string }>();

  return c.json({
    ticket_id: ticketId,
    guest_name: safeGuestName,
    student_id: studentId,
    student_name: issued?.name ?? studentId,
    created_at: issued?.created_at ?? "",
    remaining: config.maxTickets - (count + 1),
  });
});

ticketRoutes.get("/list", requireStudent, async (c) => {
  const studentId = c.get("payload").sub;
  const db = c.env.DB;

  const rows = await db
    .prepare(
      `SELECT t.id as ticket_id, t.guest_name, t.is_valid, t.used, t.used_at, t.created_at,
              s.name as student_name
       FROM tickets t JOIN students s ON t.student_id = s.id
       WHERE t.student_id = ?`,
    )
    .bind(studentId)
    .all<TicketRow>();

  return c.json(rows.results);
});

ticketRoutes.delete("/:ticket_id", requireStudent, async (c) => {
  const studentId = c.get("payload").sub;
  const ticketId = c.req.param("ticket_id");
  const db = c.env.DB;

  const row = await db
    .prepare("SELECT id, student_id, used FROM tickets WHERE id = ?")
    .bind(ticketId)
    .first<{ id: string; student_id: string; used: number }>();

  if (row === null) return c.json({ detail: "チケットが見つかりません" }, 404);
  if (row.student_id !== studentId) {
    return c.json({ detail: "他の生徒のチケットは削除できません" }, 403);
  }
  if (row.used === 1) return c.json({ detail: "入場済みチケットは削除できません" }, 400);

  await db.prepare("DELETE FROM tickets WHERE id = ?").bind(ticketId).run();
  return c.json({ message: "削除しました" });
});

ticketRoutes.post("/scan", requireStaffOrAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const ticketId = typeof body.ticket_id === "string" ? body.ticket_id : "";
  const scannedBy = c.get("payload").sub;
  const db = c.env.DB;
  const usedAt = new Date().toISOString();

  // Atomic conditional UPDATE replaces SQLite's BEGIN IMMEDIATE lock
  // (main.py:699-721). A single UPDATE that only succeeds when the row is
  // still is_valid=1 AND used=0 gives the same "exactly one scan wins"
  // guarantee under concurrent requests.
  // scanned_by is not in main.py (added post-migration for the "自分の
  // スキャン履歴" staff feature) — records which staff/admin performed
  // the scan.
  const result = await db
    .prepare(
      "UPDATE tickets SET used = 1, used_at = ?, scanned_by = ? WHERE id = ? AND is_valid = 1 AND used = 0",
    )
    .bind(usedAt, scannedBy, ticketId)
    .run();

  if (result.meta.changes === 1) {
    return c.json({ status: "ok", result: "ok", color: "green", used_at: usedAt });
  }

  // changes === 0: disambiguate why, in the same precedence order as main.py.
  const row = await db
    .prepare("SELECT id, is_valid, used FROM tickets WHERE id = ?")
    .bind(ticketId)
    .first<{ id: string; is_valid: number; used: number }>();

  if (row === null) {
    return c.json({ detail: "存在しないチケットです (not found)" }, 404);
  }
  if (row.is_valid === 0) {
    return c.json({ detail: "無効なチケットです (invalid ticket)" }, 400);
  }
  return c.json({ detail: "入場済みチケットです (already used)" }, 409);
});

ticketRoutes.post("/scan/:ticket_id/cancel", requireStaffOrAdmin, async (c) => {
  const ticketId = c.req.param("ticket_id");
  const db = c.env.DB;

  const row = await db
    .prepare("SELECT id, used FROM tickets WHERE id = ?")
    .bind(ticketId)
    .first<{ id: string; used: number }>();
  if (row === null) return c.json({ detail: "チケットが見つかりません" }, 404);

  await db
    .prepare("UPDATE tickets SET used = 0, used_at = NULL, scanned_by = NULL WHERE id = ?")
    .bind(ticketId)
    .run();
  return c.json({ message: "入場取消しました" });
});

// Added post-migration (not in main.py) so staff — not just admins — can see
// current attendance status and their own scan history, per user request:
// "スタッフモードでは、自分が来場をチェックしたデータが見れるように...
// 他の管理者と同様に、現在の来場状況も見えるように".

ticketRoutes.get("/status", requireStaffOrAdmin, async (c) => {
  const { totalEntries, unusedCount, graphData } = await getEntryStatus(c.env.DB);
  return c.json({
    total_entries: totalEntries,
    unused_count: unusedCount,
    graph_data: graphData,
  });
});

type MyScanRow = {
  ticket_id: string;
  guest_name: string;
  student_name: string;
  used_at: string;
};

ticketRoutes.get("/my-scans", requireStaffOrAdmin, async (c) => {
  const scannedBy = c.get("payload").sub;
  const rows = await c.env.DB.prepare(
    `SELECT t.id as ticket_id, t.guest_name, s.name as student_name, t.used_at
     FROM tickets t JOIN students s ON t.student_id = s.id
     WHERE t.scanned_by = ? AND t.used = 1
     ORDER BY t.used_at DESC
     LIMIT 100`,
  )
    .bind(scannedBy)
    .all<MyScanRow>();
  return c.json(rows.results);
});

