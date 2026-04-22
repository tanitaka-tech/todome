import { defineConfig } from "@playwright/test";
import path from "node:path";

// 開発用 :3002 と衝突しないよう E2E は 3102 を使う
const PORT = 3102;
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(__dirname, "data-e2e");

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    // client/dist は事前に `cd client && npm run build` しておく前提
    // uv run は親 env を引き継ぐが、念のため inline で TODOME_DATA_DIR を渡す
    command: `TODOME_DATA_DIR="${dataDir}" TODOME_BACKEND_PORT=${PORT} bun server/index.ts`,
    cwd: rootDir,
    url: `http://127.0.0.1:${PORT}`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
