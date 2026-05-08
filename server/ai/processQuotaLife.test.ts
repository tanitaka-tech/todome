import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), "todome-process-quota-life-test-"));
process.env.TODOME_DATA_DIR = TEST_DATA_DIR;

import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDb, resetDbCache } from "../db.ts";
import { loadTasks, saveTasks } from "../storage/kanban.ts";
import { loadLifeActivities, saveLifeActivities } from "../storage/life.ts";
import { loadQuotas, saveQuotas } from "../storage/quota.ts";
import type { KanbanTask, LifeActivity, Quota } from "../types.ts";
import { processQuotaLifeActions } from "./processQuotaLife.ts";

function makeQuota(partial: Partial<Quota> & Pick<Quota, "id" | "name">): Quota {
  return {
    icon: "🎯",
    targetMinutes: 30,
    archived: false,
    createdAt: "2026-04-22T00:00:00",
    ...partial,
  };
}

function makeLifeActivity(
  partial: Partial<LifeActivity> & Pick<LifeActivity, "id" | "name">
): LifeActivity {
  return {
    icon: "⏱",
    category: "other",
    softLimitMinutes: 30,
    hardLimitMinutes: 60,
    limitScope: "per_session",
    archived: false,
    ...partial,
  };
}

function makeTask(partial: Partial<KanbanTask> & Pick<KanbanTask, "id" | "title">): KanbanTask {
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

const BASE_QUOTAS: Quota[] = [
  makeQuota({ id: "q1", name: "掃除", icon: "🧹", targetMinutes: 15 }),
  makeQuota({ id: "q2", name: "運動", icon: "🏃", targetMinutes: 30 }),
];

const BASE_LIFE_ACTIVITIES: LifeActivity[] = [
  makeLifeActivity({
    id: "a1",
    name: "SNS",
    icon: "📱",
    category: "play",
    softLimitMinutes: 20,
    hardLimitMinutes: 60,
    limitScope: "per_day",
  }),
  makeLifeActivity({
    id: "a2",
    name: "昼寝",
    icon: "😴",
    category: "rest",
    softLimitMinutes: 30,
    hardLimitMinutes: 60,
    limitScope: "per_session",
  }),
];

const BASE_TASKS: KanbanTask[] = [
  makeTask({ id: "t1", title: "既存タスクA", column: "todo" }),
  makeTask({ id: "t2", title: "既存タスクB", column: "in_progress", timeSpent: 120 }),
];

beforeEach(() => {
  resetDbCache();
  const db = getDb();
  db.exec("DELETE FROM quotas");
  db.exec("DELETE FROM quota_logs");
  db.exec("DELETE FROM life_activities");
  db.exec("DELETE FROM life_logs");
  db.exec("DELETE FROM kanban_tasks");
  saveQuotas(BASE_QUOTAS.map((q) => ({ ...q })));
  saveLifeActivities(BASE_LIFE_ACTIVITIES.map((a) => ({ ...a })));
  saveTasks(BASE_TASKS.map((t) => ({ ...t })));
});

afterEach(() => {
  resetDbCache();
});

afterAll(() => {
  rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

describe("processQuotaLifeActions — 異常入力での既存データ温存", () => {
  it("非配列入力では既存データが一切変更されない", () => {
    const result = processQuotaLifeActions("not-an-array" as unknown);

    expect(result.quotasChanged).toBe(false);
    expect(result.lifeActivitiesChanged).toBe(false);
    expect(loadQuotas()).toEqual(BASE_QUOTAS);
    expect(loadLifeActivities()).toEqual(BASE_LIFE_ACTIVITIES);
    expect(loadTasks()).toEqual(BASE_TASKS);
  });

  it("空配列入力では既存データが一切変更されない", () => {
    const result = processQuotaLifeActions([]);

    expect(result.quotasChanged).toBe(false);
    expect(result.lifeActivitiesChanged).toBe(false);
    expect(loadQuotas()).toEqual(BASE_QUOTAS);
    expect(loadLifeActivities()).toEqual(BASE_LIFE_ACTIVITIES);
  });

  it("QUOTA_UPDATE の JSON が壊れている場合、既存 quota は変更されない", () => {
    const result = processQuotaLifeActions([
      { content: "QUOTA_UPDATE:q1:{not-json}", status: "completed" },
    ]);

    expect(result.quotasChanged).toBe(false);
    expect(loadQuotas()).toEqual(BASE_QUOTAS);
    expect(loadLifeActivities()).toEqual(BASE_LIFE_ACTIVITIES);
    expect(loadTasks()).toEqual(BASE_TASKS);
  });

  it("QUOTA_UPDATE で存在しない id を指定された場合、既存データは変更されない", () => {
    const result = processQuotaLifeActions([
      { content: 'QUOTA_UPDATE:does-not-exist:{"name":"x"}', status: "completed" },
    ]);

    expect(result.quotasChanged).toBe(false);
    expect(loadQuotas()).toEqual(BASE_QUOTAS);
    expect(loadLifeActivities()).toEqual(BASE_LIFE_ACTIVITIES);
  });

  it("LIFE_UPDATE の JSON が壊れている場合、既存 life activity は変更されない", () => {
    const result = processQuotaLifeActions([
      { content: "LIFE_UPDATE:a1:{broken", status: "completed" },
    ]);

    expect(result.lifeActivitiesChanged).toBe(false);
    expect(loadLifeActivities()).toEqual(BASE_LIFE_ACTIVITIES);
    expect(loadQuotas()).toEqual(BASE_QUOTAS);
    expect(loadTasks()).toEqual(BASE_TASKS);
  });

  it("LIFE_UPDATE で不正な category / limitScope は無視され、他フィールドは反映される", () => {
    const result = processQuotaLifeActions([
      {
        content:
          'LIFE_UPDATE:a1:{"name":"X(SNS)","category":"invalid","limitScope":"never"}',
        status: "completed",
      },
    ]);

    expect(result.lifeActivitiesChanged).toBe(true);
    const updated = loadLifeActivities().find((a) => a.id === "a1")!;
    expect(updated.name).toBe("X(SNS)");
    expect(updated.category).toBe("play");
    expect(updated.limitScope).toBe("per_day");
    expect(loadQuotas()).toEqual(BASE_QUOTAS);
  });
});

describe("processQuotaLifeActions — QUOTA_UPDATE 正常系", () => {
  it("name / icon / targetMinutes を更新し、他の quota や life activity は不変", () => {
    const result = processQuotaLifeActions([
      {
        content: 'QUOTA_UPDATE:q1:{"name":"清掃","icon":"🧽","targetMinutes":20}',
        status: "completed",
      },
    ]);

    expect(result.quotasChanged).toBe(true);
    expect(result.lifeActivitiesChanged).toBe(false);
    const quotas = loadQuotas();
    expect(quotas.find((q) => q.id === "q1")).toEqual({
      ...BASE_QUOTAS[0]!,
      name: "清掃",
      icon: "🧽",
      targetMinutes: 20,
    });
    expect(quotas.find((q) => q.id === "q2")).toEqual(BASE_QUOTAS[1]!);
    expect(loadLifeActivities()).toEqual(BASE_LIFE_ACTIVITIES);
    expect(loadTasks()).toEqual(BASE_TASKS);
  });

  it("負の targetMinutes は 0 に丸められる", () => {
    processQuotaLifeActions([
      { content: 'QUOTA_UPDATE:q1:{"targetMinutes":-5}', status: "completed" },
    ]);

    const updated = loadQuotas().find((q) => q.id === "q1")!;
    expect(updated.targetMinutes).toBe(0);
  });

  it("空白のみの name は無視される (regression: 空更新で名前が消えない)", () => {
    processQuotaLifeActions([
      { content: 'QUOTA_UPDATE:q1:{"name":"   "}', status: "completed" },
    ]);

    const updated = loadQuotas().find((q) => q.id === "q1")!;
    expect(updated.name).toBe("掃除");
  });
});

describe("processQuotaLifeActions — QUOTA_LOG_START / STOP", () => {
  it("START で新規ログが返り、STOP でアクティブログが終了する", () => {
    const startResult = processQuotaLifeActions([
      { content: "QUOTA_LOG_START:q1", status: "completed" },
    ]);

    expect(startResult.quotaLogStarted).not.toBeNull();
    expect(startResult.quotaLogStarted?.quotaId).toBe("q1");
    expect(startResult.todayQuotaLogs).not.toBeNull();
    expect(loadQuotas()).toEqual(BASE_QUOTAS);
    expect(loadLifeActivities()).toEqual(BASE_LIFE_ACTIVITIES);

    const stopResult = processQuotaLifeActions([
      { content: "QUOTA_LOG_STOP", status: "completed" },
    ]);

    expect(stopResult.quotaLogStopped).toBe(true);
    expect(stopResult.todayQuotaLogs).not.toBeNull();
  });

  it("アクティブな log が無い状態の STOP では quotaLogStopped=false を返す", () => {
    const result = processQuotaLifeActions([
      { content: "QUOTA_LOG_STOP", status: "completed" },
    ]);

    expect(result.quotaLogStopped).toBe(false);
  });

  it("START のみでは streaks も再計算される", () => {
    const result = processQuotaLifeActions([
      { content: "QUOTA_LOG_START:q1", status: "completed" },
    ]);

    expect(result.streaks).not.toBeNull();
    expect(Array.isArray(result.streaks)).toBe(true);
  });
});

describe("processQuotaLifeActions — LIFE_UPDATE 正常系", () => {
  it("name / icon / softLimitMinutes / hardLimitMinutes / category / limitScope を更新", () => {
    const result = processQuotaLifeActions([
      {
        content:
          'LIFE_UPDATE:a1:{"name":"X","icon":"🐦","softLimitMinutes":10,"hardLimitMinutes":30,"category":"routine","limitScope":"per_session"}',
        status: "completed",
      },
    ]);

    expect(result.lifeActivitiesChanged).toBe(true);
    const updated = loadLifeActivities().find((a) => a.id === "a1")!;
    expect(updated).toEqual({
      ...BASE_LIFE_ACTIVITIES[0]!,
      name: "X",
      icon: "🐦",
      softLimitMinutes: 10,
      hardLimitMinutes: 30,
      category: "routine",
      limitScope: "per_session",
    });
    expect(loadLifeActivities().find((a) => a.id === "a2")).toEqual(BASE_LIFE_ACTIVITIES[1]!);
    expect(loadQuotas()).toEqual(BASE_QUOTAS);
  });
});

describe("processQuotaLifeActions — LIFE_LOG_START / STOP", () => {
  it("START で新規ログが返り、STOP でアクティブログが終了する", () => {
    const startResult = processQuotaLifeActions([
      { content: "LIFE_LOG_START:a1", status: "completed" },
    ]);

    expect(startResult.lifeLogStarted).not.toBeNull();
    expect(startResult.lifeLogStarted?.activityId).toBe("a1");
    expect(startResult.todayLifeLogs).not.toBeNull();
    expect(loadQuotas()).toEqual(BASE_QUOTAS);

    const stopResult = processQuotaLifeActions([
      { content: "LIFE_LOG_STOP", status: "completed" },
    ]);

    expect(stopResult.lifeLogStopped).toBe(true);
    expect(stopResult.todayLifeLogs).not.toBeNull();
  });
});

describe("processQuotaLifeActions — 複合操作のデータ分離", () => {
  it("QUOTA_UPDATE と LIFE_UPDATE を同時に処理しても、kanban tasks には影響しない", () => {
    processQuotaLifeActions([
      { content: 'QUOTA_UPDATE:q1:{"targetMinutes":45}', status: "completed" },
      { content: 'LIFE_UPDATE:a1:{"softLimitMinutes":5}', status: "completed" },
    ]);

    expect(loadQuotas().find((q) => q.id === "q1")?.targetMinutes).toBe(45);
    expect(loadLifeActivities().find((a) => a.id === "a1")?.softLimitMinutes).toBe(5);
    expect(loadTasks()).toEqual(BASE_TASKS);
  });

  it("認識できない content (空文字や TodoWrite 関係ない指示) は無視される", () => {
    const result = processQuotaLifeActions([
      { content: "", status: "pending" },
      { content: "GOAL_ADD:{}", status: "completed" },
      { content: "TASK_UPDATE:t1:{}", status: "completed" },
    ]);

    expect(result.quotasChanged).toBe(false);
    expect(result.lifeActivitiesChanged).toBe(false);
    expect(loadQuotas()).toEqual(BASE_QUOTAS);
    expect(loadLifeActivities()).toEqual(BASE_LIFE_ACTIVITIES);
    expect(loadTasks()).toEqual(BASE_TASKS);
  });
});
