import { expect, test } from "@playwright/test";
import { clickNav, gotoApp, uniqueMark } from "../fixtures/helpers";

test.describe("Kanban CRUD", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await clickNav(page, "ボード");
  });

  test("タスクを追加して一覧に表示される", async ({ page }) => {
    const title = uniqueMark("task");
    const todoColumn = page.locator(".kanban-column").first();

    await todoColumn.locator(".kanban-add-btn").click();
    await todoColumn.locator(".kanban-add-input").fill(title);
    await todoColumn.locator(".kanban-add-submit").click();

    await expect(
      todoColumn.locator(".kanban-card-title", { hasText: title }),
    ).toBeVisible();
  });

  test("カードをクリックすると詳細モーダルが開く", async ({ page }) => {
    const title = uniqueMark("task-detail");
    const todoColumn = page.locator(".kanban-column").first();

    await todoColumn.locator(".kanban-add-btn").click();
    await todoColumn.locator(".kanban-add-input").fill(title);
    await todoColumn.locator(".kanban-add-submit").click();

    await todoColumn
      .locator(".kanban-card", { hasText: title })
      .first()
      .click();

    await expect(page.locator(".modal-content")).toBeVisible();
    await page.locator(".modal-close").first().click();
    await expect(page.locator(".modal-content")).toHaveCount(0);
  });

  test("追加したタスクを削除できる", async ({ page }) => {
    const title = uniqueMark("task-del");
    const todoColumn = page.locator(".kanban-column").first();

    await todoColumn.locator(".kanban-add-btn").click();
    await todoColumn.locator(".kanban-add-input").fill(title);
    await todoColumn.locator(".kanban-add-submit").click();

    const card = todoColumn.locator(".kanban-card", { hasText: title });
    await expect(card).toBeVisible();
    await card.locator(".kanban-card-delete").click();
    await expect(card).toHaveCount(0);
  });
});
