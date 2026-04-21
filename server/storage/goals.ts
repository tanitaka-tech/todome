import { getDb } from "../db.ts";
import type { Goal } from "../types.ts";

interface Row {
  data: string;
}

export function loadGoals(): Goal[] {
  const rows = getDb()
    .prepare("SELECT data FROM goals ORDER BY sort_order")
    .all() as Row[];
  return rows.map((r) => JSON.parse(r.data) as Goal);
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
