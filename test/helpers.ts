import { env, SELF } from "cloudflare:test";
import bcrypt from "bcryptjs";

export async function seedStudent(
  overrides: Partial<{ id: string; name: string; class: string; password: string }> = {},
) {
  const id = overrides.id ?? "9999";
  const name = overrides.name ?? "テスト太郎";
  const klass = overrides.class ?? "1-A";
  const password = overrides.password ?? "testpass123";
  const hash = await bcrypt.hash(password, 10);
  await env.DB.prepare(
    "INSERT INTO students (id, name, class, password_hash) VALUES (?, ?, ?, ?)",
  )
    .bind(id, name, klass, hash)
    .run();
  return { id, name, class: klass, password };
}

export async function seedStaff(
  overrides: Partial<{ id: string; name: string; role: "staff" | "admin"; password: string }> = {},
) {
  const id = overrides.id ?? "staff1";
  const name = overrides.name ?? "スタッフ一郎";
  const role = overrides.role ?? "staff";
  const password = overrides.password ?? "staffpass123";
  const hash = await bcrypt.hash(password, 10);
  await env.DB.prepare("INSERT INTO staff (id, name, password_hash, role) VALUES (?, ?, ?, ?)")
    .bind(id, name, hash, role)
    .run();
  return { id, name, role, password };
}

export async function loginStudent(id: string, password: string): Promise<string> {
  const res = await SELF.fetch("https://example.com/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ student_id: id, password }),
  });
  const data = (await res.json()) as { token: string };
  return data.token;
}

export async function loginStaff(id: string, password: string): Promise<string> {
  const res = await SELF.fetch("https://example.com/auth/staff/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ staff_id: id, password }),
  });
  const data = (await res.json()) as { token: string };
  return data.token;
}

export function authedFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return SELF.fetch(`https://example.com${path}`, { ...init, headers });
}

export function jsonInit(body: unknown, method = "POST"): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
