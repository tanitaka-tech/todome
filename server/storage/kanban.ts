import { getDb } from "../db.ts";
import type { KanbanTask } from "../types.ts";

interface Row {
  data: string;
}

export function loadTasks(): KanbanTask[] {
  const rows = getDb()
    .prepare("SELECT data FROM kanban_tasks ORDER BY sort_order")
    .all() as Row[];
  return rows.map((r) => {
    const t = JSON.parse(r.data) as KanbanTask;
    if (t.kpiId === undefined) t.kpiId = "";
    t.kpiContributed = Boolean(t.kpiContributed);
    return t;
  });
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
