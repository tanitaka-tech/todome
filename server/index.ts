import { Hono } from "hono";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT, PORT } from "./config.ts";
import { initDb } from "./db.ts";
import type { WSData } from "./state.ts";
import { makeWSData, wsHandlers } from "./ws/endpoint.ts";
import { registerAllHandlers } from "./ws/handlers/index.ts";

initDb();
registerAllHandlers();

const app = new Hono();

const CLIENT_DIST = join(PROJECT_ROOT, "client", "dist");
const hasClientDist = existsSync(CLIENT_DIST);

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
