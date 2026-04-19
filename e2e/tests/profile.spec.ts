import { expect, test } from "@playwright/test";
import { clickNav, gotoApp, uniqueMark } from "../fixtures/helpers";

test.describe("プロフィール編集", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await clickNav(page, "プロフィール");
  });

  test("現在の自分の状態を入力すると再読込後も残る", async ({ page }) => {
    const text = uniqueMark("state");
    const textarea = page.locator(".profile-textarea").first();
    await textarea.fill(text);
    // onChange で send 済みだが、WS 往復を待ってから reload
    await page.waitForTimeout(800);

    await page.reload();
    await page.waitForSelector(".topbar-status-dot--online");
    await clickNav(page, "プロフィール");

    await expect(page.locator(".profile-textarea").first()).toHaveValue(text);
  });

  test("バランスホイールにカテゴリを追加できる", async ({ page }) => {
    // カテゴリが 3つ未満のときは SVG ラベルが出ないので、
    // バランスホイールのウィジェットヘッダに出るカテゴリ件数で検証する。
    const bwHead = page
      .locator(".widget", { has: page.getByText("バランスホイール") })
      .locator(".widget-sub");
    const beforeText = (await bwHead.textContent())?.trim() ?? "";
    const before = parseInt(beforeText.match(/\d+/)?.[0] ?? "0", 10);

    const catName = uniqueMark("cat");
    await page.locator(".bw-cat-input").fill(catName);
    await page.locator(".bw-cat-submit").click();

    await expect(bwHead).toContainText(`${before + 1} categories`);
  });
});
