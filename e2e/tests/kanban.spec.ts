import { expect, test, type Locator, type Page } from "@playwright/test";
import { clickNav, gotoApp, uniqueMark } from "../fixtures/helpers";

async function dragLocatorTo(
  page: Page,
  source: Locator,
  target: Locator,
  targetPosition: { x: number; y: number },
): Promise<void> {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  if (!sourceBox || !targetBox) return;

  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + Math.min(24, sourceBox.height / 2),
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetPosition.x,
    targetBox.y + targetPosition.y,
    { steps: 12 },
  );
  await page.mouse.up();
}

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

  test("下段パネル高さの復元後もTODOカードを操作できる高さを保つ", async ({ page }) => {
    await page.evaluate(() => {
      window.localStorage.setItem("todome.board.bottomHeight", "10000");
    });
    await gotoApp(page);
    await clickNav(page, "ボード");

    const title = uniqueMark("task-drag-area");
    const todoColumn = page.locator(".kanban-column").first();
    const inProgressColumn = page.locator(".kanban-column").nth(1);
    const todoCards = todoColumn.locator(".kanban-cards");

    await todoColumn.locator(".kanban-add-btn").click();
    await todoColumn.locator(".kanban-add-input").fill(title);
    await todoColumn.locator(".kanban-add-submit").click();

    const card = todoColumn.locator(".kanban-card", { hasText: title });
    await expect(card).toBeVisible();
    const cardsBox = await todoCards.boundingBox();
    expect(cardsBox?.height ?? 0).toBeGreaterThan(120);

    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await card.dispatchEvent("dragstart", { dataTransfer });
    await inProgressColumn.dispatchEvent("dragover", { dataTransfer });
    await inProgressColumn.dispatchEvent("drop", { dataTransfer });

    await expect(
      inProgressColumn.locator(".kanban-card", { hasText: title }),
    ).toBeVisible();

    const movedCard = inProgressColumn.locator(".kanban-card", { hasText: title });
    const nextDataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await movedCard.dispatchEvent("dragstart", { dataTransfer: nextDataTransfer });
    await todoColumn.dispatchEvent("dragover", { dataTransfer: nextDataTransfer });
    await todoColumn.dispatchEvent("drop", { dataTransfer: nextDataTransfer });

    await expect(todoColumn.locator(".kanban-card", { hasText: title })).toBeVisible();
  });

  test("TODOから進行中の先頭へ移動したカードをすぐ再ドラッグできる", async ({ page }) => {
    const targetTitle = uniqueMark("drag-target");
    const subjectTitle = uniqueMark("drag-subject");
    const todoColumn = page.locator(".kanban-column").first();
    const inProgressColumn = page.locator(".kanban-column").nth(1);

    await todoColumn.locator(".kanban-add-btn").click();
    await todoColumn.locator(".kanban-add-input").fill(targetTitle);
    await todoColumn.locator(".kanban-add-submit").click();

    const targetCardInTodo = todoColumn.locator(".kanban-card", {
      hasText: targetTitle,
    });
    const seedDataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await targetCardInTodo.dispatchEvent("dragstart", {
      dataTransfer: seedDataTransfer,
    });
    await inProgressColumn.dispatchEvent("dragover", {
      dataTransfer: seedDataTransfer,
    });
    await inProgressColumn.dispatchEvent("drop", { dataTransfer: seedDataTransfer });

    const targetCard = inProgressColumn.locator(".kanban-card", {
      hasText: targetTitle,
    });
    await expect(targetCard).toBeVisible();

    await todoColumn.locator(".kanban-add-btn").click();
    await todoColumn.locator(".kanban-add-input").fill(subjectTitle);
    await todoColumn.locator(".kanban-add-submit").click();

    const subjectCard = todoColumn.locator(".kanban-card", {
      hasText: subjectTitle,
    });
    await expect(subjectCard).toBeVisible();

    await dragLocatorTo(page, subjectCard, targetCard, { x: 20, y: 8 });
    const movedSubject = inProgressColumn.locator(".kanban-card", {
      hasText: subjectTitle,
    });
    await expect(movedSubject).toBeVisible();

    await dragLocatorTo(page, movedSubject, todoColumn, { x: 32, y: 72 });
    await expect(
      todoColumn.locator(".kanban-card", { hasText: subjectTitle }),
    ).toBeVisible();
  });
});
