import type { APIRequestContext, Page } from "@playwright/test";

// Ports tests/e2e/e2e_helpers.py's constants and helper functions.
export const ADMIN_ID = "e2e-admin";
export const ADMIN_PASSWORD = "adminpass123";

let counter = 0;
export function uniqueId(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`;
}

export async function getAdminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post("/auth/staff/login", {
    data: { staff_id: ADMIN_ID, password: ADMIN_PASSWORD },
  });
  const body = (await res.json()) as { token: string };
  return body.token;
}

export async function seedStudent(
  request: APIRequestContext,
  adminToken: string,
  overrides: Partial<{ id: string; name: string; class_name: string; password: string }> = {},
) {
  const id = overrides.id ?? uniqueId("s");
  const name = overrides.name ?? "山田太郎";
  const className = overrides.class_name ?? "1-A";
  const password = overrides.password ?? "studentpass1";
  await request.post("/admin/students", {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { student_id: id, name, class_name: className, password },
  });
  return { id, name, class_name: className, password };
}

export async function seedStaff(
  request: APIRequestContext,
  adminToken: string,
  overrides: Partial<{ id: string; name: string; role: "staff" | "admin"; password: string }> = {},
) {
  const id = overrides.id ?? uniqueId("st");
  const name = overrides.name ?? "スタッフ一郎";
  const role = overrides.role ?? "staff";
  const password = overrides.password ?? "staffpass123";
  await request.post("/admin/staff", {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { staff_id: id, name, password, role },
  });
  return { id, name, role, password };
}

export async function loginStudentUI(page: Page, studentId: string, password: string) {
  await page.goto("/#/login");
  await page.fill("#student-id", studentId);
  await page.fill("#password", password);
  await page.click("#submit-btn");
  await page.waitForFunction(
    () => location.hash === "#/qr" || location.hash === "#/login",
    undefined,
    { timeout: 8000 },
  );
}

export async function loginStaffUI(page: Page, staffId: string, password: string) {
  await page.goto("/#/staff-login");
  await page.fill("#staff-id", staffId);
  await page.fill("#password", password);
  await page.click("#submit-btn");
  await page.waitForFunction(
    () => ["#/staff", "#/admin", "#/staff-login"].includes(location.hash),
    undefined,
    { timeout: 8000 },
  );
}

export async function loginAdminUI(page: Page, adminId = ADMIN_ID, password = ADMIN_PASSWORD) {
  await page.goto("/#/staff-login");
  await page.fill("#staff-id", adminId);
  await page.fill("#password", password);
  await page.click("#submit-btn");
  await page.waitForFunction(() => location.hash === "#/admin", undefined, { timeout: 8000 });
}
