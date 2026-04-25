import { scheduleAutosync } from "../../github/autosync.ts";
import {
  deleteManualSchedule,
  loadSchedules,
  normalizeSchedule,
  upsertManualSchedule,
} from "../../storage/schedule.ts";
import type { Schedule } from "../../types.ts";
import { shortId } from "../../utils/shortId.ts";
import { nowLocalIso } from "../../utils/time.ts";
import { broadcast } from "../broadcast.ts";
import type { Handler } from "../dispatch.ts";

function broadcastSchedules(session: { schedules: Schedule[] }): void {
  session.schedules = loadSchedules();
  broadcast({ type: "schedule_sync", schedules: session.schedules });
}

export const scheduleAdd: Handler = async (_ws, session, data) => {
  const raw = (data.schedule ?? {}) as Partial<Schedule> & Record<string, unknown>;
  const now = nowLocalIso();
  const schedule = normalizeSchedule({
    ...raw,
    id: raw.id ? String(raw.id) : shortId(),
    source: "manual",
    subscriptionId: "",
    externalUid: "",
    createdAt: raw.createdAt ? String(raw.createdAt) : now,
    updatedAt: now,
  });
  if (!schedule.start || !schedule.end) return;
  upsertManualSchedule(schedule);
  scheduleAutosync();
  broadcastSchedules(session);
};

export const scheduleEdit: Handler = async (_ws, session, data) => {
  const raw = (data.schedule ?? {}) as Partial<Schedule> & Record<string, unknown>;
  if (!raw.id) return;
  // 購読由来は編集禁止（クライアントが誤って投げてきても無視する）
  const incoming = normalizeSchedule({
    ...raw,
    source: "manual",
    subscriptionId: "",
    externalUid: "",
    updatedAt: nowLocalIso(),
  });
  if (!incoming.start || !incoming.end) return;
  upsertManualSchedule(incoming);
  scheduleAutosync();
  broadcastSchedules(session);
};

export const scheduleDelete: Handler = async (_ws, session, data) => {
  const id = String(data.scheduleId ?? "");
  if (!id) return;
  deleteManualSchedule(id);
  scheduleAutosync();
  broadcastSchedules(session);
};
