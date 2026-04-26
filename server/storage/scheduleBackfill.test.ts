import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), "todome-schedule-backfill-test-"));
process.env.TODOME_DATA_DIR = TEST_DATA_DIR;

import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDb, resetDbCache } from "../db.ts";
import { saveTasks } from "./kanban.ts";
import { saveLifeActivities } from "./life.ts";
import { saveQuotas } from "./quota.ts";
import { loadGoals, saveGoals } from "./goals.ts";
import {
  loadManualSchedules,
  loadSchedules,
  normalizeSchedule,
  upsertManualSchedule,
} from "./schedule.ts";
import { backfillSchedulesFromTimerLogs } from "./scheduleBackfill.ts";
import type {
  KanbanTask,
  LifeActivity,
  Quota,
} from "../types.ts";

beforeEach(() => {
  resetDbCache();
  const db = getDb();
  db.exec("DELETE FROM schedules");
  db.exec("DELETE FROM kanban_tasks");
  db.exec("DELETE FROM life_activities");
  db.exec("DELETE FROM life_logs");
  db.exec("DELETE FROM quotas");
  db.exec("DELETE FROM quota_logs");
  db.exec("DELETE FROM goals");
});

afterEach(() => {
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

function insertLifeLog(
  id: string,
  activityId: string,
  startedAt: string,
  endedAt: string,
): void {
  getDb()
    .prepare(
      "INSERT INTO life_logs (id, activity_id, started_at, ended_at) VALUES (?, ?, ?, ?)",
    )
    .run(id, activityId, startedAt, endedAt);
}

function insertQuotaLog(
  id: string,
  quotaId: string,
  startedAt: string,
  endedAt: string,
): void {
  getDb()
    .prepare(
      "INSERT INTO quota_logs (id, quota_id, started_at, ended_at) VALUES (?, ?, ?, ?)",
    )
    .run(id, quotaId, startedAt, endedAt);
}

describe("backfillSchedulesFromTimerLogs", () => {
  it("タスクの timeLogs を Schedule に展開する (origin.id = taskId#start)", () => {
    saveTasks([
      makeTask({
        id: "t1",
        title: "原稿",
        timeLogs: [
          { start: "2026-04-25T08:00:00", end: "2026-04-25T08:30:00", duration: 1800 },
          { start: "2026-04-25T09:00:00", end: "2026-04-25T09:45:00", duration: 2700 },
        ],
      }),
    ]);

    const result = backfillSchedulesFromTimerLogs();
    expect(result.added).toBe(2);

    const schedules = loadManualSchedules().sort((a, b) => a.start.localeCompare(b.start));
    expect(schedules).toHaveLength(2);
    expect(schedules[0]).toMatchObject({
      title: "原稿",
      start: "2026-04-25T08:00:00",
      end: "2026-04-25T08:30:00",
      origin: { type: "task", id: "t1#2026-04-25T08:00:00" },
    });
    expect(schedules[1]).toMatchObject({
      origin: { type: "task", id: "t1#2026-04-25T09:00:00" },
    });
  });

  it("LifeLog (endedAt あり) を Schedule に展開する", () => {
    saveLifeActivities([makeActivity({ id: "a1", name: "食事" })]);
    insertLifeLog("l1", "a1", "2026-04-25T12:00:00", "2026-04-25T12:30:00");

    const result = backfillSchedulesFromTimerLogs();
    expect(result.added).toBe(1);
    expect(loadManualSchedules()[0]).toMatchObject({
      title: "食事",
      origin: { type: "lifelog", id: "l1" },
    });
  });

  it("QuotaLog (endedAt あり) を Schedule に展開する", () => {
    saveQuotas([makeQuota({ id: "q1", name: "掃除" })]);
    insertQuotaLog("ql1", "q1", "2026-04-25T15:00:00", "2026-04-25T15:20:00");

    const result = backfillSchedulesFromTimerLogs();
    expect(result.added).toBe(1);
    expect(loadManualSchedules()[0]).toMatchObject({
      title: "掃除",
      origin: { type: "quota", id: "ql1" },
    });
  });

  it("endedAt 空（計測中）の LifeLog/QuotaLog はスキップする", () => {
    saveLifeActivities([makeActivity({ id: "a1", name: "食事" })]);
    saveQuotas([makeQuota({ id: "q1", name: "掃除" })]);
    insertLifeLog("l1", "a1", "2026-04-25T12:00:00", "");
    insertQuotaLog("ql1", "q1", "2026-04-25T15:00:00", "");

    const result = backfillSchedulesFromTimerLogs();
    expect(result.added).toBe(0);
    expect(loadManualSchedules()).toHaveLength(0);
  });

  it("end <= start の TimeLog/LifeLog/QuotaLog はスキップする", () => {
    saveTasks([
      makeTask({
        id: "t1",
        title: "X",
        timeLogs: [
          { start: "2026-04-25T09:00:00", end: "2026-04-25T09:00:00", duration: 0 },
          { start: "2026-04-25T10:00:00", end: "2026-04-25T09:00:00", duration: 0 },
        ],
      }),
    ]);
    saveLifeActivities([makeActivity({ id: "a1", name: "X" })]);
    insertLifeLog("l1", "a1", "2026-04-25T12:00:00", "2026-04-25T11:00:00");

    const result = backfillSchedulesFromTimerLogs();
    expect(result.added).toBe(0);
  });

  it("idempotent: 二度呼んでも重複追加しない", () => {
    saveTasks([
      makeTask({
        id: "t1",
        title: "原稿",
        timeLogs: [{ start: "2026-04-25T09:00:00", end: "2026-04-25T09:30:00", duration: 1800 }],
      }),
    ]);
    saveLifeActivities([makeActivity({ id: "a1", name: "食事" })]);
    insertLifeLog("l1", "a1", "2026-04-25T12:00:00", "2026-04-25T12:30:00");

    const r1 = backfillSchedulesFromTimerLogs();
    expect(r1.added).toBe(2);
    const r2 = backfillSchedulesFromTimerLogs();
    expect(r2.added).toBe(0);
    expect(loadManualSchedules()).toHaveLength(2);
  });

  it("リアルタイム生成された Schedule (origin 同一) はバックフィル対象外", () => {
    // 既に origin: task#start を持つ Schedule が存在する状態
    upsertManualSchedule(
      normalizeSchedule({
        id: "preexist",
        source: "manual",
        title: "原稿",
        start: "2026-04-25T09:00:00",
        end: "2026-04-25T09:30:00",
        origin: { type: "task", id: "t1#2026-04-25T09:00:00" },
        createdAt: "2026-04-25T09:30:00",
        updatedAt: "2026-04-25T09:30:00",
      }),
    );
    saveTasks([
      makeTask({
        id: "t1",
        title: "原稿",
        timeLogs: [
          { start: "2026-04-25T09:00:00", end: "2026-04-25T09:30:00", duration: 1800 },
          { start: "2026-04-25T10:00:00", end: "2026-04-25T10:15:00", duration: 900 },
        ],
      }),
    ]);

    const result = backfillSchedulesFromTimerLogs();
    expect(result.added).toBe(1); // 10:00 の方だけ追加
    expect(loadManualSchedules()).toHaveLength(2);
  });

  it("LifeActivity が見つからない LifeLog は '活動' をタイトルにする", () => {
    insertLifeLog("l1", "missing", "2026-04-25T12:00:00", "2026-04-25T12:30:00");
    const result = backfillSchedulesFromTimerLogs();
    expect(result.added).toBe(1);
    expect(loadManualSchedules()[0]?.title).toBe("活動");
  });

  it("回帰: タスク / LifeActivity / Quota は変更されない", () => {
    saveTasks([
      makeTask({
        id: "t1",
        title: "原稿",
        timeLogs: [{ start: "2026-04-25T09:00:00", end: "2026-04-25T09:30:00", duration: 1800 }],
      }),
    ]);
    saveLifeActivities([makeActivity({ id: "a1", name: "食事" })]);
    saveQuotas([makeQuota({ id: "q1", name: "掃除" })]);
    insertLifeLog("l1", "a1", "2026-04-25T12:00:00", "2026-04-25T12:30:00");
    insertQuotaLog("ql1", "q1", "2026-04-25T15:00:00", "2026-04-25T15:30:00");

    const tasksJson = JSON.stringify(getDb().prepare("SELECT * FROM kanban_tasks").all());
    const lifeActJson = JSON.stringify(getDb().prepare("SELECT * FROM life_activities").all());
    const quotasJson = JSON.stringify(getDb().prepare("SELECT * FROM quotas").all());
    const lifeLogsJson = JSON.stringify(getDb().prepare("SELECT * FROM life_logs").all());
    const quotaLogsJson = JSON.stringify(getDb().prepare("SELECT * FROM quota_logs").all());

    backfillSchedulesFromTimerLogs();

    expect(JSON.stringify(getDb().prepare("SELECT * FROM kanban_tasks").all())).toBe(tasksJson);
    expect(JSON.stringify(getDb().prepare("SELECT * FROM life_activities").all())).toBe(lifeActJson);
    expect(JSON.stringify(getDb().prepare("SELECT * FROM quotas").all())).toBe(quotasJson);
    expect(JSON.stringify(getDb().prepare("SELECT * FROM life_logs").all())).toBe(lifeLogsJson);
    expect(JSON.stringify(getDb().prepare("SELECT * FROM quota_logs").all())).toBe(quotaLogsJson);
  });

  it("既存の subscription Schedule は影響を受けない", () => {
    // subscription source の既存 schedule を入れる（バックフィルは manual のみ追加するので影響なし）
    getDb()
      .prepare(
        "INSERT INTO schedules (id, sort_order, source, subscription_id, external_uid, start_at, end_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "sub1",
        0,
        "subscription",
        "sub-id",
        "ext-uid",
        "2026-04-25T10:00:00",
        "2026-04-25T11:00:00",
        JSON.stringify(
          normalizeSchedule({
            id: "sub1",
            source: "subscription",
            subscriptionId: "sub-id",
            externalUid: "ext-uid",
            title: "外部予定",
            start: "2026-04-25T10:00:00",
            end: "2026-04-25T11:00:00",
            createdAt: "2026-04-25T09:00:00",
            updatedAt: "2026-04-25T09:00:00",
          }),
        ),
      );
    saveTasks([
      makeTask({
        id: "t1",
        title: "原稿",
        timeLogs: [{ start: "2026-04-25T09:00:00", end: "2026-04-25T09:30:00", duration: 1800 }],
      }),
    ]);

    backfillSchedulesFromTimerLogs();
    const all = loadSchedules();
    expect(all).toHaveLength(2);
    expect(all.find((s) => s.id === "sub1")?.title).toBe("外部予定");
  });

  it("回帰: goals テーブルは変更されない", () => {
    saveGoals([
      {
        id: "g1",
        name: "目標A",
        memo: "",
        kpis: [],
        deadline: "",
        achieved: false,
        achievedAt: "",
      },
    ]);
    const before = JSON.stringify(loadGoals());
    backfillSchedulesFromTimerLogs();
    expect(JSON.stringify(loadGoals())).toBe(before);
  });
});
