import type { MiddlewareHandler } from "hono";
import type { Bindings, Variables } from "../env";
import { decodeToken, AuthError, type JwtPayload } from "../lib/jwt";
import { getConfig } from "../lib/config";

type Env = { Bindings: Bindings; Variables: Variables };

// Ports main.py's require_student / require_staff_or_admin / require_admin
// (closures over `config` in create_app()). require_any (main.py:364) is
// dead code in the original app — not ported.

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

export const requireStaffOrAdmin: MiddlewareHandler<Env> = async (c, next) => {
  try {
    const payload = await decode(c);
    if (payload.role !== "staff" && payload.role !== "admin") {
      return c.json({ detail: "スタッフ権限が必要です" }, 403);
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
