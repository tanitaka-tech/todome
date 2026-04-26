// config.ts は読み込み時点で DATA_DIR を固定するため、server コードを import する前に
// テスト用ディレクトリを環境変数で指すようにする。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), "todome-schedule-from-timer-test-"));
process.env.TODOME_DATA_DIR = TEST_DATA_DIR;

import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { clearGitHubConfig } from "../../config.ts";
import { getDb, resetDbCache } from "../../db.ts";
import { activeSockets, createSessionState } from "../../state.ts";
import { clearCalDAVConfig } from "../../storage/caldav.ts";
import { clearGoogleConfig } from "../../storage/google.ts";
import {
  loadLifeActivities,
  saveLifeActivities,
} from "../../storage/life.ts";
import { loadQuotas, saveQuotas } from "../../storage/quota.ts";
import { loadManualSchedules } from "../../storage/schedule.ts";
import type {
  KanbanTask,
  LifeActivity,
  LifeLog,
  Quota,
  QuotaLog,
} from "../../types.ts";

mock.module("../../caldav/client.ts", () => ({
  connectAndListCalendars: async () => ({ ok: true, calendars: [] }),
  deleteManualEvent: async () => ({ ok: true }),
  fetchEvents: async () => ({ ok: true, schedules: [] }),
  pushManualEvent: async () => ({
    ok: true,
    objectUrl: "mock-caldav-object",
    etag: "mock-etag",
    uid: "mock-uid",
  }),
}));

mock.module("../../google/client.ts", () => ({
  deleteManualEvent: async () => ({ ok: true }),
  exchangeCodeForToken: async () => ({ ok: true, tokens: {} }),
  fetchEvents: async () => ({ ok: true, schedules: [] }),
  fetchUserEmail: async () => ({ ok: true, email: "user@example.com" }),
  listCalendars: async () => ({ ok: true, calendars: [] }),
  persistConnectedTokens: async () => ({ ok: true }),
  pushManualEvent: async () => ({
    ok: true,
    eventId: "mock-google-event",
    uid: "mock-google-uid",
  }),
}));

const {
  createScheduleFromTimerLog,
  createScheduleFromLifeLogStop,
  createScheduleFromQuotaLogStop,
  createScheduleFromTaskTimerStop,
} = await import("./scheduleFromTimer.ts");

beforeEach(() => {
  activeSockets.clear();
  resetDbCache();
  clearGitHubConfig();
  clearCalDAVConfig();
  clearGoogleConfig();
  const db = getDb();
  db.exec("DELETE FROM schedules");
  db.exec("DELETE FROM calendar_subscriptions");
  db.exec("DELETE FROM life_activities");
  db.exec("DELETE FROM life_logs");
  db.exec("DELETE FROM quotas");
  db.exec("DELETE FROM quota_logs");
  db.exec("DELETE FROM kanban_tasks");
});

afterEach(() => {
  activeSockets.clear();
  resetDbCache();
});

afterAll(() => {
  resetDbCache();
  rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

function makeTask(p: Partial<KanbanTask> & Pick<KanbanTask, "id" | "title">): KanbanTask {
  return {
    description: "",
    column: "in_progress",
    memo: "",
    goalId: "",
    kpiId: "",
    kpiContributed: false,
    estimatedMinutes: 0,
    timeSpent: 0,
    timerStartedAt: "",
    completedAt: "",
    timeLogs: [],
    ...p,
  };
}

function makeActivity(p: Partial<LifeActivity> & Pick<LifeActivity, "id" | "name">): LifeActivity {
  return {
    icon: "🍚",
    category: "routine",
    softLimitMinutes: 0,
    hardLimitMinutes: 0,
    limitScope: "per_session",
    archived: false,
    ...p,
  };
}

function makeQuota(p: Partial<Quota> & Pick<Quota, "id" | "name">): Quota {
  return {
    icon: "🎯",
    targetMinutes: 30,
    archived: false,
    createdAt: "2026-04-25T00:00:00",
    ...p,
  };
}

describe("createScheduleFromTimerLog — 計測ログから Schedule 生成", () => {
  it("通常の time range で Schedule を作成し origin が記録される", async () => {
    const session = createSessionState();
    await createScheduleFromTimerLog(session, {
      origin: { type: "task", id: "t1" },
      title: "コーディング",
      startIso: "2026-04-25T09:00:00",
      endIso: "2026-04-25T09:30:00",
    });

    const saved = loadManualSchedules();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      title: "コーディング",
      start: "2026-04-25T09:00:00",
      end: "2026-04-25T09:30:00",
      source: "manual",
      origin: { type: "task", id: "t1" },
    });
  });

  it("15 秒未満の計測は Schedule 化しない（誤操作扱い）", async () => {
    const session = createSessionState();
    await createScheduleFromTimerLog(session, {
      origin: { type: "task", id: "t1" },
      title: "短い",
      startIso: "2026-04-25T09:00:00",
      endIso: "2026-04-25T09:00:05",
    });
    expect(loadManualSchedules()).toHaveLength(0);
  });

  it("ちょうど 15 秒の計測は Schedule 化する（境界）", async () => {
    const session = createSessionState();
    await createScheduleFromTimerLog(session, {
      origin: { type: "task", id: "t1" },
      title: "境界",
      startIso: "2026-04-25T09:00:00",
      endIso: "2026-04-25T09:00:15",
    });
    expect(loadManualSchedules()).toHaveLength(1);
  });

  it("end <= start の不正範囲では Schedule を作成しない", async () => {
    const session = createSessionState();
    await createScheduleFromTimerLog(session, {
      origin: { type: "task", id: "t1" },
      title: "X",
      startIso: "2026-04-25T10:00:00",
      endIso: "2026-04-25T09:00:00",
    });
    await createScheduleFromTimerLog(session, {
      origin: { type: "task", id: "t1" },
      title: "Y",
      startIso: "2026-04-25T09:00:00",
      endIso: "2026-04-25T09:00:00",
    });
    expect(loadManualSchedules()).toHaveLength(0);
  });

  it("startIso/endIso が空なら作成しない", async () => {
    const session = createSessionState();
    await createScheduleFromTimerLog(session, {
      origin: { type: "task", id: "t1" },
      title: "X",
      startIso: "",
      endIso: "2026-04-25T10:00:00",
    });
    await createScheduleFromTimerLog(session, {
      origin: { type: "task", id: "t1" },
      title: "Y",
      startIso: "2026-04-25T09:00:00",
      endIso: "",
    });
    expect(loadManualSchedules()).toHaveLength(0);
  });

  it("title 空のときはフォールバック '(無題)' で保存される", async () => {
    const session = createSessionState();
    await createScheduleFromTimerLog(session, {
      origin: { type: "task", id: "t1" },
      title: "",
      startIso: "2026-04-25T09:00:00",
      endIso: "2026-04-25T09:30:00",
    });
    expect(loadManualSchedules()[0]?.title).toBe("(無題)");
  });
});

describe("createScheduleFromTaskTimerStop — タスクタイマー停止由来", () => {
  it("task の最後の TimeLog から Schedule を生成し title=task.title (origin.id は taskId#start)", async () => {
    const session = createSessionState();
    const task = makeTask({
      id: "t1",
      title: "原稿執筆",
      timeLogs: [
        { start: "2026-04-25T08:00:00", end: "2026-04-25T08:30:00", duration: 1800 },
        { start: "2026-04-25T09:00:00", end: "2026-04-25T09:45:00", duration: 2700 },
      ],
    });
    await createScheduleFromTaskTimerStop(session, task);
    const saved = loadManualSchedules();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      title: "原稿執筆",
      start: "2026-04-25T09:00:00",
      end: "2026-04-25T09:45:00",
      origin: { type: "task", id: "t1#2026-04-25T09:00:00" },
    });
  });

  it("timeLogs が空なら何もしない", async () => {
    const session = createSessionState();
    const task = makeTask({ id: "t1", title: "T" });
    await createScheduleFromTaskTimerStop(session, task);
    expect(loadManualSchedules()).toHaveLength(0);
  });
});

describe("createScheduleFromLifeLogStop — LifeLog 停止由来", () => {
  it("activity.name をタイトルにして Schedule を作成", async () => {
    saveLifeActivities([makeActivity({ id: "a1", name: "食事" })]);
    const session = createSessionState();
    const log: LifeLog = {
      id: "l1",
      activityId: "a1",
      startedAt: "2026-04-25T12:00:00",
      endedAt: "2026-04-25T12:30:00",
      memo: "",
      alertTriggered: "",
    };
    await createScheduleFromLifeLogStop(session, log);
    const saved = loadManualSchedules();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      title: "食事",
      origin: { type: "lifelog", id: "l1" },
    });
  });

  it("activity が見つからなくても '活動' で作成する", async () => {
    const session = createSessionState();
    const log: LifeLog = {
      id: "l1",
      activityId: "missing",
      startedAt: "2026-04-25T12:00:00",
      endedAt: "2026-04-25T12:30:00",
      memo: "",
      alertTriggered: "",
    };
    await createScheduleFromLifeLogStop(session, log);
    expect(loadManualSchedules()[0]?.title).toBe("活動");
  });

  it("endedAt が空なら何もしない", async () => {
    const session = createSessionState();
    const log: LifeLog = {
      id: "l1",
      activityId: "a1",
      startedAt: "2026-04-25T12:00:00",
      endedAt: "",
      memo: "",
      alertTriggered: "",
    };
    await createScheduleFromLifeLogStop(session, log);
    expect(loadManualSchedules()).toHaveLength(0);
  });
});

describe("createScheduleFromQuotaLogStop — QuotaLog 停止由来", () => {
  it("quota.name をタイトルにして Schedule を作成", async () => {
    saveQuotas([makeQuota({ id: "q1", name: "掃除" })]);
    const session = createSessionState();
    const log: QuotaLog = {
      id: "ql1",
      quotaId: "q1",
      startedAt: "2026-04-25T15:00:00",
      endedAt: "2026-04-25T15:20:00",
      memo: "",
    };
    await createScheduleFromQuotaLogStop(session, log);
    const saved = loadManualSchedules();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      title: "掃除",
      origin: { type: "quota", id: "ql1" },
    });
  });
});

describe("回帰: 関係ないデータが影響を受けない", () => {
  it("Schedule 生成は life_activities / quotas / kanban_tasks を変更しない", async () => {
    saveLifeActivities([makeActivity({ id: "a1", name: "食事" })]);
    saveQuotas([makeQuota({ id: "q1", name: "掃除" })]);
    const activitiesBefore = JSON.stringify(loadLifeActivities());
    const quotasBefore = JSON.stringify(loadQuotas());

    const session = createSessionState();
    await createScheduleFromTimerLog(session, {
      origin: { type: "task", id: "t1" },
      title: "X",
      startIso: "2026-04-25T09:00:00",
      endIso: "2026-04-25T09:30:00",
    });

    expect(JSON.stringify(loadLifeActivities())).toBe(activitiesBefore);
    expect(JSON.stringify(loadQuotas())).toBe(quotasBefore);
  });
});
