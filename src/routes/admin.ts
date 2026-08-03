import { Hono } from "hono";
import bcrypt from "bcryptjs";
import type { Bindings, Variables } from "../env";
import { requireAdmin } from "../middleware/auth";
import { tokenUrlsafe } from "../lib/ids";
import { generateAlnumPassword } from "../lib/password";
import { decodeCsvBytes, parseCsv, csvResponse } from "../lib/csv";
import { getEntryStatus } from "../lib/entry-stats";

// Ports main.py's `/admin/*` routes (main.py:801-1322). All routes require
// an admin-role JWT (requireAdmin, wired below) — Cloudflare Access sits in
// front of this whole group at the edge per PLAN.md section 5, but does not
// replace this check.
export const adminRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

adminRoutes.use("*", requireAdmin);

// ─── ダッシュボード ──────────────────────────────────────────────────────

adminRoutes.get("/dashboard", async (c) => {
  const db = c.env.DB;
  const { totalEntries, unusedCount, graphData } = await getEntryStatus(db);

  const studentRows = await db
    .prepare(
      `SELECT s.id, s.name, s.class,
              COUNT(t.id) as issued_count,
              SUM(CASE WHEN t.used = 1 THEN 1 ELSE 0 END) as entry_count
       FROM students s
       LEFT JOIN tickets t ON s.id = t.student_id
       GROUP BY s.id`,
    )
    .all();

  return c.json({
    total_entries: totalEntries,
    entry_count: totalEntries,
    unused_count: unusedCount,
    unused_tickets: unusedCount,
    hourly_entries: graphData,
    entry_graph: graphData,
    graph_data: graphData,
    student_entries: studentRows.results,
    students: studentRows.results,
  });
});

// ─── チケット管理 ────────────────────────────────────────────────────────

adminRoutes.get("/tickets", async (c) => {
  const studentName = c.req.query("student_name");
  const status = c.req.query("status");
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (studentName) {
    conditions.push("s.name LIKE ?");
    params.push(`%${studentName}%`);
  }
  if (status === "used") conditions.push("t.used = 1");
  else if (status === "invalid") conditions.push("t.is_valid = 0");
  else if (status === "unused") conditions.push("t.used = 0 AND t.is_valid = 1");

  let query = `SELECT t.id as ticket_id, t.student_id, s.name as student_name, s.class,
                      t.guest_name, t.is_valid, t.used, t.used_at, t.created_at
               FROM tickets t JOIN students s ON t.student_id = s.id`;
  if (conditions.length) query += " WHERE " + conditions.join(" AND ");

  const rows = await db_all(c.env.DB, query, params);
  return c.json(rows);
});

async function db_all(db: D1Database, query: string, params: unknown[]) {
  const stmt = params.length ? db.prepare(query).bind(...params) : db.prepare(query);
  return (await stmt.all()).results;
}

adminRoutes.get("/tickets/:ticket_id", async (c) => {
  const ticketId = c.req.param("ticket_id");
  const row = await c.env.DB.prepare(
    `SELECT t.id as ticket_id, t.student_id, s.name as student_name, s.class,
            t.guest_name, t.is_valid, t.used, t.used_at, t.created_at
     FROM tickets t JOIN students s ON t.student_id = s.id
     WHERE t.id = ?`,
  )
    .bind(ticketId)
    .first();
  if (row === null) return c.json({ detail: "チケットが見つかりません" }, 404);
  return c.json(row);
});

adminRoutes.put("/tickets/:ticket_id", async (c) => {
  const ticketId = c.req.param("ticket_id");
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));

  const existing = await db.prepare("SELECT id FROM tickets WHERE id = ?").bind(ticketId).first();
  if (existing === null) return c.json({ detail: "チケットが見つかりません" }, 404);

  if (typeof body.is_valid === "number") {
    await db
      .prepare("UPDATE tickets SET is_valid = ? WHERE id = ?")
      .bind(body.is_valid, ticketId)
      .run();
  }
  if (typeof body.used === "number") {
    if (body.used === 0) {
      await db
        .prepare("UPDATE tickets SET used = 0, used_at = NULL WHERE id = ?")
        .bind(ticketId)
        .run();
    } else {
      const usedAt = new Date().toISOString();
      await db
        .prepare("UPDATE tickets SET used = 1, used_at = ? WHERE id = ?")
        .bind(usedAt, ticketId)
        .run();
    }
  }

  const updated = await db
    .prepare("SELECT id as ticket_id, is_valid, used, used_at FROM tickets WHERE id = ?")
    .bind(ticketId)
    .first();
  return c.json(updated);
});

adminRoutes.post("/tickets", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const studentId = typeof body.student_id === "string" ? body.student_id : "";
  const guestName = typeof body.guest_name === "string" ? body.guest_name : "";
  const db = c.env.DB;

  const student = await db.prepare("SELECT id FROM students WHERE id = ?").bind(studentId).first();
  if (student === null) return c.json({ detail: "生徒が見つかりません" }, 404);

  const ticketId = tokenUrlsafe(12);
  await db
    .prepare("INSERT INTO tickets (id, student_id, guest_name) VALUES (?, ?, ?)")
    .bind(ticketId, studentId, guestName)
    .run();
  return c.json({ ticket_id: ticketId });
});

adminRoutes.delete("/tickets/:ticket_id", async (c) => {
  const ticketId = c.req.param("ticket_id");
  const db = c.env.DB;

  const row = await db.prepare("SELECT id FROM tickets WHERE id = ?").bind(ticketId).first();
  if (row === null) return c.json({ detail: "チケットが見つかりません" }, 404);

  // Unlike main.py (SQLite, no PRAGMA foreign_keys=ON so FKs are never
  // enforced), D1 enforces the offline_scan_queue -> tickets FK by default.
  // Admin can force-delete a used ticket that already has sync records, so
  // those must be cleared first or the DELETE below fails with a FK error.
  await db.prepare("DELETE FROM offline_scan_queue WHERE ticket_id = ?").bind(ticketId).run();
  await db.prepare("DELETE FROM tickets WHERE id = ?").bind(ticketId).run();
  return c.json({ message: "削除しました" });
});

// ─── 生徒管理 ────────────────────────────────────────────────────────────

adminRoutes.get("/students", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.class,
            COUNT(t.id) as ticket_count,
            SUM(CASE WHEN t.used = 1 THEN 1 ELSE 0 END) as entry_count
     FROM students s
     LEFT JOIN tickets t ON s.id = t.student_id
     GROUP BY s.id`,
  ).all();
  return c.json(rows.results);
});

adminRoutes.get("/students/:student_id", async (c) => {
  const studentId = c.req.param("student_id");
  const row = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.class,
            COUNT(t.id) as ticket_count,
            COUNT(t.id) as issued_count,
            SUM(CASE WHEN t.used = 1 THEN 1 ELSE 0 END) as entry_count
     FROM students s
     LEFT JOIN tickets t ON s.id = t.student_id
     WHERE s.id = ?
     GROUP BY s.id`,
  )
    .bind(studentId)
    .first();
  if (row === null) return c.json({ detail: "生徒が見つかりません" }, 404);
  return c.json(row);
});

adminRoutes.post("/students", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const studentId = typeof body.student_id === "string" ? body.student_id : "";
  const name = typeof body.name === "string" ? body.name : "";
  const className = typeof body.class_name === "string" ? body.class_name : "";
  const password = typeof body.password === "string" ? body.password : "";
  const db = c.env.DB;

  const existing = await db.prepare("SELECT id FROM students WHERE id = ?").bind(studentId).first();
  if (existing !== null) {
    return c.json({ detail: "この学籍番号は既に登録されています" }, 409);
  }
  if (!studentId || !name || !password) {
    return c.json({ detail: "学籍番号・氏名・パスワードは必須です" }, 400);
  }

  const pwHash = await bcrypt.hash(password, 10);
  await db
    .prepare("INSERT INTO students (id, name, class, password_hash) VALUES (?, ?, ?, ?)")
    .bind(studentId, name, className, pwHash)
    .run();
  return c.json({ message: "生徒を登録しました", student_id: studentId });
});

adminRoutes.put("/students/:student_id", async (c) => {
  const studentId = c.req.param("student_id");
  const body = await c.req.json().catch(() => ({}));
  const db = c.env.DB;

  const row = await db.prepare("SELECT id FROM students WHERE id = ?").bind(studentId).first();
  if (row === null) return c.json({ detail: "生徒が見つかりません" }, 404);

  if (typeof body.name === "string") {
    await db.prepare("UPDATE students SET name = ? WHERE id = ?").bind(body.name, studentId).run();
  }
  if (typeof body.class_name === "string") {
    await db
      .prepare("UPDATE students SET class = ? WHERE id = ?")
      .bind(body.class_name, studentId)
      .run();
  }
  if (typeof body.password === "string" && body.password) {
    const pwHash = await bcrypt.hash(body.password, 10);
    await db
      .prepare("UPDATE students SET password_hash = ? WHERE id = ?")
      .bind(pwHash, studentId)
      .run();
  }
  return c.json({ message: "更新しました" });
});

adminRoutes.post("/students/:student_id/reset-password", async (c) => {
  const studentId = c.req.param("student_id");
  const body = await c.req.json().catch(() => ({}));
  const db = c.env.DB;

  const row = await db.prepare("SELECT id FROM students WHERE id = ?").bind(studentId).first();
  if (row === null) return c.json({ detail: "生徒が見つかりません" }, 404);

  let newPassword: string;
  const requested = typeof body.password === "string" ? body.password.trim() : "";
  if (requested.length > 0) {
    if (requested.length < 4) {
      return c.json({ detail: "パスワードは4文字以上で入力してください" }, 400);
    }
    newPassword = requested;
  } else {
    newPassword = generateAlnumPassword(8);
  }

  const pwHash = await bcrypt.hash(newPassword, 10);
  await db
    .prepare("UPDATE students SET password_hash = ? WHERE id = ?")
    .bind(pwHash, studentId)
    .run();
  return c.json({ password: newPassword });
});

adminRoutes.delete("/students/:student_id", async (c) => {
  const studentId = c.req.param("student_id");
  const db = c.env.DB;

  const row = await db.prepare("SELECT id FROM students WHERE id = ?").bind(studentId).first();
  if (row === null) return c.json({ detail: "生徒が見つかりません" }, 404);

  // Same D1-FK-enforcement note as DELETE /tickets/:id above — clear
  // offline_scan_queue rows for this student's tickets before cascading.
  await db
    .prepare(
      "DELETE FROM offline_scan_queue WHERE ticket_id IN (SELECT id FROM tickets WHERE student_id = ?)",
    )
    .bind(studentId)
    .run();
  await db.prepare("DELETE FROM tickets WHERE student_id = ?").bind(studentId).run();
  await db.prepare("DELETE FROM students WHERE id = ?").bind(studentId).run();
  return c.json({ message: "削除しました" });
});

// ─── CSV インポート/エクスポート ────────────────────────────────────────

adminRoutes.post("/import", async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.name.endsWith(".csv")) {
    return c.json({ detail: "CSVファイルのみアップロード可能です" }, 400);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) return c.json({ detail: "空のファイルです" }, 400);

  const text = decodeCsvBytes(bytes);
  const rows = parseCsv(text);
  if (rows.length === 0) return c.json({ detail: "データが空です" }, 400);

  const startIdx = /^\d+$/.test((rows[0][0] ?? "").trim()) ? 0 : 1;

  const db = c.env.DB;
  let successCount = 0;
  let skipCount = 0;
  const newPasswords: Array<[string, string, string, string]> = [];

  for (const row of rows.slice(startIdx)) {
    if (row.length < 3) {
      skipCount += 1;
      continue;
    }
    const studentId = row[0].trim();
    const name = row[1].trim();
    const className = row[2].trim();
    if (!studentId) {
      skipCount += 1;
      continue;
    }

    const existing = await db.prepare("SELECT id FROM students WHERE id = ?").bind(studentId).first();
    if (existing !== null) {
      skipCount += 1;
      continue;
    }

    const password = generateAlnumPassword(8);
    const pwHash = await bcrypt.hash(password, 10);
    await db
      .prepare("INSERT INTO students (id, name, class, password_hash) VALUES (?, ?, ?, ?)")
      .bind(studentId, name, className, pwHash)
      .run();
    newPasswords.push([studentId, password, name, className]);
    successCount += 1;
  }

  // Replaces app.state.last_import_passwords (in-process memory in the old
  // app, broken under multiple workers/isolates by design) with a D1 table.
  await db.prepare("DELETE FROM last_import_passwords").run();
  for (const [studentId, password, name, className] of newPasswords) {
    await db
      .prepare(
        "INSERT INTO last_import_passwords (student_id, password, name, class) VALUES (?, ?, ?, ?)",
      )
      .bind(studentId, password, name, className)
      .run();
  }

  return c.json({ success_count: successCount, skip_count: skipCount });
});

adminRoutes.get("/import/passwords", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT student_id, password, name, class FROM last_import_passwords ORDER BY student_id",
  ).all<{ student_id: string; password: string; name: string; class: string }>();

  const csvRows: unknown[][] = [["学籍番号", "パスワード", "氏名", "クラス"]];
  for (const r of rows.results) {
    csvRows.push([r.student_id, r.password, r.name, r.class]);
  }
  return csvResponse(csvRows, "passwords.csv");
});

adminRoutes.get("/export", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT s.id as student_id, s.name as student_name, s.class,
            t.guest_name, t.id as ticket_id, t.used, t.is_valid
     FROM tickets t JOIN students s ON t.student_id = s.id`,
  ).all<{
    student_id: string;
    student_name: string;
    class: string;
    guest_name: string;
    ticket_id: string;
    used: number;
    is_valid: number;
  }>();

  const csvRows: unknown[][] = [
    ["学籍番号", "生徒名", "クラス", "招待者名", "チケットID", "入場状況", "有効"],
  ];
  for (const r of rows.results) {
    const usedLabel = r.used === 1 ? "入場済み" : "未入場";
    const validLabel = r.is_valid === 1 ? "有効" : "無効";
    csvRows.push([r.student_id, r.student_name, r.class, r.guest_name, r.ticket_id, usedLabel, validLabel]);
  }
  return csvResponse(csvRows, "tickets_export.csv");
});

// ─── スタッフ管理 ────────────────────────────────────────────────────────

adminRoutes.get("/staff", async (c) => {
  const rows = await c.env.DB.prepare("SELECT id, name, role FROM staff").all();
  return c.json(rows.results);
});

adminRoutes.post("/staff", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const staffId = typeof body.staff_id === "string" ? body.staff_id : "";
  const name = typeof body.name === "string" ? body.name : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role = typeof body.role === "string" && body.role ? body.role : "staff";
  const db = c.env.DB;

  const existing = await db.prepare("SELECT id FROM staff WHERE id = ?").bind(staffId).first();
  if (existing !== null) return c.json({ detail: "既に存在するIDです" }, 409);

  const pwHash = await bcrypt.hash(password, 10);
  await db
    .prepare("INSERT INTO staff (id, name, password_hash, role) VALUES (?, ?, ?, ?)")
    .bind(staffId, name, pwHash, role)
    .run();
  return c.json({ message: "スタッフを登録しました" });
});

adminRoutes.delete("/staff/:staff_id", async (c) => {
  const staffId = c.req.param("staff_id");
  await c.env.DB.prepare("DELETE FROM staff WHERE id = ?").bind(staffId).run();
  return c.json({ message: "削除しました" });
});

adminRoutes.get("/staff/export", async (c) => {
  const rows = await c.env.DB.prepare("SELECT id, name, role FROM staff").all<{
    id: string;
    name: string;
    role: string;
  }>();
  const csvRows: unknown[][] = [["スタッフID", "氏名", "ロール"]];
  for (const r of rows.results) csvRows.push([r.id, r.name, r.role]);
  return csvResponse(csvRows, "staff_export.csv");
});

adminRoutes.post("/staff/import", async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.name.endsWith(".csv")) {
    return c.json({ detail: "CSVファイルのみアップロード可能です" }, 400);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) return c.json({ detail: "空のファイルです" }, 400);

  const text = decodeCsvBytes(bytes);
  const rows = parseCsv(text);
  if (rows.length === 0) return c.json({ detail: "データが空です" }, 400);

  const firstCell = (rows[0][0] ?? "").trim();
  const firstChar = firstCell.slice(0, 1);
  const isAscii = (s: string) => /^[\x00-\x7F]*$/.test(s);
  const startIdx =
    !isAscii(firstChar) || ["スタッフid", "id", "staff_id"].includes(firstCell.toLowerCase()) ? 1 : 0;

  const db = c.env.DB;
  let successCount = 0;
  let skipCount = 0;

  for (const row of rows.slice(startIdx)) {
    if (row.length < 3) {
      skipCount += 1;
      continue;
    }
    const staffId = row[0].trim();
    const name = row[1].trim();
    const password = row[2].trim();
    let role = row.length >= 4 ? row[3].trim() : "staff";

    if (!staffId || !name || !password) {
      skipCount += 1;
      continue;
    }
    if (role !== "staff" && role !== "admin") role = "staff";

    const existing = await db.prepare("SELECT id FROM staff WHERE id = ?").bind(staffId).first();
    if (existing !== null) {
      skipCount += 1;
      continue;
    }

    const pwHash = await bcrypt.hash(password, 10);
    await db
      .prepare("INSERT INTO staff (id, name, password_hash, role) VALUES (?, ?, ?, ?)")
      .bind(staffId, name, pwHash, role)
      .run();
    successCount += 1;
  }

  return c.json({ success_count: successCount, skip_count: skipCount });
});

// ─── 設定 ────────────────────────────────────────────────────────────────

adminRoutes.get("/settings", async (c) => {
  const rows = await c.env.DB.prepare("SELECT key, value FROM settings").all<{
    key: string;
    value: string;
  }>();
  const map = new Map(rows.results.map((r) => [r.key, r.value]));
  return c.json({
    issue_start: map.get("issue_start") ?? "",
    issue_end: map.get("issue_end") ?? "",
  });
});

adminRoutes.put("/settings", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const issueStart = typeof body.issue_start === "string" ? body.issue_start : "";
  const issueEnd = typeof body.issue_end === "string" ? body.issue_end : "";
  const db = c.env.DB;

  await db
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('issue_start', ?)")
    .bind(issueStart)
    .run();
  await db
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('issue_end', ?)")
    .bind(issueEnd)
    .run();
  return c.json({ issue_start: issueStart, issue_end: issueEnd });
});
