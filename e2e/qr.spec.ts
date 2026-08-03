import { test, expect, type Page } from "@playwright/test";
import { getAdminToken, seedStudent, loginStudentUI } from "./helpers";

// Ports tests/e2e/test_fe04_qr.py, adapted for the client-side QR redesign
// (PLAN.md section 4): the server no longer returns qr_image, so ticket
// cards render a <canvas class="qr-canvas"> instead of an <img> — selectors
// updated accordingly throughout (was `#ticket-list img`).

async function waitForQrLoaded(page: Page) {
  await page.waitForFunction(
    () => {
      const el = document.getElementById("remaining-badge");
      return el !== null && !el.textContent?.includes("読込中");
    },
    { timeout: 8000 },
  );
}

async function issueAndWait(page: Page, guestName: string) {
  await page.fill("#guest-name", guestName);
  await page.click("#issue-btn");
  await page.waitForFunction(() => document.querySelector("#ticket-list [data-ticket-id]") !== null, {
    timeout: 8000,
  });
}

test.describe("QR issuance and listing", () => {
  test("shows 5 remaining tickets initially", async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const student = await seedStudent(request, adminToken);
    await loginStudentUI(page, student.id, student.password);
    await waitForQrLoaded(page);
    await expect(page.locator("#remaining-badge")).toContainText("5");
  });

  test("remaining count decreases after issuing a ticket", async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const student = await seedStudent(request, adminToken);
    await loginStudentUI(page, student.id, student.password);
    await waitForQrLoaded(page);
    await issueAndWait(page, "テスト発行");
    await expect(page.locator("#remaining-badge")).toContainText("4");
  });

  test("issue form is hidden once the 5-ticket cap is reached", async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const student = await seedStudent(request, adminToken);
    await loginStudentUI(page, student.id, student.password);
    await waitForQrLoaded(page);
    for (const name of ["a", "b", "c", "d", "e"]) {
      await page.fill("#guest-name", name);
      await page.click("#issue-btn");
      await page.waitForTimeout(600);
    }
    await page.waitForFunction(
      () => !document.getElementById("limit-reached")?.classList.contains("hidden"),
      { timeout: 8000 },
    );
    await expect(page.locator("#issue-form")).toBeHidden();
    await expect(page.locator("#limit-reached")).toBeVisible();
  });

  test("a rendered QR canvas has a sensible size", async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const student = await seedStudent(request, adminToken);
    await loginStudentUI(page, student.id, student.password);
    await waitForQrLoaded(page);
    await issueAndWait(page, "サイズテスト");
    await page.waitForFunction(() => document.querySelectorAll("#ticket-list canvas.qr-canvas").length > 0, {
      timeout: 8000,
    });
    const box = await page.locator("#ticket-list canvas.qr-canvas").first().boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(60);
  });

  test("issued ticket card shows guest name, QR canvas, and a save button", async ({
    page,
    request,
  }) => {
    const adminToken = await getAdminToken(request);
    const student = await seedStudent(request, adminToken);
    await loginStudentUI(page, student.id, student.password);
    await waitForQrLoaded(page);
    await issueAndWait(page, "カード内容テスト");

    const card = page.locator("#ticket-list [data-ticket-id]").first();
    await expect(card).toContainText("カード内容テスト");
    await expect(card.locator("canvas.qr-canvas")).toBeVisible();
    await expect(card.getByRole("button", { name: "画像を保存" })).toBeVisible();
  });

  test("empty guest name shows a validation error", async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const student = await seedStudent(request, adminToken);
    await loginStudentUI(page, student.id, student.password);
    await waitForQrLoaded(page);
    await page.fill("#guest-name", "");
    await page.click("#issue-btn");
    await page.waitForTimeout(500);
    await expect(page.locator("#issue-error")).toBeVisible();
  });

  test("clicking a QR canvas opens the enlarged modal", async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const student = await seedStudent(request, adminToken);
    await loginStudentUI(page, student.id, student.password);
    await waitForQrLoaded(page);
    await issueAndWait(page, "モーダルテスト");
    await page.locator("#ticket-list canvas.qr-canvas").first().click();
    await expect(page.locator("#qr-modal")).toBeVisible();
    // The modal's canvas should also have been (re-)rendered.
    await expect(page.locator("#modal-qr-canvas")).toBeVisible();
  });

  test("deleting an unused ticket removes its card", async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const student = await seedStudent(request, adminToken);
    await loginStudentUI(page, student.id, student.password);
    await waitForQrLoaded(page);
    await issueAndWait(page, "削除テスト");

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "削除" }).first().click();
    await page.waitForFunction(
      () => !document.getElementById("ticket-list")?.textContent?.includes("削除テスト"),
      { timeout: 5000 },
    );
    await expect(page.locator("#ticket-list")).not.toContainText("削除テスト");
  });
});

test.describe("promotion button", () => {
  test("shows a QR canvas in the promote modal", async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const student = await seedStudent(request, adminToken);
    await loginStudentUI(page, student.id, student.password);
    await page.waitForSelector("#promote-btn", { timeout: 5000 });
    await page.click("#promote-btn");
    await page.waitForTimeout(1000);
    await expect(page.locator("#promote-modal")).toBeVisible();
    await expect(page.locator("#promote-qr-canvas")).toBeVisible();
  });
});
