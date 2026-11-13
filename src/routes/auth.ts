import { Hono } from "hono";
import bcrypt from "bcryptjs";
import type { Bindings, Variables } from "../env";
import { getConfig } from "../lib/config";
import { issueStudentToken, issueStaffToken } from "../lib/jwt";
import { lockedSeconds, recordFailure, resetFailures, lockedMessage } from "../lib/lockout";

// ログイン系ルート。旧Python版の`/auth/login`(student_login)・
// `/auth/staff/login`(staff_login)を移植したもの(bcrypt.checkpw -> bcryptjs、
// python-jose -> jose、詳細はsrc/lib/jwt.ts参照)。生徒とスタッフ/管理者で
// テーブル・トークンの有効期限が異なるため、ログインAPI自体を2本に分けている。
export const authRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

type StudentRow = { id: string; password_hash: string };
type StaffRow = { id: string; password_hash: string; role: "staff" | "admin" };

authRoutes.post("/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const studentId = typeof body.student_id === "string" ? body.student_id : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!studentId.trim()) return c.json({ detail: "学籍番号は必須です" }, 400);
  if (!password.trim()) return c.json({ detail: "パスワードは必須です" }, 400);

  const config = getConfig(c.env);
  const db = c.env.DB;

  // 連続失敗でロック中なら、パスワードを確かめずに429を返す
  const userKey = `student:${studentId}`;
  const wait = await lockedSeconds(db, userKey);
  if (wait > 0) return c.json({ detail: lockedMessage(wait) }, 429);

  const row = await db
    .prepare("SELECT id, password_hash FROM students WHERE id = ?")
    .bind(studentId)
    .first<StudentRow>();

  // 「該当ユーザーなし」と「パスワード不一致」を同じエラーメッセージ・同じ401に
  // 統一している(row === null の場合でも bcrypt.compare は呼ばずショートサーキット
  // するが、レスポンス自体は区別しない) — どちらの学籍番号が存在するかを
  // 攻撃者に教えないため。
  if (row === null || !(await bcrypt.compare(password, row.password_hash))) {
    await recordFailure(db, userKey);
    return c.json({ detail: "学籍番号またはパスワードが正しくありません" }, 401);
  }

  await resetFailures(db, userKey);
  const token = await issueStudentToken(studentId, config.jwtSecret);
  return c.json({ token });
});

authRoutes.post("/staff/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const staffId = typeof body.staff_id === "string" ? body.staff_id : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!staffId.trim()) return c.json({ detail: "IDは必須です" }, 400);
  if (!password.trim()) return c.json({ detail: "パスワードは必須です" }, 400);

  const config = getConfig(c.env);
  const db = c.env.DB;

  // 連続失敗でロック中なら、パスワードを確かめずに429を返す
  const userKey = `staff:${staffId}`;
  const wait = await lockedSeconds(db, userKey);
  if (wait > 0) return c.json({ detail: lockedMessage(wait) }, 429);

  const row = await db
    .prepare("SELECT id, password_hash, role FROM staff WHERE id = ?")
    .bind(staffId)
    .first<StaffRow>();

  if (row === null || !(await bcrypt.compare(password, row.password_hash))) {
    await recordFailure(db, userKey);
    return c.json({ detail: "IDまたはパスワードが正しくありません" }, 401);
  }

  await resetFailures(db, userKey);
  const token = await issueStaffToken(staffId, row.role, config.jwtSecret);
  return c.json({ token });
});
