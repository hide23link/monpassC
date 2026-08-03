import { Hono } from "hono";
import type { Bindings, Variables } from "../env";
import { requireStudentOrPromoted, requireStaffOrAdmin } from "../middleware/auth";
import { getConfig } from "../lib/config";
import { getIssuePeriod, todayIso } from "../lib/settings";
import { tokenUrlsafe } from "../lib/ids";
import { htmlEscape } from "../lib/html";

// Ports main.py's `/ticket/*` routes (main.py:584-797).
// PLAN.md section 4: no qr_image/qr_url/qr_content in any response here —
// the client derives the QR payload string itself (`${origin}/scan/${ticket_id}`)
// and renders the QR client-side.
// PLAN.md section 3: /ticket/scan and /ticket/sync use an atomic conditional
// UPDATE (`WHERE ... AND used=0`) instead of SQLite's BEGIN IMMEDIATE lock —
// see inline comments below for the exact replacement per route. Error
// strings for /ticket/scan are kept byte-identical to main.py since
// staff-scan.js string-matches them.
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

ticketRoutes.post("/issue", requireStudentOrPromoted, async (c) => {
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

ticketRoutes.get("/list", requireStudentOrPromoted, async (c) => {
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

ticketRoutes.delete("/:ticket_id", requireStudentOrPromoted, async (c) => {
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
  const db = c.env.DB;
  const usedAt = new Date().toISOString();

  // Atomic conditional UPDATE replaces SQLite's BEGIN IMMEDIATE lock
  // (main.py:699-721) — see PLAN.md section 3. A single UPDATE that only
  // succeeds when the row is still is_valid=1 AND used=0 gives the same
  // "exactly one scan wins" guarantee under concurrent requests.
  const result = await db
    .prepare("UPDATE tickets SET used = 1, used_at = ? WHERE id = ? AND is_valid = 1 AND used = 0")
    .bind(usedAt, ticketId)
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
    .prepare("UPDATE tickets SET used = 0, used_at = NULL WHERE id = ?")
    .bind(ticketId)
    .run();
  return c.json({ message: "入場取消しました" });
});

ticketRoutes.get("/cache", requireStaffOrAdmin, async (c) => {
  const since = c.req.query("since");
  const db = c.env.DB;

  const rows = since
    ? await db
        .prepare(
          "SELECT id as ticket_id, is_valid, used, used_at, created_at FROM tickets WHERE created_at > ? OR used_at > ?",
        )
        .bind(since, since)
        .all()
    : await db
        .prepare(
          "SELECT id as ticket_id, is_valid, used, used_at, created_at FROM tickets WHERE is_valid = 1",
        )
        .all();

  return c.json(rows.results);
});

type OfflineScanItem = { ticket_id: string; scanned_at: string; session_id: string };

ticketRoutes.post("/sync", requireStaffOrAdmin, async (c) => {
  const items = (await c.req.json().catch(() => [])) as OfflineScanItem[];
  const db = c.env.DB;
  const results: Array<Record<string, unknown>> = [];

  for (const item of items) {
    const syncId = tokenUrlsafe(8);

    // Atomic conditional UPDATE fixes the race bug in main.py:764-797, which
    // does a plain read-then-write with no BEGIN IMMEDIATE (unlike /ticket/scan)
    // — see PLAN.md section 3. Note: unlike /ticket/scan, the original sync
    // logic never checked is_valid, only used — preserved here as-is.
    const result = await db
      .prepare("UPDATE tickets SET used = 1, used_at = ? WHERE id = ? AND used = 0")
      .bind(item.scanned_at, item.ticket_id)
      .run();

    if (result.meta.changes === 1) {
      await db
        .prepare(
          "INSERT INTO offline_scan_queue (id, ticket_id, scanned_at, session_id, synced, synced_at) VALUES (?, ?, ?, ?, 1, ?)",
        )
        .bind(syncId, item.ticket_id, item.scanned_at, item.session_id, item.scanned_at)
        .run();
      results.push({ ticket_id: item.ticket_id, conflict: 0, synced: 1 });
      continue;
    }

    const existing = await db
      .prepare("SELECT id FROM tickets WHERE id = ?")
      .bind(item.ticket_id)
      .first<{ id: string }>();

    if (existing === null) {
      results.push({ ticket_id: item.ticket_id, conflict: 0, error: "not found" });
      continue;
    }

    await db
      .prepare(
        "INSERT INTO offline_scan_queue (id, ticket_id, scanned_at, session_id, synced, conflict) VALUES (?, ?, ?, ?, 1, 1)",
      )
      .bind(syncId, item.ticket_id, item.scanned_at, item.session_id)
      .run();
    results.push({ ticket_id: item.ticket_id, conflict: 1 });
  }

  return c.json(results);
});
