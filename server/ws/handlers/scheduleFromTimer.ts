import { scheduleAutosync } from "../../github/autosync.ts";
import { loadLifeActivities } from "../../storage/life.ts";
import { loadQuotas } from "../../storage/quota.ts";
import {
  normalizeSchedule,
  upsertManualSchedule,
} from "../../storage/schedule.ts";
import type { SessionState } from "../../state.ts";
import type {
  KanbanTask,
  LifeLog,
  QuotaLog,
  Schedule,
  ScheduleOrigin,
  TimeLog,
} from "../../types.ts";
import { shortId } from "../../utils/shortId.ts";
import { nowLocalIso } from "../../utils/time.ts";
import { broadcastSchedules, maybePushToCloud } from "./schedule.ts";

export function originIdForTaskTimeLog(taskId: string, log: TimeLog): string {
  return `${taskId}#${log.start}`;
}

interface CreateOpts {
  origin: ScheduleOrigin;
  title: string;
  startIso: string;
  endIso: string;
}

export async function createScheduleFromTimerLog(
  session: SessionState,
  opts: CreateOpts,
): Promise<void> {
  if (!opts.startIso || !opts.endIso) return;
  if (opts.endIso <= opts.startIso) return;
  const now = nowLocalIso();
  const schedule: Schedule = normalizeSchedule({
    id: shortId(),
    source: "manual",
    title: opts.title || "(無題)",
    start: opts.startIso,
    end: opts.endIso,
    origin: opts.origin,
    createdAt: now,
    updatedAt: now,
  });
  upsertManualSchedule(schedule);
  scheduleAutosync();
  broadcastSchedules(session);
  await maybePushToCloud(schedule);
  broadcastSchedules(session);
}

export async function createScheduleFromTaskTimerStop(
  session: SessionState,
  task: KanbanTask,
): Promise<void> {
  const last = task.timeLogs[task.timeLogs.length - 1];
  if (!last) return;
  await createScheduleFromTimerLog(session, {
    origin: { type: "task", id: originIdForTaskTimeLog(task.id, last) },
    title: task.title,
    startIso: last.start,
    endIso: last.end,
  });
}

export async function createScheduleFromLifeLogStop(
  session: SessionState,
  log: LifeLog,
): Promise<void> {
  if (!log.endedAt) return;
  const activity = loadLifeActivities().find((a) => a.id === log.activityId);
  await createScheduleFromTimerLog(session, {
    origin: { type: "lifelog", id: log.id },
    title: activity?.name ?? "活動",
    startIso: log.startedAt,
    endIso: log.endedAt,
  });
}

export async function createScheduleFromQuotaLogStop(
  session: SessionState,
  log: QuotaLog,
): Promise<void> {
  if (!log.endedAt) return;
  const quota = loadQuotas().find((q) => q.id === log.quotaId);
  await createScheduleFromTimerLog(session, {
    origin: { type: "quota", id: log.id },
    title: quota?.name ?? "ノルマ",
    startIso: log.startedAt,
    endIso: log.endedAt,
  });
}
