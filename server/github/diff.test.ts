import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { getDb, resetDbCache } from "../db.ts";
import { githubState } from "../state.ts";
import { saveGoals } from "../storage/goals.ts";
import { saveTasks } from "../storage/kanban.ts";
import { saveLifeActivities } from "../storage/life.ts";
import { DEFAULT_PROFILE, saveProfile } from "../storage/profile.ts";
import { saveQuotas } from "../storage/quota.ts";
import type {
  Goal,
  KanbanTask,
  LifeActivity,
  LifeLog,
  Quota,
  QuotaLog,
} from "../types.ts";
import { computeCommitDiff, type EntitySnapshot } from "./diff.ts";

const EMPTY_SNAPSHOT = (): EntitySnapshot => ({
  tasks: [],
  goals: [],
  retros: [],
  lifeActivities: [],
  lifeLogs: [],
  quotas: [],
  quotaLogs: [],
  profile: { ...DEFAULT_PROFILE },
});

function insertLifeLog(log: LifeLog): void {
  getDb()
    .prepare(
      "INSERT INTO life_logs (id, activity_id, started_at, ended_at, memo, alert_triggered) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(log.id, log.activityId, log.startedAt, log.endedAt, log.memo, log.alertTriggered);
}

function insertQuotaLog(log: QuotaLog): void {
  getDb()
    .prepare(
      "INSERT INTO quota_logs (id, quota_id, started_at, ended_at, memo) VALUES (?, ?, ?, ?, ?)",
    )
    .run(log.id, log.quotaId, log.startedAt, log.endedAt, log.memo);
}

beforeEach(() => {
  resetDbCache();
  const db = getDb();
  db.exec("DELETE FROM kanban_tasks");
  db.exec("DELETE FROM goals");
  db.exec("DELETE FROM retrospectives");
  db.exec("DELETE FROM profile");
  db.exec("DELETE FROM life_activities");
  db.exec("DELETE FROM life_logs");
  db.exec("DELETE FROM quotas");
  db.exec("DELETE FROM quota_logs");
  saveProfile({ ...DEFAULT_PROFILE });
  githubState.diffCache.clear();
});

afterAll(() => {
  resetDbCache();
});

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

function makeGoal(partial: Partial<Goal> & Pick<Goal, "id" | "name">): Goal {
  return {
    memo: "",
    kpis: [],
    deadline: "",
    achieved: false,
    achievedAt: "",
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
    createdAt: "2026-04-22T00:00:00",
    ...partial,
  };
}

describe("computeCommitDiff — 差分キャッシュが current DB の更新を反映する (regression)", () => {
  // 再現したいバグ: push 直後のコミットを hover すると「差分ゼロ」がキャッシュされ、
  // 以降 DB を編集しても UI 上は常に「現在と同じ内容です」と表示されていた。
  // 修正後は target スナップショットだけをキャッシュし、current は毎回ロードする。
  it("2回目の呼び出しでも current の最新状態で差分を再計算する", async () => {
    const HASH = "deadbeef000000000000000000000000deadbeef";

    const initialTask = makeTask({ id: "t-existing", title: "既存タスク" });
    saveTasks([initialTask]);

    const targetSnapshot: EntitySnapshot = {
      ...EMPTY_SNAPSHOT(),
      tasks: [initialTask],
    };
    githubState.diffCache.set(HASH, targetSnapshot);

    const first = await computeCommitDiff(HASH);
    expect(first.summary.tasks).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(first.summary.profileChanged).toBe(false);

    const newTask = makeTask({ id: "t-new", title: "新規タスク" });
    saveTasks([initialTask, newTask]);

    const second = await computeCommitDiff(HASH);
    expect(second.summary.tasks).toEqual({ added: 0, removed: 1, modified: 0 });
    expect(second.details.tasks.removed).toEqual([
      { id: "t-new", label: "新規タスク" },
    ]);
    expect(second.details.tasks.added).toEqual([]);
    expect(second.details.tasks.modified).toEqual([]);
    // 関係ない領域には影響が出ていないこと
    expect(second.summary.goals).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(second.summary.retros).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(second.summary.lifeActivities).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(second.summary.lifeLogs).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(second.summary.quotas).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(second.summary.quotaLogs).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(second.summary.profileChanged).toBe(false);
  });

  it("target スナップショットはキャッシュが再利用される (git show を再実行しない)", async () => {
    const HASH = "cafef00d000000000000000000000000cafef00d";

    saveTasks([]);
    const initialGoal = makeGoal({ id: "g1", name: "目標" });
    saveGoals([initialGoal]);

    const targetSnapshot: EntitySnapshot = {
      ...EMPTY_SNAPSHOT(),
      goals: [initialGoal],
    };
    githubState.diffCache.set(HASH, targetSnapshot);

    await computeCommitDiff(HASH);
    // 一度呼んだ後でも、キャッシュのエントリは上書きされず同じ参照のままであること。
    expect(githubState.diffCache.get(HASH)).toBe(targetSnapshot);

    saveGoals([{ ...initialGoal, name: "目標 (更新)" }]);

    const result = await computeCommitDiff(HASH);
    expect(result.summary.goals).toEqual({ added: 0, removed: 0, modified: 1 });
    expect(result.details.goals.modified).toEqual([
      { id: "g1", label: "目標" },
    ]);
    // キャッシュされた target 側は変更されていない (pure)
    const cached = githubState.diffCache.get(HASH) as EntitySnapshot;
    expect(cached.goals[0]?.name).toBe("目標");
  });
});

describe("computeCommitDiff — ノルマ・タイムボックスの計測時間が差分に乗る (regression)", () => {
  // 再現したいバグ: quota_logs / life_logs / quotas / life_activities が
  // 全く diff に含まれず、計測時間を編集/追加しても「現在と同じ内容です」と表示されていた。
  it("ノルマ計測ログの追加 (current 側) が quotaLogs として検出される", async () => {
    const HASH = "a1a1a1a1000000000000000000000000a1a1a1a1";

    const quota = makeQuota({ id: "q1", name: "掃除" });
    saveQuotas([quota]);

    const targetSnapshot: EntitySnapshot = {
      ...EMPTY_SNAPSHOT(),
      quotas: [quota],
    };
    githubState.diffCache.set(HASH, targetSnapshot);

    // 計測ログを current 側にだけ追加 (push 後に計測したシナリオ)
    insertQuotaLog({
      id: "ql1",
      quotaId: "q1",
      startedAt: "2026-04-22T10:15:00",
      endedAt: "2026-04-22T10:45:00",
      memo: "",
    });

    const result = await computeCommitDiff(HASH);
    expect(result.summary.quotaLogs).toEqual({ added: 0, removed: 1, modified: 0 });
    expect(result.details.quotaLogs.removed).toEqual([
      { id: "ql1", label: "掃除 2026-04-22 10:15" },
    ]);
    // 他のセクションは無変化のまま
    expect(result.summary.tasks).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(result.summary.goals).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(result.summary.quotas).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(result.summary.lifeLogs).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(result.summary.profileChanged).toBe(false);
  });

  it("タイムボックス計測ログの内容変更が lifeLogs.modified として検出される", async () => {
    const HASH = "b2b2b2b2000000000000000000000000b2b2b2b2";

    const activity = makeActivity({ id: "a1", name: "食事" });
    saveLifeActivities([activity]);

    const targetLog: LifeLog = {
      id: "ll1",
      activityId: "a1",
      startedAt: "2026-04-22T12:00:00",
      endedAt: "2026-04-22T12:20:00",
      memo: "",
      alertTriggered: "",
    };

    const targetSnapshot: EntitySnapshot = {
      ...EMPTY_SNAPSHOT(),
      lifeActivities: [activity],
      lifeLogs: [targetLog],
    };
    githubState.diffCache.set(HASH, targetSnapshot);

    // current 側は同じ log id だが時間が延長されている
    insertLifeLog({
      ...targetLog,
      endedAt: "2026-04-22T12:45:00",
    });

    const result = await computeCommitDiff(HASH);
    expect(result.summary.lifeLogs).toEqual({ added: 0, removed: 0, modified: 1 });
    expect(result.details.lifeLogs.modified).toEqual([
      { id: "ll1", label: "食事 2026-04-22 12:00" },
    ]);
    // アクティビティ定義と他セクションは無変化
    expect(result.summary.lifeActivities).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(result.summary.tasks).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(result.summary.quotas).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(result.summary.quotaLogs).toEqual({ added: 0, removed: 0, modified: 0 });
  });

  it("ノルマ定義の追加 (target 側のみ) が quotas.added として検出される", async () => {
    const HASH = "c3c3c3c3000000000000000000000000c3c3c3c3";

    // current はノルマなし
    saveQuotas([]);

    const removedQuota = makeQuota({ id: "q-old", name: "古いノルマ" });
    const targetSnapshot: EntitySnapshot = {
      ...EMPTY_SNAPSHOT(),
      quotas: [removedQuota],
    };
    githubState.diffCache.set(HASH, targetSnapshot);

    const result = await computeCommitDiff(HASH);
    // target にあって current にない → "復元したら追加される" 扱い (added)
    expect(result.summary.quotas).toEqual({ added: 1, removed: 0, modified: 0 });
    expect(result.details.quotas.added).toEqual([
      { id: "q-old", label: "古いノルマ" },
    ]);
    // 他は無変化
    expect(result.summary.tasks).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(result.summary.goals).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(result.summary.lifeActivities).toEqual({ added: 0, removed: 0, modified: 0 });
  });
});
