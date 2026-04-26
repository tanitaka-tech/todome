import {
  computeAllQuotaStreaks,
  loadAllQuotaLogs,
  loadQuotas,
  loadTodayQuotaLogs,
  saveQuotas,
  startQuotaLog,
  stopActiveQuotaLogIfAny,
} from "../storage/quota.ts";
import {
  loadLifeActivities,
  loadTodayLifeLogs,
  saveLifeActivities,
  startLifeLog,
  stopActiveLifeLogIfAny,
} from "../storage/life.ts";
import type { LifeActivity, LifeLog, QuotaLog, QuotaStreak } from "../types.ts";

const QUOTA_UPDATE_PREFIX = "QUOTA_UPDATE:";
const QUOTA_LOG_START_PREFIX = "QUOTA_LOG_START:";
const QUOTA_LOG_STOP_CMD = "QUOTA_LOG_STOP";
const LIFE_UPDATE_PREFIX = "LIFE_UPDATE:";
const LIFE_LOG_START_PREFIX = "LIFE_LOG_START:";
const LIFE_LOG_STOP_CMD = "LIFE_LOG_STOP";

const VALID_CATEGORIES = ["rest", "play", "routine", "other"] as const;
const VALID_SCOPES = ["per_session", "per_day"] as const;

function parseJsonSafe(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

export interface QuotaLifeResult {
  quotasChanged: boolean;
  lifeActivitiesChanged: boolean;
  quotaLogStarted: QuotaLog | null;
  quotaLogStopped: boolean;
  lifeLogStarted: LifeLog | null;
  lifeLogStopped: boolean;
  todayQuotaLogs: QuotaLog[] | null;
  todayLifeLogs: LifeLog[] | null;
  streaks: QuotaStreak[] | null;
}

export function processQuotaLifeActions(todos: unknown): QuotaLifeResult {
  const result: QuotaLifeResult = {
    quotasChanged: false,
    lifeActivitiesChanged: false,
    quotaLogStarted: null,
    quotaLogStopped: false,
    lifeLogStarted: null,
    lifeLogStopped: false,
    todayQuotaLogs: null,
    todayLifeLogs: null,
    streaks: null,
  };

  const todoList = Array.isArray(todos)
    ? (todos as Array<{ content?: unknown }>)
    : [];

  for (const todo of todoList) {
    const content = typeof todo?.content === "string" ? todo.content : "";

    if (content.startsWith(QUOTA_UPDATE_PREFIX)) {
      const rest = content.slice(QUOTA_UPDATE_PREFIX.length);
      const colonIdx = rest.indexOf(":");
      if (colonIdx === -1) continue;
      const quotaId = rest.slice(0, colonIdx).trim();
      const updates = parseJsonSafe(rest.slice(colonIdx + 1).trim());
      if (!quotaId || !updates || typeof updates !== "object") continue;

      const quotas = loadQuotas();
      const target = quotas.find((q) => q.id === quotaId);
      if (!target) continue;

      const u = updates as Record<string, unknown>;
      if (typeof u.name === "string" && u.name.trim()) target.name = u.name.trim();
      if (typeof u.icon === "string" && u.icon.trim()) target.icon = u.icon.trim();
      if (typeof u.targetMinutes === "number") {
        target.targetMinutes = Math.max(0, Math.trunc(u.targetMinutes));
      }

      saveQuotas(quotas);
      result.quotasChanged = true;
      continue;
    }

    if (content.startsWith(QUOTA_LOG_START_PREFIX)) {
      const quotaId = content.slice(QUOTA_LOG_START_PREFIX.length).trim();
      if (!quotaId) continue;
      result.quotaLogStarted = startQuotaLog(quotaId);
      continue;
    }

    if (content.trim() === QUOTA_LOG_STOP_CMD) {
      result.quotaLogStopped = stopActiveQuotaLogIfAny() !== null;
      continue;
    }

    if (content.startsWith(LIFE_UPDATE_PREFIX)) {
      const rest = content.slice(LIFE_UPDATE_PREFIX.length);
      const colonIdx = rest.indexOf(":");
      if (colonIdx === -1) continue;
      const activityId = rest.slice(0, colonIdx).trim();
      const updates = parseJsonSafe(rest.slice(colonIdx + 1).trim());
      if (!activityId || !updates || typeof updates !== "object") continue;

      const activities = loadLifeActivities();
      const target = activities.find((a) => a.id === activityId);
      if (!target) continue;

      const u = updates as Record<string, unknown>;
      if (typeof u.name === "string" && u.name.trim()) target.name = u.name.trim();
      if (typeof u.icon === "string" && u.icon.trim()) target.icon = u.icon.trim();
      if (typeof u.softLimitMinutes === "number") {
        target.softLimitMinutes = Math.max(0, Math.trunc(u.softLimitMinutes));
      }
      if (typeof u.hardLimitMinutes === "number") {
        target.hardLimitMinutes = Math.max(0, Math.trunc(u.hardLimitMinutes));
      }
      if (
        typeof u.category === "string" &&
        VALID_CATEGORIES.includes(u.category as (typeof VALID_CATEGORIES)[number])
      ) {
        target.category = u.category as LifeActivity["category"];
      }
      if (
        typeof u.limitScope === "string" &&
        VALID_SCOPES.includes(u.limitScope as (typeof VALID_SCOPES)[number])
      ) {
        target.limitScope = u.limitScope as LifeActivity["limitScope"];
      }

      saveLifeActivities(activities);
      result.lifeActivitiesChanged = true;
      continue;
    }

    if (content.startsWith(LIFE_LOG_START_PREFIX)) {
      const activityId = content.slice(LIFE_LOG_START_PREFIX.length).trim();
      if (!activityId) continue;
      result.lifeLogStarted = startLifeLog(activityId);
      continue;
    }

    if (content.trim() === LIFE_LOG_STOP_CMD) {
      result.lifeLogStopped = stopActiveLifeLogIfAny() !== null;
      continue;
    }
  }

  if (result.quotaLogStarted || result.quotaLogStopped) {
    result.todayQuotaLogs = loadTodayQuotaLogs();
  }
  if (result.lifeLogStarted || result.lifeLogStopped) {
    result.todayLifeLogs = loadTodayLifeLogs();
  }
  if (result.quotasChanged || result.quotaLogStarted || result.quotaLogStopped) {
    result.streaks = computeAllQuotaStreaks(loadQuotas(), loadAllQuotaLogs());
  }

  return result;
}
