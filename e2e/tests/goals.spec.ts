import { expect, test } from "@playwright/test";
import { clickNav, gotoApp, uniqueMark } from "../fixtures/helpers";

test.describe("目標 CRUD", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await clickNav(page, "目標");
  });

  test("KPI付きの目標を追加・編集・削除できる", async ({ page }) => {
    const goalName = uniqueMark("goal");
    const renamed = `${goalName}-edited`;

    // --- 追加 ---
    await page.getByRole("button", { name: "+ 新しい目標" }).click();
    const modal = page.locator(".modal-content").first();
    await expect(modal).toBeVisible();

    await modal.locator(".modal-input").first().fill(goalName);
    await modal.locator(".kpi-input-name").first().fill("月間KPI");
    await modal.locator(".kpi-input-num").first().fill("100");

    await modal.locator(".modal-btn-primary", { hasText: "保存" }).click();
    await expect(page.locator(".modal-overlay")).toHaveCount(0);

    const card = page.locator(".goal-card", { hasText: goalName });
    await expect(card).toBeVisible();

    // --- 編集 ---
    await card.locator(".goal-card-action").first().click();
    const editModal = page.locator(".modal-content").first();
    await expect(editModal).toBeVisible();
    await editModal.locator(".modal-input").first().fill(renamed);
    await editModal.locator(".modal-btn-primary", { hasText: "保存" }).click();
    await expect(page.locator(".modal-overlay")).toHaveCount(0);
    await expect(
      page.locator(".goal-card", { hasText: renamed }),
    ).toBeVisible();

    // --- 削除 ---
    await page
      .locator(".goal-card", { hasText: renamed })
      .locator(".goal-card-action--delete")
      .click();
    const deleteModal = page.locator(".modal-content").first();
    await expect(deleteModal).toBeVisible();
    await deleteModal.locator(".modal-btn-danger").click();
    await expect(page.locator(".modal-overlay")).toHaveCount(0);

    await expect(
      page.locator(".goal-card", { hasText: renamed }),
    ).toHaveCount(0);
  });
});
