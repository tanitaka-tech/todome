import { rebalanceKpiContribution, type RebalanceBefore } from "../../domain/goal.ts";
import { stopTaskTimersIfRunning } from "../../domain/kanban.ts";
import { scheduleAutosync } from "../../github/autosync.ts";
import { applyKpiTimeDelta } from "../../domain/goal.ts";
import { saveGoals } from "../../storage/goals.ts";
import { saveTasks } from "../../storage/kanban.ts";
import {
  loadTodayLifeLogs,
  stopActiveLifeLogIfAny,
} from "../../storage/life.ts";
import {
  computeAllQuotaStreaks,
  loadAllQuotaLogs,
  loadQuotas,
  loadTodayQuotaLogs,
  stopActiveQuotaLogIfAny,
} from "../../storage/quota.ts";
import { shortId } from "../../utils/shortId.ts";
import type { AppWebSocket, SessionState } from "../../state.ts";
import type { ColumnId, KanbanTask, Priority } from "../../types.ts";
import { broadcast, sendTo } from "../broadcast.ts";
import type { Handler } from "../dispatch.ts";

function sendKanbanAndGoals(ws: AppWebSocket, session: SessionState): void {
  sendTo(ws, { type: "kanban_sync", tasks: session.kanbanTasks });
  sendTo(ws, { type: "goal_sync", goals: session.goals });
}

function broadcastTimeTrackingSync(): void {
  broadcast({ type: "life_log_sync", logs: loadTodayLifeLogs() });
  broadcast({ type: "quota_log_sync", logs: loadTodayQuotaLogs() });
  broadcast({
    type: "quota_streak_sync",
    streaks: computeAllQuotaStreaks(loadQuotas(), loadAllQuotaLogs()),
  });
}

function assignIfPresent<K extends keyof KanbanTask>(
  task: KanbanTask,
  data: Record<string, unknown>,
  key: K
): void {
  if (key in data) {
    (task as unknown as Record<string, unknown>)[key as string] = data[key as string];
  }
}

function before(task: KanbanTask): RebalanceBefore {
  return {
    goalId: task.goalId || "",
    kpiId: task.kpiId || "",
    timeSpent: task.timeSpent || 0,
    kpiContributed: Boolean(task.kpiContributed),
  };
}

export const kanbanMove: Handler = async (ws, session, data) => {
  const taskId = String(data.taskId ?? "");
  const startingTimer = Boolean(data.timerStartedAt);
  for (const task of session.kanbanTasks) {
    if (task.id !== taskId) continue;
    const prev = before(task);
    task.column = data.column as ColumnId;
    for (const key of ["timeSpent", "timerStartedAt", "completedAt", "timeLogs"] as const) {
      assignIfPresent(task, data, key);
    }
    rebalanceKpiContribution(task, prev, session.goals);
    break;
  }
  if (startingTimer) {
    stopActiveLifeLogIfAny();
    stopActiveQuotaLogIfAny();
  }
  saveTasks(session.kanbanTasks);
  saveGoals(session.goals);
  scheduleAutosync();
  sendKanbanAndGoals(ws, session);
  if (startingTimer) broadcastTimeTrackingSync();
};

export const kanbanAdd: Handler = async (ws, session, data) => {
  const newTask: KanbanTask = {
    id: shortId(),
    title: String(data.title ?? "新しいタスク"),
    description: String(data.description ?? ""),
    column: (data.column as ColumnId) ?? "todo",
    priority: (data.priority as Priority) ?? "medium",
    memo: String(data.memo ?? ""),
    goalId: String(data.goalId ?? ""),
    kpiId: String(data.kpiId ?? ""),
    kpiContributed: false,
    estimatedMinutes: Number(data.estimatedMinutes ?? 0),
    timeSpent: 0,
    timerStartedAt: "",
    completedAt: "",
    timeLogs: [],
  };
  session.kanbanTasks.push(newTask);
  saveTasks(session.kanbanTasks);
  scheduleAutosync();
  sendTo(ws, { type: "kanban_sync", tasks: session.kanbanTasks });
};

export const kanbanDelete: Handler = async (ws, session, data) => {
  const taskId = String(data.taskId ?? "");
  const target = session.kanbanTasks.find((t) => t.id === taskId);
  if (target?.kpiContributed) {
    applyKpiTimeDelta(session.goals, target.goalId, target.kpiId, -target.timeSpent);
  }
  session.kanbanTasks = session.kanbanTasks.filter((t) => t.id !== taskId);
  saveTasks(session.kanbanTasks);
  saveGoals(session.goals);
  scheduleAutosync();
  sendKanbanAndGoals(ws, session);
};

export const kanbanReorder: Handler = async (_ws, session, data) => {
  const ids = Array.isArray(data.taskIds) ? (data.taskIds as string[]) : [];
  const taskMap = new Map(session.kanbanTasks.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const newOrder: KanbanTask[] = [];
  for (const id of ids) {
    const t = taskMap.get(id);
    if (t && !seen.has(id)) {
      newOrder.push(t);
      seen.add(id);
    }
  }
  for (const t of session.kanbanTasks) {
    if (!seen.has(t.id)) newOrder.push(t);
  }
  session.kanbanTasks = newOrder;
  saveTasks(session.kanbanTasks);
  scheduleAutosync();
};

export const kanbanEdit: Handler = async (ws, session, data) => {
  const taskId = String(data.taskId ?? "");
  const startingTimer = Boolean(data.timerStartedAt);
  for (const task of session.kanbanTasks) {
    if (task.id !== taskId) continue;
    const prev = before(task);
    for (const key of [
      "title",
      "description",
      "priority",
      "memo",
      "goalId",
      "kpiId",
      "estimatedMinutes",
      "timeSpent",
      "timerStartedAt",
      "completedAt",
      "timeLogs",
    ] as const) {
      assignIfPresent(task, data, key);
    }
    if (!task.goalId) task.kpiId = "";
    rebalanceKpiContribution(task, prev, session.goals);
    break;
  }
  if (startingTimer) {
    stopActiveLifeLogIfAny();
    stopActiveQuotaLogIfAny();
  }
  saveTasks(session.kanbanTasks);
  saveGoals(session.goals);
  scheduleAutosync();
  sendKanbanAndGoals(ws, session);
  if (startingTimer) broadcastTimeTrackingSync();
};

