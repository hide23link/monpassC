import { Hono } from "hono";
import bcrypt from "bcryptjs";
import type { Bindings, Variables } from "../env";
import { getConfig } from "../lib/config";
import { issueStudentToken, issueStaffToken } from "../lib/jwt";

// Ports main.py's `/auth/login` (student_login) and `/auth/staff/login`
// (staff_login). bcrypt.checkpw -> bcryptjs, python-jose -> jose (src/lib/jwt.ts).
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

  const row = await db
    .prepare("SELECT id, password_hash FROM students WHERE id = ?")
    .bind(studentId)
    .first<StudentRow>();

  if (row === null || !(await bcrypt.compare(password, row.password_hash))) {
    return c.json({ detail: "学籍番号またはパスワードが正しくありません" }, 401);
  }

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

  const row = await db
    .prepare("SELECT id, password_hash, role FROM staff WHERE id = ?")
    .bind(staffId)
    .first<StaffRow>();

  if (row === null || !(await bcrypt.compare(password, row.password_hash))) {
    return c.json({ detail: "IDまたはパスワードが正しくありません" }, 401);
  }

  const token = await issueStaffToken(staffId, row.role, config.jwtSecret);
  return c.json({ token });
});
