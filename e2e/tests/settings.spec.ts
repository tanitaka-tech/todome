import { expect, test } from "@playwright/test";
import { clickNav, gotoApp } from "../fixtures/helpers";

test.describe("設定: テーマ切替", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await clickNav(page, "設定");
  });

  test("テーマを切り替えると data-theme と localStorage が更新される", async ({
    page,
  }) => {
    const themeOptions = page.locator(".theme-option");
    // "Paper" テーマを選択（ライトテーマの中で ID が paper）
    await themeOptions
      .filter({ has: page.locator(".theme-option-name", { hasText: "Paper" }) })
      .first()
      .click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
    const stored = await page.evaluate(() =>
      window.localStorage.getItem("todome.theme"),
    );
    expect(stored).toBe("paper");

    // 別のテーマにも切替えて永続化を確認
    await themeOptions
      .filter({ has: page.locator(".theme-option-name", { hasText: "Forest" }) })
      .first()
      .click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "forest");
  });
});
