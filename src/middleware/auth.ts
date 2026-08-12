import type { MiddlewareHandler } from "hono";
import type { Bindings, Variables } from "../env";
import { decodeToken, AuthError, type JwtPayload } from "../lib/jwt";
import { getConfig } from "../lib/config";

type Env = { Bindings: Bindings; Variables: Variables };

// ロールごとの認可ミドルウェア(旧Python版のrequire_student /
// require_staff_or_admin / require_adminを移植)。各ルートはこれらを
// `app.get("/path", requireXxx, handler)`のようにHonoのミドルウェアとして
// 差し込むことで、ハンドラ本体は認可済みのpayloadを`c.get('payload')`で
// 受け取れる前提で書ける。

// Authorizationヘッダーを取り出してJWT検証し、成功すればペイロードを返す。
// 失敗時はdecodeToken内でAuthErrorがthrowされ、各ミドルウェアのcatch節が拾う。
async function decode(c: Parameters<MiddlewareHandler<Env>>[0]): Promise<JwtPayload> {
  const config = getConfig(c.env);
  return decodeToken(c.req.header("Authorization"), config.jwtSecret);
}

// AuthError(トークン欠落・不正)は401、ロール不一致は各ミドルウェアが
// 個別に403を返す。ここではAuthError以外の想定外エラーも安全側に倒して
// 401扱いにしている。
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
