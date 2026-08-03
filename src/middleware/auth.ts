import type { MiddlewareHandler } from "hono";
import type { Bindings, Variables } from "../env";
import { decodeToken, AuthError, type JwtPayload } from "../lib/jwt";
import { getConfig } from "../lib/config";

type Env = { Bindings: Bindings; Variables: Variables };

// Ports main.py's require_student / require_staff_or_admin / require_admin /
// require_student_or_promoted (all closures over `config` in create_app()).
// require_any (main.py:364) is dead code in the original app — not ported.

async function decode(c: Parameters<MiddlewareHandler<Env>>[0]): Promise<JwtPayload> {
  const config = getConfig(c.env);
  return decodeToken(c.req.header("Authorization"), config.jwtSecret);
}

function authError(err: unknown): { status: 401 | 403; detail: string } {
  if (err instanceof AuthError) return { status: err.status as 401 | 403, detail: err.message };
  return { status: 401, detail: "無効なトークンです" };
}

export const requireStudent: MiddlewareHandler<Env> = async (c, next) => {
  try {
    const payload = await decode(c);
    if (payload.role !== "student") {
      return c.json({ detail: "生徒権限が必要です" }, 403);
    }
    c.set("payload", payload);
    await next();
  } catch (err) {
    const { status, detail } = authError(err);
    return c.json({ detail }, status);
  }
};

// Ticket issuance: student or promoted student (promoted students keep
// role="student" with payload.promoted=true, so this is the same check as
// requireStudent — matches main.py's require_student_or_promoted exactly).
export const requireStudentOrPromoted: MiddlewareHandler<Env> = async (c, next) => {
  try {
    const payload = await decode(c);
    if (payload.role !== "student") {
      return c.json({ detail: "生徒権限が必要です" }, 403);
    }
    c.set("payload", payload);
    await next();
  } catch (err) {
    const { status, detail } = authError(err);
    return c.json({ detail }, status);
  }
};

export const requireStaffOrAdmin: MiddlewareHandler<Env> = async (c, next) => {
  try {
    const payload = await decode(c);
    const isPromotedStudent = payload.role === "student" && payload.promoted === true;
    if (payload.role !== "staff" && payload.role !== "admin" && !isPromotedStudent) {
      return c.json({ detail: "スタッフ権限が必要です" }, 403);
    }
    c.set("payload", payload);
    await next();
  } catch (err) {
    const { status, detail } = authError(err);
    return c.json({ detail }, status);
  }
};

// Ports the inline role check in main.py's promote_approve (main.py:1359-1373).
// Same condition as requireStaffOrAdmin (staff/admin, or a promoted student)
// but with promote_approve's own error message — main.py implements this
// check manually rather than via Depends(require_staff_or_admin), and the
// message text differs ("昇格承認権限がありません" vs "スタッフ権限が必要です").
export const requirePromoteApprover: MiddlewareHandler<Env> = async (c, next) => {
  try {
    const payload = await decode(c);
    const isPromotedStudent = payload.role === "student" && payload.promoted === true;
    if (payload.role !== "staff" && payload.role !== "admin" && !isPromotedStudent) {
      return c.json({ detail: "昇格承認権限がありません" }, 403);
    }
    c.set("payload", payload);
    await next();
  } catch (err) {
    const { status, detail } = authError(err);
    return c.json({ detail }, status);
  }
};

export const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
  try {
    const payload = await decode(c);
    if (payload.role !== "admin") {
      return c.json({ detail: "管理者権限が必要です" }, 403);
    }
    c.set("payload", payload);
    await next();
  } catch (err) {
    const { status, detail } = authError(err);
    return c.json({ detail }, status);
  }
};
