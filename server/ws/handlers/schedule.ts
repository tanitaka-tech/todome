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
import {
  loadSubscriptions,
} from "../../storage/subscription.ts";
import type { CalendarSubscription, Schedule } from "../../types.ts";
import { shortId } from "../../utils/shortId.ts";
import { nowLocalIso } from "../../utils/time.ts";
import { broadcast } from "../broadcast.ts";
import type { Handler } from "../dispatch.ts";
import { buildCalDAVStatus } from "./caldav.ts";
import { refreshSubscriptionAndBroadcast } from "./subscription.ts";

function broadcastSchedules(session: { schedules: Schedule[] }): void {
  session.schedules = loadSchedules();
  broadcast({ type: "schedule_sync", schedules: session.schedules });
}

function notifyCaldavError(message: string): void {
  broadcast({ type: "caldav_status", status: buildCalDAVStatus(message) });
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

/** 書き戻しに使うカレンダー URL を決定する。
 * - manual: caldav_config.writeTargetCalendarUrl
 * - subscription (provider=caldav): その購読の url
 * - 上記以外: "" (push 不可)
 */
function pickCalendarUrl(
  schedule: Schedule,
  subs: CalendarSubscription[],
  cfg: ReturnType<typeof loadCalDAVConfig>,
): string {
  if (schedule.source === "subscription") {
    const sub = subs.find((s) => s.id === schedule.subscriptionId);
    if (!sub) return "";
    if (sub.provider !== "caldav") return ""; // ICS 公開URLは書き戻し不可
    return sub.url;
  }
  return cfg.writeTargetCalendarUrl ?? "";
}

async function maybePushToCloud(schedule: Schedule): Promise<void> {
  const cfg = loadCalDAVConfig();
  if (!cfg.appleId || !cfg.appPassword) return;
  const subs = loadSubscriptions();
  const calendarUrl = pickCalendarUrl(schedule, subs, cfg);
  if (!calendarUrl) return;

  // RRULE 展開済み occurrence の編集は単体ではサポートしない（master を上書きしてしまう）
  if (schedule.source === "subscription" && schedule.rrule) {
    notifyCaldavError(
      "繰り返しイベントの個別編集は未対応です（master を上書きしないため iCloud 側未反映）",
    );
    return;
  }

  const tzid = effectiveTimezone();
  const result = await pushManualEvent({
    cfg,
    calendarUrl,
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
  // manual の場合のみ DB に push 結果を書き戻す（subscription は次回 refresh で正規化される）
  if (schedule.source === "manual") {
    const updated: Schedule = normalizeSchedule({
      ...schedule,
      caldavObjectUrl: result.objectUrl,
      caldavEtag: result.etag,
      externalUid: result.uid || schedule.externalUid,
    });
    upsertManualSchedule(updated);
  }
  notifyCaldavError("");
}

async function maybeDeleteFromCloud(schedule: Schedule): Promise<void> {
  const cfg = loadCalDAVConfig();
  if (!cfg.appleId || !cfg.appPassword) return;
  if (!schedule.caldavObjectUrl) return;
  // 繰り返しイベントの delete は master ごと消えるので警告
  if (schedule.source === "subscription" && schedule.rrule) {
    notifyCaldavError(
      "繰り返しイベントの個別削除は未対応です（master を消すと全 occurrence が消えます）",
    );
    return;
  }
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
  broadcastSchedules(session);
};

export const scheduleEdit: Handler = async (_ws, session, data) => {
  const raw = (data.schedule ?? {}) as Partial<Schedule> & Record<string, unknown>;
  if (!raw.id) return;
  const id = String(raw.id);
  const all = loadSchedules();
  const existing = all.find((s) => s.id === id);
  if (!existing) return;

  if (existing.source === "subscription") {
    // subscription 由来は DB 上は次回 refresh で再生成される一時レコードなので、
    // upsertManualSchedule では保存しない。代わりに iCloud に書き戻すだけ。
    const subs = loadSubscriptions();
    const sub = subs.find((s) => s.id === existing.subscriptionId);
    if (!sub || sub.provider !== "caldav") {
      notifyCaldavError("この購読は書き戻しに対応していません (公開 iCal URL)");
      return;
    }
    const merged: Schedule = normalizeSchedule({
      ...existing,
      ...raw,
      // subscription の identity は維持（クライアントが弄っても無視）
      id: existing.id,
      source: "subscription",
      subscriptionId: existing.subscriptionId,
      externalUid: existing.externalUid,
      caldavObjectUrl: existing.caldavObjectUrl,
      caldavEtag: existing.caldavEtag,
      rrule: existing.rrule,
      recurrenceId: existing.recurrenceId,
      updatedAt: nowLocalIso(),
    });
    if (!merged.start || !merged.end) return;
    await maybePushToCloud(merged);
    // 書き戻し成功で iCloud は更新済み → 即 refresh してローカル DB / クライアント表示を反映
    await refreshSubscriptionAndBroadcast(existing.subscriptionId);
    return;
  }

  // manual の編集
  const incoming = normalizeSchedule({
    ...raw,
    source: "manual",
    subscriptionId: "",
    externalUid: existing.externalUid,
    caldavObjectUrl: existing.caldavObjectUrl,
    caldavEtag: existing.caldavEtag,
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
  const all = loadSchedules();
  const target = all.find((s) => s.id === id);
  if (!target) return;

  if (target.source === "subscription") {
    const subs = loadSubscriptions();
    const sub = subs.find((s) => s.id === target.subscriptionId);
    if (!sub || sub.provider !== "caldav") {
      notifyCaldavError("この購読は削除に対応していません (公開 iCal URL)");
      return;
    }
    await maybeDeleteFromCloud(target);
    await refreshSubscriptionAndBroadcast(target.subscriptionId);
    return;
  }

  // manual の削除
  deleteManualSchedule(id);
  scheduleAutosync();
  broadcastSchedules(session);
  await maybeDeleteFromCloud(target);
};
