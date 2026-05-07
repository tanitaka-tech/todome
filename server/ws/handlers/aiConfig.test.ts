// config.ts は読み込み時点で DATA_DIR を固定するため、server コードを import する前に
// テスト用ディレクトリを環境変数で指すようにする。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), "todome-aiconfig-handler-test-"));
process.env.TODOME_DATA_DIR = TEST_DATA_DIR;

import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetDbCache } from "../../db.ts";
import {
  activeSockets,
  createSessionState,
  type AppWebSocket,
  type SessionState,
} from "../../state.ts";
import { resetAIConfigCache } from "../../storage/aiConfig.ts";
import { aiConfigUpdate } from "./aiConfig.ts";

interface SentMessage {
  type: string;
  [k: string]: unknown;
}

function attachFakeBroadcastSocket(): SentMessage[] {
  const sent: SentMessage[] = [];
  const fake = {
    data: { id: "broadcast", session: createSessionState() },
    send(payload: string) {
      sent.push(JSON.parse(payload) as SentMessage);
    },
  } as unknown as AppWebSocket;
  activeSockets.add(fake);
  return sent;
}

function makeRequester(): { ws: AppWebSocket; session: SessionState } {
  const session = createSessionState();
  const ws = {
    data: { id: "requester", session },
    send() {},
  } as unknown as AppWebSocket;
  return { ws, session };
}

describe("aiConfigUpdate handler", () => {
  let sent: SentMessage[];

  beforeEach(() => {
    activeSockets.clear();
    resetAIConfigCache();
    sent = attachFakeBroadcastSocket();
  });

  afterEach(() => {
    activeSockets.clear();
    resetAIConfigCache();
  });

  afterAll(() => {
    resetDbCache();
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it("正規化された config を ai_config_sync でブロードキャストする", async () => {
    const { ws, session } = makeRequester();

    await aiConfigUpdate(ws, session, {
      config: {
        allowedTools: ["Bash", "Read"],
        allowGhApi: true,
        model: "claude-opus-4-7",
        thinkingEffort: "low",
      },
    });

    const syncs = sent.filter((m) => m.type === "ai_config_sync");
    expect(syncs).toHaveLength(1);
    expect(syncs[0]).toMatchObject({
      type: "ai_config_sync",
      config: {
        allowedTools: ["Bash", "Read"],
        allowGhApi: true,
        model: "claude-opus-4-7",
        thinkingEffort: "low",
      },
    });
  });

  it("config 未指定時はデフォルト設定で broadcast される", async () => {
    const { ws, session } = makeRequester();

    await aiConfigUpdate(ws, session, {});

    const sync = sent.find((m) => m.type === "ai_config_sync");
    expect(sync).toMatchObject({
      type: "ai_config_sync",
      config: {
        allowedTools: ["TodoWrite", "Bash"],
        allowGhApi: false,
        model: "claude-sonnet-4-6",
        thinkingEffort: "high",
      },
    });
  });

  it("不正な model / thinkingEffort はデフォルトに丸められる", async () => {
    const { ws, session } = makeRequester();

    await aiConfigUpdate(ws, session, {
      config: { model: "gpt-4", thinkingEffort: "extreme" },
    });

    const sync = sent.find((m) => m.type === "ai_config_sync");
    expect(sync).toMatchObject({
      config: {
        model: "claude-sonnet-4-6",
        thinkingEffort: "high",
      },
    });
  });

  it("model alias (sonnet/opus/haiku) は正規モデル名に展開される", async () => {
    const { ws, session } = makeRequester();

    await aiConfigUpdate(ws, session, { config: { model: "opus" } });

    const sync = sent.find((m) => m.type === "ai_config_sync");
    expect(sync).toMatchObject({ config: { model: "claude-opus-4-7" } });
  });

  it("カタログに無いツールは allowedTools から除外される", async () => {
    const { ws, session } = makeRequester();

    await aiConfigUpdate(ws, session, {
      config: { allowedTools: ["Bash", "EvilTool", "Bash", "Read"] },
    });

    const sync = sent.find((m) => m.type === "ai_config_sync");
    expect(sync).toMatchObject({
      config: { allowedTools: ["Bash", "Read"] },
    });
  });

  it("既存の session.client.close を呼び、session 状態をリセットする", async () => {
    const { ws, session } = makeRequester();
    let closeCalled = 0;
    session.client = {
      close: async () => {
        closeCalled += 1;
      },
    };
    session.cancelRequested = true;

    await aiConfigUpdate(ws, session, { config: {} });

    expect(closeCalled).toBe(1);
    expect(session.client).toBeNull();
    expect(session.cancelRequested).toBe(false);
  });

  it("session.client.close が throw しても broadcast は届く", async () => {
    const { ws, session } = makeRequester();
    session.client = {
      close: async () => {
        throw new Error("boom");
      },
    };

    await aiConfigUpdate(ws, session, { config: {} });

    expect(session.client).toBeNull();
    expect(sent.some((m) => m.type === "ai_config_sync")).toBe(true);
  });
});
