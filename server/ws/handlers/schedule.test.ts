// config.ts は読み込み時点で DATA_DIR を固定するため、server コードを import する前に
// テスト用ディレクトリを環境変数で指すようにする。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), "todome-schedule-handler-test-"));
process.env.TODOME_DATA_DIR = TEST_DATA_DIR;

import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { clearGitHubConfig } from "../../config.ts";
import { getDb, resetDbCache } from "../../db.ts";
import {
  activeSockets,
  createSessionState,
  type AppWebSocket,
  type SessionState,
} from "../../state.ts";
import { clearCalDAVConfig } from "../../storage/caldav.ts";
import { clearGoogleConfig } from "../../storage/google.ts";
import {
  loadManualSchedules,
  normalizeSchedule,
  upsertManualSchedule,
} from "../../storage/schedule.ts";
import type { Schedule } from "../../types.ts";

mock.module("../../caldav/client.ts", () => ({
  connectAndListCalendars: async () => ({ ok: true, calendars: [] }),
  deleteManualEvent: async () => ({ ok: true }),
  fetchEvents: async () => ({ ok: true, schedules: [] }),
  pushManualEvent: async () => ({
    ok: true,
    objectUrl: "mock-caldav-object",
    etag: "mock-etag",
    uid: "mock-uid",
  }),
}));

mock.module("../../google/client.ts", () => ({
  deleteManualEvent: async () => ({ ok: true }),
  exchangeCodeForToken: async () => ({ ok: true, tokens: {} }),
  fetchEvents: async () => ({ ok: true, schedules: [] }),
  fetchUserEmail: async () => ({ ok: true, email: "user@example.com" }),
  listCalendars: async () => ({ ok: true, calendars: [] }),
  persistConnectedTokens: async () => ({ ok: true }),
  pushManualEvent: async () => ({
    ok: true,
    eventId: "mock-google-event",
    uid: "mock-google-uid",
  }),
}));

const { scheduleAdd, scheduleEdit } = await import("./schedule.ts");

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

function makeManual(partial: Partial<Schedule> & Pick<Schedule, "id" | "title">): Schedule {
  return normalizeSchedule({
    source: "manual",
    subscriptionId: "",
    externalUid: "",
    description: "",
    location: "",
    start: "2026-04-25T09:00:00",
    end: "2026-04-25T10:00:00",
    allDay: false,
    rrule: "",
    recurrenceId: "",
    createdAt: "2026-04-25T08:00:00",
    updatedAt: "2026-04-25T08:00:00",
    ...partial,
  });
}

beforeEach(() => {
  activeSockets.clear();
  resetDbCache();
  clearGitHubConfig();
  clearCalDAVConfig();
  clearGoogleConfig();
  const db = getDb();
  db.exec("DELETE FROM schedules");
  db.exec("DELETE FROM calendar_subscriptions");
});

afterEach(() => {
  activeSockets.clear();
  resetDbCache();
});

afterAll(() => {
  resetDbCache();
  rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

describe("scheduleAdd handler", () => {
  it("終日 1 日予定を保存し、クライアント supplied id は採用しない", async () => {
    const sent = attachFakeBroadcastSocket();
    const { ws, session } = makeRequester();

    await scheduleAdd(ws, session, {
      schedule: {
        id: "client-id",
        title: "祝日",
        start: "2026-04-25T00:00:00",
        end: "2026-04-25T00:00:00",
        allDay: true,
      },
    });

    const saved = loadManualSchedules();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.id).not.toBe("client-id");
    expect(saved[0]?.title).toBe("祝日");
    expect(saved[0]?.allDay).toBe(true);
    expect(saved[0]?.start).toBe("2026-04-25T00:00:00");
    expect(saved[0]?.end).toBe("2026-04-25T00:00:00");
    expect(sent.some((m) => m.type === "schedule_sync")).toBe(true);
  });

  it("終了が開始以前の通常予定は保存しない", async () => {
    const sent = attachFakeBroadcastSocket();
    const { ws, session } = makeRequester();

    await scheduleAdd(ws, session, {
      schedule: {
        title: "逆転",
        start: "2026-04-25T10:00:00",
        end: "2026-04-25T09:00:00",
        allDay: false,
      },
    });

    expect(loadManualSchedules()).toHaveLength(0);
    expect(sent.filter((m) => m.type === "schedule_sync")).toHaveLength(0);
  });
});

describe("scheduleEdit handler", () => {
  it("部分 payload でも既存の時刻と createdAt を保ったまま編集する", async () => {
    const { ws, session } = makeRequester();
    upsertManualSchedule(makeManual({ id: "m1", title: "Old" }));

    await scheduleEdit(ws, session, {
      schedule: { id: "m1", title: "New" },
    });

    const saved = loadManualSchedules();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      id: "m1",
      title: "New",
      start: "2026-04-25T09:00:00",
      end: "2026-04-25T10:00:00",
      createdAt: "2026-04-25T08:00:00",
    });
  });

  it("不正な時刻範囲の編集は既存予定を壊さない", async () => {
    const { ws, session } = makeRequester();
    upsertManualSchedule(makeManual({ id: "m1", title: "Keep" }));

    await scheduleEdit(ws, session, {
      schedule: {
        id: "m1",
        title: "Bad",
        start: "2026-04-25T10:00:00",
        end: "2026-04-25T09:00:00",
        allDay: false,
      },
    });

    const saved = loadManualSchedules();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      id: "m1",
      title: "Keep",
      start: "2026-04-25T09:00:00",
      end: "2026-04-25T10:00:00",
    });
  });
});
