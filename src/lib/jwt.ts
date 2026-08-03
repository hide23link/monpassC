import { SignJWT, jwtVerify } from "jose";

// Ports main.py's make_token / issue_student_token / issue_staff_token /
// today_midnight_utc / decode_token. Claim names and exp computation are
// kept identical (see PLAN.md section 3, "認証") since the frontend
// (auth.js) decodes the JWT payload client-side to read role/sub/exp/promoted.

export type JwtPayload = {
  sub: string;
  role: "student" | "staff" | "admin";
  iat: number;
  exp: number;
  promoted?: true;
};

function key(secret: string) {
  return new TextEncoder().encode(secret);
}

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

export async function issueStudentToken(
  studentId: string,
  secret: string,
  promoted = false,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: studentId,
    role: "student",
    iat: now,
    exp: now + 30 * 24 * 3600,
  };
  if (promoted) {
    payload.promoted = true;
    payload.exp = todayMidnightUtc();
  }
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
    // Matches main.py's decode_token: any JWTError (expired/invalid
    // signature/malformed) collapses to the same 401 response.
    throw new AuthError(401, "無効なトークンです");
  }
}
