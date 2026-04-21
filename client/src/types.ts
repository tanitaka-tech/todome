export type ColumnId = "todo" | "in_progress" | "done";

export type KPIUnit = "number" | "percent" | "time";

export interface KPI {
  id: string;
  name: string;
  unit: KPIUnit;
  targetValue: number;
  currentValue: number;
}

export function kpiProgress(kpi: KPI): number {
  if (!kpi.targetValue) return 0;
  return Math.min(100, Math.max(0, (kpi.currentValue / kpi.targetValue) * 100));
}

export function isKpiAchieved(kpi: KPI): boolean {
  return kpi.targetValue > 0 && kpi.currentValue >= kpi.targetValue;
}

export function areAllKpisAchieved(kpis: KPI[]): boolean {
  return kpis.length > 0 && kpis.every(isKpiAchieved);
}

export interface Goal {
  id: string;
  name: string;
  memo: string;
  kpis: KPI[];
  deadline: string;
  achieved: boolean;
  achievedAt: string; // ISO datetime or ""
  icon?: string; // 絵文字アイコン
  repository?: string; // "owner/name" 形式、空はリポジトリ未紐付け
}

export interface TimeLog {
  start: string;  // ISO datetime
  end: string;    // ISO datetime
  duration: number; // seconds
}

export interface KanbanTask {
  id: string;
  title: string;
  description: string;
  column: ColumnId;
  memo: string;
  goalId: string;
  kpiId: string;           // 紐付け先 KPI (unit=time 限定, "" = 未紐付け)
  kpiContributed: boolean; // 完了時に KPI へ加算済みかどうか (二重加算防止)
  estimatedMinutes: number; // 見積もり時間 (分), 0 = 未設定
  timeSpent: number;       // total seconds
  timerStartedAt: string;  // ISO datetime or ""
  completedAt: string;     // ISO datetime or ""
  timeLogs: TimeLog[];
}

// --- Profile ---

export interface BalanceWheelItem {
  id: string;
  text: string;
}

export interface BalanceWheelCategory {
  id: string;
  name: string;
  score?: number; // 1-10, バランスホイール上の現在スコア
  icon?: string;  // 絵文字アイコン
}

export interface UserProfile {
  currentState: string;
  balanceWheel: BalanceWheelCategory[];
  actionPrinciples: BalanceWheelItem[];
  wantToDo: BalanceWheelItem[];
}

// --- Helpers ---

// 保存文字列は "YYYY-MM-DDTHH:mm:ss" 形式 (Z なし) のローカル時刻。
// 新しい時刻を書き込むときは必ずこれを使う。`new Date().toISOString()` は UTC+Z を返すので禁止。
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatLocalIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function nowLocalIso(): string {
  return formatLocalIso(new Date());
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h${m > 0 ? ` ${m}m` : ""}`;
  return `${m}m${s > 0 ? ` ${s}s` : ""}`;
}

export function formatKpiTimeValue(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h${m}m` : `${h}h`;
  return `${m}m`;
}

export function secondsToHM(seconds: number): { h: number; m: number } {
  const safe = Math.max(0, Math.round(seconds));
  return { h: Math.floor(safe / 3600), m: Math.floor((safe % 3600) / 60) };
}

export function hmToSeconds(h: number, m: number): number {
  const hh = Math.max(0, Math.floor(h) || 0);
  const mm = Math.max(0, Math.floor(m) || 0);
  return hh * 3600 + mm * 60;
}

export function getRunningSeconds(task: KanbanTask): number {
  if (!task.timerStartedAt) return 0;
  return Math.floor((Date.now() - new Date(task.timerStartedAt).getTime()) / 1000);
}

export function totalSeconds(task: KanbanTask): number {
  return task.timeSpent + getRunningSeconds(task);
}

export function isTaskCompletedInPeriod(
  task: KanbanTask,
  periodStart: string,
  periodEnd: string,
): boolean {
  if (task.column !== "done") return false;
  const ca = (task.completedAt || "").slice(0, 19);
  if (!ca) return false;
  return ca >= `${periodStart}T00:00:00` && ca <= `${periodEnd}T23:59:59`;
}

// --- Messages ---

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  toolName?: string;
  toolInput?: unknown;
}

export interface AskQuestion {
  question: string;
  header?: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
}

export interface AskUserRequest {
  requestId: string;
  questions: AskQuestion[];
}

// --- GitHub sync ---

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

export interface RepoInfo {
  name: string;
  owner: { login: string };
  nameWithOwner: string;
  isPrivate: boolean;
  updatedAt: string;
  url: string;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  date: string;
  author: string;
  message: string;
}

export interface DiffCounts {
  added: number;
  removed: number;
  modified: number;
}

export interface CommitDiffSummary {
  tasks: DiffCounts;
  goals: DiffCounts;
  retros: DiffCounts;
  profileChanged: boolean;
}

export interface LabeledId {
  id: string;
  label: string;
}

export interface DiffSection {
  added: LabeledId[];
  removed: LabeledId[];
  modified: LabeledId[];
}

export interface CommitDiffDetails {
  tasks: DiffSection;
  goals: DiffSection;
  retros: DiffSection;
  profileChanged: boolean;
}

export interface CommitDiffEntry {
  summary: CommitDiffSummary | null;
  details: CommitDiffDetails | null;
  error: string | null;
}

// --- AI tool config ---

export type AIModel =
  | "claude-opus-4-7"
  | "claude-opus-4-7-1m"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5";

export const AI_MODELS: readonly AIModel[] = [
  "claude-opus-4-7",
  "claude-opus-4-7-1m",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
];

export const AI_MODEL_LABELS: Record<AIModel, string> = {
  "claude-opus-4-7": "Opus 4.7",
  "claude-opus-4-7-1m": "Opus 4.7 1M",
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-haiku-4-5": "Haiku 4.5",
};

export type ThinkingEffort = "low" | "medium" | "high" | "veryHigh" | "max";

export const THINKING_EFFORTS: readonly ThinkingEffort[] = [
  "low",
  "medium",
  "high",
  "veryHigh",
  "max",
];

export interface AIToolConfig {
  allowedTools: string[];
  allowGhApi: boolean;
  model: AIModel;
  thinkingEffort: ThinkingEffort;
}

export interface AppConfig {
  dayBoundaryHour: number;
}

// --- Retrospective ---

export type RetroType = "daily" | "weekly" | "monthly" | "yearly";

export interface RetroDocument {
  did: string;
  learned: string;
  next: string;
  dayRating: number; // 1-10, 0 = 未評価 (主に daily で使用)
  wakeUpTime: string; // "HH:MM" (24h), "" = 未設定 (daily のみ)
  bedtime: string;    // "HH:MM" (24h), "" = 未設定 (daily のみ)
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
  completedAt: string; // "" = draft
  createdAt: string;
  updatedAt: string;
}

// --- Timebox ---

export type LifeCategory = "rest" | "play" | "routine" | "other";
export type LifeLimitScope = "per_session" | "per_day";

export interface LifeActivity {
  id: string;
  name: string;
  icon: string;
  category: LifeCategory;
  softLimitMinutes: number; // 0 = 無効
  hardLimitMinutes: number; // 0 = 無効
  limitScope: LifeLimitScope;
  archived: boolean;
}

export interface LifeLog {
  id: string;
  activityId: string;
  startedAt: string; // ISO datetime
  endedAt: string;   // ISO datetime or ""
  memo: string;
  alertTriggered: "" | "soft" | "hard";
}

export const LIFE_CATEGORIES: readonly LifeCategory[] = [
  "rest",
  "play",
  "routine",
  "other",
];

export const LIFE_CATEGORY_LABELS: Record<LifeCategory, string> = {
  rest: "休息",
  play: "遊び",
  routine: "ルーティン",
  other: "その他",
};

export const LIFE_CATEGORY_COLORS: Record<LifeCategory, string> = {
  rest: "#3b82f6",
  play: "#ec4899",
  routine: "#10b981",
  other: "#6b7280",
};

export const LIFE_LIMIT_SCOPE_LABELS: Record<LifeLimitScope, string> = {
  per_session: "1回ごと",
  per_day: "1日合計",
};

export function lifeLogDurationSeconds(log: LifeLog, nowMs: number = Date.now()): number {
  if (!log.startedAt) return 0;
  const start = new Date(log.startedAt).getTime();
  if (Number.isNaN(start)) return 0;
  const end = log.endedAt ? new Date(log.endedAt).getTime() : nowMs;
  return Math.max(0, Math.floor((end - start) / 1000));
}

export function isLifeLogActive(log: LifeLog): boolean {
  return !log.endedAt;
}

export function logSecondsInRange(
  startedAt: string,
  endedAt: string,
  rangeStartMs: number,
  rangeEndMs: number,
  nowMs: number,
): number {
  if (!startedAt) return 0;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return 0;
  const end = endedAt ? new Date(endedAt).getTime() : nowMs;
  const clippedStart = Math.max(start, rangeStartMs);
  const clippedEnd = Math.min(end, rangeEndMs);
  return Math.max(0, Math.floor((clippedEnd - clippedStart) / 1000));
}

export function lifeActivityTodayTotalSeconds(
  activityId: string,
  logs: LifeLog[],
  dayBoundaryHour: number = 0,
  nowMs: number = Date.now(),
): number {
  const range = getTodayDayRange(dayBoundaryHour, new Date(nowMs));
  return logs
    .filter((l) => l.activityId === activityId)
    .reduce(
      (sum, l) =>
        sum + logSecondsInRange(l.startedAt, l.endedAt, range.startMs, range.endMs, nowMs),
      0,
    );
}

export interface DayRange {
  startMs: number;
  endMs: number;
  /** ISO "YYYY-MM-DD" of the day this range belongs to (境界基準の開始日)。 */
  dateKey: string;
}

export function getDayRangeForDate(
  dateIso: string,
  boundaryHour: number,
): DayRange {
  // dateIso の 境界時刻 ~ 翌日の境界時刻 の区間。
  const [y, m, d] = dateIso.split("-").map((v) => parseInt(v, 10));
  const start = new Date(y, (m || 1) - 1, d || 1, boundaryHour, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startMs: start.getTime(), endMs: end.getTime(), dateKey: dateIso };
}

export function getTodayDayRange(
  boundaryHour: number,
  now: Date = new Date(),
): DayRange {
  const start = new Date(now);
  start.setHours(boundaryHour, 0, 0, 0);
  if (now.getTime() < start.getTime()) {
    start.setDate(start.getDate() - 1);
  }
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const dateKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  return { startMs: start.getTime(), endMs: end.getTime(), dateKey };
}

export function lifeLogAlertLevel(
  activity: LifeActivity,
  totalSeconds: number,
): "" | "soft" | "hard" {
  const hard = activity.hardLimitMinutes * 60;
  if (hard > 0 && totalSeconds >= hard) return "hard";
  const soft = activity.softLimitMinutes * 60;
  if (soft > 0 && totalSeconds >= soft) return "soft";
  return "";
}

// --- Quota (ノルマ) ---

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

export function quotaLogDurationSeconds(
  log: QuotaLog,
  nowMs: number = Date.now(),
): number {
  if (!log.startedAt) return 0;
  const start = new Date(log.startedAt).getTime();
  if (Number.isNaN(start)) return 0;
  const end = log.endedAt ? new Date(log.endedAt).getTime() : nowMs;
  return Math.max(0, Math.floor((end - start) / 1000));
}

export function isQuotaLogActive(log: QuotaLog): boolean {
  return !log.endedAt;
}

export function quotaTodayTotalSeconds(
  quotaId: string,
  logs: QuotaLog[],
  dayBoundaryHour: number = 0,
  nowMs: number = Date.now(),
): number {
  const range = getTodayDayRange(dayBoundaryHour, new Date(nowMs));
  return logs
    .filter((l) => l.quotaId === quotaId)
    .reduce(
      (sum, l) =>
        sum + logSecondsInRange(l.startedAt, l.endedAt, range.startMs, range.endMs, nowMs),
      0,
    );
}

export function quotaIsAchieved(quota: Quota, todaySeconds: number): boolean {
  if (quota.targetMinutes <= 0) return false;
  return todaySeconds >= quota.targetMinutes * 60;
}

export function streakRank(days: number): 0 | 1 | 2 | 3 | 4 {
  if (days >= 14) return 4;
  if (days >= 7) return 3;
  if (days >= 3) return 2;
  if (days >= 1) return 1;
  return 0;
}

export type WSMessage =
  | { type: "stream_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "assistant"; text: string; toolCalls: unknown[] }
  | { type: "tool_use"; name: string; input?: unknown }
  | { type: "session_cleared" }
  | { type: "ask_user"; requestId: string; questions: AskQuestion[] }
  | { type: "kanban_sync"; tasks: KanbanTask[] }
  | { type: "goal_sync"; goals: Goal[] }
  | { type: "profile_sync"; profile: UserProfile }
  | { type: "github_status"; status: GitHubStatus }
  | { type: "github_repo_list"; repos: RepoInfo[] }
  | { type: "github_commit_list"; commits: GitCommit[] }
  | {
      type: "github_commit_diff_result";
      hash: string;
      summary: CommitDiffSummary | null;
      details: CommitDiffDetails | null;
      error: string | null;
    }
  | { type: "ai_config_sync"; config: AIToolConfig }
  | { type: "app_config_sync"; config: AppConfig }
  | { type: "result"; result: string; cost: number; turns: number; sessionId: string }
  | { type: "retro_list_sync"; retros: Retrospective[] }
  | { type: "retro_sync"; retro: Retrospective }
  | { type: "retro_doc_update"; retroId: string; document: RetroDocument }
  | { type: "retro_stream_delta"; text: string }
  | { type: "retro_assistant"; text: string }
  | { type: "retro_thinking_delta"; text: string }
  | { type: "retro_completed"; retro: Retrospective }
  | { type: "retro_session_closed" }
  | { type: "retro_session_waiting"; waiting: boolean }
  | { type: "retro_error"; message: string }
  | { type: "life_activity_sync"; activities: LifeActivity[] }
  | { type: "life_log_sync"; logs: LifeLog[] }
  | { type: "life_log_started"; log: LifeLog }
  | { type: "life_log_stopped"; log: LifeLog }
  | { type: "life_log_range_sync"; requestId: string; logs: LifeLog[] }
  | { type: "quota_sync"; quotas: Quota[] }
  | { type: "quota_log_sync"; logs: QuotaLog[] }
  | { type: "quota_log_started"; log: QuotaLog }
  | { type: "quota_log_stopped"; log: QuotaLog }
  | { type: "quota_streak_sync"; streaks: QuotaStreak[] }
  | { type: "quota_log_range_sync"; requestId: string; logs: QuotaLog[] };
