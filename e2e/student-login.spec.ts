import { test, expect } from "@playwright/test";
import { getAdminToken, seedStudent } from "./helpers";

// Ports a representative subset of tests/e2e/test_fe02_student_login.py.
test.describe("student login page — display", () => {
  test("shows the page title", async ({ page }) => {
    await page.goto("/#/login");
    await expect(page).toHaveTitle(/学園祭入場システム/);
  });

  test("shows the login form elements", async ({ page }) => {
    await page.goto("/#/login");
    await page.waitForSelector("#student-id");
    await expect(page.locator("#student-id")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.locator("#submit-btn")).toBeVisible();
  });

  test("staff-login link navigates", async ({ page }) => {
    await page.goto("/#/login");
    await page.waitForSelector("a[href='#/staff-login']");
    await page.click("a[href='#/staff-login']");
    await page.waitForTimeout(500);
    expect(page.url()).toContain("#/staff-login");
  });
});

test.describe("student login — normal flow", () => {
  test("successful login redirects to /#/qr and stores a JWT", async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const student = await seedStudent(request, adminToken);

    await page.goto("/#/login");
    await page.waitForSelector("#student-id");
    await page.fill("#student-id", student.id);
    await page.fill("#password", student.password);
    await page.click("#submit-btn");
    await page.waitForURL((u) => u.hash.includes("#/qr"), { timeout: 5000 });
    expect(page.url()).toContain("#/qr");

    const token = await page.evaluate(() => localStorage.getItem("token"));
    expect(token?.split(".").length).toBe(3);
  });

  test("Enter key submits the form", async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const student = await seedStudent(request, adminToken);

    await page.goto("/#/login");
    await page.waitForSelector("#student-id");
    await page.fill("#student-id", student.id);
    await page.fill("#password", student.password);
    await page.press("#password", "Enter");
    await page.waitForURL((u) => u.hash.includes("#/qr"), { timeout: 5000 });
  });
});

test.describe("student login — password visibility toggle", () => {
  test("password field starts masked and toggles on click", async ({ page }) => {
    await page.goto("/#/login");
    await page.waitForSelector("#password");
    expect(await page.locator("#password").getAttribute("type")).toBe("password");

    await page.locator("button[onclick*='togglePw']").click();
    expect(await page.locator("#password").getAttribute("type")).toBe("text");

    await page.locator("button[onclick*='togglePw']").click();
    expect(await page.locator("#password").getAttribute("type")).toBe("password");
  });
});

test.describe("student login — error paths", () => {
  test("unknown student_id shows an error and does not navigate", async ({ page }) => {
    await page.goto("/#/login");
    await page.waitForSelector("#student-id");
    await page.fill("#student-id", "no-such-id");
    await page.fill("#password", "wrongpass");
    await page.click("#submit-btn");
    await page.waitForTimeout(1000);
    await expect(page.locator("#error-msg")).toBeVisible();
    expect(page.url()).not.toContain("#/qr");
  });

  test("wrong password shows an error", async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const student = await seedStudent(request, adminToken);

    await page.goto("/#/login");
    await page.waitForSelector("#student-id");
    await page.fill("#student-id", student.id);
    await page.fill("#password", "wrong-password");
    await page.click("#submit-btn");
    await page.waitForTimeout(1000);
    await expect(page.locator("#error-msg")).toBeVisible();
  });
});
