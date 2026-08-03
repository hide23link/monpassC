import { test, expect } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, getAdminToken, seedStaff } from "./helpers";

// Ports tests/e2e/test_fe03_staff_login.py.
test.describe("staff/admin login", () => {
  test("staff login redirects to /#/staff", async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const staff = await seedStaff(request, adminToken, { role: "staff" });

    await page.goto("/#/staff-login");
    await page.waitForSelector("#staff-id");
    await page.fill("#staff-id", staff.id);
    await page.fill("#password", staff.password);
    await page.click("#submit-btn");
    await page.waitForURL((u) => u.hash.includes("#/staff"), { timeout: 5000 });
    expect(page.url()).toContain("#/staff");
  });

  test("admin login redirects to /#/admin", async ({ page }) => {
    await page.goto("/#/staff-login");
    await page.waitForSelector("#staff-id");
    await page.fill("#staff-id", ADMIN_ID);
    await page.fill("#password", ADMIN_PASSWORD);
    await page.click("#submit-btn");
    await page.waitForURL((u) => u.hash.includes("#/admin"), { timeout: 5000 });
    expect(page.url()).toContain("#/admin");
  });

  test("wrong credentials show an error message", async ({ page }) => {
    await page.goto("/#/staff-login");
    await page.waitForSelector("#staff-id");
    await page.fill("#staff-id", "wrong-id");
    await page.fill("#password", "wrong-pass");
    await page.click("#submit-btn");
    await page.waitForTimeout(1500);
    await expect(page.locator("#error-msg")).toBeVisible();
  });

  test("student-login link navigates back to /#/login", async ({ page }) => {
    await page.goto("/#/staff-login");
    await page.waitForSelector("a[href='#/login']");
    await page.click("a[href='#/login']");
    await page.waitForTimeout(500);
    expect(page.url()).toContain("#/login");
  });

  test("password visibility toggle works", async ({ page }) => {
    await page.goto("/#/staff-login");
    await page.waitForSelector("#password");
    expect(await page.locator("#password").getAttribute("type")).toBe("password");
    await expect(page.locator("#pw-eye")).toHaveText("👁");

    await page.locator("button[onclick*='togglePw']").click();
    expect(await page.locator("#password").getAttribute("type")).toBe("text");
    await expect(page.locator("#pw-eye")).toHaveText("🙈");
  });
});
