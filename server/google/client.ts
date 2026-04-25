import {
  getGoogleAccount,
  loadGoogleConfig,
  saveGoogleAccount,
  saveGoogleConfig,
} from "../storage/google.ts";
import type {
  GoogleAccount,
  GoogleCalendarChoice,
  GoogleConfig,
  Schedule,
} from "../types.ts";
import { nowLocalIso } from "../utils/time.ts";
import { buildRedirectUri } from "./oauth.ts";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const CALENDAR_LIST_ENDPOINT =
  "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const CALENDARS_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars";

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

interface UserInfoResponse {
  email?: string;
  name?: string;
  sub?: string;
}

interface CalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  description?: string;
  primary?: boolean;
  backgroundColor?: string;
  foregroundColor?: string;
  accessRole?: string;
}

interface CalendarListResponse {
  items?: CalendarListEntry[];
  nextPageToken?: string;
}

export interface GoogleEventDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface GoogleEvent {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  recurrence?: string[];
  recurringEventId?: string;
  iCalUID?: string;
  htmlLink?: string;
}

interface EventsListResponse {
  items?: GoogleEvent[];
  nextPageToken?: string;
}

// --- OAuth: code → token 交換 ---

export async function exchangeCodeForToken(args: {
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
}): Promise<{ ok: true; token: TokenResponse } | { ok: false; error: string }> {
  const body = new URLSearchParams({
    client_id: args.clientId,
    client_secret: args.clientSecret,
    code: args.code,
    code_verifier: args.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: buildRedirectUri(),
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `token exchange failed (${res.status}): ${text}` };
  }
  const json = (await res.json()) as TokenResponse;
  return { ok: true, token: json };
}

// --- アクセストークンの refresh / 取得 ---

function expiresAtFromNow(expiresInSec: number): string {
  const d = new Date(Date.now() + expiresInSec * 1000);
  // ローカル ISO 形式で保存（caldav config と同じ流儀）
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function refreshAccessToken(
  cfg: GoogleConfig,
  account: GoogleAccount,
): Promise<{ ok: true; access: string; expiresAt: string } | { ok: false; error: string }> {
  if (!cfg.clientId || !cfg.clientSecret || !account.refreshToken) {
    return { ok: false, error: "Google 接続情報が不足しています" };
  }
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: account.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `token refresh failed (${res.status}): ${text}` };
  }
  const json = (await res.json()) as TokenResponse;
  const expiresAt = expiresAtFromNow(json.expires_in ?? 3600);
  saveGoogleAccount({
    ...account,
    accessToken: json.access_token,
    accessTokenExpiresAt: expiresAt,
  });
  return { ok: true, access: json.access_token, expiresAt };
}

function isAccessTokenValid(account: GoogleAccount): boolean {
  if (!account.accessToken || !account.accessTokenExpiresAt) return false;
  // 残り 60 秒未満なら expired 扱い
  const expMs = new Date(account.accessTokenExpiresAt).getTime();
  if (Number.isNaN(expMs)) return false;
  return expMs - Date.now() > 60 * 1000;
}

async function getValidAccessToken(accountId?: string): Promise<
  { ok: true; access: string; accountId: string } | { ok: false; error: string }
> {
  const cfg = loadGoogleConfig();
  const account = getGoogleAccount(accountId);
  if (!account) return { ok: false, error: "Google アカウントが見つかりません" };
  if (isAccessTokenValid(account) && account.accessToken) {
    return { ok: true, access: account.accessToken, accountId: account.id };
  }
  const refreshed = await refreshAccessToken(cfg, account);
  if (!refreshed.ok) return refreshed;
  return { ok: true, access: refreshed.access, accountId: account.id };
}

export async function fetchUserEmail(accessToken: string): Promise<string> {
  const res = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return "";
  const json = (await res.json()) as UserInfoResponse;
  return json.email ?? "";
}

/**
 * Google API のエラーレスポンス本文を、ユーザーに見せられる短い日本語に整形する。
 *
 * 特に `SERVICE_DISABLED` (Calendar API が未有効化) は頻発する初期設定ミスなので、
 * 有効化リンクを抽出して案内文に含める。
 */
export async function describeGoogleApiError(
  res: Response,
  label: string,
): Promise<string> {
  const text = await res.text();
  try {
    const json = JSON.parse(text) as {
      error?: {
        code?: number;
        message?: string;
        status?: string;
        details?: Array<{
          reason?: string;
          metadata?: {
            activationUrl?: string;
            serviceTitle?: string;
          };
        }>;
      };
    };
    const err = json.error;
    if (err) {
      const disabled = err.details?.find((d) => d?.reason === "SERVICE_DISABLED");
      if (disabled) {
        const title = disabled.metadata?.serviceTitle ?? "Google Calendar API";
        const url = disabled.metadata?.activationUrl ?? "";
        return `${title} がプロジェクトで有効化されていません。下記URLから有効化してください（反映に1〜2分かかることがあります）: ${url}`;
      }
      if (err.message) {
        return `${label} (${err.code ?? res.status}): ${err.message}`;
      }
    }
  } catch {
    // JSON でないレスポンスはそのまま返す
  }
  return `${label} (${res.status}): ${text}`;
}

// --- Calendar API ---

export async function listCalendars(accountId?: string): Promise<
  { ok: true; calendars: GoogleCalendarChoice[] } | { ok: false; error: string }
> {
  const tk = await getValidAccessToken(accountId);
  if (!tk.ok) return tk;
  const calendars: GoogleCalendarChoice[] = [];
  let pageToken: string | undefined = undefined;
  do {
    const url = new URL(CALENDAR_LIST_ENDPOINT);
    url.searchParams.set("maxResults", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${tk.access}` },
    });
    if (!res.ok) {
      return {
        ok: false,
        error: await describeGoogleApiError(res, "calendarList failed"),
      };
    }
    const json = (await res.json()) as CalendarListResponse;
    for (const item of json.items ?? []) {
      // accessRole が freeBusyReader の calendar は予約状況だけで title が取れないので除外
      if (item.accessRole === "freeBusyReader") continue;
      calendars.push({
        id: item.id,
        displayName: item.summaryOverride || item.summary || item.id,
        description: item.description ?? "",
        color: item.backgroundColor ?? "",
        primary: Boolean(item.primary),
        accountId: tk.accountId,
      });
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  return { ok: true, calendars };
}

interface FetchEventsArgs {
  calendarId: string;
  accountId?: string;
  rangeStartMs: number;
  rangeEndMs: number;
}

export interface GoogleScheduleParts {
  externalUid: string;
  title: string;
  description: string;
  location: string;
  /** ローカル ISO "YYYY-MM-DDTHH:mm:ss" */
  start: string;
  end: string;
  allDay: boolean;
  /** singleEvents=true 時は空。recurringEventId が入った occurrence は親 event ID。 */
  rrule: string;
  recurrenceId: string;
  googleEventId: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toLocalIsoFromMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function toLocalIsoFromGoogleDateTime(g: GoogleEventDateTime): {
  iso: string;
  allDay: boolean;
} {
  if (g.date) {
    // 終日イベント: date は "YYYY-MM-DD"
    return { iso: `${g.date}T00:00:00`, allDay: true };
  }
  if (g.dateTime) {
    return { iso: toLocalIsoFromMs(new Date(g.dateTime).getTime()), allDay: false };
  }
  return { iso: "", allDay: false };
}

export async function fetchEvents(
  args: FetchEventsArgs,
): Promise<{ ok: true; events: GoogleScheduleParts[] } | { ok: false; error: string }> {
  const tk = await getValidAccessToken(args.accountId);
  if (!tk.ok) return tk;
  const events: GoogleScheduleParts[] = [];
  let pageToken: string | undefined = undefined;
  const timeMin = new Date(args.rangeStartMs).toISOString();
  const timeMax = new Date(args.rangeEndMs).toISOString();
  do {
    const url = new URL(
      `${CALENDARS_ENDPOINT}/${encodeURIComponent(args.calendarId)}/events`,
    );
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("maxResults", "2500");
    url.searchParams.set("orderBy", "startTime");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${tk.access}` },
    });
    if (!res.ok) {
      return {
        ok: false,
        error: await describeGoogleApiError(res, "events.list failed"),
      };
    }
    const json = (await res.json()) as EventsListResponse;
    for (const ev of json.items ?? []) {
      if (ev.status === "cancelled") continue;
      if (!ev.start || !ev.end) continue;
      const startInfo = toLocalIsoFromGoogleDateTime(ev.start);
      const endInfo = toLocalIsoFromGoogleDateTime(ev.end);
      if (!startInfo.iso || !endInfo.iso) continue;
      events.push({
        externalUid: ev.iCalUID || ev.id || "",
        title: ev.summary ?? "",
        description: ev.description ?? "",
        location: ev.location ?? "",
        start: startInfo.iso,
        end: endInfo.iso,
        allDay: startInfo.allDay,
        // singleEvents=true で既に展開済みなので rrule は持たないが、
        // recurringEventId が入っていれば「これは繰り返しの一回」と判別できる。
        rrule: ev.recurringEventId ? "RECURRING_OCCURRENCE" : "",
        recurrenceId: ev.recurringEventId ?? "",
        googleEventId: ev.id ?? "",
      });
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  return { ok: true, events };
}

// --- 書き戻し: manual schedule を Google に push ---

interface PushArgs {
  calendarId: string;
  accountId?: string;
  schedule: Schedule;
  /** 既存 event_id があれば PATCH、なければ POST */
  existingEventId?: string;
  tzid: string;
}

interface PushResult {
  ok: true;
  eventId: string;
  uid: string;
}

interface PushFailure {
  ok: false;
  error: string;
}

function buildEventBody(schedule: Schedule, tzid: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary: schedule.title || "(no title)",
  };
  if (schedule.description) body.description = schedule.description;
  if (schedule.location) body.location = schedule.location;
  if (schedule.allDay) {
    // 終日イベント。Google は end.date が排他的な「翌日」を期待する。
    body.start = { date: schedule.start.slice(0, 10) };
    const endDate = schedule.end ? schedule.end.slice(0, 10) : schedule.start.slice(0, 10);
    body.end = { date: endDate };
  } else {
    body.start = { dateTime: localIsoToRfc3339(schedule.start, tzid), timeZone: tzid };
    body.end = { dateTime: localIsoToRfc3339(schedule.end, tzid), timeZone: tzid };
  }
  return body;
}

/**
 * "YYYY-MM-DDTHH:mm:ss" (TZ なし) を、tzid 上のローカル時刻として解釈し、
 * Google API 用の RFC 3339 文字列 (タイムゾーンオフセット付き) に変換する。
 *
 * 単純化: tzid を直接渡せば Google 側が解釈するので、ここでは "{iso}:00" のみ整形する。
 * timeZone フィールドと合わせて送るので、末尾のオフセットは省略可能。
 */
function localIsoToRfc3339(localIso: string, _tzid: string): string {
  // "YYYY-MM-DDTHH:mm:ss" ならそのまま、長さが足りなければ補完
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(localIso)) return localIso;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localIso)) return `${localIso}:00`;
  return localIso;
}

export async function pushManualEvent(
  args: PushArgs,
): Promise<PushResult | PushFailure> {
  const tk = await getValidAccessToken(args.accountId);
  if (!tk.ok) return tk;
  const body = buildEventBody(args.schedule, args.tzid);
  const isUpdate = Boolean(args.existingEventId);
  const url = isUpdate
    ? `${CALENDARS_ENDPOINT}/${encodeURIComponent(args.calendarId)}/events/${encodeURIComponent(args.existingEventId!)}`
    : `${CALENDARS_ENDPOINT}/${encodeURIComponent(args.calendarId)}/events`;
  const res = await fetch(url, {
    method: isUpdate ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${tk.access}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return {
      ok: false,
      error: await describeGoogleApiError(
        res,
        `${isUpdate ? "events.patch" : "events.insert"} failed`,
      ),
    };
  }
  const json = (await res.json()) as GoogleEvent;
  return {
    ok: true,
    eventId: json.id ?? "",
    uid: json.iCalUID ?? json.id ?? "",
  };
}

export async function deleteManualEvent(args: {
  calendarId: string;
  accountId?: string;
  eventId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const tk = await getValidAccessToken(args.accountId);
  if (!tk.ok) return tk;
  const url = `${CALENDARS_ENDPOINT}/${encodeURIComponent(args.calendarId)}/events/${encodeURIComponent(args.eventId)}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${tk.access}` },
  });
  // 404 は「既に消えてる」ので成功扱いにする（caldav と同方針）
  if (res.ok || res.status === 404 || res.status === 410) return { ok: true };
  return {
    ok: false,
    error: await describeGoogleApiError(res, "events.delete failed"),
  };
}

/** 接続成立時、refresh_token と access_token を保存する。 */
export function persistConnectedTokens(args: {
  clientId: string;
  clientSecret: string;
  token: TokenResponse;
  email: string;
}): void {
  const cfg = loadGoogleConfig();
  const accountId = args.email.trim().toLowerCase() || "google-account";
  const existing = cfg.accounts?.find((a) => a.id === accountId);
  saveGoogleAccount({
    id: accountId,
    accountEmail: args.email,
    refreshToken:
      args.token.refresh_token || existing?.refreshToken || "",
    accessToken: args.token.access_token,
    accessTokenExpiresAt: expiresAtFromNow(args.token.expires_in ?? 3600),
    connectedAt: nowLocalIso(),
    writeTargetCalendarId: existing?.writeTargetCalendarId ?? "",
    writeTargetCalendarName: existing?.writeTargetCalendarName ?? "",
    writeTargetCalendarColor: existing?.writeTargetCalendarColor ?? "",
  });
  saveGoogleConfig({
    ...loadGoogleConfig(),
    clientId: args.clientId,
    clientSecret: args.clientSecret,
    activeAccountId: accountId,
  });
}
