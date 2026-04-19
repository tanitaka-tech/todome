import type { Page } from "@playwright/test";

export type NavLabel =
  | "Overview"
  | "ボード"
  | "目標"
  | "振り返り"
  | "統計"
  | "プロフィール"
  | "設定";

export async function gotoApp(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForSelector(".app-shell");
  await page.waitForSelector(".topbar-status-dot--online", { timeout: 10_000 });
}

export async function clickNav(page: Page, label: NavLabel): Promise<void> {
  await page
    .locator(".sidebar-nav-item", { hasText: label })
    .first()
    .click();
}

export function uniqueMark(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}
