// config.ts は読み込み時点で DATA_DIR を固定するため、server コードを import する前に
// テスト用ディレクトリを環境変数で指すようにする。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), "todome-caldav-handler-test-"));
process.env.TODOME_DATA_DIR = TEST_DATA_DIR;

import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetDbCache } from "../../db.ts";
import {
  activeSockets,
  createSessionState,
  type AppWebSocket,
  type SessionState,
} from "../../state.ts";
import {
  clearCalDAVConfig,
  loadCalDAVConfig,
  resetCalDAVConfigCache,
  saveCalDAVConfig,
} from "../../storage/caldav.ts";
import { caldavSetWriteTarget } from "./caldav.ts";

interface SentMessage {
  type: string;
  [k: string]: unknown;
}

function makeRequester(): {
  ws: AppWebSocket;
  session: SessionState;
  sent: SentMessage[];
} {
  const sent: SentMessage[] = [];
  const session = createSessionState();
  const ws = {
    data: { id: "requester", session },
    send(payload: string) {
      sent.push(JSON.parse(payload) as SentMessage);
    },
  } as unknown as AppWebSocket;
  return { ws, session, sent };
}

describe("caldavSetWriteTarget handler — 未接続ガード", () => {
  beforeEach(() => {
    activeSockets.clear();
    resetCalDAVConfigCache();
    clearCalDAVConfig();
  });

  afterEach(() => {
    activeSockets.clear();
    resetCalDAVConfigCache();
    clearCalDAVConfig();
  });

  afterAll(() => {
    resetDbCache();
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it("未接続時はエラー status を返し書き込み先は保存されない", async () => {
    const { ws, session, sent } = makeRequester();

    await caldavSetWriteTarget(ws, session, {
      calendarUrl: "https://example.com/cal/",
      calendarName: "Work",
      calendarColor: "#ff0000",
    });

    const status = sent.find((m) => m.type === "caldav_status");
    expect(status).toBeDefined();
    expect(status).toMatchObject({
      type: "caldav_status",
      status: {
        connected: false,
        lastError: "iCloud に未接続のため書き込み先を設定できません",
      },
    });

    // ファイルにも書き込まれていない
    expect(loadCalDAVConfig().writeTargetCalendarUrl).toBeUndefined();
  });

  it("接続済みなら書き込み先が保存され caldav_status が broadcast される", async () => {
    saveCalDAVConfig({ appleId: "me@icloud.com", appPassword: "secret" });

    // broadcast を観測するための fake socket を activeSockets に登録
    const broadcastSent: SentMessage[] = [];
    const broadcastWs = {
      data: { id: "broadcast", session: createSessionState() },
      send(payload: string) {
        broadcastSent.push(JSON.parse(payload) as SentMessage);
      },
    } as unknown as AppWebSocket;
    activeSockets.add(broadcastWs);

    const { ws, session } = makeRequester();
    await caldavSetWriteTarget(ws, session, {
      calendarUrl: "https://example.com/cal/",
      calendarName: "Work",
      calendarColor: "#ff0000",
    });

    const cfg = loadCalDAVConfig();
    expect(cfg.writeTargetCalendarUrl).toBe("https://example.com/cal/");
    expect(cfg.writeTargetCalendarName).toBe("Work");
    expect(cfg.writeTargetCalendarColor).toBe("#ff0000");

    const sync = broadcastSent.find((m) => m.type === "caldav_status");
    expect(sync).toMatchObject({
      type: "caldav_status",
      status: {
        connected: true,
        appleId: "me@icloud.com",
        writeTargetCalendarUrl: "https://example.com/cal/",
        writeTargetCalendarName: "Work",
        writeTargetCalendarColor: "#ff0000",
      },
    });
  });
});
