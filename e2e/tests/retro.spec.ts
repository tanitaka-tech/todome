import { expect, test } from "@playwright/test";
import { clickNav, gotoApp } from "../fixtures/helpers";

test.describe("振り返り", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await clickNav(page, "振り返り");
  });

  test("4タブを切り替えると開始ボタンのタイトルが変わる", async ({ page }) => {
    const start = page.locator(".retro-start-title");
    const period = page.locator(".retro-tabs .period-dropdown");
    const trigger = period.locator(".period-dropdown-button");

    await trigger.click();
    await period.locator(".period-dropdown-item", { hasText: "日" }).click();
    await expect(start).toContainText("日次振り返り");

    await trigger.click();
    await period.locator(".period-dropdown-item", { hasText: "週" }).click();
    await expect(start).toContainText("週次振り返り");

    await trigger.click();
    await period.locator(".period-dropdown-item", { hasText: "月" }).click();
    await expect(start).toContainText("月次振り返り");

    await trigger.click();
    await period.locator(".period-dropdown-item", { hasText: "年" }).click();
    await expect(start).toContainText("年次振り返り");
  });

  test("対象日を変更すると「今日に戻す」ボタンが出る", async ({ page }) => {
    const dateInput = page.locator(".retro-start-date-input");
    await dateInput.fill("2020-01-15");
    await expect(
      page.getByRole("button", { name: "今日に戻す" }),
    ).toBeVisible();
  });
});
