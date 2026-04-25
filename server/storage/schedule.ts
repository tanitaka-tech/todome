import { getDb } from "../db.ts";
import type { Schedule } from "../types.ts";

interface Row {
  data: string;
}

function safeParse(json: string): Schedule | null {
  try {
    return JSON.parse(json) as Schedule;
  } catch {
    return null;
  }
}

export function loadSchedules(): Schedule[] {
  const rows = getDb()
    .prepare(
      "SELECT data FROM schedules ORDER BY start_at ASC, id ASC",
    )
    .all() as Row[];
  const result: Schedule[] = [];
  for (const r of rows) {
    const parsed = safeParse(r.data);
    if (parsed) result.push(parsed);
  }
  return result;
}

export function loadManualSchedules(): Schedule[] {
  return loadSchedules().filter((s) => s.source === "manual");
}

function insertOne(
  ins: ReturnType<ReturnType<typeof getDb>["prepare"]>,
  index: number,
  schedule: Schedule,
): void {
  ins.run(
    schedule.id,
    index,
    schedule.source,
    schedule.subscriptionId,
    schedule.externalUid,
    schedule.start,
    schedule.end,
    JSON.stringify(schedule),
  );
}

export function upsertManualSchedule(schedule: Schedule): void {
  if (schedule.source !== "manual") {
    throw new Error("upsertManualSchedule: source must be 'manual'");
  }
  const db = getDb();
  const upd = db.prepare(
    "UPDATE schedules SET start_at = ?, end_at = ?, data = ? WHERE id = ?",
  );
  const result = upd.run(
    schedule.start,
    schedule.end,
    JSON.stringify(schedule),
    schedule.id,
  );
  if (result.changes === 0) {
    const maxRow = db
      .prepare("SELECT COALESCE(MAX(sort_order), -1) AS max FROM schedules")
      .get() as { max: number };
    const ins = db.prepare(
      "INSERT INTO schedules (id, sort_order, source, subscription_id, external_uid, start_at, end_at, data) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    insertOne(ins, maxRow.max + 1, schedule);
  }
}

export function deleteManualSchedule(id: string): void {
  getDb()
    .prepare("DELETE FROM schedules WHERE id = ? AND source = 'manual'")
    .run(id);
}

export function deleteSchedulesBySubscription(subscriptionId: string): void {
  getDb()
    .prepare(
      "DELETE FROM schedules WHERE source = 'subscription' AND subscription_id = ?",
    )
    .run(subscriptionId);
}

export function replaceSubscriptionSchedules(
  subscriptionId: string,
  schedules: Schedule[],
): void {
  if (!subscriptionId) {
    throw new Error("replaceSubscriptionSchedules: subscriptionId required");
  }
  const db = getDb();
  const del = db.prepare(
    "DELETE FROM schedules WHERE source = 'subscription' AND subscription_id = ?",
  );
  const ins = db.prepare(
    "INSERT INTO schedules (id, sort_order, source, subscription_id, external_uid, start_at, end_at, data) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const tx = db.transaction((items: Schedule[]) => {
    del.run(subscriptionId);
    items.forEach((s, i) => {
      if (s.source !== "subscription") {
        throw new Error("replaceSubscriptionSchedules: items must be subscription source");
      }
      if (s.subscriptionId !== subscriptionId) {
        throw new Error("replaceSubscriptionSchedules: subscriptionId mismatch");
      }
      insertOne(ins, i, s);
    });
  });
  tx(schedules);
}

export function normalizeSchedule(raw: Partial<Schedule>): Schedule {
  return {
    id: String(raw.id ?? ""),
    source: raw.source === "subscription" ? "subscription" : "manual",
    subscriptionId: String(raw.subscriptionId ?? ""),
    externalUid: String(raw.externalUid ?? ""),
    title: String(raw.title ?? ""),
    description: String(raw.description ?? ""),
    location: String(raw.location ?? ""),
    start: String(raw.start ?? ""),
    end: String(raw.end ?? ""),
    allDay: Boolean(raw.allDay),
    rrule: String(raw.rrule ?? ""),
    recurrenceId: String(raw.recurrenceId ?? ""),
    createdAt: String(raw.createdAt ?? ""),
    updatedAt: String(raw.updatedAt ?? ""),
    caldavObjectUrl: String(raw.caldavObjectUrl ?? ""),
    caldavEtag: String(raw.caldavEtag ?? ""),
  };
}
