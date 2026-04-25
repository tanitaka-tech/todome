import { createDAVClient, fetchCalendars, fetchCalendarObjects, type DAVCalendar } from "tsdav";
import ICAL from "ical.js";
import type { CalDAVCalendarChoice, CalDAVConfig, Schedule } from "../types.ts";

export const ICLOUD_CALDAV_URL = "https://caldav.icloud.com";

interface ConnectionResult {
  ok: boolean;
  error: string;
  calendars: CalDAVCalendarChoice[];
}

interface DavClient {
  fetchCalendars: typeof fetchCalendars;
  fetchCalendarObjects: typeof fetchCalendarObjects;
}

async function buildClient(cfg: CalDAVConfig): Promise<DavClient | null> {
  if (!cfg.appleId || !cfg.appPassword) return null;
  return (await createDAVClient({
    serverUrl: ICLOUD_CALDAV_URL,
    credentials: { username: cfg.appleId, password: cfg.appPassword },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  })) as DavClient;
}

function pickColor(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // iCloud は "#RRGGBBAA" 形式で返すことがあるので末尾2桁を落とす
  const m = raw.match(/^#[0-9a-fA-F]{6}/);
  return m ? m[0].toLowerCase() : raw.toLowerCase();
}

function pickDisplayName(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "_cdata" in (raw as object)) {
    const cdata = (raw as { _cdata?: unknown })._cdata;
    if (typeof cdata === "string") return cdata;
  }
  return "";
}

function calendarsToChoices(items: DAVCalendar[]): CalDAVCalendarChoice[] {
  const result: CalDAVCalendarChoice[] = [];
  for (const c of items) {
    const url = c.url ?? "";
    if (!url) continue;
    // iCloud は VEVENT 以外（reminders 等）も calendar として返すので絞る
    const components = c.components;
    const isEventCal =
      !components ||
      (Array.isArray(components) && components.includes("VEVENT"));
    if (!isEventCal) continue;
    result.push({
      url,
      displayName: pickDisplayName(c.displayName) || url,
      description: typeof c.description === "string" ? c.description : "",
      color: pickColor(c.calendarColor),
      ctag: typeof c.ctag === "string" ? c.ctag : "",
    });
  }
  return result;
}

/**
 * Apple ID + App用パスワードで iCloud に接続して、利用可能カレンダー一覧を返す。
 * 接続失敗時は ok=false + error を返す（throw しない）。
 */
export async function connectAndListCalendars(
  cfg: CalDAVConfig,
): Promise<ConnectionResult> {
  if (!cfg.appleId || !cfg.appPassword) {
    return { ok: false, error: "Apple ID と App用パスワードが必要です", calendars: [] };
  }
  try {
    const client = await buildClient(cfg);
    if (!client) {
      return { ok: false, error: "認証情報が不完全です", calendars: [] };
    }
    const cals = await client.fetchCalendars();
    return { ok: true, error: "", calendars: calendarsToChoices(cals) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      calendars: [],
    };
  }
}

// ----- VEVENT パース & RRULE 展開 -----

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function timeToLocalIso(t: ICAL.Time, tzid: string): string {
  // ical.js Time → 指定 TZ → Date → ローカル ISO 文字列
  // Schedule.start は Z なしのローカル文字列（クライアント側で `new Date(str)` parse 想定）
  const inLocal = new Date(
    t.toJSDate().toLocaleString("en-US", { timeZone: tzid }),
  );
  return `${inLocal.getFullYear()}-${pad2(inLocal.getMonth() + 1)}-${pad2(inLocal.getDate())}T${pad2(inLocal.getHours())}:${pad2(inLocal.getMinutes())}:${pad2(inLocal.getSeconds())}`;
}

function dateOnlyIso(t: ICAL.Time): string {
  // 終日イベント: 日付だけ。終了は exclusive 仕様なので呼び出し側で handling する。
  return `${t.year}-${pad2(t.month)}-${pad2(t.day)}T00:00:00`;
}

function registerTimezones(comp: ICAL.Component): void {
  const tzs = comp.getAllSubcomponents("vtimezone");
  for (const tz of tzs) {
    const tzid = tz.getFirstPropertyValue("tzid");
    if (typeof tzid !== "string") continue;
    if (!ICAL.TimezoneService.has(tzid)) {
      ICAL.TimezoneService.register(new ICAL.Timezone({ component: tz, tzid }));
    }
  }
}

interface ExpandOptions {
  /** 展開対象の出力 TZ (例: "Asia/Tokyo")。Schedule.start に書く時刻の解釈に使う。 */
  tzid: string;
  /** 過去側の境界 (UTC ms)。これより前で完全に終わる occurrence は捨てる。 */
  rangeStartMs: number;
  /** 未来側の境界 (UTC ms)。これより後で開始する occurrence は捨てる。 */
  rangeEndMs: number;
  /** 暴走防止上限 (1イベント当たりの occurrence 上限)。デフォルト 500。 */
  maxOccurrences?: number;
}

interface RawEvent {
  uid: string;
  startMs: number;
  endMs: number;
  start: string;
  end: string;
  allDay: boolean;
  summary: string;
  description: string;
  location: string;
  rrule: string;
  recurrenceId: string;
}

function pushEvent(
  out: RawEvent[],
  ev: ICAL.Event,
  startTime: ICAL.Time,
  endTime: ICAL.Time,
  tzid: string,
  rrule: string,
  recurrenceId: string,
): void {
  const allDay = startTime.isDate;
  const startIso = allDay ? dateOnlyIso(startTime) : timeToLocalIso(startTime, tzid);
  // ICS の DTEND は exclusive。todome 側は終了時刻を inclusive で扱う UI なので、
  // 全日イベントは 1 日引いて inclusive にする。時刻イベントはそのまま。
  let endIso: string;
  if (allDay) {
    const adjusted = endTime.clone();
    adjusted.adjust(-1, 0, 0, 0);
    endIso = dateOnlyIso(adjusted);
  } else {
    endIso = timeToLocalIso(endTime, tzid);
  }
  out.push({
    uid: ev.uid || "",
    startMs: startTime.toJSDate().getTime(),
    endMs: endTime.toJSDate().getTime(),
    start: startIso,
    end: endIso,
    allDay,
    summary: ev.summary || "",
    description: ev.description || "",
    location: ev.location || "",
    rrule,
    recurrenceId,
  });
}

function expandSingleEvent(
  master: ICAL.Event,
  opts: ExpandOptions,
  out: RawEvent[],
): void {
  const max = opts.maxOccurrences ?? 500;
  const rruleProp = master.component.getFirstPropertyValue("rrule");
  const rruleStr = rruleProp ? String(rruleProp) : "";

  if (!master.isRecurring()) {
    // 単発
    const startMs = master.startDate.toJSDate().getTime();
    const endMs = master.endDate.toJSDate().getTime();
    if (endMs < opts.rangeStartMs) return;
    if (startMs > opts.rangeEndMs) return;
    pushEvent(out, master, master.startDate, master.endDate, opts.tzid, "", "");
    return;
  }

  const iter = master.iterator();
  let count = 0;
  let next: ICAL.Time | null = iter.next();
  while (next && count < max) {
    const occMs = next.toJSDate().getTime();
    if (occMs > opts.rangeEndMs) break;
    const details = master.getOccurrenceDetails(next);
    const startMs = details.startDate.toJSDate().getTime();
    const endMs = details.endDate.toJSDate().getTime();
    if (endMs >= opts.rangeStartMs) {
      const recId = details.recurrenceId
        ? details.recurrenceId.toString()
        : "";
      // exception で上書きされている場合 details.item は exception イベント
      const item = details.item;
      pushEvent(out, item, details.startDate, details.endDate, opts.tzid, rruleStr, recId);
      count += 1;
    }
    next = iter.next();
  }
}

/**
 * VCALENDAR テキスト 1 件以上をパースして、指定範囲内の occurrence を全部
 * RawEvent にして返す。RRULE / EXDATE / RECURRENCE-ID は ical.js が解釈。
 */
export function parseAndExpand(
  icsBlocks: string[],
  opts: ExpandOptions,
): RawEvent[] {
  const out: RawEvent[] = [];
  for (const ics of icsBlocks) {
    if (!ics) continue;
    let jcal: unknown;
    try {
      jcal = ICAL.parse(ics);
    } catch {
      continue;
    }
    const root = new ICAL.Component(jcal as [string, unknown[], unknown[]]);
    registerTimezones(root);

    // VEVENT は master + 0 個以上の RECURRENCE-ID 例外で構成される。
    // UID 単位でまとめて、master 1 個 + exceptions[] にする。
    const vevents = root.getAllSubcomponents("vevent");
    const groups = new Map<string, { master: ICAL.Component | null; exceptions: ICAL.Component[] }>();
    for (const v of vevents) {
      const uid = String(v.getFirstPropertyValue("uid") ?? "");
      if (!uid) continue;
      const recId = v.getFirstPropertyValue("recurrence-id");
      const g = groups.get(uid) ?? { master: null, exceptions: [] };
      if (recId) g.exceptions.push(v);
      else g.master = v;
      groups.set(uid, g);
    }

    for (const [, g] of groups) {
      const masterComp = g.master ?? g.exceptions[0];
      if (!masterComp) continue;
      const exceptionEvents = g.exceptions
        .filter((c) => c !== masterComp)
        .map((c) => new ICAL.Event(c));
      const master = new ICAL.Event(masterComp, {
        exceptions: exceptionEvents,
      });
      try {
        expandSingleEvent(master, opts, out);
      } catch {
        // 1 件の壊れたイベントで全体を落とさない
      }
    }
  }
  return out;
}

interface FetchOptions {
  cfg: CalDAVConfig;
  calendarUrl: string;
  rangeStartMs: number;
  rangeEndMs: number;
  tzid: string;
}

export interface FetchResult {
  ok: boolean;
  error: string;
  schedules: Omit<Schedule, "id" | "source" | "subscriptionId" | "color" | "createdAt" | "updatedAt">[];
}

/**
 * 1 つの CalDAV カレンダーから [rangeStart, rangeEnd] の VEVENT を全部取って
 * Schedule 部品にして返す。subscriptionId と id は呼び出し側で割り当てる。
 */
export async function fetchEvents(opts: FetchOptions): Promise<FetchResult> {
  const client = await buildClient(opts.cfg);
  if (!client) {
    return { ok: false, error: "iCloud に未接続です", schedules: [] };
  }
  try {
    const cals = await client.fetchCalendars();
    const target = cals.find((c) => c.url === opts.calendarUrl);
    if (!target) {
      return { ok: false, error: "対象カレンダーが見つかりません", schedules: [] };
    }
    const objs = await client.fetchCalendarObjects({
      calendar: target,
      timeRange: {
        start: new Date(opts.rangeStartMs).toISOString(),
        end: new Date(opts.rangeEndMs).toISOString(),
      },
    });
    const ics = objs
      .map((o) => (typeof o.data === "string" ? o.data : ""))
      .filter(Boolean);
    const expanded = parseAndExpand(ics, {
      tzid: opts.tzid,
      rangeStartMs: opts.rangeStartMs,
      rangeEndMs: opts.rangeEndMs,
    });
    return {
      ok: true,
      error: "",
      schedules: expanded.map((e) => ({
        externalUid:
          e.recurrenceId ? `${e.uid}::${e.recurrenceId}` : e.uid,
        title: e.summary,
        description: e.description,
        location: e.location,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        rrule: e.rrule,
        recurrenceId: e.recurrenceId,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      schedules: [],
    };
  }
}
