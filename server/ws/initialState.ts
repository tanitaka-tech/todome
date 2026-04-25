import { buildGitHubStatus } from "../github/sync.ts";
import { loadAIConfig } from "../storage/aiConfig.ts";
import { loadAppConfig } from "../storage/appConfig.ts";
import { loadGoals } from "../storage/goals.ts";
import { loadTasks } from "../storage/kanban.ts";
import {
  loadLifeActivities,
  loadTodayLifeLogs,
} from "../storage/life.ts";
import { loadProfile } from "../storage/profile.ts";
import {
  computeAllQuotaStreaks,
  loadAllQuotaLogs,
  loadQuotas,
  loadTodayQuotaLogs,
} from "../storage/quota.ts";
import { loadRetros } from "../storage/retro.ts";
import { loadSchedules } from "../storage/schedule.ts";
import { loadSubscriptions } from "../storage/subscription.ts";
import type { AppWebSocket, SessionState } from "../state.ts";
import { sendTo } from "./broadcast.ts";

export function loadSessionState(session: SessionState): void {
  session.kanbanTasks = loadTasks();
  session.goals = loadGoals();
  session.profile = loadProfile();
  session.schedules = loadSchedules();
  session.subscriptions = loadSubscriptions();
}

// 初期同期は複数ストレージ / 外部コマンドを直列に叩くため、いずれか 1 段が
// throw すると以降が全部送られずクライアントが partial state に陥る。各段を
// 独立にして失敗段のみエラー通知にすり替え、残りの同期は続行する。
export async function sendInitialState(
  ws: AppWebSocket,
  session: SessionState
): Promise<void> {
  const steps: Array<readonly [string, () => unknown]> = [
    ["kanban", () => ({ type: "kanban_sync", tasks: session.kanbanTasks })],
    ["goal", () => ({ type: "goal_sync", goals: session.goals })],
    ["profile", () => ({ type: "profile_sync", profile: session.profile })],
    ["retro", () => ({ type: "retro_list_sync", retros: loadRetros() })],
    ["ai_config", () => ({ type: "ai_config_sync", config: loadAIConfig() })],
    ["app_config", () => ({ type: "app_config_sync", config: loadAppConfig() })],
    ["life_activity", () => ({ type: "life_activity_sync", activities: loadLifeActivities() })],
    ["life_log", () => ({ type: "life_log_sync", logs: loadTodayLifeLogs() })],
    ["quota", () => {
      const quotas = loadQuotas();
      return { type: "quota_sync", quotas };
    }],
    ["quota_log", () => ({ type: "quota_log_sync", logs: loadTodayQuotaLogs() })],
    ["quota_streak", () => ({
      type: "quota_streak_sync",
      streaks: computeAllQuotaStreaks(loadQuotas(), loadAllQuotaLogs()),
    })],
    ["schedule", () => ({ type: "schedule_sync", schedules: session.schedules })],
    ["subscription", () => ({
      type: "subscription_sync",
      subscriptions: session.subscriptions,
    })],
    ["github_status", async () => await buildGitHubStatus()],
  ];

  for (const [name, produce] of steps) {
    try {
      sendTo(ws, await produce());
    } catch (err) {
      console.error(`[ws] initial state step "${name}" failed:`, err);
      sendTo(ws, {
        type: "error",
        scope: "initial_state",
        requestType: name,
        message: err instanceof Error ? err.message : "internal error",
      });
    }
  }
}
