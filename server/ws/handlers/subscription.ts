import { fetchEvents } from "../../caldav/client.ts";
import { fetchEvents as fetchGoogleEvents } from "../../google/client.ts";
import { scheduleAutosync } from "../../github/autosync.ts";
import { loadCalDAVConfig } from "../../storage/caldav.ts";
import {
  isGoogleAccountConnected,
  loadGoogleConfig,
} from "../../storage/google.ts";
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

function googleCalendarIdFromRaw(
  raw: Partial<CalendarSubscription> & Record<string, unknown>,
): string {
  const explicit = String(raw.googleCalendarId ?? "").trim();
  if (explicit) return explicit;
  const url = String(raw.url ?? "").trim();
  return url.startsWith("google:") ? url.replace(/^google:/, "").trim() : "";
}

function googleAccountIdFromRaw(
  raw: Partial<CalendarSubscription> & Record<string, unknown>,
): string {
  return (
    String(raw.googleAccountId ?? "").trim() ||
    loadGoogleConfig().activeAccountId ||
    ""
  );
}

function strictBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === true;
}

export const subscriptionAdd: Handler = async (_ws, session, data) => {
  const raw = (data.subscription ?? {}) as Partial<CalendarSubscription> &
    Record<string, unknown>;
  const provider =
    raw.provider === "caldav" || raw.provider === "google"
      ? raw.provider
      : "ics";
  const googleCalendarId = provider === "google" ? googleCalendarIdFromRaw(raw) : "";
  const googleAccountId = provider === "google" ? googleAccountIdFromRaw(raw) : "";
  const rawUrl = String(raw.url ?? "").trim();
  const url =
    rawUrl ||
    (provider === "google" && googleCalendarId
      ? `google:${googleCalendarId}`
      : "");
  if (!url) return;
  const now = nowLocalIso();
  const existing = loadSubscriptions();
  const sub = normalizeSubscription({
    ...raw,
    id: shortId(),
    name: raw.name ? String(raw.name) : url,
    url,
    color: raw.color ? String(raw.color) : pickDefaultColor(existing),
    enabled: strictBoolean(raw.enabled, true),
    status: "idle",
    createdAt: now,
    updatedAt: now,
    provider,
    googleCalendarId,
    googleAccountId,
  });
  saveSubscriptions([...existing, sub]);
  scheduleAutosync();
  broadcastSubscriptions(session);
  // CalDAV / Google 購読は追加直後に 1 回フェッチして UI に出す
  if (sub.provider === "caldav" || sub.provider === "google") {
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
  const current = existing[idx];
  if (!current) return;
  const provider =
    raw.provider === "caldav" || raw.provider === "google" || raw.provider === "ics"
      ? raw.provider
      : current.provider;
  const googleFields =
    provider === "google"
      ? {
          googleCalendarId: googleCalendarIdFromRaw({
            ...current,
            ...raw,
          }),
          googleAccountId: googleAccountIdFromRaw({
            ...current,
            ...raw,
          }),
        }
      : {};
  const merged = normalizeSubscription({
    ...current,
    ...raw,
    ...googleFields,
    id,
    provider,
    createdAt: current.createdAt,
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

  if (target.provider === "caldav") {
    await refreshCalDAV(target, session);
    return;
  }
  if (target.provider === "google") {
    await refreshGoogle(target, session);
    return;
  }
  // ICS フェッチは未実装。状態だけ idle に戻して終わる。
  setSubscriptionState(id, { status: "idle" });
  broadcastSubscriptions(session);
}

async function refreshCalDAV(
  target: CalendarSubscription,
  session: SyncSession,
): Promise<void> {
  setSubscriptionState(target.id, { status: "fetching", lastError: "" });
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
    setSubscriptionState(target.id, {
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
    rrule: part.rrule,
    recurrenceId: part.recurrenceId,
    createdAt: now,
    updatedAt: now,
    caldavObjectUrl: part.objectUrl,
    caldavEtag: part.etag,
    googleEventId: "",
    googleAccountId: "",
  }));
  replaceSubscriptionSchedules(target.id, schedules);
  setSubscriptionState(target.id, {
    status: "ok",
    lastError: "",
    lastFetchedAt: now,
    eventCount: schedules.length,
  });
  scheduleAutosync();
  broadcastSubscriptions(session);
  broadcastSchedules(session);
}

async function refreshGoogle(
  target: CalendarSubscription,
  session: SyncSession,
): Promise<void> {
  const accountId =
    target.googleAccountId || loadGoogleConfig().activeAccountId || "";
  if (!isGoogleAccountConnected(accountId || undefined)) {
    setSubscriptionState(target.id, {
      status: "error",
      lastError: "Google に未接続です",
      lastFetchedAt: nowLocalIso(),
    });
    broadcastSubscriptions(session);
    return;
  }
  setSubscriptionState(target.id, {
    status: "fetching",
    lastError: "",
    googleAccountId: accountId,
  });
  broadcastSubscriptions(session);

  const range = expandRange();
  const result = await fetchGoogleEvents({
    calendarId: target.googleCalendarId || target.url.replace(/^google:/, ""),
    accountId: accountId || undefined,
    rangeStartMs: range.startMs,
    rangeEndMs: range.endMs,
  });

  if (!result.ok) {
    setSubscriptionState(target.id, {
      status: "error",
      lastError: result.error,
      lastFetchedAt: nowLocalIso(),
    });
    broadcastSubscriptions(session);
    return;
  }

  const now = nowLocalIso();
  const schedules: Schedule[] = result.events.map((part, i) => ({
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
    rrule: part.rrule,
    recurrenceId: part.recurrenceId,
    createdAt: now,
    updatedAt: now,
    caldavObjectUrl: "",
    caldavEtag: "",
    googleEventId: part.googleEventId,
    googleAccountId: accountId,
  }));
  replaceSubscriptionSchedules(target.id, schedules);
  setSubscriptionState(target.id, {
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
    if (s.provider !== "caldav" && s.provider !== "google") continue;
    await refreshOne(s.id, session);
  }
};
