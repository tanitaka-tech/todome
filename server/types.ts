export type ColumnId = "todo" | "in_progress" | "done";
export type KPIUnit = "number" | "percent" | "time";

export interface KPI {
  id: string;
  name: string;
  unit: KPIUnit;
  targetValue: number;
  currentValue: number;
}

export interface Goal {
  id: string;
  name: string;
  memo: string;
  kpis: KPI[];
  deadline: string;
  achieved: boolean;
  achievedAt: string;
  icon?: string;
  repository?: string;
}

export interface TimeLog {
  start: string;
  end: string;
  duration: number;
}

export interface KanbanTask {
  id: string;
  title: string;
  description: string;
  column: ColumnId;
  memo: string;
  goalId: string;
  kpiId: string;
  kpiContributed: boolean;
  estimatedMinutes: number;
  timeSpent: number;
  timerStartedAt: string;
  completedAt: string;
  timeLogs: TimeLog[];
}

export interface BalanceWheelItem {
  id: string;
  text: string;
}

export interface BalanceWheelCategory {
  id: string;
  name: string;
  score?: number;
  icon?: string;
}

export interface UserProfile {
  currentState: string;
  balanceWheel: BalanceWheelCategory[];
  actionPrinciples: BalanceWheelItem[];
  wantToDo: BalanceWheelItem[];
  /** IANA タイムゾーン (例: "Asia/Tokyo")。"" ならサーバー解決の TZ にフォールバック。 */
  timezone: string;
}

export type LifeCategory = "rest" | "play" | "routine" | "other";
export type LifeLimitScope = "per_session" | "per_day";

export interface LifeActivity {
  id: string;
  name: string;
  icon: string;
  category: LifeCategory;
  softLimitMinutes: number;
  hardLimitMinutes: number;
  limitScope: LifeLimitScope;
  archived: boolean;
}

export interface LifeLog {
  id: string;
  activityId: string;
  startedAt: string;
  endedAt: string;
  memo: string;
  alertTriggered: "" | "soft" | "hard";
}

export interface Quota {
  id: string;
  name: string;
  icon: string;
  targetMinutes: number;
  archived: boolean;
  createdAt: string;
}

export interface QuotaLog {
  id: string;
  quotaId: string;
  startedAt: string;
  endedAt: string;
  memo: string;
}

export interface QuotaStreak {
  quotaId: string;
  current: number;
  best: number;
  lastAchievedDate: string;
}

export type RetroType = "daily" | "weekly" | "monthly" | "yearly";

export interface RetroDocument {
  did: string;
  learned: string;
  next: string;
  dayRating: number;
  wakeUpTime: string;
  bedtime: string;
}

export interface RetroMessage {
  role: "user" | "assistant";
  text: string;
}

export interface Retrospective {
  id: string;
  type: RetroType;
  periodStart: string;
  periodEnd: string;
  document: RetroDocument;
  messages: RetroMessage[];
  aiComment: string;
  completedAt: string;
  createdAt: string;
  updatedAt: string;
}

export type AIModel =
  | "claude-opus-4-7"
  | "claude-opus-4-7-1m"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5";

export type ThinkingEffort = "low" | "medium" | "high" | "veryHigh" | "max";

export interface AIToolConfig {
  allowedTools: string[];
  allowGhApi: boolean;
  model: AIModel;
  thinkingEffort: ThinkingEffort;
}

export type ScheduleSource = "manual" | "subscription";

export interface Schedule {
  id: string;
  source: ScheduleSource;
  subscriptionId: string;
  externalUid: string;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  rrule: string;
  recurrenceId: string;
  createdAt: string;
  updatedAt: string;
  /** manual schedule を iCloud に push した場合の DAV オブジェクト URL。空なら未 push。 */
  caldavObjectUrl: string;
  /** push した時の ETag。次回 PUT/DELETE の If-Match に使う（任意）。 */
  caldavEtag: string;
  /** Google Calendar に push した場合の event ID。空なら未 push。 */
  googleEventId: string;
  /** Google Calendar に push / fetch したアカウント ID。空なら旧データ。 */
  googleAccountId: string;
}

export type SubscriptionStatus = "idle" | "fetching" | "ok" | "error";

/**
 * "ics" = 公開 iCal URL を GET で取得。
 * "caldav" = iCloud などの CalDAV サーバから取得。
 * "google" = Google Calendar API v3 から取得。
 */
export type SubscriptionProvider = "ics" | "caldav" | "google";

export interface CalendarSubscription {
  id: string;
  name: string;
  url: string;
  color: string;
  enabled: boolean;
  lastFetchedAt: string;
  lastError: string;
  status: SubscriptionStatus;
  eventCount: number;
  createdAt: string;
  updatedAt: string;
  provider: SubscriptionProvider;
  /** provider="caldav" のときの iCloud カレンダー識別子 (例: ctag や displayName)。表示用。 */
  caldavCalendarId: string;
  /** provider="google" のときの Google Calendar API calendarId (push 先解決にも使う)。 */
  googleCalendarId: string;
  /** provider="google" のときの接続済み Google アカウント ID。 */
  googleAccountId: string;
}

export interface CalDAVConfig {
  appleId?: string;
  appPassword?: string;
  connectedAt?: string;
  /** manual イベントを書き込む先のカレンダー URL。"" なら書き込み無効。 */
  writeTargetCalendarUrl?: string;
  writeTargetCalendarName?: string;
  /** 書き込み先カレンダーの色 (#RRGGBB)。 */
  writeTargetCalendarColor?: string;
}

export interface CalDAVStatus {
  connected: boolean;
  appleId: string;
  connectedAt: string;
  lastError: string;
  writeTargetCalendarUrl: string;
  writeTargetCalendarName: string;
  writeTargetCalendarColor: string;
}

export interface CalDAVCalendarChoice {
  url: string;
  displayName: string;
  description: string;
  color: string;
  /** ctag があれば返す（差分検知用、現状は表示しない）。 */
  ctag: string;
}

export interface GoogleConfig {
  /** Google Cloud Console で発行した OAuth クライアントの client_id。 */
  clientId?: string;
  /** 同 client_secret。 */
  clientSecret?: string;
  /** リフレッシュトークン。これがあれば「接続済み」とみなす。 */
  refreshToken?: string;
  /** 直近取得した access_token。期限切れなら refresh する。 */
  accessToken?: string;
  /** access_token の有効期限 (ローカル ISO)。 */
  accessTokenExpiresAt?: string;
  /** 接続中アカウントの email (表示用)。 */
  accountEmail?: string;
  /** 接続日時 (ローカル ISO)。 */
  connectedAt?: string;
  /** manual イベントを書き込む先の Google calendarId。"" なら書き込み無効。 */
  writeTargetCalendarId?: string;
  writeTargetCalendarName?: string;
  /** 書き込み先カレンダーの色 (#RRGGBB)。 */
  writeTargetCalendarColor?: string;
  /** 複数 Google アカウント接続用。未設定の旧データは load 時に 1 件へ正規化する。 */
  accounts?: GoogleAccount[];
  activeAccountId?: string;
}

export interface GoogleAccount {
  id: string;
  /** 接続中アカウントの email (表示用)。 */
  accountEmail: string;
  /** リフレッシュトークン。これがあれば「接続済み」とみなす。 */
  refreshToken?: string;
  /** 直近取得した access_token。期限切れなら refresh する。 */
  accessToken?: string;
  /** access_token の有効期限 (ローカル ISO)。 */
  accessTokenExpiresAt?: string;
  /** 接続日時 (ローカル ISO)。 */
  connectedAt?: string;
  /** manual イベントを書き込む先の Google calendarId。"" なら書き込み無効。 */
  writeTargetCalendarId?: string;
  writeTargetCalendarName?: string;
  /** 書き込み先カレンダーの色 (#RRGGBB)。 */
  writeTargetCalendarColor?: string;
}

export interface GoogleAccountStatus {
  id: string;
  accountEmail: string;
  connectedAt: string;
  writeTargetCalendarId: string;
  writeTargetCalendarName: string;
  writeTargetCalendarColor: string;
}

export interface GoogleStatus {
  connected: boolean;
  /** client_id / client_secret が保存済みかどうか (接続前の判定用)。 */
  hasCredentials: boolean;
  accountEmail: string;
  connectedAt: string;
  lastError: string;
  writeTargetCalendarId: string;
  writeTargetCalendarName: string;
  writeTargetCalendarColor: string;
  activeAccountId: string;
  accounts: GoogleAccountStatus[];
  /** Google Cloud Console に登録するリダイレクト URI (UI でユーザーに見せて一致チェックさせる)。 */
  redirectUri: string;
}

export interface GoogleCalendarChoice {
  /** Google Calendar API の calendarId (例: "primary" や "xxx@group.calendar.google.com")。 */
  id: string;
  displayName: string;
  description: string;
  color: string;
  /** Google からの primary フラグ。 */
  primary: boolean;
  /** このカレンダーを取得した接続済み Google アカウント ID。 */
  accountId: string;
}

export interface GitHubConfig {
  linked?: boolean;
  owner?: string;
  repo?: string;
  autoSync?: boolean;
  lastSyncAt?: string | null;
}

export interface GitHubStatus {
  authUser: string | null;
  authOk: boolean;
  authError: string | null;
  linked: boolean;
  owner?: string | null;
  repo?: string | null;
  autoSync: boolean;
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  pendingSync: boolean;
}
