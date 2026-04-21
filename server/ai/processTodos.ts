import {
  ensureKpiIds,
  normalizeGoalRepository,
  syncGoalAchievement,
} from "../domain/goal.ts";
import { applyProfileUpdate } from "../storage/profile.ts";
import type { ColumnId, Goal, KanbanTask, UserProfile } from "../types.ts";
import { shortId } from "../utils/shortId.ts";

const GOAL_ADD_PREFIX = "GOAL_ADD:";
const GOAL_UPDATE_PREFIX = "GOAL_UPDATE:";
const PROFILE_UPDATE_PREFIX = "PROFILE_UPDATE:";

const STATUS_TO_COLUMN: Record<string, ColumnId> = {
  pending: "todo",
  in_progress: "in_progress",
  completed: "done",
};

interface TodoEntry {
  content?: string;
  status?: string;
}

export interface ProcessTodosResult {
  tasks: KanbanTask[];
  goals: Goal[];
  profile: UserProfile;
}

function parseJsonSafe(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

export function processTodos(
  todos: unknown,
  existingTasks: KanbanTask[],
  existingGoals: Goal[],
  existingProfile: UserProfile
): ProcessTodosResult {
  const todoList = Array.isArray(todos) ? (todos as TodoEntry[]) : [];
  const existingTaskMap = new Map(existingTasks.map((t) => [t.title, t]));
  const existingGoalMap = new Map(existingGoals.map((g) => [g.name, g]));

  const tasks: KanbanTask[] = [];
  const goals = [...existingGoals];
  let profile = existingProfile;

  for (const todo of todoList) {
    const content = typeof todo.content === "string" ? todo.content : "";

    if (content.startsWith(PROFILE_UPDATE_PREFIX)) {
      const updates = parseJsonSafe(content.slice(PROFILE_UPDATE_PREFIX.length).trim());
      if (updates && typeof updates === "object") {
        profile = applyProfileUpdate(profile, updates as Record<string, unknown>);
      }
      continue;
    }

    if (content.startsWith(GOAL_ADD_PREFIX)) {
      const parsed = parseJsonSafe(content.slice(GOAL_ADD_PREFIX.length).trim());
      if (!parsed || typeof parsed !== "object") continue;
      const goalData = parsed as Record<string, unknown>;
      const name = typeof goalData.name === "string" ? goalData.name : "";
      if (name && existingGoalMap.has(name)) {
        const existing = existingGoalMap.get(name)!;
        for (const [k, v] of Object.entries(goalData)) {
          (existing as unknown as Record<string, unknown>)[k] = v;
        }
        existing.kpis = ensureKpiIds(existing.kpis ?? []);
        normalizeGoalRepository(existing);
        syncGoalAchievement(existing);
      } else {
        const newGoal: Goal = {
          id: shortId(),
          name: typeof goalData.name === "string" ? goalData.name : "新しい目標",
          memo: typeof goalData.memo === "string" ? goalData.memo : "",
          kpis: ensureKpiIds(goalData.kpis),
          deadline: typeof goalData.deadline === "string" ? goalData.deadline : "",
          achieved: Boolean(goalData.achieved),
          achievedAt: typeof goalData.achievedAt === "string" ? goalData.achievedAt : "",
          ...(typeof goalData.icon === "string" ? { icon: goalData.icon } : {}),
          ...(typeof goalData.repository === "string"
            ? { repository: goalData.repository }
            : {}),
        };
        normalizeGoalRepository(newGoal);
        syncGoalAchievement(newGoal);
        goals.push(newGoal);
        existingGoalMap.set(newGoal.name, newGoal);
      }
      continue;
    }

    if (content.startsWith(GOAL_UPDATE_PREFIX)) {
      const rest = content.slice(GOAL_UPDATE_PREFIX.length).trim();
      const colonIdx = rest.indexOf(":");
      if (colonIdx === -1) continue;
      const goalName = rest.slice(0, colonIdx).trim();
      const updates = parseJsonSafe(rest.slice(colonIdx + 1).trim());
      if (!updates || typeof updates !== "object") continue;
      const target = existingGoalMap.get(goalName);
      if (!target) continue;
      for (const [k, v] of Object.entries(updates as Record<string, unknown>)) {
        (target as unknown as Record<string, unknown>)[k] = v;
      }
      target.kpis = ensureKpiIds(target.kpis ?? []);
      normalizeGoalRepository(target);
      syncGoalAchievement(target);
      continue;
    }

    const status = typeof todo.status === "string" ? todo.status : "pending";
    let title = content;

    let goalId: string | null = null;
    const goalMatch = /^\[GOAL:([^\]]*)\]\s*/.exec(title);
    if (goalMatch) {
      goalId = goalMatch[1]!.trim();
      title = title.slice(goalMatch[0].length);
    }

    const existing = existingTaskMap.get(title);
    if (existing) {
      const task: KanbanTask = { ...existing };
      task.column = STATUS_TO_COLUMN[status] ?? "todo";
      if (goalId !== null) task.goalId = goalId;
      tasks.push(task);
    } else {
      tasks.push({
        id: shortId(),
        title,
        description: "",
        column: STATUS_TO_COLUMN[status] ?? "todo",
        memo: "",
        goalId: goalId ?? "",
        kpiId: "",
        kpiContributed: false,
        estimatedMinutes: 0,
        timeSpent: 0,
        timerStartedAt: "",
        completedAt: "",
        timeLogs: [],
      });
    }
  }

  return { tasks, goals, profile };
}
