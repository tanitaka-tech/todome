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
  color: string;
  rrule: string;
  recurrenceId: string;
  createdAt: string;
  updatedAt: string;
}

export type SubscriptionStatus = "idle" | "fetching" | "ok" | "error";

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
