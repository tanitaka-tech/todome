import {
  createCalendarObject,
  createDAVClient,
  deleteCalendarObject,
  fetchCalendars,
  fetchCalendarObjects,
  updateCalendarObject,
  urlEquals,
  type DAVCalendar,
} from "tsdav";
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
  createCalendarObject: typeof createCalendarObject;
  updateCalendarObject: typeof updateCalendarObject;
  deleteCalendarObject: typeof deleteCalendarObject;
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
  schedules: Omit<
    Schedule,
    | "id"
    | "source"
    | "subscriptionId"
    | "color"
    | "createdAt"
    | "updatedAt"
    | "caldavObjectUrl"
    | "caldavEtag"
  >[];
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
    const target = cals.find((c) => urlEquals(c.url, opts.calendarUrl));
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

// ----- 書き込み (manual schedule → iCloud) -----

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * "YYYY-MM-DDTHH:mm:ss" (Zなし、ローカル時刻) を、指定 TZ のローカル時刻として解釈し、
 * UTC タイムスタンプに変換する。
 *
 * 仕組み: Date.UTC(...) で「文字列の数値そのものを UTC として扱った時刻」を取り、
 * そこから Intl の formatToParts で同じ瞬間を tzid 表現したオフセットを計算して引く。
 */
export function localIsoToUtcMs(localIso: string, tzid: string): number {
  const m = localIso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) {
    const fallback = Date.parse(localIso);
    return Number.isFinite(fallback) ? fallback : Date.now();
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6]);
  // 文字列の数値を UTC として解釈した仮想時刻。
  const naiveUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  // この瞬間を tzid で表現したときの「数値」を取る。
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tzid,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(naiveUtc));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  let hour = get("hour");
  if (hour === 24) hour = 0;
  const tzNumeric = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );
  // tzid で見たときの数値と naiveUtc の差 = TZ オフセット (TZ が UTC より進んでいれば正)。
  const offsetMs = tzNumeric - naiveUtc;
  // ローカル時刻 = UTC + offset → UTC = ローカル時刻 - offset。
  return naiveUtc - offsetMs;
}

function formatUtcStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function formatDateOnly(localIso: string): string {
  const m = localIso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${m[1]}${m[2]}${m[3]}`;
}

function shiftDateOnly(yyyymmdd: string, days: number): string {
  const y = Number(yyyymmdd.slice(0, 4));
  const mo = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  const t = new Date(Date.UTC(y, mo - 1, d) + days * 24 * 60 * 60 * 1000);
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}`;
}

function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldLine(line: string): string {
  // RFC 5545 4.1: 75 octets を超える行は CRLF + 1 space で folding する。
  // 安全のため文字数で 73 ごとに区切る（マルチバイト UTF-8 でも壊れにくいよう余裕を取る）。
  if (line.length <= 75) return line;
  const out: string[] = [];
  let rest = line;
  let first = true;
  while (rest.length > 0) {
    const len = first ? 75 : 74;
    out.push((first ? "" : " ") + rest.slice(0, len));
    rest = rest.slice(len);
    first = false;
  }
  return out.join("\r\n");
}

/**
 * Schedule から VCALENDAR/VEVENT 文字列を作る。
 * - allDay: VALUE=DATE。DTEND は exclusive 仕様なので 1 日加算する。
 * - 時刻イベント: tzid を考慮して UTC に変換し DTSTART:...Z 形式で書く。
 */
export function buildVEventIcs(
  schedule: Schedule,
  tzid: string,
  uid: string,
): string {
  const dtstamp = formatUtcStamp(Date.now());
  const summary = escapeIcsText(schedule.title || "Untitled");
  const description = escapeIcsText(schedule.description || "");
  const location = escapeIcsText(schedule.location || "");

  let dtStart: string;
  let dtEnd: string;
  if (schedule.allDay) {
    const startDate = formatDateOnly(schedule.start);
    const endInclusive = formatDateOnly(schedule.end || schedule.start);
    if (!startDate) throw new Error("invalid start date");
    // todome の end は inclusive なので exclusive にするため 1 日足す
    const endExclusive = shiftDateOnly(endInclusive || startDate, 1);
    dtStart = `DTSTART;VALUE=DATE:${startDate}`;
    dtEnd = `DTEND;VALUE=DATE:${endExclusive}`;
  } else {
    const startMs = localIsoToUtcMs(schedule.start, tzid);
    const endMs = localIsoToUtcMs(schedule.end || schedule.start, tzid);
    dtStart = `DTSTART:${formatUtcStamp(startMs)}`;
    dtEnd = `DTEND:${formatUtcStamp(endMs)}`;
  }

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//todome//todome//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    dtStart,
    dtEnd,
    `SUMMARY:${summary}`,
  ];
  if (description) lines.push(`DESCRIPTION:${description}`);
  if (location) lines.push(`LOCATION:${location}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

interface PushOptions {
  cfg: CalDAVConfig;
  calendarUrl: string;
  schedule: Schedule;
  tzid: string;
  /** 既存の caldavObjectUrl があれば PUT、なければ POST。 */
  existingObjectUrl?: string;
  existingEtag?: string;
}

export interface PushResult {
  ok: boolean;
  error: string;
  /** push に成功した場合の DAV オブジェクト URL。新規作成時はサーバが決めた URL。 */
  objectUrl: string;
  etag: string;
  uid: string;
}

function uidForSchedule(schedule: Schedule): string {
  // externalUid が既にあればそれを使い回す（編集時に同じ UID が必要）
  if (schedule.externalUid) return schedule.externalUid;
  return `${schedule.id}@todome`;
}

function pickEtag(res: Response | undefined): string {
  if (!res) return "";
  const e = res.headers.get("ETag") || res.headers.get("etag") || "";
  return e;
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

export async function pushManualEvent(
  opts: PushOptions,
): Promise<PushResult> {
  if (!opts.cfg.appleId || !opts.cfg.appPassword) {
    return { ok: false, error: "iCloud に未接続です", objectUrl: "", etag: "", uid: "" };
  }
  if (!opts.calendarUrl) {
    return { ok: false, error: "書き込み先カレンダーが未設定です", objectUrl: "", etag: "", uid: "" };
  }
  try {
    const client = (await createDAVClient({
      serverUrl: ICLOUD_CALDAV_URL,
      credentials: { username: opts.cfg.appleId, password: opts.cfg.appPassword },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    })) as DavClient;

    const cals = await client.fetchCalendars();
    const target = cals.find((c) => urlEquals(c.url, opts.calendarUrl));
    if (!target) {
      return { ok: false, error: "対象カレンダーが見つかりません", objectUrl: "", etag: "", uid: "" };
    }
    const uid = uidForSchedule(opts.schedule);
    const ics = buildVEventIcs(opts.schedule, opts.tzid, uid);

    if (opts.existingObjectUrl) {
      const res = await client.updateCalendarObject({
        calendarObject: {
          url: opts.existingObjectUrl,
          data: ics,
          etag: opts.existingEtag,
        },
      });
      if (!res.ok) {
        const body = await safeReadBody(res);
        console.error(
          `[caldav] update failed status=${res.status} body=${body.slice(0, 400)}`,
        );
        return {
          ok: false,
          error: `更新失敗 (HTTP ${res.status}) ${body.slice(0, 200)}`,
          objectUrl: opts.existingObjectUrl,
          etag: opts.existingEtag ?? "",
          uid,
        };
      }
      return {
        ok: true,
        error: "",
        objectUrl: opts.existingObjectUrl,
        etag: pickEtag(res) || (opts.existingEtag ?? ""),
        uid,
      };
    } else {
      const filename = `${uid.replace(/[^a-zA-Z0-9._-]/g, "_")}.ics`;
      const res = await client.createCalendarObject({
        calendar: target,
        iCalString: ics,
        filename,
      });
      if (!res.ok) {
        const body = await safeReadBody(res);
        console.error(
          `[caldav] create failed status=${res.status} body=${body.slice(0, 400)}`,
        );
        return {
          ok: false,
          error: `作成失敗 (HTTP ${res.status}) ${body.slice(0, 200)}`,
          objectUrl: "",
          etag: "",
          uid,
        };
      }
      console.log(
        `[caldav] create ok status=${res.status} location=${res.headers.get("Location") ?? ""}`,
      );
      // 作成時のレスポンスヘッダ Location が新規 URL（無ければ calendar URL + filename）
      const loc = res.headers.get("Location") || res.headers.get("location") || "";
      let objectUrl = loc;
      if (objectUrl && !objectUrl.startsWith("http")) {
        // 相対パス → calendar URL の origin で絶対化
        try {
          objectUrl = new URL(objectUrl, opts.calendarUrl).toString();
        } catch {
          objectUrl = "";
        }
      }
      if (!objectUrl) {
        objectUrl = opts.calendarUrl.replace(/\/?$/, "/") + filename;
      }
      return { ok: true, error: "", objectUrl, etag: pickEtag(res), uid };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      objectUrl: opts.existingObjectUrl ?? "",
      etag: opts.existingEtag ?? "",
      uid: "",
    };
  }
}

export interface DeleteResult {
  ok: boolean;
  error: string;
}

export async function deleteManualEvent(
  cfg: CalDAVConfig,
  objectUrl: string,
  etag: string,
): Promise<DeleteResult> {
  if (!cfg.appleId || !cfg.appPassword) {
    return { ok: false, error: "iCloud に未接続です" };
  }
  if (!objectUrl) {
    return { ok: true, error: "" }; // 何も push されていなければ削除対象なし
  }
  try {
    const client = (await createDAVClient({
      serverUrl: ICLOUD_CALDAV_URL,
      credentials: { username: cfg.appleId, password: cfg.appPassword },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    })) as DavClient;
    const res = await client.deleteCalendarObject({
      calendarObject: { url: objectUrl, data: "", etag },
    });
    if (!res.ok && res.status !== 404) {
      return { ok: false, error: `削除失敗 (HTTP ${res.status})` };
    }
    return { ok: true, error: "" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
