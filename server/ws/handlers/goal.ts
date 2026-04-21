import {
  ensureKpiIds,
  normalizeGoalRepository,
  syncGoalAchievement,
} from "../../domain/goal.ts";
import { scheduleAutosync } from "../../github/autosync.ts";
import { saveGoals } from "../../storage/goals.ts";
import { saveTasks } from "../../storage/kanban.ts";
import type { Goal } from "../../types.ts";
import { sendTo } from "../broadcast.ts";
import type { Handler } from "../dispatch.ts";
import { shortId } from "../../utils/shortId.ts";

export const goalAdd: Handler = async (ws, session, data) => {
  const rawGoal = (data.goal ?? {}) as Partial<Goal> & Record<string, unknown>;
  const goal: Goal = {
    id: rawGoal.id || shortId(),
    name: String(rawGoal.name ?? ""),
    memo: String(rawGoal.memo ?? ""),
    kpis: ensureKpiIds(rawGoal.kpis),
    deadline: String(rawGoal.deadline ?? ""),
    achieved: Boolean(rawGoal.achieved),
    achievedAt: String(rawGoal.achievedAt ?? ""),
    ...(typeof rawGoal.icon === "string" ? { icon: rawGoal.icon } : {}),
    ...(typeof rawGoal.repository === "string" ? { repository: rawGoal.repository } : {}),
  };
  normalizeGoalRepository(goal);
  syncGoalAchievement(goal);
  session.goals.push(goal);
  saveGoals(session.goals);
  scheduleAutosync();
  sendTo(ws, { type: "goal_sync", goals: session.goals });
};

export const goalEdit: Handler = async (ws, session, data) => {
  const rawGoal = (data.goal ?? {}) as Partial<Goal> & Record<string, unknown>;
  const incoming: Goal = {
    id: String(rawGoal.id ?? ""),
    name: String(rawGoal.name ?? ""),
    memo: String(rawGoal.memo ?? ""),
    kpis: ensureKpiIds(rawGoal.kpis),
    deadline: String(rawGoal.deadline ?? ""),
    achieved: Boolean(rawGoal.achieved),
    achievedAt: String(rawGoal.achievedAt ?? ""),
    ...(typeof rawGoal.icon === "string" ? { icon: rawGoal.icon } : {}),
    ...(typeof rawGoal.repository === "string" ? { repository: rawGoal.repository } : {}),
  };
  normalizeGoalRepository(incoming);
  syncGoalAchievement(incoming);
  const goalId = incoming.id;
  const validTimeKpiIds = new Set(
    incoming.kpis.filter((k) => k.unit === "time").map((k) => k.id)
  );
  for (const task of session.kanbanTasks) {
    if (task.goalId === goalId && task.kpiId && !validTimeKpiIds.has(task.kpiId)) {
      task.kpiId = "";
      task.kpiContributed = false;
    }
  }
  session.goals = session.goals.map((g) => (g.id === goalId ? incoming : g));
  saveGoals(session.goals);
  saveTasks(session.kanbanTasks);
  scheduleAutosync();
  sendTo(ws, { type: "goal_sync", goals: session.goals });
  sendTo(ws, { type: "kanban_sync", tasks: session.kanbanTasks });
};

export const goalDelete: Handler = async (ws, session, data) => {
  const goalId = String(data.goalId ?? "");
  session.goals = session.goals.filter((g) => g.id !== goalId);
  for (const task of session.kanbanTasks) {
    if (task.goalId === goalId) {
      task.goalId = "";
      task.kpiId = "";
      task.kpiContributed = false;
    }
  }
  saveGoals(session.goals);
  saveTasks(session.kanbanTasks);
  scheduleAutosync();
  sendTo(ws, { type: "goal_sync", goals: session.goals });
  sendTo(ws, { type: "kanban_sync", tasks: session.kanbanTasks });
};
