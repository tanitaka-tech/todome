import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { clickNav, gotoApp } from "../fixtures/helpers";
import { seedAll } from "./seed";

const SHOT_DIR = path.resolve(
  __dirname,
  "../../docs/manual/assets/screenshots",
);

const shotPath = (name: string) => path.join(SHOT_DIR, `${name}.png`);

async function shot(page: Page, name: string): Promise<void> {
  // アニメーションや非同期描画の落ち着きを待つ
  await page.waitForTimeout(300);
  await page.screenshot({ path: shotPath(name), fullPage: false });
}

async function closeChat(page: Page): Promise<void> {
  const closeBtn = page.locator(".chat-panel-close");
  if (await closeBtn.isVisible()) {
    await closeBtn.click();
    await page.waitForTimeout(200);
  }
}

async function openChat(page: Page): Promise<void> {
  const openBtn = page.locator(".topbar-toggle--right");
  if (await openBtn.isVisible()) {
    await openBtn.click();
    await page.waitForTimeout(200);
  }
}

test.describe.configure({ mode: "serial" });

test.describe("画面説明書スクリーンショット", () => {
  test("00 デモデータ投入", async ({ page }) => {
    await gotoApp(page);
    await seedAll(page);
  });

  test("01 Overview", async ({ page }) => {
    await gotoApp(page);
    await closeChat(page);
    // Overview が初期ビュー
    await expect(
      page.getByRole("heading", { name: "Overview", level: 1 }),
    ).toBeVisible();
    await shot(page, "overview");
  });

  test("02 ボード", async ({ page }) => {
    await gotoApp(page);
    await closeChat(page);
    await clickNav(page, "ボード");
    await expect(page.locator(".kanban-column")).toHaveCount(3);
    await shot(page, "board");
  });

  test("03 ボード: タスク追加中", async ({ page }) => {
    await gotoApp(page);
    await closeChat(page);
    await clickNav(page, "ボード");
    const todoColumn = page.locator(".kanban-column").first();
    await todoColumn.locator(".kanban-add-btn").click();
    await todoColumn.locator(".kanban-add-input").fill("新しいタスクの例");
    await page.waitForTimeout(200);
    await shot(page, "board-add-task");
    // Escで開いたフォームを閉じる(次テストに影響しないように)
    await page.keyboard.press("Escape");
  });

  test("04 目標", async ({ page }) => {
    await gotoApp(page);
    await closeChat(page);
    await clickNav(page, "目標");
    await expect(
      page.getByRole("heading", { name: "目標管理", level: 1 }),
    ).toBeVisible();
    await shot(page, "goal");
  });

  test("05 振り返り", async ({ page }) => {
    await gotoApp(page);
    await closeChat(page);
    await clickNav(page, "振り返り");
    await expect(
      page.getByRole("heading", { name: "振り返り", level: 1 }),
    ).toBeVisible();
    await shot(page, "retrospective");
  });

  test("06 統計", async ({ page }) => {
    await gotoApp(page);
    await closeChat(page);
    await clickNav(page, "統計");
    await expect(
      page.getByRole("heading", { name: "統計", level: 1 }),
    ).toBeVisible();
    await shot(page, "stats");
  });

  test("07 プロフィール", async ({ page }) => {
    await gotoApp(page);
    await closeChat(page);
    await clickNav(page, "プロフィール");
    await expect(
      page.getByRole("heading", { name: "プロフィール", level: 1 }),
    ).toBeVisible();
    await shot(page, "profile");
  });

  test("08 設定", async ({ page }) => {
    await gotoApp(page);
    await closeChat(page);
    await clickNav(page, "設定");
    await expect(
      page.getByRole("heading", { name: "設定", level: 1 }),
    ).toBeVisible();
    await shot(page, "settings");
  });

  test("09 AIチャット(パネル展開)", async ({ page }) => {
    await gotoApp(page);
    // Overviewでチャット展開状態のフルスクリーンショットを撮る
    await openChat(page);
    await expect(page.locator(".chat-panel")).toBeVisible();
    await shot(page, "chat");
  });

  test("10 タスク詳細モーダル", async ({ page }) => {
    await gotoApp(page);
    await closeChat(page);
    await clickNav(page, "ボード");
    // 最初のカードを開く
    const firstCard = page.locator(".kanban-card").first();
    await firstCard.click();
    await expect(page.locator(".modal-content")).toBeVisible();
    await shot(page, "task-detail");
    await page.locator(".modal-close").first().click();
  });
});
