import { deleteManualEvent, pushManualEvent } from "../../caldav/client.ts";
import { scheduleAutosync } from "../../github/autosync.ts";
import { loadCalDAVConfig } from "../../storage/caldav.ts";
import { loadProfile } from "../../storage/profile.ts";
import {
  deleteManualSchedule,
  loadManualSchedules,
  loadSchedules,
  normalizeSchedule,
  upsertManualSchedule,
} from "../../storage/schedule.ts";
import type { Schedule } from "../../types.ts";
import { shortId } from "../../utils/shortId.ts";
import { nowLocalIso } from "../../utils/time.ts";
import { broadcast } from "../broadcast.ts";
import type { Handler } from "../dispatch.ts";
import { buildCalDAVStatus } from "./caldav.ts";

function notifyCaldavError(message: string): void {
  broadcast({ type: "caldav_status", status: buildCalDAVStatus(message) });
}

function broadcastSchedules(session: { schedules: Schedule[] }): void {
  session.schedules = loadSchedules();
  broadcast({ type: "schedule_sync", schedules: session.schedules });
}

function effectiveTimezone(): string {
  const tz = loadProfile().timezone;
  if (tz) return tz;
  try {
    const sys = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return sys || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * iCloud に書き込み先が設定されている manual schedule を push する。
 * 失敗してもローカルの schedule は維持する（best-effort）。
 * push 結果（caldavObjectUrl/caldavEtag/externalUid）が変われば DB を更新する。
 */
async function maybePushToCloud(schedule: Schedule): Promise<void> {
  const cfg = loadCalDAVConfig();
  if (!cfg.appleId || !cfg.appPassword) return;
  if (!cfg.writeTargetCalendarUrl) return;
  if (schedule.source !== "manual") return;

  const tzid = effectiveTimezone();
  const result = await pushManualEvent({
    cfg,
    calendarUrl: cfg.writeTargetCalendarUrl,
    schedule,
    tzid,
    existingObjectUrl: schedule.caldavObjectUrl || undefined,
    existingEtag: schedule.caldavEtag || undefined,
  });
  if (!result.ok) {
    console.error(
      `[caldav] push failed for schedule ${schedule.id}: ${result.error}`,
    );
    notifyCaldavError(`書き込みに失敗しました: ${result.error}`);
    return;
  }
  // push 成功時、URL/ETag/UID を保存（同じ id で再 upsert）
  const updated: Schedule = normalizeSchedule({
    ...schedule,
    caldavObjectUrl: result.objectUrl,
    caldavEtag: result.etag,
    externalUid: result.uid || schedule.externalUid,
  });
  upsertManualSchedule(updated);
  // 直前の lastError を消す（成功した時点でクリア）
  notifyCaldavError("");
}

async function maybeDeleteFromCloud(schedule: Schedule): Promise<void> {
  const cfg = loadCalDAVConfig();
  if (!cfg.appleId || !cfg.appPassword) return;
  if (!schedule.caldavObjectUrl) return;
  const result = await deleteManualEvent(
    cfg,
    schedule.caldavObjectUrl,
    schedule.caldavEtag,
  );
  if (!result.ok) {
    console.error(
      `[caldav] delete failed for schedule ${schedule.id}: ${result.error}`,
    );
    notifyCaldavError(`iCloud 側の削除に失敗しました: ${result.error}`);
  }
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
    caldavObjectUrl: "",
    caldavEtag: "",
    createdAt: raw.createdAt ? String(raw.createdAt) : now,
    updatedAt: now,
  });
  if (!schedule.start || !schedule.end) return;
  upsertManualSchedule(schedule);
  scheduleAutosync();
  broadcastSchedules(session);
  await maybePushToCloud(schedule);
  // push が成功すると DB の schedule に caldavObjectUrl が書き込まれるので再ブロードキャスト
  broadcastSchedules(session);
};

export const scheduleEdit: Handler = async (_ws, session, data) => {
  const raw = (data.schedule ?? {}) as Partial<Schedule> & Record<string, unknown>;
  if (!raw.id) return;
  // 既存レコードから caldav 識別情報を引き継ぐ（クライアントは知らないかもしれない）
  const existing = loadManualSchedules().find((s) => s.id === String(raw.id));
  // 購読由来は編集禁止（クライアントが誤って投げてきても無視する）
  const incoming = normalizeSchedule({
    ...raw,
    source: "manual",
    subscriptionId: "",
    externalUid: existing?.externalUid ?? String(raw.externalUid ?? ""),
    caldavObjectUrl: existing?.caldavObjectUrl ?? "",
    caldavEtag: existing?.caldavEtag ?? "",
    updatedAt: nowLocalIso(),
  });
  if (!incoming.start || !incoming.end) return;
  upsertManualSchedule(incoming);
  scheduleAutosync();
  broadcastSchedules(session);
  await maybePushToCloud(incoming);
  broadcastSchedules(session);
};

export const scheduleDelete: Handler = async (_ws, session, data) => {
  const id = String(data.scheduleId ?? "");
  if (!id) return;
  const target = loadManualSchedules().find((s) => s.id === id);
  deleteManualSchedule(id);
  scheduleAutosync();
  broadcastSchedules(session);
  if (target) await maybeDeleteFromCloud(target);
};
