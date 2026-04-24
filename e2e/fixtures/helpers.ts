import type { Page } from "@playwright/test";

export type NavLabel =
  | "Overview"
  | "ボード"
  | "目標"
  | "振り返り"
  | "統計"
  | "プロフィール"
  | "設定";

const NAV_LABEL_ALIASES: Record<NavLabel, string[]> = {
  Overview: ["Overview"],
  ボード: ["ボード", "Board"],
  目標: ["目標", "Goals"],
  振り返り: ["振り返り", "Retro"],
  統計: ["統計", "Stats"],
  プロフィール: ["プロフィール", "Profile"],
  設定: ["設定", "Settings"],
};

export async function gotoApp(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForSelector(".app-shell");
  await page.waitForSelector(".topbar-status-dot--online", { timeout: 10_000 });
}

export async function clickNav(page: Page, label: NavLabel): Promise<void> {
  const labels = NAV_LABEL_ALIASES[label];
  for (const text of labels) {
    const item = page.locator(".sidebar-nav-item", { hasText: text }).first();
    if ((await item.count()) > 0) {
      await item.click();
      return;
    }
  }
  await page.locator(".sidebar-nav-item", { hasText: label }).first().click();
}

export function uniqueMark(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}
