import { Hono } from "hono";
import type { Bindings, Variables } from "../env";
import { requireStudent, requirePromoteApprover, requireAdmin } from "../middleware/auth";
import { getConfig } from "../lib/config";
import { tokenUrlsafe } from "../lib/ids";
import { issueStudentToken, todayMidnightUtc } from "../lib/jwt";

// Ports main.py's `/promote/*` routes (main.py:1326-1421).
// /promote/request no longer returns a server-rendered qr_image (see PLAN.md
// section 4) — returns qr_content for the client to render instead.
// /promote/list is admin-only; PLAN.md section 5 flags that it needs to move
// under /admin/* (or get a dedicated Access rule) since Cloudflare Access
// only guards /admin/* paths. Left at its current path for now — revisit
// once Access is actually configured.
export const promoteRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function todayMidnightUtcIso(): string {
  return new Date(todayMidnightUtc() * 1000).toISOString();
}

promoteRoutes.post("/request", requireStudent, async (c) => {
  const studentId = c.get("payload").sub;
  const db = c.env.DB;
  const config = getConfig(c.env);

  const promoteToken = tokenUrlsafe(24);
  const sessionId = tokenUrlsafe(16);
  const promoId = tokenUrlsafe(8);
  const expiresAt = todayMidnightUtcIso();

  await db
    .prepare(
      `INSERT INTO temp_promotions
       (id, promote_token, token_used, session_id, student_id,
        promoted_by_type, promoted_by_id, expires_at)
       VALUES (?, ?, 0, ?, ?, 'pending', 'pending', ?)`,
    )
    .bind(promoId, promoteToken, sessionId, studentId, expiresAt)
    .run();

  const qrContent = `https://${config.domain}/promote/approve?token=${promoteToken}`;

  return c.json({
    promote_token: promoteToken,
    session_id: sessionId,
    qr_content: qrContent,
  });
});

type TempPromotionRow = { id: string; student_id: string; token_used: number };

promoteRoutes.post("/approve", requirePromoteApprover, async (c) => {
  const payload = c.get("payload");
  const body = await c.req.json().catch(() => ({}));
  const promoteToken = typeof body.promote_token === "string" ? body.promote_token : "";
  const db = c.env.DB;

  const row = await db
    .prepare("SELECT id, student_id, token_used FROM temp_promotions WHERE promote_token = ?")
    .bind(promoteToken)
    .first<TempPromotionRow>();

  if (row === null) return c.json({ detail: "無効な昇格トークンです" }, 400);
  if (row.token_used === 1) return c.json({ detail: "使用済みの昇格トークンです" }, 409);

  const studentId = row.student_id;
  const approverId = payload.sub;
  const approverType = payload.role === "admin" || payload.role === "staff" ? "staff" : "student";
  const now = new Date().toISOString();
  const expiresAt = todayMidnightUtcIso();

  await db
    .prepare(
      `UPDATE temp_promotions
       SET token_used = 1, promoted_by_type = ?, promoted_by_id = ?,
           promoted_at = ?, expires_at = ?
       WHERE promote_token = ?`,
    )
    .bind(approverType, approverId, now, expiresAt, promoteToken)
    .run();

  const token = await issueStudentToken(studentId, getConfig(c.env).jwtSecret, true);
  return c.json({ token, student_id: studentId });
});

promoteRoutes.get("/list", requireAdmin, async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, student_id, promoted_by_type, promoted_by_id, promoted_at, expires_at
     FROM temp_promotions WHERE token_used = 1`,
  ).all();
  return c.json(rows.results);
});
