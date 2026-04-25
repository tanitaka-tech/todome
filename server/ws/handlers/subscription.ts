import { scheduleAutosync } from "../../github/autosync.ts";
import {
  deleteSubscriptionAndSchedules,
  loadSubscriptions,
  normalizeSubscription,
  saveSubscriptions,
} from "../../storage/subscription.ts";
import { loadSchedules } from "../../storage/schedule.ts";
import type { CalendarSubscription, Schedule } from "../../types.ts";
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

// Phase 1 ではスタブ実装。Phase 3 で server/calendar/scheduler.ts に差し替え。
export const subscriptionRefresh: Handler = async (_ws, session) => {
  // フェッチは未実装（Phase 3）。現状の購読リストをそのまま再ブロードキャストするだけ。
  broadcastSubscriptions(session);
};
