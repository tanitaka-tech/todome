import { getDb } from "../db.ts";
import { shortId } from "../utils/shortId.ts";
import { nowLocalIso as nowIso } from "../utils/time.ts";
import {
  dayRangeForBoundary,
  todayBoundaryIsoDate,
} from "../utils/dayBoundary.ts";
import { getDayBoundaryHour } from "./appConfig.ts";
import type { LifeActivity, LifeCategory, LifeLimitScope, LifeLog } from "../types.ts";

export const LIFE_ACTIVITY_CATEGORIES: readonly LifeCategory[] = [
  "rest",
  "play",
  "routine",
  "other",
];
export const LIFE_LIMIT_SCOPES: readonly LifeLimitScope[] = ["per_session", "per_day"];

const DEFAULT_LIFE_ACTIVITIES: Omit<LifeActivity, "id" | "archived">[] = [
  { name: "食事", icon: "🍚", category: "routine", softLimitMinutes: 45, hardLimitMinutes: 90, limitScope: "per_session" },
  { name: "風呂", icon: "🛁", category: "routine", softLimitMinutes: 30, hardLimitMinutes: 60, limitScope: "per_session" },
  { name: "遊び", icon: "🎮", category: "play", softLimitMinutes: 60, hardLimitMinutes: 180, limitScope: "per_day" },
  { name: "SNS", icon: "📱", category: "play", softLimitMinutes: 30, hardLimitMinutes: 90, limitScope: "per_day" },
  { name: "動画視聴", icon: "📺", category: "play", softLimitMinutes: 60, hardLimitMinutes: 180, limitScope: "per_day" },
  { name: "仮眠", icon: "💤", category: "rest", softLimitMinutes: 20, hardLimitMinutes: 45, limitScope: "per_session" },
];

export function normalizeLifeActivity(raw: Partial<LifeActivity> & Record<string, unknown>): LifeActivity {
  const category = LIFE_ACTIVITY_CATEGORIES.includes(raw.category as LifeCategory)
    ? (raw.category as LifeCategory)
    : "other";
  const scope = LIFE_LIMIT_SCOPES.includes(raw.limitScope as LifeLimitScope)
    ? (raw.limitScope as LifeLimitScope)
    : "per_session";
  const soft = Math.max(0, Math.trunc(Number(raw.softLimitMinutes) || 0));
  const hard = Math.max(0, Math.trunc(Number(raw.hardLimitMinutes) || 0));
  const name = String(raw.name ?? "").trim() || "未命名";
  const icon = String(raw.icon ?? "").trim() || "⏱";
  return {
    id: raw.id || shortId(),
    name,
    icon,
    category,
    softLimitMinutes: soft,
    hardLimitMinutes: hard,
    limitScope: scope,
    archived: Boolean(raw.archived),
  };
}

interface ActivityRow {
  data: string;
}

export function loadLifeActivities(): LifeActivity[] {
  const rows = getDb()
    .prepare("SELECT data FROM life_activities ORDER BY sort_order")
    .all() as ActivityRow[];
  if (rows.length === 0) {
    const defaults = DEFAULT_LIFE_ACTIVITIES.map((a) => normalizeLifeActivity(a));
    saveLifeActivities(defaults);
    return defaults;
  }
  return rows.map((r) => normalizeLifeActivity(JSON.parse(r.data)));
}

export function saveLifeActivities(activities: LifeActivity[]): void {
  const db = getDb();
  const del = db.prepare("DELETE FROM life_activities");
  const ins = db.prepare(
    "INSERT INTO life_activities (id, sort_order, data) VALUES (?, ?, ?)"
  );
  const tx = db.transaction((items: LifeActivity[]) => {
    del.run();
    items.forEach((a, i) => ins.run(a.id, i, JSON.stringify(a)));
  });
  tx(activities);
}

interface LogRow {
  id: string;
  activity_id: string;
  started_at: string;
  ended_at: string | null;
  memo: string | null;
  alert_triggered: string | null;
}

function logRowToDict(row: LogRow): LifeLog {
  return {
    id: row.id,
    activityId: row.activity_id,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? "",
    memo: row.memo ?? "",
    alertTriggered: (row.alert_triggered ?? "") as LifeLog["alertTriggered"],
  };
}

export function loadTodayLifeLogs(todayIso?: string): LifeLog[] {
  const boundaryHour = getDayBoundaryHour();
  const day = todayIso ?? todayBoundaryIsoDate(boundaryHour);
  const { startIso, endIso } = dayRangeForBoundary(day, boundaryHour);
  return loadLifeLogsInRange(startIso, endIso);
}

export function loadLifeLogsInRange(startIso: string, endIso: string): LifeLog[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM life_logs " +
        "WHERE started_at < ? AND (ended_at = '' OR ended_at > ?) " +
        "ORDER BY started_at ASC"
    )
    .all(endIso, startIso) as LogRow[];
  return rows.map(logRowToDict);
}

export function loadAllLifeLogs(): LifeLog[] {
  const rows = getDb()
    .prepare("SELECT * FROM life_logs ORDER BY started_at ASC")
    .all() as LogRow[];
  return rows.map(logRowToDict);
}

function stopAllActiveLifeLogs(now: string): void {
  getDb().prepare("UPDATE life_logs SET ended_at = ? WHERE ended_at = ''").run(now);
}

export function startLifeLog(activityId: string): LifeLog {
  const now = nowIso();
  stopAllActiveLifeLogs(now);
  const id = shortId();
  const db = getDb();
  db.prepare(
    "INSERT INTO life_logs (id, activity_id, started_at) VALUES (?, ?, ?)"
  ).run(id, activityId, now);
  const row = db.prepare("SELECT * FROM life_logs WHERE id = ?").get(id) as LogRow;
  return logRowToDict(row);
}

export function stopLifeLog(logId: string, memo?: string): LifeLog | null {
  const now = nowIso();
  const db = getDb();
  if (memo === undefined) {
    db.prepare(
      "UPDATE life_logs SET ended_at = ? WHERE id = ? AND ended_at = ''"
    ).run(now, logId);
  } else {
    db.prepare(
      "UPDATE life_logs SET ended_at = ?, memo = ? WHERE id = ? AND ended_at = ''"
    ).run(now, memo, logId);
  }
  const row = db.prepare("SELECT * FROM life_logs WHERE id = ?").get(logId) as
    | LogRow
    | undefined;
  return row ? logRowToDict(row) : null;
}

export function deleteLifeLog(logId: string): void {
  getDb().prepare("DELETE FROM life_logs WHERE id = ?").run(logId);
}

export function stopActiveLifeLogIfAny(): LifeLog | null {
  const db = getDb();
  const row = db
    .prepare("SELECT id FROM life_logs WHERE ended_at = '' LIMIT 1")
    .get() as { id: string } | undefined;
  if (!row) return null;
  return stopLifeLog(row.id);
}
