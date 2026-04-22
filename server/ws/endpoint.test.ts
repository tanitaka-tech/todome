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

  it("非 Error オブジェクトが throw されてもプロパティを外部漏洩しない", async () => {
    // ハンドラが { secret, message } のような任意オブジェクトを throw した場合、
    // JSON.stringify されてクライアントに全プロパティが返る挙動を避けたい。
    registerHandler("leaky", async () => {
      throw { secret: "DO_NOT_LEAK", message: "look here" };
    });
    const { ws, sent } = makeFakeWs();

    await wsHandlers.message(ws, JSON.stringify({ type: "leaky" }));

    expect(sent).toHaveLength(1);
    const serialized = JSON.stringify(sent[0]);
    expect(serialized).not.toContain("DO_NOT_LEAK");
    expect(sent[0]).toMatchObject({
      type: "error",
      scope: "handler",
      requestType: "leaky",
    });
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
