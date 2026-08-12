import { Hono } from "hono";
import type { Bindings, Variables } from "../env";
import { requireStudent, requireStaffOrAdmin } from "../middleware/auth";
import { getConfig } from "../lib/config";
import { getIssuePeriod, todayIso } from "../lib/settings";
import { tokenUrlsafe } from "../lib/ids";
import { htmlEscape } from "../lib/html";
import { getEntryStatus } from "../lib/entry-stats";

// チケット(招待QR)関連の全ルート。生徒によるQR発行・一覧・削除と、
// スタッフ/管理者によるスキャン(入場処理)・スキャン履歴を扱う。
// レスポンスにqr_image/qr_url/qr_contentのような値は一切含めない — QRの
// 中身の文字列(`${origin}/scan/${ticket_id}`)はクライアント側で自前生成し、
// 描画もクライアント側(qrcodeライブラリ)で行う(サーバーはQR画像を生成しない)。
// /ticket/scanは、SQLite版のBEGIN IMMEDIATEロックの代わりに、単一のatomicな
// 条件付きUPDATE(`WHERE ... AND used=0`)で同時実行制御している(詳細は
// 下のインラインコメント参照)。エラー文言はフロント(staff-scan.js)が
// 文字列マッチで種別判定しているため、変更すると連動して壊れる。
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

// QRチケットを1枚発行する。招待者名必須・発行期間内のみ・1人あたりの上限
// (既定5枚、MAX_TICKETS環境変数)以内、という3つのバリデーションを順にかける。
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

// ログイン中の生徒が発行した自分のチケット一覧のみを返す(他の生徒の分は
// 見えない)。QR画像は含めず、フロントがticket_idから自前でQRを描画する。
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

// 生徒が自分の未使用チケットを削除する。他人のチケットは403、すでに
// 入場済みのチケットは400で拒否する(入場記録を勝手に消せないようにするため)。
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

  // 同じチケットに対して複数のスタッフが同時にスキャンしても、入場成功が
  // 1件だけになるようにするための仕組み。SQLite版のBEGIN IMMEDIATEロックの
  // 代わりに、is_valid=1 AND used=0の条件が真である行にだけ成功する単一の
  // UPDATE文を使う。D1(内部的にはSQLite)ではUPDATEはatomicに実行されるため、
  // 「WHERE条件を満たす行が0件ならchanges=0」という結果だけで、ロックなしに
  // 「ちょうど1件だけ勝つ」ことを保証できる(同時10件スキャンでも1件だけ200、
  // 残り9件は409になることをテストで確認済み)。
  // scanned_by列は旧Python版にはなかった追加カラム(誰がスキャンしたかを
  // 記録し、「自分のスキャン履歴」機能で使う)。
  const result = await db
    .prepare(
      "UPDATE tickets SET used = 1, used_at = ?, scanned_by = ? WHERE id = ? AND is_valid = 1 AND used = 0",
    )
    .bind(usedAt, scannedBy, ticketId)
    .run();

  if (result.meta.changes === 1) {
    return c.json({ status: "ok", result: "ok", color: "green", used_at: usedAt });
  }

  // changes === 0 の場合、上のUPDATEが失敗した理由を追加のSELECTで判定する。
  // 「存在しない(404) → 無効化されている(400) → すでに入場済み(409)」の
  // 優先順位で判定するのは旧Python版と同じ(この順序をフロントの文字列マッチが
  // 前提にしている)。
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

// 誤スキャン等で入場記録してしまった場合の取消。usedを0に戻し、
// scanned_byもクリアする(取り消された記録が「自分のスキャン履歴」に
// 残り続けないように)。
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

// 以下2ルートは旧Python版にはなかった追加機能。「管理者専用の/admin/*には
// アクセスできないスタッフでも、現在の来場状況と自分のスキャン履歴くらいは
// 見たい」という要望に応えて後から追加した。集計ロジックは/admin/dashboardと
// entry-stats.tsで共通化している。

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

