import { getDb } from "../db.ts";
import type { KanbanTask } from "../types.ts";

interface Row {
  data: string;
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
      const t = JSON.parse(r.data) as KanbanTask;
      if (t.kpiId === undefined) t.kpiId = "";
      t.kpiContributed = Boolean(t.kpiContributed);
      tasks.push(t);
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
