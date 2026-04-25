import { Hono } from "hono";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT, PORT } from "./config.ts";
import { initDb } from "./db.ts";
import type { WSData } from "./state.ts";
import { makeWSData, wsHandlers } from "./ws/endpoint.ts";
import { registerAllHandlers } from "./ws/handlers/index.ts";
import { handleOAuthCallback } from "./ws/handlers/google.ts";

initDb();
registerAllHandlers();

// Bun のデフォルトでは unhandled rejection / uncaught exception が握りつぶされて
// プロセスが落ちる or 黙る。`void promise.catch(() => {})` パターンが各所にあるため、
// 最低限ログだけは残してデバッグ可能にする。プロセスは落とさない。
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

const app = new Hono();

const CLIENT_DIST = join(PROJECT_ROOT, "client", "dist");
const hasClientDist = existsSync(CLIENT_DIST);

// Google OAuth Loopback コールバック。catch-all より前に登録する。
app.get("/google/oauth/callback", async (c) => {
  const url = new URL(c.req.url);
  const result = await handleOAuthCallback({
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
    error: url.searchParams.get("error"),
  });
  const title = result.ok ? "todome: Google 連携完了" : "todome: Google 連携エラー";
  const heading = result.ok ? "✅ 接続しました" : "⚠️ 接続できませんでした";
  const body = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}h1{font-size:1.5rem;margin:0 0 12px}p{margin:0 0 16px;line-height:1.6}.box{max-width:520px;background:#1e293b;border-radius:12px;padding:32px;border:1px solid #334155}</style>
</head><body><div class="box"><h1>${heading}</h1><p>${escapeHtml(result.message)}</p><p><small>このタブを閉じて todome に戻ってください。</small></p></div></body></html>`;
  return c.html(body, result.ok ? 200 : 400);
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

app.get("*", async (c) => {
  if (!hasClientDist) return c.text("client/dist not built", 404);
  const url = new URL(c.req.url);
  let filePath = join(CLIENT_DIST, url.pathname);
  if (
    !filePath.startsWith(CLIENT_DIST) ||
    !existsSync(filePath) ||
    !statSync(filePath).isFile()
  ) {
    filePath = join(CLIENT_DIST, "index.html");
  }
  const file = Bun.file(filePath);
  return new Response(file, {
    headers: { "content-type": file.type || "application/octet-stream" },
  });
});

const server = Bun.serve<WSData, never>({
  port: PORT,
  hostname: "0.0.0.0",
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (srv.upgrade(req, { data: makeWSData() })) return undefined;
      return new Response("WS upgrade failed", { status: 500 });
    }
    return app.fetch(req);
  },
  websocket: {
    open(ws) {
      void wsHandlers.open(ws);
    },
    message(ws, raw) {
      void wsHandlers.message(ws, typeof raw === "string" ? raw : Buffer.from(raw));
    },
    close(ws) {
      wsHandlers.close(ws);
    },
  },
});

console.log(`[todome] listening on http://${server.hostname}:${server.port}`);
