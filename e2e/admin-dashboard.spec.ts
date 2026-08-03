import { test, expect } from "@playwright/test";
import { loginAdminUI, getAdminToken, seedStudent } from "./helpers";

// Ports tests/e2e/test_fe06_admin_dashboard.py.
test.describe("admin dashboard — layout", () => {
  test("shows the admin tab bar with the expected number of tabs", async ({ page }) => {
    await loginAdminUI(page);
    await page.waitForSelector("#admin-tabs", { timeout: 5000 });
    const count = await page.locator("#admin-tabs a").count();
    expect(count).toBeGreaterThanOrEqual(6);
  });

  test("clicking the tickets tab navigates to /#/admin/tickets", async ({ page }) => {
    await loginAdminUI(page);
    await page.waitForSelector("#admin-tabs", { timeout: 5000 });
    await page.locator("#admin-tabs a[data-tab='tickets']").click();
    await page.waitForURL((u) => u.hash.includes("#/admin/tickets"), { timeout: 3000 });
    expect(page.url()).toContain("#/admin/tickets");
  });

  test("shows the three summary cards on desktop", async ({ page }) => {
    await loginAdminUI(page);
    await page.waitForSelector("#total-entries", { timeout: 5000 });
    await expect(page.locator("#total-entries")).toBeVisible();
    await expect(page.locator("#unused-count")).toBeVisible();
    await expect(page.locator("#issued-students")).toBeVisible();
  });
});

test.describe("admin dashboard — data", () => {
  test("total entries and unused count render actual values", async ({ page }) => {
    await loginAdminUI(page);
    // #total-entries exists in the DOM immediately with placeholder "-";
    // wait for the dashboard fetch to actually populate it before asserting.
    await page.waitForFunction(
      () => document.getElementById("total-entries")?.textContent?.trim() !== "-",
      undefined,
      { timeout: 8000 },
    );
    const total = (await page.locator("#total-entries").innerText()).trim();
    const unused = (await page.locator("#unused-count").innerText()).trim();
    expect(total).not.toBe("");
    expect(total).not.toBe("-");
    expect(unused).not.toBe("");
    expect(unused).not.toBe("-");
  });

  test("renders the entry chart canvas", async ({ page }) => {
    await loginAdminUI(page);
    await page.waitForSelector("#entry-chart", { timeout: 5000 });
    await expect(page.locator("#entry-chart")).toBeVisible();
  });

  test("dashboard fetch returns 200 across a reload (polling does not break)", async ({ page }) => {
    const dashboardResponses: number[] = [];
    page.on("response", (r) => {
      if (r.url().includes("/admin/dashboard")) dashboardResponses.push(r.status());
    });
    await loginAdminUI(page);
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForSelector("#total-entries", { timeout: 5000 });
    expect(dashboardResponses.every((s) => s === 200)).toBe(true);
  });

  test("shows the student table once a student exists", async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    await seedStudent(request, adminToken);
    await loginAdminUI(page);
    await page.waitForSelector("#student-table", { timeout: 5000 });
    await expect(page.locator("#student-table")).toBeVisible();
  });

  test("shows the promotion tree container", async ({ page }) => {
    await loginAdminUI(page);
    await page.waitForSelector("#promote-tree", { timeout: 5000 });
    await expect(page.locator("#promote-tree")).toBeVisible();
  });
});
