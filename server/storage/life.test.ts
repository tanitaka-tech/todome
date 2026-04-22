import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDb, resetDbCache } from "../db.ts";
import { githubState } from "../state.ts";
import { loadGoals, saveGoals } from "./goals.ts";
import { loadTasks, saveTasks } from "./kanban.ts";
import {
  LIFE_ACTIVITY_CATEGORIES,
  LIFE_LIMIT_SCOPES,
  loadLifeActivities,
  normalizeLifeActivity,
  saveLifeActivities,
  startLifeLog,
  stopActiveLifeLogIfAny,
  stopLifeLog,
} from "./life.ts";
import { DEFAULT_PROFILE, loadProfile, saveProfile } from "./profile.ts";
import { loadQuotas, saveQuotas } from "./quota.ts";
import type { Goal, KanbanTask, LifeActivity, Quota } from "../types.ts";

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

function makeGoal(partial: Partial<Goal> & Pick<Goal, "id" | "name">): Goal {
  return { memo: "", kpis: [], deadline: "", achieved: false, achievedAt: "", ...partial };
}

function makeTask(partial: Partial<KanbanTask> & Pick<KanbanTask, "id" | "title">): KanbanTask {
  return {
    description: "", column: "todo", memo: "", goalId: "", kpiId: "",
    kpiContributed: false, estimatedMinutes: 0, timeSpent: 0,
    timerStartedAt: "", completedAt: "", timeLogs: [], ...partial,
  };
}

function makeQuota(partial: Partial<Quota> & Pick<Quota, "id" | "name">): Quota {
  return { icon: "🎯", targetMinutes: 30, archived: false, createdAt: "2026-04-22T00:00:00", ...partial };
}

beforeEach(() => {
  resetDbCache();
  const db = getDb();
  db.exec("DELETE FROM life_activities");
  db.exec("DELETE FROM life_logs");
  db.exec("DELETE FROM goals");
  db.exec("DELETE FROM kanban_tasks");
  db.exec("DELETE FROM profile");
  db.exec("DELETE FROM quotas");
  db.exec("DELETE FROM quota_logs");
  db.exec("DELETE FROM retrospectives");
  saveProfile({ ...DEFAULT_PROFILE });
  githubState.diffCache.clear();
});

afterEach(() => {
  resetDbCache();
});


// ─────────────────────────────────────────────────────────────────────────────
// normalizeLifeActivity
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeLifeActivity — 入力値の正規化", () => {
  it("無効な category は 'other' になる", () => {
    const a = normalizeLifeActivity({ id: "a1", name: "テスト", icon: "⏱", category: "invalid" as never, softLimitMinutes: 0, hardLimitMinutes: 0, limitScope: "per_session", archived: false });
    expect(a.category).toBe("other");
  });

  it("有効な category は全て受け付ける", () => {
    for (const cat of LIFE_ACTIVITY_CATEGORIES) {
      const a = normalizeLifeActivity({ id: "a1", name: "テスト", icon: "⏱", category: cat, softLimitMinutes: 0, hardLimitMinutes: 0, limitScope: "per_session", archived: false });
      expect(a.category).toBe(cat);
    }
  });

  it("無効な limitScope は 'per_session' になる", () => {
    const a = normalizeLifeActivity({ id: "a1", name: "テスト", icon: "⏱", category: "other", softLimitMinutes: 0, hardLimitMinutes: 0, limitScope: "invalid" as never, archived: false });
    expect(a.limitScope).toBe("per_session");
  });

  it("有効な limitScope は全て受け付ける", () => {
    for (const scope of LIFE_LIMIT_SCOPES) {
      const a = normalizeLifeActivity({ id: "a1", name: "テスト", icon: "⏱", category: "other", softLimitMinutes: 0, hardLimitMinutes: 0, limitScope: scope, archived: false });
      expect(a.limitScope).toBe(scope);
    }
  });

  it("負の softLimitMinutes は 0 になる", () => {
    const a = normalizeLifeActivity({ id: "a1", name: "テスト", icon: "⏱", category: "other", softLimitMinutes: -10, hardLimitMinutes: 0, limitScope: "per_session", archived: false });
    expect(a.softLimitMinutes).toBe(0);
  });

  it("負の hardLimitMinutes は 0 になる", () => {
    const a = normalizeLifeActivity({ id: "a1", name: "テスト", icon: "⏱", category: "other", softLimitMinutes: 0, hardLimitMinutes: -20, limitScope: "per_session", archived: false });
    expect(a.hardLimitMinutes).toBe(0);
  });

  it("小数の分数は切り捨てられる", () => {
    const a = normalizeLifeActivity({ id: "a1", name: "テスト", icon: "⏱", category: "other", softLimitMinutes: 14.9, hardLimitMinutes: 29.7, limitScope: "per_session", archived: false });
    expect(a.softLimitMinutes).toBe(14);
    expect(a.hardLimitMinutes).toBe(29);
  });

  it("空の name は '未命名' になる", () => {
    const a = normalizeLifeActivity({ id: "a1", name: "", icon: "⏱", category: "other", softLimitMinutes: 0, hardLimitMinutes: 0, limitScope: "per_session", archived: false });
    expect(a.name).toBe("未命名");
  });

  it("空の icon は '⏱' になる", () => {
    const a = normalizeLifeActivity({ id: "a1", name: "テスト", icon: "", category: "other", softLimitMinutes: 0, hardLimitMinutes: 0, limitScope: "per_session", archived: false });
    expect(a.icon).toBe("⏱");
  });

  it("id が未設定の場合は新しい id が生成される", () => {
    const a = normalizeLifeActivity({ name: "テスト", icon: "⏱", category: "other", softLimitMinutes: 0, hardLimitMinutes: 0, limitScope: "per_session", archived: false });
    expect(a.id).toBeTruthy();
    expect(typeof a.id).toBe("string");
  });

  it("入力オブジェクトは変更されない (immutability)", () => {
    const raw = { id: "a1", name: "テスト", icon: "⏱", category: "invalid" as never, softLimitMinutes: -5, hardLimitMinutes: -10, limitScope: "per_session" as const, archived: false };
    const snapshot = JSON.stringify(raw);
    normalizeLifeActivity(raw);
    expect(JSON.stringify(raw)).toBe(snapshot);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// saveLifeActivities / loadLifeActivities
// ─────────────────────────────────────────────────────────────────────────────

describe("saveLifeActivities / loadLifeActivities — 永続化ラウンドトリップ", () => {
  it("保存したアクティビティを正確に復元できる", () => {
    const activities = [
      makeActivity({ id: "a1", name: "食事", icon: "🍚", category: "routine", softLimitMinutes: 45, hardLimitMinutes: 90, limitScope: "per_session" }),
      makeActivity({ id: "a2", name: "遊び", icon: "🎮", category: "play", softLimitMinutes: 60, hardLimitMinutes: 180, limitScope: "per_day" }),
    ];
    saveLifeActivities(activities);
    const loaded = loadLifeActivities();
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toEqual(activities[0]);
    expect(loaded[1]).toEqual(activities[1]);
  });

  it("保存した順序（sort_order）で返る", () => {
    const a = makeActivity({ id: "a", name: "後から" });
    const b = makeActivity({ id: "b", name: "先に" });
    saveLifeActivities([a, b]);
    const loaded = loadLifeActivities();
    expect(loaded[0]!.id).toBe("a");
    expect(loaded[1]!.id).toBe("b");
  });

  it("全件上書き保存が正しく反映される", () => {
    saveLifeActivities([makeActivity({ id: "a1", name: "旧" })]);
    saveLifeActivities([makeActivity({ id: "a2", name: "新" })]);
    const loaded = loadLifeActivities();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe("a2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// アップサート挙動
// ─────────────────────────────────────────────────────────────────────────────

describe("アクティビティのアップサート挙動", () => {
  it("既存 id のアクティビティを更新するとリストの長さが変わらない", () => {
    const original = makeActivity({ id: "a1", name: "旧名前", softLimitMinutes: 30 });
    saveLifeActivities([original]);

    const updated = { ...original, name: "新名前", softLimitMinutes: 45 };
    const activities = loadLifeActivities();
    const idx = activities.findIndex((a) => a.id === updated.id);
    if (idx >= 0) activities[idx] = updated;
    else activities.push(updated);
    saveLifeActivities(activities);

    const result = loadLifeActivities();
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("新名前");
    expect(result[0]!.softLimitMinutes).toBe(45);
  });

  it("1件更新しても他のアクティビティの内容が変わらない", () => {
    const a1 = makeActivity({ id: "a1", name: "食事", softLimitMinutes: 30 });
    const a2 = makeActivity({ id: "a2", name: "運動", softLimitMinutes: 60 });
    saveLifeActivities([a1, a2]);

    const activities = loadLifeActivities();
    const idx = activities.findIndex((a) => a.id === "a1")!;
    activities[idx] = { ...a1, name: "食事 更新" };
    saveLifeActivities(activities);

    const resultA2 = loadLifeActivities().find((a) => a.id === "a2");
    expect(resultA2).toEqual(a2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 計測ログ（regression: タイムボックス計測ログが Git 同期できなかった）
// ─────────────────────────────────────────────────────────────────────────────

describe("startLifeLog / stopLifeLog — 計測ログ操作", () => {
  it("startLifeLog でログが作成され ended_at が空になる", () => {
    saveLifeActivities([makeActivity({ id: "a1", name: "食事" })]);
    const log = startLifeLog("a1");
    expect(log.activityId).toBe("a1");
    expect(log.startedAt).toBeTruthy();
    expect(log.endedAt).toBe("");
  });

  it("stopLifeLog で ended_at が設定される", () => {
    saveLifeActivities([makeActivity({ id: "a1", name: "食事" })]);
    const started = startLifeLog("a1");
    const stopped = stopLifeLog(started.id);
    expect(stopped).not.toBeNull();
    expect(stopped!.endedAt).toBeTruthy();
    expect(stopped!.endedAt).not.toBe("");
  });

  it("stopLifeLog で memo が保存される", () => {
    saveLifeActivities([makeActivity({ id: "a1", name: "食事" })]);
    const started = startLifeLog("a1");
    const stopped = stopLifeLog(started.id, "夕食");
    expect(stopped!.memo).toBe("夕食");
  });

  it("startLifeLog は既存のアクティブログを全て自動停止する", () => {
    saveLifeActivities([
      makeActivity({ id: "a1", name: "食事" }),
      makeActivity({ id: "a2", name: "風呂" }),
    ]);
    const first = startLifeLog("a1");
    expect(first.endedAt).toBe("");

    startLifeLog("a2");

    // 自動停止済みなので ended_at が設定されている
    const afterAutoStop = stopLifeLog(first.id);
    expect(afterAutoStop).not.toBeNull();
    expect(afterAutoStop!.endedAt).not.toBe("");
  });
});

describe("stopActiveLifeLogIfAny — アクティブログの停止", () => {
  it("アクティブなログがない場合は空文字を返す", () => {
    const result = stopActiveLifeLogIfAny();
    expect(result).toBe("");
  });

  it("アクティブなログがある場合はそのIDを返して停止する", () => {
    saveLifeActivities([makeActivity({ id: "a1", name: "食事" })]);
    const log = startLifeLog("a1");

    const stoppedId = stopActiveLifeLogIfAny();
    expect(stoppedId).toBe(log.id);

    expect(stopActiveLifeLogIfAny()).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cross-data: アクティビティ保存が他テーブルに影響しない
// ─────────────────────────────────────────────────────────────────────────────

describe("cross-data: saveLifeActivities が goals / kanban_tasks / quotas / profile を変更しない", () => {
  it("saveLifeActivities の前後で他テーブルが不変", () => {
    const goal = makeGoal({ id: "g1", name: "目標" });
    const task = makeTask({ id: "t1", title: "タスク" });
    const quota = makeQuota({ id: "q1", name: "ノルマ" });
    const profile = { ...DEFAULT_PROFILE, currentState: "テスト中" };
    saveGoals([goal]);
    saveTasks([task]);
    saveQuotas([quota]);
    saveProfile(profile);

    const beforeGoals = JSON.stringify(loadGoals());
    const beforeTasks = JSON.stringify(loadTasks());
    const beforeQuotas = JSON.stringify(loadQuotas());
    const beforeProfile = JSON.stringify(loadProfile());

    saveLifeActivities([makeActivity({ id: "a1", name: "食事" })]);

    expect(JSON.stringify(loadGoals())).toBe(beforeGoals);
    expect(JSON.stringify(loadTasks())).toBe(beforeTasks);
    expect(JSON.stringify(loadQuotas())).toBe(beforeQuotas);
    expect(JSON.stringify(loadProfile())).toBe(beforeProfile);
  });
});
