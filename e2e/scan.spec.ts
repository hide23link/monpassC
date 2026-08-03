import { test, expect } from "@playwright/test";
import { getAdminToken, seedStaff, loginStaffUI } from "./helpers";

// Ports tests/e2e/test_fe05_scan.py.
test.describe("staff scan page — display", () => {
  test("shows the online indicator", async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const staff = await seedStaff(request, adminToken);
    await loginStaffUI(page, staff.id, staff.password);
    await page.waitForURL((u) => u.hash.includes("#/staff"), { timeout: 5000 });
    await page.waitForSelector("#online-indicator", { timeout: 5000 });
    await expect(page.locator("#online-text")).toContainText("オンライン");
  });

  test("shows the scan history and QR reader containers", async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const staff = await seedStaff(request, adminToken);
    await loginStaffUI(page, staff.id, staff.password);
    await page.waitForSelector("#scan-history", { timeout: 5000 });
    await expect(page.locator("#scan-history")).toBeVisible();
    await expect(page.locator("#qr-reader")).toBeVisible();
  });

  test("scan-overlay element exists (initially hidden)", async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const staff = await seedStaff(request, adminToken);
    await loginStaffUI(page, staff.id, staff.password);
    await page.waitForSelector("#scan-overlay", { state: "attached", timeout: 5000 });
    await expect(page.locator("#scan-overlay")).toBeHidden();
  });

  test("sync button is hidden until the offline queue is non-empty", async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const staff = await seedStaff(request, adminToken);
    await loginStaffUI(page, staff.id, staff.password);
    await page.waitForSelector("#sync-btn", { state: "attached", timeout: 5000 });
    await expect(page.locator("#sync-btn")).toBeHidden();
  });
});

test.describe("staff scan page — offline cache fetch", () => {
  test("fetches /ticket/cache on load", async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const staff = await seedStaff(request, adminToken);

    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));

    await loginStaffUI(page, staff.id, staff.password);
    await page.waitForURL((u) => u.hash.includes("#/staff"), { timeout: 5000 });
    await page.waitForTimeout(1000);

    expect(requests.some((u) => u.includes("/ticket/cache"))).toBe(true);
  });

  test("responds to a synthetic offline event without crashing", async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const staff = await seedStaff(request, adminToken);
    await loginStaffUI(page, staff.id, staff.password);
    await page.waitForSelector("#online-indicator", { timeout: 5000 });
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.waitForTimeout(800);
    const text = await page.locator("#online-text").innerText();
    expect(text.includes("オフライン") || text.includes("オンライン")).toBe(true);
  });
});
