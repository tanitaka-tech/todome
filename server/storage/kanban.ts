import { getDb } from "../db.ts";
import type { ColumnId, KanbanTask } from "../types.ts";

interface Row {
  data: string;
}

const COLUMN_IDS: readonly ColumnId[] = ["todo", "in_progress", "done"];

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return Boolean(raw && typeof raw === "object" && !Array.isArray(raw));
}

function isColumnId(value: unknown): value is ColumnId {
  return typeof value === "string" && COLUMN_IDS.includes(value as ColumnId);
}

function nonNegativeInteger(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function stringField(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  return typeof value === "string" ? value : "";
}

function normalizeKpiContributed(value: unknown): boolean {
  return value === true || value === "true";
}

function normalizeTimeLogs(value: unknown): KanbanTask["timeLogs"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const start = stringField(raw, "start");
    const end = stringField(raw, "end");
    if (!start || !end) return [];
    return [{ start, end, duration: nonNegativeInteger(raw.duration) }];
  });
}

export function normalizeKanbanTask(raw: unknown): KanbanTask | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id || typeof raw.title !== "string") return null;
  return {
    id,
    title: raw.title,
    description: stringField(raw, "description"),
    column: isColumnId(raw.column) ? raw.column : "todo",
    memo: stringField(raw, "memo"),
    goalId: stringField(raw, "goalId"),
    kpiId: stringField(raw, "kpiId"),
    kpiContributed: normalizeKpiContributed(raw.kpiContributed),
    estimatedMinutes: nonNegativeInteger(raw.estimatedMinutes),
    timeSpent: nonNegativeInteger(raw.timeSpent),
    timerStartedAt: stringField(raw, "timerStartedAt"),
    completedAt: stringField(raw, "completedAt"),
    timeLogs: normalizeTimeLogs(raw.timeLogs),
  };
}

export function loadTasks(): KanbanTask[] {
  const rows = getDb()
    .prepare("SELECT data FROM kanban_tasks ORDER BY sort_order")
    .all() as Row[];
  // 1行でも JSON.parse が失敗すると map() ごと throw して全タスクが消えるため、
  // 壊れた行はスキップして残りを返す。GitHub sync で外部要因でも DB が入れ替わる構成上、
  // 1行不正で UI が空白になるのを避ける。
  const tasks: KanbanTask[] = [];
  for (const r of rows) {
    try {
      const task = normalizeKanbanTask(JSON.parse(r.data) as unknown);
      if (task) tasks.push(task);
    } catch (err) {
      console.warn("[storage/kanban] skip malformed row:", err);
    }
  }
  return tasks;
}

export function saveTasks(tasks: KanbanTask[]): void {
  const db = getDb();
  const del = db.prepare("DELETE FROM kanban_tasks");
  const ins = db.prepare(
    "INSERT INTO kanban_tasks (id, sort_order, data) VALUES (?, ?, ?)"
  );
  const tx = db.transaction((items: KanbanTask[]) => {
    del.run();
    items.forEach((t, i) => ins.run(t.id, i, JSON.stringify(t)));
  });
  tx(tasks);
}
