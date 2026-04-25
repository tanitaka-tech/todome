import { deleteManualEvent, pushManualEvent } from "../../caldav/client.ts";
import {
  deleteManualEvent as deleteGoogleEvent,
  pushManualEvent as pushGoogleEvent,
} from "../../google/client.ts";
import { scheduleAutosync } from "../../github/autosync.ts";
import { loadCalDAVConfig } from "../../storage/caldav.ts";
import {
  getGoogleAccount,
  isGoogleAccountConnected,
  loadGoogleConfig,
} from "../../storage/google.ts";
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
import { buildGoogleStatus } from "./google.ts";
import { refreshSubscriptionAndBroadcast } from "./subscription.ts";

function broadcastSchedules(session: { schedules: Schedule[] }): void {
  session.schedules = loadSchedules();
  broadcast({ type: "schedule_sync", schedules: session.schedules });
}

function notifyCaldavError(message: string): void {
  broadcast({ type: "caldav_status", status: buildCalDAVStatus(message) });
}

function notifyGoogleError(message: string): void {
  broadcast({ type: "google_status", status: buildGoogleStatus(message) });
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

type WriteTarget =
  | { provider: "caldav"; url: string }
  | { provider: "google"; calendarId: string; accountId: string }
  | null;

function hasValidScheduleRange(schedule: Schedule): boolean {
  if (!schedule.start || !schedule.end) return false;
  if (schedule.allDay) {
    return schedule.end.slice(0, 10) >= schedule.start.slice(0, 10);
  }
  return schedule.end > schedule.start;
}

/** 書き戻しに使うカレンダーを決定する。
 * - manual:
 *    - schedule.caldavObjectUrl があれば caldav (既存 push 先を維持)
 *    - schedule.googleEventId があれば google (同上)
 *    - どちらも未設定なら caldav の writeTarget → google の writeTarget の順で確定
 * - subscription:
 *    - provider="caldav" → その購読の url
 *    - provider="google" → その購読の googleCalendarId
 *    - ics → null (push 不可)
 */
function pickWriteTarget(
  schedule: Schedule,
  subs: CalendarSubscription[],
  caldavCfg: ReturnType<typeof loadCalDAVConfig>,
  googleCfg: ReturnType<typeof loadGoogleConfig>,
): WriteTarget {
  if (schedule.source === "subscription") {
    const sub = subs.find((s) => s.id === schedule.subscriptionId);
    if (!sub) return null;
    if (sub.provider === "caldav") return { provider: "caldav", url: sub.url };
    if (sub.provider === "google") {
      return {
        provider: "google",
        calendarId: sub.googleCalendarId,
        accountId: sub.googleAccountId || googleCfg.activeAccountId || "",
      };
    }
    return null;
  }
  // manual: 既に push 済みならその provider に固定する
  if (schedule.caldavObjectUrl) {
    return caldavCfg.writeTargetCalendarUrl
      ? { provider: "caldav", url: caldavCfg.writeTargetCalendarUrl }
      : null;
  }
  if (schedule.googleEventId) {
    const account = getGoogleAccount(schedule.googleAccountId || undefined);
    return account?.writeTargetCalendarId
      ? {
          provider: "google",
          calendarId: account.writeTargetCalendarId,
          accountId: account.id,
        }
      : null;
  }
  // 未 push: 設定済みの書き込み先を優先採用 (両方あれば caldav 優先で既存挙動維持)
  if (caldavCfg.writeTargetCalendarUrl) {
    return { provider: "caldav", url: caldavCfg.writeTargetCalendarUrl };
  }
  const activeGoogleAccount = getGoogleAccount(googleCfg.activeAccountId || undefined);
  if (activeGoogleAccount?.writeTargetCalendarId) {
    return {
      provider: "google",
      calendarId: activeGoogleAccount.writeTargetCalendarId,
      accountId: activeGoogleAccount.id,
    };
  }
  return null;
}

async function maybePushToCloud(schedule: Schedule): Promise<void> {
  const caldavCfg = loadCalDAVConfig();
  const googleCfg = loadGoogleConfig();
  const subs = loadSubscriptions();
  const target = pickWriteTarget(schedule, subs, caldavCfg, googleCfg);
  if (!target) return;

  // 繰り返しイベントの個別編集は未対応（master を上書きしないため）
  if (schedule.source === "subscription" && schedule.rrule) {
    if (target.provider === "caldav") {
      notifyCaldavError(
        "繰り返しイベントの個別編集は未対応です（master を上書きしないため iCloud 側未反映）",
      );
    } else {
      notifyGoogleError(
        "繰り返しイベントの個別編集は未対応です（Google 側未反映）",
      );
    }
    return;
  }

  if (target.provider === "caldav") {
    if (!caldavCfg.appleId || !caldavCfg.appPassword) return;
    const tzid = effectiveTimezone();
    const result = await pushManualEvent({
      cfg: caldavCfg,
      calendarUrl: target.url,
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
    if (schedule.source === "manual") {
      const updated: Schedule = normalizeSchedule({
        ...schedule,
        caldavObjectUrl: result.objectUrl,
        caldavEtag: result.etag,
        externalUid: result.uid || schedule.externalUid,
      });
      upsertManualSchedule(updated);
      scheduleAutosync();
    }
    notifyCaldavError("");
    return;
  }

  // google
  if (!isGoogleAccountConnected(target.accountId)) return;
  if (!target.calendarId) return;
  const tzid = effectiveTimezone();
  const result = await pushGoogleEvent({
    calendarId: target.calendarId,
    accountId: target.accountId,
    schedule,
    existingEventId: schedule.googleEventId || undefined,
    tzid,
  });
  if (!result.ok) {
    console.error(
      `[google] push failed for schedule ${schedule.id}: ${result.error}`,
    );
    notifyGoogleError(`Google への書き込みに失敗しました: ${result.error}`);
    return;
  }
  if (schedule.source === "manual") {
    const updated: Schedule = normalizeSchedule({
      ...schedule,
      googleEventId: result.eventId,
      googleAccountId: target.accountId,
      externalUid: result.uid || schedule.externalUid,
    });
    upsertManualSchedule(updated);
    scheduleAutosync();
  }
  notifyGoogleError("");
}

async function maybeDeleteFromCloud(schedule: Schedule): Promise<void> {
  // CalDAV 側に push 済みなら CalDAV から消す
  if (schedule.caldavObjectUrl) {
    const cfg = loadCalDAVConfig();
    if (cfg.appleId && cfg.appPassword) {
      if (schedule.source === "subscription" && schedule.rrule) {
        notifyCaldavError(
          "繰り返しイベントの個別削除は未対応です（master を消すと全 occurrence が消えます）",
        );
      } else {
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
    }
  }

  // Google 側に push 済みなら Google からも消す
  if (schedule.googleEventId && isGoogleAccountConnected(schedule.googleAccountId || undefined)) {
    if (schedule.source === "subscription" && schedule.rrule) {
      notifyGoogleError(
        "繰り返しイベントの個別削除は未対応です（master を消すと全 occurrence が消えます）",
      );
      return;
    }
    // 削除対象の calendarId は: subscription なら購読の calendarId、manual なら write target
    const subs = loadSubscriptions();
    const cfg = loadGoogleConfig();
    let calendarId = "";
    let accountId = schedule.googleAccountId || cfg.activeAccountId || "";
    if (schedule.source === "subscription") {
      const sub = subs.find((s) => s.id === schedule.subscriptionId);
      if (sub?.provider === "google") {
        calendarId = sub.googleCalendarId;
        accountId = sub.googleAccountId || accountId;
      }
    } else {
      const account = getGoogleAccount(accountId);
      calendarId = account?.writeTargetCalendarId ?? "";
    }
    if (!calendarId) return;
    const result = await deleteGoogleEvent({
      calendarId,
      accountId,
      eventId: schedule.googleEventId,
    });
    if (!result.ok) {
      console.error(
        `[google] delete failed for schedule ${schedule.id}: ${result.error}`,
      );
      notifyGoogleError(`Google 側の削除に失敗しました: ${result.error}`);
    }
  }
}

export const scheduleAdd: Handler = async (_ws, session, data) => {
  const raw = (data.schedule ?? {}) as Partial<Schedule> & Record<string, unknown>;
  const now = nowLocalIso();
  const schedule = normalizeSchedule({
    ...raw,
    id: shortId(),
    source: "manual",
    subscriptionId: "",
    externalUid: "",
    caldavObjectUrl: "",
    caldavEtag: "",
    googleEventId: "",
    googleAccountId: "",
    createdAt: now,
    updatedAt: now,
  });
  if (!hasValidScheduleRange(schedule)) return;
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
    // upsertManualSchedule では保存しない。代わりに cloud (iCloud / Google) に書き戻すだけ。
    const subs = loadSubscriptions();
    const sub = subs.find((s) => s.id === existing.subscriptionId);
    if (!sub || (sub.provider !== "caldav" && sub.provider !== "google")) {
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
      googleEventId: existing.googleEventId,
      googleAccountId: existing.googleAccountId,
      rrule: existing.rrule,
      recurrenceId: existing.recurrenceId,
      createdAt: existing.createdAt,
      updatedAt: nowLocalIso(),
    });
    if (!hasValidScheduleRange(merged)) return;
    await maybePushToCloud(merged);
    // 書き戻し成功で cloud は更新済み → 即 refresh してローカル DB / クライアント表示を反映
    await refreshSubscriptionAndBroadcast(existing.subscriptionId);
    return;
  }

  // manual の編集
  const incoming = normalizeSchedule({
    ...existing,
    ...raw,
    id: existing.id,
    source: "manual",
    subscriptionId: "",
    externalUid: existing.externalUid,
    caldavObjectUrl: existing.caldavObjectUrl,
    caldavEtag: existing.caldavEtag,
    googleEventId: existing.googleEventId,
    googleAccountId: existing.googleAccountId,
    createdAt: existing.createdAt,
    updatedAt: nowLocalIso(),
  });
  if (!hasValidScheduleRange(incoming)) return;
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
    if (!sub || (sub.provider !== "caldav" && sub.provider !== "google")) {
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
