import { stopTaskTimersIfRunning } from "../../domain/kanban.ts";
import { getDb } from "../../db.ts";
import { scheduleAutosync } from "../../github/autosync.ts";
import { saveTasks } from "../../storage/kanban.ts";
import {
  loadTodayLifeLogs,
  stopActiveLifeLogIfAny,
} from "../../storage/life.ts";
import {
  computeAllQuotaStreaks,
  loadAllQuotaLogs,
  loadQuotaLogsInRange,
  loadQuotas,
  loadTodayQuotaLogs,
  normalizeQuota,
  saveQuotas,
  startQuotaLog,
  stopQuotaLog,
} from "../../storage/quota.ts";
import type { Quota } from "../../types.ts";
import { broadcast, sendTo } from "../broadcast.ts";
import type { Handler } from "../dispatch.ts";
import {
  createScheduleFromLifeLogStop,
  createScheduleFromQuotaLogStop,
  createScheduleFromTaskTimerStop,
} from "./scheduleFromTimer.ts";

export const quotaUpsert: Handler = async (_ws, _session, data) => {
  const incoming = (data.quota ?? {}) as Partial<Quota> & Record<string, unknown>;
  const normalized = normalizeQuota(incoming);
  const quotas = loadQuotas();
  const idx = quotas.findIndex((q) => q.id === normalized.id);
  if (idx >= 0) quotas[idx] = normalized;
  else quotas.push(normalized);
  saveQuotas(quotas);
  scheduleAutosync();
  broadcast({ type: "quota_sync", quotas });
  broadcast({
    type: "quota_streak_sync",
    streaks: computeAllQuotaStreaks(quotas, loadAllQuotaLogs()),
  });
};

export const quotaDelete: Handler = async (_ws, _session, data) => {
  const quotaId = String(data.id ?? "");
  if (!quotaId) return;
  const quotas = loadQuotas().filter((q) => q.id !== quotaId);
  saveQuotas(quotas);
  getDb().prepare("DELETE FROM quota_logs WHERE quota_id = ?").run(quotaId);
  scheduleAutosync();
  broadcast({ type: "quota_sync", quotas });
  broadcast({ type: "quota_log_sync", logs: loadTodayQuotaLogs() });
  broadcast({
    type: "quota_streak_sync",
    streaks: computeAllQuotaStreaks(quotas, loadAllQuotaLogs()),
  });
};

export const quotaReorder: Handler = async (_ws, _session, data) => {
  const ids = Array.isArray(data.ids) ? (data.ids as string[]) : [];
  const quotas = loadQuotas();
  const map = new Map(quotas.map((q) => [q.id, q]));
  const seen = new Set<string>();
  const ordered: Quota[] = [];
  for (const id of ids) {
    const q = map.get(id);
    if (q && !seen.has(id)) {
      ordered.push(q);
      seen.add(id);
    }
  }
  for (const q of quotas) {
    if (!seen.has(q.id)) ordered.push(q);
  }
  saveQuotas(ordered);
  scheduleAutosync();
  broadcast({ type: "quota_sync", quotas: ordered });
};

export const quotaLogStart: Handler = async (_ws, session, data) => {
  const quotaId = String(data.quota_id ?? data.quotaId ?? "");
  if (!quotaId) return;
  const stoppedTaskIds = stopTaskTimersIfRunning(session.kanbanTasks);
  saveTasks(session.kanbanTasks);
  const lifeStopped = stopActiveLifeLogIfAny();
  const log = startQuotaLog(quotaId);
  scheduleAutosync();
  broadcast({ type: "kanban_sync", tasks: session.kanbanTasks });
  if (lifeStopped) broadcast({ type: "life_log_sync", logs: loadTodayLifeLogs() });
  broadcast({ type: "quota_log_sync", logs: loadTodayQuotaLogs() });
  broadcast({ type: "quota_log_started", log });
  broadcast({
    type: "quota_streak_sync",
    streaks: computeAllQuotaStreaks(loadQuotas(), loadAllQuotaLogs()),
  });
  if (lifeStopped) await createScheduleFromLifeLogStop(session, lifeStopped);
  for (const id of stoppedTaskIds) {
    const task = session.kanbanTasks.find((t) => t.id === id);
    if (task) await createScheduleFromTaskTimerStop(session, task);
  }
};

export const quotaLogStop: Handler = async (_ws, session, data) => {
  const logId = String(data.log_id ?? data.logId ?? "");
  const memo = typeof data.memo === "string" ? (data.memo as string) : undefined;
  if (!logId) return;
  const stopped = stopQuotaLog(logId, memo);
  scheduleAutosync();
  broadcast({ type: "quota_log_sync", logs: loadTodayQuotaLogs() });
  if (stopped) broadcast({ type: "quota_log_stopped", log: stopped });
  broadcast({
    type: "quota_streak_sync",
    streaks: computeAllQuotaStreaks(loadQuotas(), loadAllQuotaLogs()),
  });
  if (stopped) await createScheduleFromQuotaLogStop(session, stopped);
};

export const quotaLogRangeRequest: Handler = async (ws, _session, data) => {
  const requestId = String(data.requestId ?? "");
  const startIso = String(data.startIso ?? "");
  const endIso = String(data.endIso ?? "");
  const logs = startIso && endIso ? loadQuotaLogsInRange(startIso, endIso) : [];
  sendTo(ws, { type: "quota_log_range_sync", requestId, logs });
};
