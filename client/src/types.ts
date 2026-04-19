export type ColumnId = "todo" | "in_progress" | "done";

export type KPIUnit = "number" | "percent";

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
  priority: "low" | "medium" | "high";
  memo: string;
  goalId: string;
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

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h${m > 0 ? ` ${m}m` : ""}`;
  return `${m}m${s > 0 ? ` ${s}s` : ""}`;
}

export function getRunningSeconds(task: KanbanTask): number {
  if (!task.timerStartedAt) return 0;
  return Math.floor((Date.now() - new Date(task.timerStartedAt).getTime()) / 1000);
}

export function totalSeconds(task: KanbanTask): number {
  return task.timeSpent + getRunningSeconds(task);
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

// --- Retrospective ---

export type RetroType = "daily" | "weekly" | "monthly" | "yearly";

export interface RetroDocument {
  did: string;
  learned: string;
  next: string;
  dayRating: number; // 1-10, 0 = 未評価 (主に daily で使用)
  completedTasks: string[];
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
  | { type: "retro_error"; message: string };
