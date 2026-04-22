// config.ts は読み込み時点で DATA_DIR を固定するため、server コードを import する前に
// テスト用ディレクトリを環境変数で指すようにする。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), "todome-endpoint-test-"));
process.env.TODOME_DATA_DIR = TEST_DATA_DIR;

import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetDbCache } from "../db.ts";
import { createSessionState, type AppWebSocket } from "../state.ts";
import { MESSAGE_HANDLERS, registerHandler } from "./dispatch.ts";
import { wsHandlers } from "./endpoint.ts";

interface SentMessage {
  type: string;
  [k: string]: unknown;
}

function makeFakeWs(): { ws: AppWebSocket; sent: SentMessage[] } {
  const sent: SentMessage[] = [];
  const session = createSessionState();
  const fake = {
    data: { id: "test-ws", session },
    send(payload: string) {
      sent.push(JSON.parse(payload) as SentMessage);
    },
  } as unknown as AppWebSocket;
  return { ws: fake, sent };
}

describe("wsHandlers.message error propagation", () => {
  beforeEach(() => {
    // 念のためハンドラ一覧をクリア（handlers/index.ts の登録は副作用 import に依存する
    // ため、endpoint.ts 単体テストではここで閉じた世界を作る）。
    MESSAGE_HANDLERS.clear();
  });

  afterEach(() => {
    MESSAGE_HANDLERS.clear();
  });

  afterAll(() => {
    resetDbCache();
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it("ハンドラ例外時に error メッセージを WS へ返す", async () => {
    registerHandler("boom", async () => {
      throw new Error("kaboom");
    });
    const { ws, sent } = makeFakeWs();

    await wsHandlers.message(ws, JSON.stringify({ type: "boom" }));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      type: "error",
      scope: "handler",
      requestType: "boom",
      message: "kaboom",
    });
  });

  it("未知の type に対して error メッセージを返す", async () => {
    const { ws, sent } = makeFakeWs();

    await wsHandlers.message(ws, JSON.stringify({ type: "does_not_exist" }));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "error",
      scope: "unknown_type",
      requestType: "does_not_exist",
    });
  });

  it("不正な JSON を受信したら error メッセージを返す", async () => {
    const { ws, sent } = makeFakeWs();

    await wsHandlers.message(ws, "{ not json");

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "error",
      scope: "parse",
    });
  });

  it("ask_response と cancel は error を返さない（既存挙動の維持）", async () => {
    const { ws, sent } = makeFakeWs();

    await wsHandlers.message(ws, JSON.stringify({ type: "cancel" }));
    expect(sent).toHaveLength(0);
    expect(ws.data.session.cancelRequested).toBe(true);

    await wsHandlers.message(
      ws,
      JSON.stringify({ type: "ask_response", requestId: "nonexistent" }),
    );
    expect(sent).toHaveLength(0);
  });

  it("正常ハンドラの場合は error を返さない", async () => {
    let called = false;
    registerHandler("ok", async () => {
      called = true;
    });
    const { ws, sent } = makeFakeWs();

    await wsHandlers.message(ws, JSON.stringify({ type: "ok" }));

    expect(called).toBe(true);
    expect(sent).toHaveLength(0);
  });
});
