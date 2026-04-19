import { expect, test } from "@playwright/test";
import { gotoApp } from "../fixtures/helpers";

test.describe("AIアシスタント (ChatPanel)", () => {
  test("初期表示でチャットパネルが開いており、閉じる/再度開くができる", async ({
    page,
  }) => {
    await gotoApp(page);

    const panel = page.locator(".chat-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".chat-input")).toBeVisible();

    // 閉じる (display:none になる)
    await page.locator(".chat-panel-close").click();
    await expect(panel).toBeHidden();

    // 開く
    await page.getByRole("button", { name: "AIアシスタントを開く" }).click();
    await expect(panel).toBeVisible();
  });

  test("入力欄にテキストを入れて送信ボタンが有効になる (送信はしない)", async ({
    page,
  }) => {
    await gotoApp(page);
    const input = page.locator(".chat-input");
    await input.fill("hello");
    // 送信ボタンは waiting=false のとき .chat-send が有効
    const sendBtn = page.locator(".chat-send").first();
    await expect(sendBtn).toBeEnabled();
  });
});
