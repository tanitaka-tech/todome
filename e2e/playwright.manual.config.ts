import { defineConfig } from "@playwright/test";
import path from "node:path";

// 画面説明書のスクリーンショット取得用。e2e テスト (playwright.config.ts) と
// 別のデータディレクトリ・別ポートで走らせ、互いの状態を汚さない。
const PORT = 3112;
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(__dirname, "data-manual");

export default defineConfig({
  testDir: "./manual",
  testMatch: /(capture|animations)\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  },
  webServer: {
    command: `TODOME_DATA_DIR="${dataDir}" uv run uvicorn server:app --host 127.0.0.1 --port ${PORT}`,
    cwd: rootDir,
    url: `http://127.0.0.1:${PORT}`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
