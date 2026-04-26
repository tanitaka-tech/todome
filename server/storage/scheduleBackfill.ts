import type { Schedule } from "../types.ts";
import { shortId } from "../utils/shortId.ts";
import { nowLocalIso } from "../utils/time.ts";
import { loadTasks } from "./kanban.ts";
import { loadAllLifeLogs, loadLifeActivities } from "./life.ts";
import { loadAllQuotaLogs, loadQuotas } from "./quota.ts";
import {
  loadSchedules,
  normalizeSchedule,
  upsertManualSchedule,
} from "./schedule.ts";

export interface BackfillResult {
  added: number;
}

function originKey(type: string, id: string): string {
  return `${type}:${id}`;
}

/** 15秒未満の計測は誤操作の可能性が高いため Schedule 化しない (createScheduleFromTimerLog と同基準)。 */
const MIN_SCHEDULE_DURATION_MS = 15_000;

function isValidRange(startIso: string, endIso: string): boolean {
  if (!startIso || !endIso) return false;
  if (endIso <= startIso) return false;
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (
    Number.isFinite(startMs) &&
    Number.isFinite(endMs) &&
    endMs - startMs < MIN_SCHEDULE_DURATION_MS
  )
    return false;
  return true;
}

/**
 * 既存の計測ログ (タスクの timeLogs / LifeLog / QuotaLog) のうち、
 * Schedule にまだ反映されていないものを manual schedule (origin 付き) として登録する。
 *
 * - Cloud (iCloud / Google) には push しない（バックフィルは端末内のみ）
 * - origin: { type, id } の組で重複検知 → idempotent。複数回呼んでも安全
 * - LifeLog / QuotaLog は endedAt が空（計測中）はスキップ
 */
export function backfillSchedulesFromTimerLogs(): BackfillResult {
  const existing = loadSchedules();
  const seen = new Set<string>();
  for (const s of existing) {
    if (s.origin) seen.add(originKey(s.origin.type, s.origin.id));
  }

  let added = 0;
  const now = nowLocalIso();

  const tasks = loadTasks();
  for (const t of tasks) {
    for (const log of t.timeLogs) {
      if (!isValidRange(log.start, log.end)) continue;
      const oid = `${t.id}#${log.start}`;
      const key = originKey("task", oid);
      if (seen.has(key)) continue;
      const sch: Schedule = normalizeSchedule({
        id: shortId(),
        source: "manual",
        title: t.title || "(無題)",
        start: log.start,
        end: log.end,
        origin: { type: "task", id: oid },
        createdAt: now,
        updatedAt: now,
      });
      upsertManualSchedule(sch);
      seen.add(key);
      added++;
    }
  }

  const activities = new Map(loadLifeActivities().map((a) => [a.id, a]));
  for (const log of loadAllLifeLogs()) {
    if (!log.endedAt) continue;
    if (!isValidRange(log.startedAt, log.endedAt)) continue;
    const key = originKey("lifelog", log.id);
    if (seen.has(key)) continue;
    const activity = activities.get(log.activityId);
    const sch: Schedule = normalizeSchedule({
      id: shortId(),
      source: "manual",
      title: activity?.name ?? "活動",
      start: log.startedAt,
      end: log.endedAt,
      origin: { type: "lifelog", id: log.id },
      createdAt: now,
      updatedAt: now,
    });
    upsertManualSchedule(sch);
    seen.add(key);
    added++;
  }

  const quotas = new Map(loadQuotas().map((q) => [q.id, q]));
  for (const log of loadAllQuotaLogs()) {
    if (!log.endedAt) continue;
    if (!isValidRange(log.startedAt, log.endedAt)) continue;
    const key = originKey("quota", log.id);
    if (seen.has(key)) continue;
    const quota = quotas.get(log.quotaId);
    const sch: Schedule = normalizeSchedule({
      id: shortId(),
      source: "manual",
      title: quota?.name ?? "ノルマ",
      start: log.startedAt,
      end: log.endedAt,
      origin: { type: "quota", id: log.id },
      createdAt: now,
      updatedAt: now,
    });
    upsertManualSchedule(sch);
    seen.add(key);
    added++;
  }

  return { added };
}
