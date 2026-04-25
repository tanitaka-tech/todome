import { expect, test } from "@playwright/test";
import { clickNav, gotoApp } from "../fixtures/helpers";

test.describe("全画面の遷移", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test("Overview が初期表示される", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Overview", level: 1 }),
    ).toBeVisible();
  });

  test("ボード: 3カラムが表示される", async ({ page }) => {
    await clickNav(page, "ボード");
    await expect(page.locator(".kanban-column")).toHaveCount(3);
    await expect(page.locator(".kanban-column-title")).toContainText([
      "TODO",
      "進行中",
      "完了",
    ]);
  });

  test("目標: ページタイトルと追加ボタン", async ({ page }) => {
    await clickNav(page, "目標");
    await expect(
      page.getByRole("heading", { name: "目標管理", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "+ 新しい目標" })).toBeVisible();
  });

  test("振り返り: 4つの期間タブ", async ({ page }) => {
    await clickNav(page, "振り返り");
    await expect(
      page.getByRole("heading", { name: "振り返り", level: 1 }),
    ).toBeVisible();
    const period = page.locator(".retro-tabs .period-dropdown");
    await period.locator(".period-dropdown-button").click();
    const options = period.locator(".period-dropdown-item");
    await expect(options).toHaveCount(4);
    await expect(options).toContainText(["日", "週", "月", "年"]);
  });

  test("統計: ページタイトル", async ({ page }) => {
    await clickNav(page, "統計");
    await expect(
      page.getByRole("heading", { name: "統計", level: 1 }),
    ).toBeVisible();
  });

  test("プロフィール: ページタイトル", async ({ page }) => {
    await clickNav(page, "プロフィール");
    await expect(
      page.getByRole("heading", { name: "プロフィール", level: 1 }),
    ).toBeVisible();
  });

  test("設定: テーマ選択ボタンが複数ある", async ({ page }) => {
    await clickNav(page, "設定");
    await expect(
      page.getByRole("heading", { name: "設定", level: 1 }),
    ).toBeVisible();
    await expect(page.locator(".theme-groups .theme-option")).toHaveCount(12);
  });
});
