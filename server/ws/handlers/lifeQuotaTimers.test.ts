import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDb, resetDbCache } from "../../db.ts";
import {
  activeSockets,
  createSessionState,
  type AppWebSocket,
  type SessionState,
} from "../../state.ts";
import { loadTasks, saveTasks } from "../../storage/kanban.ts";
import {
  loadAllLifeLogs,
  saveLifeActivities,
  startLifeLog,
} from "../../storage/life.ts";
import {
  loadAllQuotaLogs,
  saveQuotas,
  startQuotaLog,
} from "../../storage/quota.ts";
import type { KanbanTask, LifeActivity, Quota } from "../../types.ts";
import { lifeLogStart } from "./life.ts";
import { quotaLogStart } from "./quota.ts";

interface SentMessage {
  type: string;
  [k: string]: unknown;
}

function makeRequester(): {
  ws: AppWebSocket;
  session: SessionState;
  sent: SentMessage[];
} {
  const session = createSessionState();
  const sent: SentMessage[] = [];
  const ws = {
    data: { id: "requester", session },
    send(payload: string) {
      sent.push(JSON.parse(payload) as SentMessage);
    },
  } as unknown as AppWebSocket;
  return { ws, session, sent };
}

function makeTask(
  partial: Partial<KanbanTask> & Pick<KanbanTask, "id" | "title">,
): KanbanTask {
  return {
    description: "",
    column: "todo",
    memo: "",
    goalId: "",
    kpiId: "",
    kpiContributed: false,
    estimatedMinutes: 0,
    timeSpent: 0,
    timerStartedAt: "",
    completedAt: "",
    timeLogs: [],
    ...partial,
  };
}

function makeActivity(
  partial: Partial<LifeActivity> & Pick<LifeActivity, "id" | "name">,
): LifeActivity {
  return {
    icon: "⏱",
    category: "other",
    softLimitMinutes: 0,
    hardLimitMinutes: 0,
    limitScope: "per_session",
    archived: false,
    ...partial,
  };
}

function makeQuota(partial: Partial<Quota> & Pick<Quota, "id" | "name">): Quota {
  return {
    icon: "🎯",
    targetMinutes: 30,
    archived: false,
    createdAt: "2026-08-07T00:00:00",
    ...partial,
  };
}

beforeEach(() => {
  activeSockets.clear();
  resetDbCache();
  const db = getDb();
  db.exec("DELETE FROM kanban_tasks");
  db.exec("DELETE FROM life_activities");
  db.exec("DELETE FROM life_logs");
  db.exec("DELETE FROM quotas");
  db.exec("DELETE FROM quota_logs");
});

afterEach(() => {
  activeSockets.clear();
  resetDbCache();
});

describe("lifeLogStart handler", () => {
  it("存在しない activityId ではログを作らず、実行中タスクとノルマログも止めない", async () => {
    const ctx = makeRequester();
    const timerStartedAt = "2026-08-07T09:00:00";
    const task = makeTask({
      id: "task-1",
      title: "作業中",
      timerStartedAt,
    });
    ctx.session.kanbanTasks.push(task);
    saveTasks([task]);
    saveLifeActivities([makeActivity({ id: "activity-1", name: "食事" })]);
    saveQuotas([makeQuota({ id: "quota-1", name: "掃除" })]);
    const quotaLog = startQuotaLog("quota-1");

    await lifeLogStart(ctx.ws, ctx.session, { activityId: "missing" });

    expect(loadAllLifeLogs()).toHaveLength(0);
    expect(loadAllQuotaLogs()).toEqual([{ ...quotaLog, endedAt: "" }]);
    expect(ctx.session.kanbanTasks[0]!.timerStartedAt).toBe(timerStartedAt);
    expect(loadTasks()[0]!.timerStartedAt).toBe(timerStartedAt);
    expect(ctx.sent).toHaveLength(0);
  });

  it("アーカイブ済み activityId ではログを作らない", async () => {
    const ctx = makeRequester();
    saveLifeActivities([
      makeActivity({ id: "archived", name: "古い活動", archived: true }),
    ]);

    await lifeLogStart(ctx.ws, ctx.session, { activityId: "archived" });

    expect(loadAllLifeLogs()).toHaveLength(0);
  });
});

describe("quotaLogStart handler", () => {
  it("存在しない quotaId ではログを作らず、実行中タスクとLifeログも止めない", async () => {
    const ctx = makeRequester();
    const timerStartedAt = "2026-08-07T10:00:00";
    const task = makeTask({
      id: "task-1",
      title: "作業中",
      timerStartedAt,
    });
    ctx.session.kanbanTasks.push(task);
    saveTasks([task]);
    saveLifeActivities([makeActivity({ id: "activity-1", name: "食事" })]);
    saveQuotas([makeQuota({ id: "quota-1", name: "掃除" })]);
    const lifeLog = startLifeLog("activity-1");

    await quotaLogStart(ctx.ws, ctx.session, { quotaId: "missing" });

    expect(loadAllQuotaLogs()).toHaveLength(0);
    expect(loadAllLifeLogs()).toEqual([{ ...lifeLog, endedAt: "" }]);
    expect(ctx.session.kanbanTasks[0]!.timerStartedAt).toBe(timerStartedAt);
    expect(loadTasks()[0]!.timerStartedAt).toBe(timerStartedAt);
    expect(ctx.sent).toHaveLength(0);
  });

  it("アーカイブ済み quotaId ではログを作らない", async () => {
    const ctx = makeRequester();
    saveQuotas([makeQuota({ id: "archived", name: "古いノルマ", archived: true })]);

    await quotaLogStart(ctx.ws, ctx.session, { quotaId: "archived" });

    expect(loadAllQuotaLogs()).toHaveLength(0);
  });
});
