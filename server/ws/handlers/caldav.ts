import { connectAndListCalendars } from "../../caldav/client.ts";
import {
  clearCalDAVConfig,
  loadCalDAVConfig,
  saveCalDAVConfig,
} from "../../storage/caldav.ts";
import {
  deleteSubscriptionAndSchedules,
  loadSubscriptions,
} from "../../storage/subscription.ts";
import type { CalDAVStatus } from "../../types.ts";
import { nowLocalIso } from "../../utils/time.ts";
import { broadcast, sendTo } from "../broadcast.ts";
import type { Handler } from "../dispatch.ts";
import { broadcastSubscriptionsAndSchedules } from "./subscription.ts";

export function buildCalDAVStatus(lastError = ""): CalDAVStatus {
  const cfg = loadCalDAVConfig();
  return {
    connected: Boolean(cfg.appleId && cfg.appPassword),
    appleId: cfg.appleId ?? "",
    connectedAt: cfg.connectedAt ?? "",
    lastError,
  };
}

export const caldavStatusRequest: Handler = async (ws) => {
  sendTo(ws, { type: "caldav_status", status: buildCalDAVStatus() });
};

export const caldavConnect: Handler = async (ws, _session, data) => {
  const appleId = String(data.appleId ?? "").trim();
  const appPassword = String(data.appPassword ?? "").trim();
  if (!appleId || !appPassword) {
    sendTo(ws, {
      type: "caldav_status",
      status: buildCalDAVStatus("Apple ID と App用パスワードを入力してください"),
    });
    return;
  }
  const result = await connectAndListCalendars({ appleId, appPassword });
  if (!result.ok) {
    sendTo(ws, {
      type: "caldav_status",
      status: {
        connected: false,
        appleId: "",
        connectedAt: "",
        lastError: result.error || "接続に失敗しました",
      },
    });
    return;
  }
  saveCalDAVConfig({ appleId, appPassword, connectedAt: nowLocalIso() });
  broadcast({ type: "caldav_status", status: buildCalDAVStatus() });
  sendTo(ws, {
    type: "caldav_calendars",
    calendars: result.calendars,
    error: "",
  });
};

export const caldavDisconnect: Handler = async () => {
  // CalDAV 由来の購読をすべて削除（events も cascade で消える）
  const subs = loadSubscriptions().filter((s) => s.provider === "caldav");
  for (const s of subs) deleteSubscriptionAndSchedules(s.id);
  clearCalDAVConfig();
  broadcast({ type: "caldav_status", status: buildCalDAVStatus() });
  broadcastSubscriptionsAndSchedules();
};

export const caldavListCalendars: Handler = async (ws) => {
  const cfg = loadCalDAVConfig();
  if (!cfg.appleId || !cfg.appPassword) {
    sendTo(ws, {
      type: "caldav_calendars",
      calendars: [],
      error: "iCloud に未接続です",
    });
    return;
  }
  const result = await connectAndListCalendars(cfg);
  sendTo(ws, {
    type: "caldav_calendars",
    calendars: result.calendars,
    error: result.error,
  });
};
