import { stopTaskTimersIfRunning } from "../../domain/kanban.ts";
import { scheduleAutosync } from "../../github/autosync.ts";
import { saveTasks } from "../../storage/kanban.ts";
import {
  deleteLifeLog,
  loadLifeActivities,
  loadLifeLogsInRange,
  loadTodayLifeLogs,
  normalizeLifeActivity,
  saveLifeActivities,
  startLifeLog,
  stopLifeLog,
} from "../../storage/life.ts";
import {
  computeAllQuotaStreaks,
  loadAllQuotaLogs,
  loadQuotas,
  loadTodayQuotaLogs,
  stopActiveQuotaLogIfAny,
} from "../../storage/quota.ts";
import type { LifeActivity } from "../../types.ts";
import { broadcast, sendTo } from "../broadcast.ts";
import type { Handler } from "../dispatch.ts";

export const lifeActivityUpsert: Handler = async (_ws, _session, data) => {
  const incoming = (data.activity ?? {}) as Partial<LifeActivity> & Record<string, unknown>;
  const activities = loadLifeActivities();
  const normalized = normalizeLifeActivity(incoming);
  const idx = activities.findIndex((a) => a.id === normalized.id);
  if (idx >= 0) activities[idx] = normalized;
  else activities.push(normalized);
  saveLifeActivities(activities);
  scheduleAutosync();
  broadcast({ type: "life_activity_sync", activities });
};

export const lifeActivityArchive: Handler = async (_ws, _session, data) => {
  const id = String(data.id ?? "");
  if (!id) return;
  const activities = loadLifeActivities();
  for (const a of activities) {
    if (a.id === id) {
      a.archived = true;
      break;
    }
  }
  saveLifeActivities(activities);
  scheduleAutosync();
  broadcast({ type: "life_activity_sync", activities });
};

export const lifeActivityDelete: Handler = async (_ws, _session, data) => {
  const id = String(data.id ?? "");
  if (!id) return;
  const activities = loadLifeActivities().filter((a) => a.id !== id);
  saveLifeActivities(activities);
  scheduleAutosync();
  broadcast({ type: "life_activity_sync", activities });
};

export const lifeActivityReorder: Handler = async (_ws, _session, data) => {
  const ids = Array.isArray(data.ids) ? (data.ids as string[]) : [];
  const activities = loadLifeActivities();
  const map = new Map(activities.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const ordered: LifeActivity[] = [];
  for (const id of ids) {
    const a = map.get(id);
    if (a && !seen.has(id)) {
      ordered.push(a);
      seen.add(id);
    }
  }
  for (const a of activities) {
    if (!seen.has(a.id)) ordered.push(a);
  }
  saveLifeActivities(ordered);
  scheduleAutosync();
  broadcast({ type: "life_activity_sync", activities: ordered });
};

export const lifeLogStart: Handler = async (_ws, session, data) => {
  const activityId = String(data.activity_id ?? data.activityId ?? "");
  if (!activityId) return;
  stopTaskTimersIfRunning(session.kanbanTasks);
  saveTasks(session.kanbanTasks);
  const quotaStopped = stopActiveQuotaLogIfAny();
  const log = startLifeLog(activityId);
  scheduleAutosync();
  broadcast({ type: "kanban_sync", tasks: session.kanbanTasks });
  broadcast({ type: "life_log_sync", logs: loadTodayLifeLogs() });
  broadcast({ type: "life_log_started", log });
  if (quotaStopped) {
    broadcast({ type: "quota_log_sync", logs: loadTodayQuotaLogs() });
    broadcast({
      type: "quota_streak_sync",
      streaks: computeAllQuotaStreaks(loadQuotas(), loadAllQuotaLogs()),
    });
  }
};

export const lifeLogStop: Handler = async (_ws, _session, data) => {
  const logId = String(data.log_id ?? data.logId ?? "");
  const memo = typeof data.memo === "string" ? (data.memo as string) : undefined;
  if (!logId) return;
  const stopped = stopLifeLog(logId, memo);
  scheduleAutosync();
  broadcast({ type: "life_log_sync", logs: loadTodayLifeLogs() });
  if (stopped) broadcast({ type: "life_log_stopped", log: stopped });
};

export const lifeLogDelete: Handler = async (_ws, _session, data) => {
  const logId = String(data.log_id ?? data.logId ?? "");
  if (!logId) return;
  deleteLifeLog(logId);
  scheduleAutosync();
  broadcast({ type: "life_log_sync", logs: loadTodayLifeLogs() });
};

export const lifeLogRangeRequest: Handler = async (ws, _session, data) => {
  const requestId = String(data.requestId ?? "");
  const startIso = String(data.startIso ?? "");
  const endIso = String(data.endIso ?? "");
  const logs = startIso && endIso ? loadLifeLogsInRange(startIso, endIso) : [];
  sendTo(ws, { type: "life_log_range_sync", requestId, logs });
};
