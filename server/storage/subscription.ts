import { getDb } from "../db.ts";
import type { CalendarSubscription } from "../types.ts";
import { deleteSchedulesBySubscription } from "./schedule.ts";

interface Row {
  data: string;
}

function safeParse(json: string): CalendarSubscription | null {
  try {
    return JSON.parse(json) as CalendarSubscription;
  } catch {
    return null;
  }
}

export function loadSubscriptions(): CalendarSubscription[] {
  const rows = getDb()
    .prepare("SELECT data FROM calendar_subscriptions ORDER BY sort_order ASC")
    .all() as Row[];
  const result: CalendarSubscription[] = [];
  for (const r of rows) {
    const parsed = safeParse(r.data);
    if (parsed) result.push(parsed);
  }
  return result;
}

export function saveSubscriptions(items: CalendarSubscription[]): void {
  const db = getDb();
  const del = db.prepare("DELETE FROM calendar_subscriptions");
  const ins = db.prepare(
    "INSERT INTO calendar_subscriptions (id, sort_order, data) VALUES (?, ?, ?)",
  );
  const tx = db.transaction((list: CalendarSubscription[]) => {
    del.run();
    list.forEach((s, i) => ins.run(s.id, i, JSON.stringify(s)));
  });
  tx(items);
}

export function deleteSubscriptionAndSchedules(subscriptionId: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    deleteSchedulesBySubscription(subscriptionId);
    db.prepare("DELETE FROM calendar_subscriptions WHERE id = ?").run(
      subscriptionId,
    );
  });
  tx();
}

export function normalizeSubscription(
  raw: Partial<CalendarSubscription>,
): CalendarSubscription {
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    url: String(raw.url ?? ""),
    color: String(raw.color ?? ""),
    enabled: raw.enabled === undefined ? true : Boolean(raw.enabled),
    lastFetchedAt: String(raw.lastFetchedAt ?? ""),
    lastError: String(raw.lastError ?? ""),
    status:
      raw.status === "fetching" ||
      raw.status === "ok" ||
      raw.status === "error"
        ? raw.status
        : "idle",
    eventCount: typeof raw.eventCount === "number" ? raw.eventCount : 0,
    createdAt: String(raw.createdAt ?? ""),
    updatedAt: String(raw.updatedAt ?? ""),
    provider: raw.provider === "caldav" ? "caldav" : "ics",
    caldavCalendarId: String(raw.caldavCalendarId ?? ""),
  };
}
