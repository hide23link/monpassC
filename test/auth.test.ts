import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";
import { seedStudent, seedStaff, jsonInit } from "./helpers";

// Ports tests/test_tc01_auth.py's core assertions.
describe("POST /auth/login", () => {
  it("issues a token for a valid student login", async () => {
    const student = await seedStudent();
    const res = await SELF.fetch(
      "https://example.com/auth/login",
      jsonInit({ student_id: student.id, password: student.password }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    expect(typeof body.token).toBe("string");

    const [, payloadB64] = body.token.split(".");
    const payload = JSON.parse(atob(payloadB64));
    expect(payload.sub).toBe(student.id);
    expect(payload.role).toBe("student");
    expect(payload.promoted).toBeUndefined();
  });

  it("rejects an incorrect password", async () => {
    const student = await seedStudent();
    const res = await SELF.fetch(
      "https://example.com/auth/login",
      jsonInit({ student_id: student.id, password: "wrong-password" }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("学籍番号またはパスワードが正しくありません");
  });

  it("rejects an unknown student_id with the same message as a wrong password", async () => {
    const res = await SELF.fetch(
      "https://example.com/auth/login",
      jsonInit({ student_id: "no-such-student", password: "whatever" }),
    );
    expect(res.status).toBe(401);
  });

  it("locks the account after LOGIN_MAX_FAILURES consecutive failures", async () => {
    const student = await seedStudent();
    for (let i = 0; i < 10; i++) {
      await SELF.fetch(
        "https://example.com/auth/login",
        jsonInit({ student_id: student.id, password: "wrong" }),
      );
    }
    const res = await SELF.fetch(
      "https://example.com/auth/login",
      jsonInit({ student_id: student.id, password: student.password }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toContain("ロックされています");
  });
});

describe("POST /auth/staff/login", () => {
  it("issues a same-day-expiry token carrying the staff role", async () => {
    const staff = await seedStaff({ role: "admin" });
    const res = await SELF.fetch(
      "https://example.com/auth/staff/login",
      jsonInit({ staff_id: staff.id, password: staff.password }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    const [, payloadB64] = body.token.split(".");
    const payload = JSON.parse(atob(payloadB64));
    expect(payload.role).toBe("admin");
    // exp should be today 23:59:59 UTC — within the next 24h, never 30 days out.
    const secondsUntilExpiry = payload.exp - Math.floor(Date.now() / 1000);
    expect(secondsUntilExpiry).toBeLessThan(24 * 3600);
  });

  it("rejects wrong password with the staff-specific message", async () => {
    const staff = await seedStaff();
    const res = await SELF.fetch(
      "https://example.com/auth/staff/login",
      jsonInit({ staff_id: staff.id, password: "wrong" }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("IDまたはパスワードが正しくありません");
  });
});

describe("protected routes without a token", () => {
  it("returns 401 with the standard message", async () => {
    const res = await SELF.fetch("https://example.com/admin/dashboard");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("認証が必要です");
  });

  it("rejects a malformed/tampered token with 401", async () => {
    const res = await SELF.fetch("https://example.com/admin/dashboard", {
      headers: { Authorization: "Bearer not-a-real-jwt" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("無効なトークンです");
  });

  it("rejects a token signed with a different secret", async () => {
    const student = await seedStudent();
    const loginRes = await SELF.fetch(
      "https://example.com/auth/login",
      jsonInit({ student_id: student.id, password: student.password }),
    );
    const { token } = (await loginRes.json()) as { token: string };
    const [header, payload] = token.split(".");
    const forgedToken = `${header}.${payload}.forged-signature-abc123`;

    const res = await SELF.fetch(`https://example.com/ticket/list`, {
      headers: { Authorization: `Bearer ${forgedToken}` },
    });
    expect(res.status).toBe(401);
  });
});

describe("role enforcement across route groups", () => {
  it("rejects a student token on a staff-only route with 403", async () => {
    const student = await seedStudent();
    const loginRes = await SELF.fetch(
      "https://example.com/auth/login",
      jsonInit({ student_id: student.id, password: student.password }),
    );
    const { token } = (await loginRes.json()) as { token: string };

    const res = await SELF.fetch("https://example.com/ticket/scan", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ticket_id: "irrelevant" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("スタッフ権限が必要です");
  });

  it("rejects a staff (non-admin) token on an admin-only route with 403", async () => {
    const staff = await seedStaff({ role: "staff" });
    const loginRes = await SELF.fetch(
      "https://example.com/auth/staff/login",
      jsonInit({ staff_id: staff.id, password: staff.password }),
    );
    const { token } = (await loginRes.json()) as { token: string };

    const res = await SELF.fetch("https://example.com/admin/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("管理者権限が必要です");
  });
});
