import { SignJWT, jwtVerify } from "jose";

// JWT(HS256)の発行・検証をまとめたモジュール。旧Python版のmake_token /
// issue_student_token / issue_staff_token / today_midnight_utc / decode_token
// を移植しており、クレーム名やexpの計算方法は当時と同じにしてある。理由:
// フロントエンド(auth.js)がサーバーに問い合わせずJWTペイロードを
// `atob()`でクライアント側デコードし、role/sub/expをそのまま読んでいるため。

// JWTペイロードの型。ここに新しいクレームを足す場合は、auth.jsのgetPayload()側の
// 想定とズレないよう注意(サーバーとフロント両方でこの形を前提にしている)。
export type JwtPayload = {
  sub: string; // 学籍番号 or スタッフID
  role: "student" | "staff" | "admin";
  iat: number; // 発行時刻(UNIX秒)
  exp: number; // 有効期限(UNIX秒)
};

function key(secret: string) {
  return new TextEncoder().encode(secret);
}

// スタッフ/管理者トークンの有効期限に使う「今日の23:59:59 UTC」を返す。
// 日をまたぐと自動的に失効するので、前日ログインしたスタッフの端末を
// 翌日まで有効なままにしてしまう事故を防げる。
export function todayMidnightUtc(): number {
  const now = new Date();
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    23,
    59,
    59,
    0,
  );
  return Math.floor(midnight / 1000);
}

async function makeToken(payload: JwtPayload, secret: string): Promise<string> {
  return await new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).sign(key(secret));
}

// 生徒トークンはスタッフ/管理者と違い「発行から30日間」有効。生徒は
// 学園祭当日以外にもQRを発行・確認する必要があるため、当日限りの
// 有効期限にはしていない。
export async function issueStudentToken(studentId: string, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: studentId,
    role: "student",
    iat: now,
    exp: now + 30 * 24 * 3600,
  };
  return makeToken(payload, secret);
}

export async function issueStaffToken(
  staffId: string,
  role: "staff" | "admin",
  secret: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: staffId,
    role,
    iat: now,
    exp: todayMidnightUtc(),
  };
  return makeToken(payload, secret);
}

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function decodeToken(
  authHeader: string | undefined,
  secret: string,
): Promise<JwtPayload> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AuthError(401, "認証が必要です");
  }
  const token = authHeader.slice("Bearer ".length);
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    return payload as unknown as JwtPayload;
  } catch {
    // 期限切れ・署名不正・フォーマット不正など、jwtVerify()が投げうる
    // どのエラーも同じ401「無効なトークンです」に集約する(旧Python版のdecode_tokenと
    // 同じ挙動 — エラー種別ごとに詳細なメッセージを返すと、攻撃者にトークンの
    // どこが問題かのヒントを与えてしまうため)。
    throw new AuthError(401, "無効なトークンです");
  }
}
