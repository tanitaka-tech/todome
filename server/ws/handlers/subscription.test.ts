import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DATA_DIR = mkdtempSync(
  join(tmpdir(), "todome-subscription-handler-test-"),
);
process.env.TODOME_DATA_DIR = TEST_DATA_DIR;

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { clearGitHubConfig } from "../../config.ts";
import { getDb, resetDbCache } from "../../db.ts";
import {
  activeSockets,
  createSessionState,
  type AppWebSocket,
  type SessionState,
} from "../../state.ts";
import {
  clearGoogleConfig,
  saveGoogleConfig,
} from "../../storage/google.ts";
import {
  loadSchedules,
} from "../../storage/schedule.ts";
import {
  loadSubscriptions,
  saveSubscriptions,
} from "../../storage/subscription.ts";
import type { CalendarSubscription } from "../../types.ts";

const googleFetchCalls: Array<{ calendarId: string; accountId?: string }> = [];
const icsFetchCalls: Array<{ url: string }> = [];

mock.module("../../caldav/client.ts", () => ({
  fetchEvents: async () => ({ ok: true, schedules: [] }),
}));

mock.module("../../ics/client.ts", () => ({
  fetchEvents: async (args: { url: string }) => {
    icsFetchCalls.push(args);
    return {
      ok: true,
      schedules: [
        {
          externalUid: "ics-uid-1",
          title: "ICS event",
          description: "Public calendar",
          location: "Online",
          start: "2026-06-06T09:00:00",
          end: "2026-06-06T10:00:00",
          allDay: false,
          rrule: "",
          recurrenceId: "",
          objectUrl: "",
          etag: "",
        },
      ],
    };
  },
}));

mock.module("../../google/client.ts", () => ({
  fetchEvents: async (args: { calendarId: string; accountId?: string }) => {
    googleFetchCalls.push(args);
    return {
      ok: true,
      events: [
        {
          externalUid: "uid-1",
          title: "Google event",
          description: "",
          location: "",
          start: "2026-06-05T09:00:00",
          end: "2026-06-05T10:00:00",
          allDay: false,
          rrule: "",
          recurrenceId: "",
          googleEventId: "event-1",
        },
      ],
    };
  },
}));

const {
  subscriptionAdd,
  subscriptionEdit,
  subscriptionRefresh,
} = await import("./subscription.ts");

function makeRequester(): { ws: AppWebSocket; session: SessionState } {
  const session = createSessionState();
  const ws = {
    data: { id: "requester", session },
    send() {},
  } as unknown as AppWebSocket;
  return { ws, session };
}

function saveActiveGoogleAccount(): void {
  saveGoogleConfig({
    clientId: "client-id",
    clientSecret: "client-secret",
    activeAccountId: "active@example.com",
    accounts: [
      {
        id: "active@example.com",
        accountEmail: "active@example.com",
        refreshToken: "refresh-token",
        accessToken: "",
        accessTokenExpiresAt: "",
        connectedAt: "2026-06-05T08:00:00",
        writeTargetCalendarId: "primary",
        writeTargetCalendarName: "Primary",
        writeTargetCalendarColor: "#3b82f6",
      },
    ],
  });
}

function makeGoogleSubscription(
  partial: Partial<CalendarSubscription>,
): CalendarSubscription {
  return {
    id: "sub-1",
    name: "Work",
    url: "google:primary",
    color: "#3b82f6",
    enabled: true,
    lastFetchedAt: "",
    lastError: "",
    status: "idle",
    eventCount: 0,
    createdAt: "2026-06-05T08:00:00",
    updatedAt: "2026-06-05T08:00:00",
    provider: "google",
    caldavCalendarId: "",
    googleCalendarId: "primary",
    googleAccountId: "",
    ...partial,
  };
}

function makeIcsSubscription(
  partial: Partial<CalendarSubscription>,
): CalendarSubscription {
  return {
    id: "ics-sub",
    name: "Public",
    url: "https://example.com/public.ics",
    color: "#10b981",
    enabled: true,
    lastFetchedAt: "",
    lastError: "",
    status: "idle",
    eventCount: 0,
    createdAt: "2026-06-05T08:00:00",
    updatedAt: "2026-06-05T08:00:00",
    provider: "ics",
    caldavCalendarId: "",
    googleCalendarId: "",
    googleAccountId: "",
    ...partial,
  };
}

beforeEach(() => {
  activeSockets.clear();
  googleFetchCalls.length = 0;
  icsFetchCalls.length = 0;
  resetDbCache();
  clearGitHubConfig();
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

describe("subscription handlers", () => {
  it("ICS購読追加時にURLを取得し、生成予定を保存する", async () => {
    const { ws, session } = makeRequester();

    await subscriptionAdd(ws, session, {
      subscription: {
        name: "Public",
        url: "https://example.com/public.ics",
        provider: "ics",
      },
    });

    expect(icsFetchCalls).toHaveLength(1);
    expect(icsFetchCalls[0]).toMatchObject({
      url: "https://example.com/public.ics",
    });
    const subscriptions = loadSubscriptions();
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]).toMatchObject({
      provider: "ics",
      status: "ok",
      eventCount: 1,
      lastError: "",
    });

    const schedules = loadSchedules();
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toMatchObject({
      source: "subscription",
      subscriptionId: subscriptions[0]?.id,
      externalUid: "ics-uid-1",
      title: "ICS event",
      caldavObjectUrl: "",
      googleEventId: "",
    });
  });

  it("Google購読追加時にアクティブアカウントを補完し、生成予定にも保持する", async () => {
    saveActiveGoogleAccount();
    const { ws, session } = makeRequester();

    await subscriptionAdd(ws, session, {
      subscription: {
        id: "client-id",
        name: "Primary",
        url: "",
        color: "#ec4899",
        provider: "google",
        googleCalendarId: "primary",
        googleAccountId: "",
        createdAt: "client-created",
      },
    });

    const subscriptions = loadSubscriptions();
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]).toMatchObject({
      name: "Primary",
      url: "google:primary",
      provider: "google",
      googleCalendarId: "primary",
      googleAccountId: "active@example.com",
    });
    expect(subscriptions[0]?.id).not.toBe("client-id");
    expect(subscriptions[0]?.createdAt).not.toBe("client-created");
    expect(googleFetchCalls[0]).toMatchObject({
      calendarId: "primary",
      accountId: "active@example.com",
    });

    const schedules = loadSchedules();
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toMatchObject({
      source: "subscription",
      title: "Google event",
      googleEventId: "event-1",
      googleAccountId: "active@example.com",
    });
  });

  it("購読追加時の enabled は boolean true だけを有効扱いにする", async () => {
    const { ws, session } = makeRequester();

    await subscriptionAdd(ws, session, {
      subscription: {
        name: "Public",
        url: "https://example.com/public.ics",
        enabled: "false",
      },
    });

    const subscriptions = loadSubscriptions();
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]?.enabled).toBe(false);
    expect(icsFetchCalls).toHaveLength(0);
  });

  it("Google購読編集時にcreatedAtを保持し、空のaccountIdを補完する", async () => {
    saveActiveGoogleAccount();
    saveSubscriptions([
      makeGoogleSubscription({
        id: "sub-1",
        createdAt: "2026-01-01T00:00:00",
      }),
    ]);
    const { ws, session } = makeRequester();

    await subscriptionEdit(ws, session, {
      subscription: {
        id: "sub-1",
        name: "Renamed",
        createdAt: "client-created",
        googleAccountId: "",
      },
    });

    const subscriptions = loadSubscriptions();
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]).toMatchObject({
      id: "sub-1",
      name: "Renamed",
      createdAt: "2026-01-01T00:00:00",
      googleAccountId: "active@example.com",
    });
  });

  it("旧データのGoogle購読refreshでも生成予定にアクティブアカウントを保持する", async () => {
    saveActiveGoogleAccount();
    saveSubscriptions([makeGoogleSubscription({ id: "legacy-sub" })]);
    const { ws, session } = makeRequester();

    await subscriptionRefresh(ws, session, { subscriptionId: "legacy-sub" });

    const subscriptions = loadSubscriptions();
    expect(subscriptions[0]).toMatchObject({
      id: "legacy-sub",
      status: "ok",
      googleAccountId: "active@example.com",
      eventCount: 1,
    });
    const schedules = loadSchedules();
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toMatchObject({
      subscriptionId: "legacy-sub",
      googleAccountId: "active@example.com",
    });
  });

  it("全件refreshでICS購読も再取得する", async () => {
    saveActiveGoogleAccount();
    saveSubscriptions([
      makeIcsSubscription({ id: "ics-sub" }),
      makeGoogleSubscription({ id: "google-sub" }),
    ]);
    const { ws, session } = makeRequester();

    await subscriptionRefresh(ws, session, { subscriptionId: "" });

    expect(icsFetchCalls).toHaveLength(1);
    expect(icsFetchCalls[0]).toMatchObject({
      url: "https://example.com/public.ics",
    });
    expect(googleFetchCalls).toHaveLength(1);

    const subscriptions = loadSubscriptions();
    expect(subscriptions).toHaveLength(2);
    expect(subscriptions.find((s) => s.id === "ics-sub")).toMatchObject({
      status: "ok",
      eventCount: 1,
    });
    expect(subscriptions.find((s) => s.id === "google-sub")).toMatchObject({
      status: "ok",
      eventCount: 1,
    });

    const schedules = loadSchedules();
    expect(schedules).toHaveLength(2);
    expect(schedules.map((s) => s.subscriptionId).sort()).toEqual([
      "google-sub",
      "ics-sub",
    ]);
  });
});
