import type { Page } from "@playwright/test";
import { clickNav } from "../fixtures/helpers";

// 画面説明書のスクショに載せるデモデータを UI 経由で投入する。
// サーバー側は SQLite 永続化なので一度入れれば次回の `capture` でも残る。
// `precapture` で data-manual/ を消す前提で、毎回ゼロから作り直す想定。

const SAMPLE_TASKS: {
  column: 0 | 1 | 2;
  title: string;
  priority?: "low" | "medium" | "high";
}[] = [
  { column: 0, title: "画面説明書のドラフトレビュー", priority: "high" },
  { column: 0, title: "仕様ドキュメント更新" },
  { column: 0, title: "週次ミーティング資料準備", priority: "low" },
  { column: 1, title: "Playwrightスクショ自動化", priority: "high" },
  { column: 1, title: "GoalPanelのKPI UIリファイン" },
  { column: 2, title: "振り返り機能リリース", priority: "medium" },
  { column: 2, title: "GitHub連携フェーズ1完了" },
];

export async function seedBoard(page: Page): Promise<void> {
  await clickNav(page, "ボード");
  const columns = page.locator(".kanban-column");

  for (const t of SAMPLE_TASKS) {
    const col = columns.nth(t.column);
    await col.locator(".kanban-add-btn").click();
    await col.locator(".kanban-add-input").fill(t.title);
    // 優先度セレクタはフォームに存在しないケースもあるため最小限で投入
    await col.locator(".kanban-add-submit").click();
    // ややゆっくりに。WSで反映されるのを待つ
    await page.waitForTimeout(120);
  }
}

export async function seedGoals(page: Page): Promise<void> {
  await clickNav(page, "目標");

  await page.getByRole("button", { name: "+ 新しい目標" }).click();
  const modal1 = page.locator(".modal-content").first();
  await modal1.locator(".modal-input").first().fill("プロダクトを月次リリース");
  await modal1.locator(".kpi-input-name").first().fill("リリース回数");
  await modal1.locator(".kpi-input-num").first().fill("1");
  await modal1.locator(".modal-btn-primary", { hasText: "保存" }).click();
  await page.waitForTimeout(300);

  await page.getByRole("button", { name: "+ 新しい目標" }).click();
  const modal2 = page.locator(".modal-content").first();
  await modal2.locator(".modal-input").first().fill("ランニング週3回");
  await modal2.locator(".kpi-input-name").first().fill("走った日数");
  await modal2.locator(".kpi-input-num").first().fill("12");
  await modal2.locator(".modal-btn-primary", { hasText: "保存" }).click();
  await page.waitForTimeout(300);
}

export async function seedProfile(page: Page): Promise<void> {
  await clickNav(page, "自分について");

  const stateArea = page.locator(".profile-textarea").first();
  await stateArea.fill(
    "新規プロダクトの PM として、週2本のフィーチャーリリースを目指している。技術負債の返済とユーザー体験の底上げを両立させたい。",
  );
  // onChange で送信されるが WS 往復を待つ
  await page.waitForTimeout(500);

  // バランスホイールに2つカテゴリを追加
  await page.locator(".bw-cat-input").fill("仕事");
  await page.locator(".bw-cat-submit").click();
  await page.waitForTimeout(200);
  await page.locator(".bw-cat-input").fill("健康");
  await page.locator(".bw-cat-submit").click();
  await page.waitForTimeout(200);
  await page.locator(".bw-cat-input").fill("学び");
  await page.locator(".bw-cat-submit").click();
  await page.waitForTimeout(200);
}

export async function seedAll(page: Page): Promise<void> {
  await seedBoard(page);
  await seedGoals(page);
  await seedProfile(page);
}
