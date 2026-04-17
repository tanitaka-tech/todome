export type ColumnId = "todo" | "in_progress" | "done";

export interface KPI {
  id: string;
  name: string;
  value: string;
}

export interface Goal {
  id: string;
  name: string;
  memo: string;
  kpis: KPI[];
  deadline: string;
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
  ideals: BalanceWheelItem[];
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

export type MessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
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

export type WSMessage =
  | { type: "stream_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "assistant"; text: string; toolCalls: unknown[] }
  | { type: "tool_use"; name: string; input?: string }
  | { type: "ask_user"; requestId: string; questions: AskQuestion[] }
  | { type: "kanban_sync"; tasks: KanbanTask[] }
  | { type: "goal_sync"; goals: Goal[] }
  | { type: "profile_sync"; profile: UserProfile }
  | { type: "result"; result: string; cost: number; turns: number; sessionId: string };
