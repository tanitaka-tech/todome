import type { Goal, KPI, KanbanTask } from "../types.ts";
import { shortId } from "../utils/shortId.ts";
import { nowLocalIso } from "../utils/time.ts";

const REPO_NAME_WITH_OWNER_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export function ensureKpiIds(kpis: unknown): KPI[] {
  const list = Array.isArray(kpis) ? kpis : [];
  return list.map((raw) => {
    const kpi = { ...(raw as Record<string, unknown>) } as Record<string, unknown>;
    if (!kpi.id) kpi.id = shortId();
    const unit = kpi.unit;
    if (unit !== "number" && unit !== "percent" && unit !== "time") {
      kpi.unit = "number";
    }
    let target = Math.max(0, Math.round(Number(kpi.targetValue) || 0));
    if (kpi.unit === "percent") target = 100;
    kpi.targetValue = target;
    kpi.currentValue = Math.max(0, Math.round(Number(kpi.currentValue) || 0));
    delete kpi.value;
    return kpi as unknown as KPI;
  });
}

export function normalizeGoalRepository(goal: Goal): Goal {
  const raw = goal.repository;
  if (typeof raw !== "string") {
    delete goal.repository;
    return goal;
  }
  const value = raw.trim();
  if (value && REPO_NAME_WITH_OWNER_RE.test(value)) {
    goal.repository = value;
  } else {
    delete goal.repository;
  }
  return goal;
}

export function isGoalAllKpisAchieved(goal: Goal): boolean {
  if (!goal.kpis.length) return false;
  return goal.kpis.every((kpi) => {
    const target = kpi.targetValue || 0;
    const current = kpi.currentValue || 0;
    return target > 0 && current >= target;
  });
}

export function syncGoalAchievement(goal: Goal): Goal {
  const allDone = isGoalAllKpisAchieved(goal);
  if (allDone && !goal.achieved) {
    goal.achieved = true;
    goal.achievedAt = nowLocalIso();
  } else if (!allDone && goal.achieved) {
    goal.achieved = false;
    goal.achievedAt = "";
  }
  return goal;
}

export function findTimeKpi(
  goals: Goal[],
  goalId: string,
  kpiId: string
): KPI | null {
  if (!goalId || !kpiId) return null;
  for (const g of goals) {
    if (g.id !== goalId) continue;
    for (const k of g.kpis) {
      if (k.id === kpiId && k.unit === "time") return k;
    }
    return null;
  }
  return null;
}

export function applyKpiTimeDelta(
  goals: Goal[],
  goalId: string,
  kpiId: string,
  deltaSeconds: number
): boolean {
  const kpi = findTimeKpi(goals, goalId, kpiId);
  if (!kpi || deltaSeconds === 0) return false;
  kpi.currentValue = Math.max(0, (kpi.currentValue || 0) + Math.trunc(deltaSeconds));
  const g = goals.find((x) => x.id === goalId);
  if (g) syncGoalAchievement(g);
  return true;
}

export interface RebalanceBefore {
  goalId: string;
  kpiId: string;
  timeSpent: number;
  kpiContributed: boolean;
}

export function rebalanceKpiContribution(
  task: KanbanTask,
  before: RebalanceBefore,
  goals: Goal[]
): void {
  if (before.kpiContributed) {
    applyKpiTimeDelta(goals, before.goalId, before.kpiId, -before.timeSpent);
    task.kpiContributed = false;
  }
  if (task.column === "done" && task.kpiId && task.goalId) {
    const added = applyKpiTimeDelta(goals, task.goalId, task.kpiId, task.timeSpent);
    if (added) task.kpiContributed = true;
  }
}
