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
import type { ColumnId, KanbanTask, TimeLog } from "../../types.ts";
import { broadcast, sendTo } from "../broadcast.ts";
import type { Handler } from "../dispatch.ts";
import {
  createScheduleFromLifeLogStop,
  createScheduleFromQuotaLogStop,
  createScheduleFromTaskTimerStop,
  createScheduleFromTimerLog,
  originIdForTaskTimeLog,
} from "./scheduleFromTimer.ts";

const COLUMN_IDS: readonly ColumnId[] = ["todo", "in_progress", "done"];

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

function assignIfPresent(
  task: KanbanTask,
  data: Record<string, unknown>,
  key: keyof KanbanTask
): void {
  if (!(key in data)) return;
  const value = data[key as string];
  switch (key) {
    case "column":
      if (isColumnId(value)) task.column = value;
      return;
    case "estimatedMinutes":
      task.estimatedMinutes = nonNegativeInteger(value);
      return;
    case "timeSpent":
      task.timeSpent = nonNegativeInteger(value);
      return;
    case "timeLogs":
      task.timeLogs = normalizeTimeLogs(value);
      return;
    case "title":
      task.title = String(value ?? "");
      return;
    case "description":
      task.description = String(value ?? "");
      return;
    case "memo":
      task.memo = String(value ?? "");
      return;
    case "goalId":
      task.goalId = String(value ?? "");
      return;
    case "kpiId":
      task.kpiId = String(value ?? "");
      return;
    case "timerStartedAt":
      task.timerStartedAt = String(value ?? "");
      return;
    case "completedAt":
      task.completedAt = String(value ?? "");
      return;
    case "id":
    case "kpiContributed":
      return;
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

function isColumnId(value: unknown): value is ColumnId {
  return typeof value === "string" && COLUMN_IDS.includes(value as ColumnId);
}

function nonNegativeInteger(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function normalizeTimeLogs(value: unknown): KanbanTask["timeLogs"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const log = raw as Record<string, unknown>;
    if (typeof log.start !== "string" || typeof log.end !== "string") return [];
    return [
      {
        start: log.start,
        end: log.end,
        duration: nonNegativeInteger(log.duration),
      },
    ];
  });
}

function isStartingTimer(data: Record<string, unknown>): boolean {
  return typeof data.timerStartedAt === "string" && data.timerStartedAt !== "";
}

function stopExistingTaskTimers(session: SessionState): string[] {
  const beforeById = new Map(
    session.kanbanTasks.map((task) => [task.id, before(task)] as const)
  );
  const stoppedIds = stopTaskTimersIfRunning(session.kanbanTasks);
  for (const id of stoppedIds) {
    const task = session.kanbanTasks.find((t) => t.id === id);
    const prev = beforeById.get(id);
    if (task && prev) rebalanceKpiContribution(task, prev, session.goals);
  }
  return stoppedIds;
}

async function broadcastSchedulesForStoppedTasks(
  session: SessionState,
  stoppedTaskIds: string[],
): Promise<void> {
  for (const id of stoppedTaskIds) {
    const task = session.kanbanTasks.find((t) => t.id === id);
    if (task) await createScheduleFromTaskTimerStop(session, task);
  }
}

function hasTask(session: SessionState, taskId: string): boolean {
  return session.kanbanTasks.some((task) => task.id === taskId);
}

export const kanbanMove: Handler = async (ws, session, data) => {
  const taskId = String(data.taskId ?? "");
  const startingTimer = isStartingTimer(data) && hasTask(session, taskId);
  const stoppedTaskIds = startingTimer ? stopExistingTaskTimers(session) : [];
  for (const task of session.kanbanTasks) {
    if (task.id !== taskId) continue;
    const prev = before(task);
    for (const key of [
      "column",
      "timeSpent",
      "timerStartedAt",
      "completedAt",
      "timeLogs",
    ] as const) {
      assignIfPresent(task, data, key);
    }
    rebalanceKpiContribution(task, prev, session.goals);
    break;
  }
  let lifeStopped = null;
  let quotaStopped = null;
  if (startingTimer) {
    lifeStopped = stopActiveLifeLogIfAny();
    quotaStopped = stopActiveQuotaLogIfAny();
  }
  saveTasks(session.kanbanTasks);
  saveGoals(session.goals);
  scheduleAutosync();
  sendKanbanAndGoals(ws, session);
  if (startingTimer) broadcastTimeTrackingSync();
  await broadcastSchedulesForStoppedTasks(session, stoppedTaskIds);
  if (lifeStopped) await createScheduleFromLifeLogStop(session, lifeStopped);
  if (quotaStopped) await createScheduleFromQuotaLogStop(session, quotaStopped);
};

export const kanbanAdd: Handler = async (ws, session, data) => {
  const newTask: KanbanTask = {
    id: shortId(),
    title: String(data.title ?? "新しいタスク"),
    description: String(data.description ?? ""),
    column: isColumnId(data.column) ? data.column : "todo",
    memo: String(data.memo ?? ""),
    goalId: String(data.goalId ?? ""),
    kpiId: String(data.kpiId ?? ""),
    kpiContributed: false,
    estimatedMinutes: nonNegativeInteger(data.estimatedMinutes ?? 0),
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

export const kanbanReorder: Handler = async (ws, session, data) => {
  const move = data.move;
  const moveData =
    move && typeof move === "object" ? (move as Record<string, unknown>) : null;
  const movedTaskId = String(moveData?.taskId ?? "");
  const startingTimer =
    moveData !== null && isStartingTimer(moveData) && hasTask(session, movedTaskId);
  const stoppedTaskIds = startingTimer ? stopExistingTaskTimers(session) : [];
  if (moveData && movedTaskId) {
    for (const task of session.kanbanTasks) {
      if (task.id !== movedTaskId) continue;
      const prev = before(task);
      for (const key of [
        "column",
        "timeSpent",
        "timerStartedAt",
        "completedAt",
        "timeLogs",
      ] as const) {
        assignIfPresent(task, moveData, key);
      }
      rebalanceKpiContribution(task, prev, session.goals);
      break;
    }
  }

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
  let lifeStopped = null;
  let quotaStopped = null;
  if (startingTimer) {
    lifeStopped = stopActiveLifeLogIfAny();
    quotaStopped = stopActiveQuotaLogIfAny();
  }
  saveTasks(session.kanbanTasks);
  saveGoals(session.goals);
  scheduleAutosync();
  sendKanbanAndGoals(ws, session);
  if (startingTimer) broadcastTimeTrackingSync();
  await broadcastSchedulesForStoppedTasks(session, stoppedTaskIds);
  if (lifeStopped) await createScheduleFromLifeLogStop(session, lifeStopped);
  if (quotaStopped) await createScheduleFromQuotaLogStop(session, quotaStopped);
};

export const kanbanEdit: Handler = async (ws, session, data) => {
  const taskId = String(data.taskId ?? "");
  const startingTimer = isStartingTimer(data) && hasTask(session, taskId);
  const stoppedTaskIds = startingTimer ? stopExistingTaskTimers(session) : [];
  const addedTimeLogs: TimeLog[] = [];
  for (const task of session.kanbanTasks) {
    if (task.id !== taskId) continue;
    const prev = before(task);
    const prevLogsLen = task.timeLogs.length;
    for (const key of [
      "title",
      "description",
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
    if (!startingTimer && task.timeLogs.length > prevLogsLen) {
      addedTimeLogs.push(...task.timeLogs.slice(prevLogsLen));
    }
    break;
  }
  let lifeStopped = null;
  let quotaStopped = null;
  if (startingTimer) {
    lifeStopped = stopActiveLifeLogIfAny();
    quotaStopped = stopActiveQuotaLogIfAny();
  }
  saveTasks(session.kanbanTasks);
  saveGoals(session.goals);
  scheduleAutosync();
  sendKanbanAndGoals(ws, session);
  if (startingTimer) broadcastTimeTrackingSync();
  await broadcastSchedulesForStoppedTasks(session, stoppedTaskIds);
  if (lifeStopped) await createScheduleFromLifeLogStop(session, lifeStopped);
  if (quotaStopped) await createScheduleFromQuotaLogStop(session, quotaStopped);
  if (addedTimeLogs.length > 0) {
    const target = session.kanbanTasks.find((t) => t.id === taskId);
    if (target) {
      for (const log of addedTimeLogs) {
        await createScheduleFromTimerLog(session, {
          origin: { type: "task", id: originIdForTaskTimeLog(target.id, log) },
          title: target.title,
          startIso: log.start,
          endIso: log.end,
        });
      }
    }
  }
};
