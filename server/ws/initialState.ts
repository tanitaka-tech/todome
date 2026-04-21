import { buildGitHubStatus } from "../github/sync.ts";
import { loadAIConfig } from "../storage/aiConfig.ts";
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
import type { AppWebSocket, SessionState } from "../state.ts";
import { sendTo } from "./broadcast.ts";

export function loadSessionState(session: SessionState): void {
  session.kanbanTasks = loadTasks();
  session.goals = loadGoals();
  session.profile = loadProfile();
}

export async function sendInitialState(
  ws: AppWebSocket,
  session: SessionState
): Promise<void> {
  sendTo(ws, { type: "kanban_sync", tasks: session.kanbanTasks });
  sendTo(ws, { type: "goal_sync", goals: session.goals });
  sendTo(ws, { type: "profile_sync", profile: session.profile });
  sendTo(ws, { type: "retro_list_sync", retros: loadRetros() });
  sendTo(ws, { type: "ai_config_sync", config: loadAIConfig() });
  sendTo(ws, { type: "life_activity_sync", activities: loadLifeActivities() });
  sendTo(ws, { type: "life_log_sync", logs: loadTodayLifeLogs() });
  const quotas = loadQuotas();
  const allQuotaLogs = loadAllQuotaLogs();
  sendTo(ws, { type: "quota_sync", quotas });
  sendTo(ws, { type: "quota_log_sync", logs: loadTodayQuotaLogs() });
  sendTo(ws, {
    type: "quota_streak_sync",
    streaks: computeAllQuotaStreaks(quotas, allQuotaLogs),
  });
  sendTo(ws, await buildGitHubStatus());
}
