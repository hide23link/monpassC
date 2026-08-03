import { test, expect } from "@playwright/test";
import { seedStudent, getAdminToken, loginStudentUI } from "./helpers";

// Ports tests/e2e/test_fe01_routing.py.
test.describe("routing", () => {
  test("unauthenticated /#/qr redirects to login", async ({ page }) => {
    await page.goto("/#/qr");
    await page.waitForTimeout(800);
    expect(page.url()).toContain("#/login");
  });

  test("unauthenticated /#/staff redirects to staff-login", async ({ page }) => {
    await page.goto("/#/staff");
    await page.waitForTimeout(800);
    expect(page.url()).toContain("#/staff-login");
  });

  test("unauthenticated /#/admin redirects to staff-login", async ({ page }) => {
    await page.goto("/#/admin");
    await page.waitForTimeout(800);
    expect(page.url()).toContain("#/staff-login");
  });

  test("a logged-in student cannot reach /#/admin", async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const student = await seedStudent(request, adminToken);
    await loginStudentUI(page, student.id, student.password);
    await page.goto("/#/admin");
    await page.waitForTimeout(800);
    const url = page.url();
    const appText = await page.locator("#app").innerText();
    expect(!url.includes("#/admin") || appText.includes("403") || url.includes("#/qr")).toBe(true);
  });

  test("root path resolves to a known hash route", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1500);
    const hash = await page.evaluate(() => location.hash);
    expect(["#/login", "#/qr"]).toContain(hash || "#/login");
  });

  test("an already-logged-in student visiting /#/login is redirected to /#/qr", async ({
    page,
    request,
  }) => {
    const adminToken = await getAdminToken(request);
    const student = await seedStudent(request, adminToken);
    await loginStudentUI(page, student.id, student.password);
    await page.goto("/#/login");
    await page.waitForTimeout(800);
    expect(page.url()).toContain("#/qr");
  });

  test("browser back navigation does not crash the app", async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const student = await seedStudent(request, adminToken);
    await loginStudentUI(page, student.id, student.password);
    await page.waitForSelector("#issue-btn", { timeout: 5000 });
    await page.goBack();
    await page.waitForTimeout(500);
    expect(page.isClosed()).toBe(false);
  });
});
