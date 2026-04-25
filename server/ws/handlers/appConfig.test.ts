// config.ts は読み込み時点で DATA_DIR を固定するため、server コードを import する前に
// テスト用ディレクトリを環境変数で指すようにする。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), "todome-appconfig-handler-test-"));
process.env.TODOME_DATA_DIR = TEST_DATA_DIR;

import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetDbCache } from "../../db.ts";
import {
  activeSockets,
  createSessionState,
  type AppWebSocket,
  type SessionState,
} from "../../state.ts";
import { resetAppConfigCache } from "../../storage/appConfig.ts";
import { appConfigUpdate } from "./appConfig.ts";

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

describe("appConfigUpdate handler", () => {
  let sent: SentMessage[];

  beforeEach(() => {
    activeSockets.clear();
    resetAppConfigCache();
    sent = attachFakeBroadcastSocket();
  });

  afterEach(() => {
    activeSockets.clear();
    resetAppConfigCache();
  });

  afterAll(() => {
    resetDbCache();
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it("正規化された config を app_config_sync でブロードキャストする", async () => {
    const { ws, session } = makeRequester();

    await appConfigUpdate(ws, session, { config: { dayBoundaryHour: 6 } });

    const syncs = sent.filter((m) => m.type === "app_config_sync");
    expect(syncs).toHaveLength(1);
    expect(syncs[0]).toMatchObject({
      type: "app_config_sync",
      config: { dayBoundaryHour: 6 },
    });
  });

  it("範囲外の値はデフォルト (4) に丸めて broadcast される", async () => {
    const { ws, session } = makeRequester();

    await appConfigUpdate(ws, session, { config: { dayBoundaryHour: 99 } });

    const sync = sent.find((m) => m.type === "app_config_sync");
    expect(sync).toMatchObject({ config: { dayBoundaryHour: 4 } });
  });

  it("calendarWeekStart を正規化して broadcast する", async () => {
    const { ws, session } = makeRequester();

    await appConfigUpdate(ws, session, { config: { calendarWeekStart: 0 } });

    const sync = sent.find((m) => m.type === "app_config_sync");
    expect(sync).toMatchObject({ config: { calendarWeekStart: 0 } });
  });

  it("config 未指定時は空オブジェクト扱いでデフォルト値が broadcast される", async () => {
    const { ws, session } = makeRequester();

    await appConfigUpdate(ws, session, {});

    const sync = sent.find((m) => m.type === "app_config_sync");
    expect(sync).toMatchObject({ config: { dayBoundaryHour: 4 } });
  });

  it("dayBoundaryHour が変化したときだけ life/quota の sync が追加で broadcast される", async () => {
    const { ws, session } = makeRequester();

    // 初期化: デフォルト (4) を確定させる
    await appConfigUpdate(ws, session, { config: { dayBoundaryHour: 4 } });
    sent.length = 0;

    // 値を変更
    await appConfigUpdate(ws, session, { config: { dayBoundaryHour: 7 } });

    const types = sent.map((m) => m.type);
    expect(types).toContain("app_config_sync");
    expect(types).toContain("life_log_sync");
    expect(types).toContain("quota_log_sync");
    expect(types).toContain("quota_streak_sync");
  });

  it("dayBoundaryHour が同じ値なら追加 broadcast は飛ばない", async () => {
    const { ws, session } = makeRequester();

    await appConfigUpdate(ws, session, { config: { dayBoundaryHour: 4 } });
    sent.length = 0;

    await appConfigUpdate(ws, session, { config: { dayBoundaryHour: 4 } });

    expect(sent.filter((m) => m.type === "app_config_sync")).toHaveLength(1);
    expect(sent.filter((m) => m.type === "life_log_sync")).toHaveLength(0);
    expect(sent.filter((m) => m.type === "quota_log_sync")).toHaveLength(0);
    expect(sent.filter((m) => m.type === "quota_streak_sync")).toHaveLength(0);
  });
});
