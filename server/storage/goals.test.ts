// config.ts は読み込み時点で DATA_DIR を固定するため、server コードを import する前に
// テスト用ディレクトリを環境変数で指すようにする。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), "todome-goals-test-"));
process.env.TODOME_DATA_DIR = TEST_DATA_DIR;

import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDb, resetDbCache } from "../db.ts";
import { githubState } from "../state.ts";
import { loadGoals, saveGoals } from "./goals.ts";
import { loadTasks, saveTasks } from "./kanban.ts";
import { DEFAULT_PROFILE, loadProfile, saveProfile } from "./profile.ts";
import type { Goal, KPI, KanbanTask } from "../types.ts";

function makeKpi(partial: Partial<KPI> & Pick<KPI, "id" | "name">): KPI {
  return { unit: "number", targetValue: 10, currentValue: 0, ...partial };
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

beforeEach(() => {
  resetDbCache();
  const db = getDb();
  db.exec("DELETE FROM goals");
  db.exec("DELETE FROM kanban_tasks");
  db.exec("DELETE FROM profile");
  db.exec("DELETE FROM quotas");
  db.exec("DELETE FROM quota_logs");
  db.exec("DELETE FROM life_activities");
  db.exec("DELETE FROM life_logs");
  db.exec("DELETE FROM retrospectives");
  saveProfile({ ...DEFAULT_PROFILE });
  githubState.diffCache.clear();
});

afterEach(() => {
  resetDbCache();
});

afterAll(() => {
  rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// saveGoals / loadGoals — 永続化ラウンドトリップ
// ─────────────────────────────────────────────────────────────────────────────

describe("saveGoals / loadGoals — 永続化ラウンドトリップ", () => {
  it("空の DB は空配列を返す", () => {
    expect(loadGoals()).toEqual([]);
  });

  it("保存した目標を正確に復元できる", () => {
    const goals: Goal[] = [
      makeGoal({ id: "g1", name: "目標A", memo: "詳細", deadline: "2026-12-31" }),
      makeGoal({ id: "g2", name: "目標B", achieved: true, achievedAt: "2026-04-01T10:00:00" }),
    ];
    saveGoals(goals);
    const loaded = loadGoals();
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toEqual(goals[0]);
    expect(loaded[1]).toEqual(goals[1]);
  });

  it("KPI 付きの目標が round-trip できる", () => {
    const goal = makeGoal({
      id: "g1",
      name: "売上目標",
      kpis: [
        makeKpi({ id: "k1", name: "受注数", unit: "number", targetValue: 50, currentValue: 12 }),
        makeKpi({ id: "k2", name: "達成率", unit: "percent", targetValue: 100, currentValue: 30 }),
      ],
    });
    saveGoals([goal]);
    const loaded = loadGoals();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.kpis).toEqual(goal.kpis);
  });

  it("オプショナルな icon / repository フィールドが保持される", () => {
    const goal = makeGoal({
      id: "g1",
      name: "OSS貢献",
      icon: "🚀",
      repository: "owner/repo",
    });
    saveGoals([goal]);
    const loaded = loadGoals();
    expect(loaded[0]!.icon).toBe("🚀");
    expect(loaded[0]!.repository).toBe("owner/repo");
  });

  it("保存した順序 (sort_order) で返る", () => {
    const a = makeGoal({ id: "a", name: "後から入れる" });
    const b = makeGoal({ id: "b", name: "先に入れる" });
    saveGoals([a, b]);
    const loaded = loadGoals();
    expect(loaded[0]!.id).toBe("a");
    expect(loaded[1]!.id).toBe("b");
  });

  it("順序を入れ替えて保存すると反映される", () => {
    const g1 = makeGoal({ id: "g1", name: "1" });
    const g2 = makeGoal({ id: "g2", name: "2" });
    saveGoals([g1, g2]);
    saveGoals([g2, g1]);
    const loaded = loadGoals();
    expect(loaded[0]!.id).toBe("g2");
    expect(loaded[1]!.id).toBe("g1");
  });

  it("全件上書き保存で既存目標が消える", () => {
    saveGoals([makeGoal({ id: "old", name: "旧" })]);
    saveGoals([makeGoal({ id: "new", name: "新" })]);
    const loaded = loadGoals();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe("new");
  });

  it("空配列を保存すると全目標が削除される", () => {
    saveGoals([makeGoal({ id: "g1", name: "消える" })]);
    saveGoals([]);
    expect(loadGoals()).toEqual([]);
  });

  it("達成済み目標が保存・復元される (regression: 達成済みフィルター関連)", () => {
    const goals = [
      makeGoal({ id: "g1", name: "未達成" }),
      makeGoal({ id: "g2", name: "達成済み", achieved: true, achievedAt: "2026-04-20T09:00:00" }),
    ];
    saveGoals(goals);
    const loaded = loadGoals();
    const achieved = loaded.find((g) => g.id === "g2");
    expect(achieved).toBeDefined();
    expect(achieved!.achieved).toBe(true);
    expect(achieved!.achievedAt).toBe("2026-04-20T09:00:00");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// immutability — 入力配列を変更しない
// ─────────────────────────────────────────────────────────────────────────────

describe("saveGoals — immutability", () => {
  it("saveGoals が入力配列・要素を変更しない", () => {
    const original: Goal[] = [
      makeGoal({ id: "g1", name: "A", kpis: [makeKpi({ id: "k1", name: "KPI" })] }),
      makeGoal({ id: "g2", name: "B" }),
    ];
    const snapshot = JSON.stringify(original);
    saveGoals(original);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cross-data: goals 保存が他テーブルに影響しない
// ─────────────────────────────────────────────────────────────────────────────

describe("cross-data: saveGoals が tasks / profile を変更しない", () => {
  it("saveGoals の前後で tasks と profile が不変", () => {
    const task = makeTask({ id: "t1", title: "タスク", goalId: "g1" });
    const profile = { ...DEFAULT_PROFILE, currentState: "テスト中" };
    saveTasks([task]);
    saveProfile(profile);

    const beforeTasks = JSON.stringify(loadTasks());
    const beforeProfile = JSON.stringify(loadProfile());

    saveGoals([makeGoal({ id: "g1", name: "新目標" })]);

    expect(JSON.stringify(loadTasks())).toBe(beforeTasks);
    expect(JSON.stringify(loadProfile())).toBe(beforeProfile);
  });

  it("目標を全削除してもタスクは削除されない (goalId 依存は caller 責任)", () => {
    const task = makeTask({ id: "t1", title: "タスク", goalId: "g1" });
    saveGoals([makeGoal({ id: "g1", name: "元目標" })]);
    saveTasks([task]);

    saveGoals([]);

    const loadedTasks = loadTasks();
    expect(loadedTasks).toHaveLength(1);
    expect(loadedTasks[0]!.goalId).toBe("g1");
  });
});
