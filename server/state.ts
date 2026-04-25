import type { ServerWebSocket } from "bun";
import type {
  CalendarSubscription,
  Goal,
  KanbanTask,
  Retrospective,
  Schedule,
  UserProfile,
} from "./types.ts";

export interface WSData {
  id: string;
  session: SessionState;
}

export type AppWebSocket = ServerWebSocket<WSData>;

export interface SessionState {
  client: unknown | null;
  kanbanTasks: KanbanTask[];
  goals: Goal[];
  profile: UserProfile;
  schedules: Schedule[];
  subscriptions: CalendarSubscription[];
  pendingRetros: Map<string, Retrospective>;
  needsReload: boolean;
  cancelRequested: boolean;
}

export function createSessionState(): SessionState {
  return {
    client: null,
    kanbanTasks: [],
    goals: [],
    profile: {
      currentState: "",
      balanceWheel: [],
      actionPrinciples: [],
      wantToDo: [],
      timezone: "",
    },
    schedules: [],
    subscriptions: [],
    pendingRetros: new Map(),
    needsReload: false,
    cancelRequested: false,
  };
}

export interface PendingApproval {
  resolve: (value: { answers?: Record<string, unknown> }) => void;
  reject: (err: unknown) => void;
}

export const activeSockets = new Set<AppWebSocket>();
export const pendingApprovals = new Map<string, PendingApproval>();

export interface GitHubState {
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  pendingSync: boolean;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  diffCache: Map<string, unknown>;
  syncChain: Promise<void>;
}

export const githubState: GitHubState = {
  syncing: false,
  lastSyncAt: null,
  lastError: null,
  pendingSync: false,
  debounceTimer: null,
  diffCache: new Map(),
  syncChain: Promise.resolve(),
};

export const wsNeedsReload: WeakSet<AppWebSocket> = new WeakSet();
