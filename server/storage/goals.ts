import { getDb } from "../db.ts";
import { ensureKpiIds, normalizeGoalRepository } from "../domain/goal.ts";
import type { Goal } from "../types.ts";

interface Row {
  data: string;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return Boolean(raw && typeof raw === "object" && !Array.isArray(raw));
}

export function normalizeGoal(raw: Record<string, unknown>): Goal | null {
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!id || !name) return null;

  const goal: Goal = {
    id,
    name,
    memo: typeof raw.memo === "string" ? raw.memo : "",
    kpis: ensureKpiIds(raw.kpis),
    deadline: typeof raw.deadline === "string" ? raw.deadline : "",
    achieved: raw.achieved === true,
    achievedAt: typeof raw.achievedAt === "string" ? raw.achievedAt : "",
    ...(typeof raw.icon === "string" && raw.icon.trim()
      ? { icon: raw.icon.trim() }
      : {}),
    ...(typeof raw.repository === "string" ? { repository: raw.repository } : {}),
  };
  normalizeGoalRepository(goal);
  return goal;
}

export function loadGoals(): Goal[] {
  const rows = getDb()
    .prepare("SELECT data FROM goals ORDER BY sort_order")
    .all() as Row[];
  // 壊れた1行で全ロードを諦めない。kanban.ts の loadTasks と同じ方針。
  const goals: Goal[] = [];
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.data) as unknown;
      if (!isRecord(parsed)) continue;
      const goal = normalizeGoal(parsed);
      if (goal) goals.push(goal);
    } catch (err) {
      console.warn("[storage/goals] skip malformed row:", err);
    }
  }
  return goals;
}

export function saveGoals(goals: Goal[]): void {
  const db = getDb();
  const del = db.prepare("DELETE FROM goals");
  const ins = db.prepare("INSERT INTO goals (id, sort_order, data) VALUES (?, ?, ?)");
  const tx = db.transaction((items: Goal[]) => {
    del.run();
    items.forEach((g, i) => ins.run(g.id, i, JSON.stringify(g)));
  });
  tx(goals);
}
