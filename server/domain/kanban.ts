import type { KanbanTask } from "../types.ts";
import { formatLocalIso } from "../utils/time.ts";

function parseIsoFlexible(iso: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function stopTaskTimersIfRunning(tasks: KanbanTask[]): string[] {
  const stopped: string[] = [];
  const now = new Date();
  const nowIso = formatLocalIso(now);
  for (const t of tasks) {
    const started = t.timerStartedAt || "";
    if (!started) continue;
    const startDt = parseIsoFlexible(started);
    if (!startDt) {
      t.timerStartedAt = "";
      continue;
    }
    const elapsed = Math.max(0, Math.floor((now.getTime() - startDt.getTime()) / 1000));
    t.timeSpent = (t.timeSpent || 0) + elapsed;
    t.timeLogs = [...(t.timeLogs || []), { start: started, end: nowIso, duration: elapsed }];
    t.timerStartedAt = "";
    stopped.push(t.id);
  }
  return stopped;
}
