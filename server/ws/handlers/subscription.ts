import { fetchEvents } from "../../caldav/client.ts";
import { scheduleAutosync } from "../../github/autosync.ts";
import { loadCalDAVConfig } from "../../storage/caldav.ts";
import { loadProfile } from "../../storage/profile.ts";
import {
  loadSchedules,
  replaceSubscriptionSchedules,
} from "../../storage/schedule.ts";
import {
  deleteSubscriptionAndSchedules,
  loadSubscriptions,
  normalizeSubscription,
  saveSubscriptions,
} from "../../storage/subscription.ts";
import type {
  CalendarSubscription,
  Schedule,
} from "../../types.ts";
import { shortId } from "../../utils/shortId.ts";
import { nowLocalIso } from "../../utils/time.ts";
import { broadcast } from "../broadcast.ts";
import type { Handler } from "../dispatch.ts";

interface SyncSession {
  subscriptions: CalendarSubscription[];
  schedules: Schedule[];
}

function broadcastSubscriptions(session: SyncSession): void {
  session.subscriptions = loadSubscriptions();
  broadcast({ type: "subscription_sync", subscriptions: session.subscriptions });
}

function broadcastSchedules(session: SyncSession): void {
  session.schedules = loadSchedules();
  broadcast({ type: "schedule_sync", schedules: session.schedules });
}

/**
 * caldav.ts から呼ばれる用。session を持たないので最新を読み直してブロードキャストするだけ。
 */
export function broadcastSubscriptionsAndSchedules(): void {
  broadcast({ type: "subscription_sync", subscriptions: loadSubscriptions() });
  broadcast({ type: "schedule_sync", schedules: loadSchedules() });
}

const FALLBACK_COLORS = [
  "#3b82f6",
  "#ec4899",
  "#10b981",
  "#f59e0b",
  "#a855f7",
  "#ef4444",
];

function pickDefaultColor(existing: CalendarSubscription[]): string {
  const used = new Set(existing.map((s) => s.color));
  for (const c of FALLBACK_COLORS) {
    if (!used.has(c)) return c;
  }
  return FALLBACK_COLORS[existing.length % FALLBACK_COLORS.length] ?? "#3b82f6";
}

export const subscriptionAdd: Handler = async (_ws, session, data) => {
  const raw = (data.subscription ?? {}) as Partial<CalendarSubscription> &
    Record<string, unknown>;
  const url = String(raw.url ?? "").trim();
  if (!url) return;
  const now = nowLocalIso();
  const existing = loadSubscriptions();
  const sub = normalizeSubscription({
    ...raw,
    id: raw.id ? String(raw.id) : shortId(),
    name: raw.name ? String(raw.name) : url,
    url,
    color: raw.color ? String(raw.color) : pickDefaultColor(existing),
    enabled: raw.enabled === undefined ? true : Boolean(raw.enabled),
    status: "idle",
    createdAt: now,
    updatedAt: now,
  });
  saveSubscriptions([...existing, sub]);
  scheduleAutosync();
  broadcastSubscriptions(session);
  // CalDAV 購読は追加直後に 1 回フェッチして UI に出す
  if (sub.provider === "caldav") {
    await refreshOne(sub.id, session);
  }
};

export const subscriptionEdit: Handler = async (_ws, session, data) => {
  const raw = (data.subscription ?? {}) as Partial<CalendarSubscription> &
    Record<string, unknown>;
  const id = String(raw.id ?? "");
  if (!id) return;
  const existing = loadSubscriptions();
  const idx = existing.findIndex((s) => s.id === id);
  if (idx < 0) return;
  const merged = normalizeSubscription({
    ...existing[idx],
    ...raw,
    id,
    updatedAt: nowLocalIso(),
  });
  const next = [...existing];
  next[idx] = merged;
  saveSubscriptions(next);
  scheduleAutosync();
  broadcastSubscriptions(session);
};

export const subscriptionDelete: Handler = async (_ws, session, data) => {
  const id = String(data.subscriptionId ?? "");
  if (!id) return;
  deleteSubscriptionAndSchedules(id);
  scheduleAutosync();
  broadcastSubscriptions(session);
  broadcastSchedules(session);
};

// 過去 90 日 〜 未来 365 日 を初期の展開ウィンドウとする。
const PAST_DAYS = 90;
const FUTURE_DAYS = 365;

function expandRange(): { startMs: number; endMs: number } {
  const now = Date.now();
  return {
    startMs: now - PAST_DAYS * 24 * 60 * 60 * 1000,
    endMs: now + FUTURE_DAYS * 24 * 60 * 60 * 1000,
  };
}

function effectiveTimezone(): string {
  const tz = loadProfile().timezone;
  if (tz) return tz;
  try {
    const sys = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return sys || "UTC";
  } catch {
    return "UTC";
  }
}

function setSubscriptionState(
  id: string,
  patch: Partial<CalendarSubscription>,
): CalendarSubscription | null {
  const list = loadSubscriptions();
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  const merged = normalizeSubscription({
    ...list[idx],
    ...patch,
    updatedAt: nowLocalIso(),
  });
  const next = [...list];
  next[idx] = merged;
  saveSubscriptions(next);
  return merged;
}

/**
 * subscription を 1 件 refresh して broadcast までやる。
 * 別ハンドラ (schedule edit/delete) から「書き戻した直後にローカルにも反映したい」
 * ときに呼ぶ。session を持たないので最新を読み直して全体 broadcast する。
 */
export async function refreshSubscriptionAndBroadcast(
  id: string,
): Promise<void> {
  const dummy: SyncSession = { subscriptions: [], schedules: [] };
  await refreshOne(id, dummy);
}

async function refreshOne(id: string, session: SyncSession): Promise<void> {
  const subs = loadSubscriptions();
  const target = subs.find((s) => s.id === id);
  if (!target) return;
  if (!target.enabled) return;
  if (target.provider !== "caldav") {
    // ICS フェッチは未実装。状態だけ idle に戻して終わる。
    setSubscriptionState(id, { status: "idle" });
    broadcastSubscriptions(session);
    return;
  }

  setSubscriptionState(id, { status: "fetching", lastError: "" });
  broadcastSubscriptions(session);

  const cfg = loadCalDAVConfig();
  const range = expandRange();
  const tzid = effectiveTimezone();
  const result = await fetchEvents({
    cfg,
    calendarUrl: target.url,
    rangeStartMs: range.startMs,
    rangeEndMs: range.endMs,
    tzid,
  });

  if (!result.ok) {
    setSubscriptionState(id, {
      status: "error",
      lastError: result.error,
      lastFetchedAt: nowLocalIso(),
    });
    broadcastSubscriptions(session);
    return;
  }

  const now = nowLocalIso();
  const schedules: Schedule[] = result.schedules.map((part, i) => ({
    id: `${target.id}:${i}`,
    source: "subscription",
    subscriptionId: target.id,
    externalUid: part.externalUid,
    title: part.title,
    description: part.description,
    location: part.location,
    start: part.start,
    end: part.end,
    allDay: part.allDay,
    color: "",
    rrule: part.rrule,
    recurrenceId: part.recurrenceId,
    createdAt: now,
    updatedAt: now,
    caldavObjectUrl: part.objectUrl,
    caldavEtag: part.etag,
  }));
  replaceSubscriptionSchedules(target.id, schedules);
  setSubscriptionState(id, {
    status: "ok",
    lastError: "",
    lastFetchedAt: now,
    eventCount: schedules.length,
  });
  scheduleAutosync();
  broadcastSubscriptions(session);
  broadcastSchedules(session);
}

export const subscriptionRefresh: Handler = async (_ws, session, data) => {
  const id = String(data.subscriptionId ?? "").trim();
  if (id) {
    await refreshOne(id, session);
    return;
  }
  // 全件 refresh
  const subs = loadSubscriptions();
  for (const s of subs) {
    if (!s.enabled) continue;
    if (s.provider !== "caldav") continue;
    await refreshOne(s.id, session);
  }
};
