// config.ts は読み込み時点で DATA_DIR を固定するため、server コードを import する前に
// テスト用ディレクトリを環境変数で指すようにする。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), "todome-kanban-test-"));
process.env.TODOME_DATA_DIR = TEST_DATA_DIR;

import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDb, resetDbCache } from "../db.ts";
import { githubState } from "../state.ts";
import { loadGoals, saveGoals } from "./goals.ts";
import { loadTasks, saveTasks } from "./kanban.ts";
import { DEFAULT_PROFILE, loadProfile, saveProfile } from "./profile.ts";
import type { Goal, KanbanTask } from "../types.ts";

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
  return { memo: "", kpis: [], deadline: "", achieved: false, achievedAt: "", ...partial };
}

beforeEach(() => {
  resetDbCache();
  const db = getDb();
  db.exec("DELETE FROM kanban_tasks");
  db.exec("DELETE FROM goals");
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
// saveTasks / loadTasks
// ─────────────────────────────────────────────────────────────────────────────

describe("saveTasks / loadTasks — 永続化ラウンドトリップ", () => {
  it("空の DB は空配列を返す (デフォルト値なし)", () => {
    const loaded = loadTasks();
    expect(loaded).toEqual([]);
  });

  it("保存したタスクを正確に復元できる", () => {
    const tasks = [
      makeTask({ id: "t1", title: "タスクA", column: "todo", description: "説明A" }),
      makeTask({ id: "t2", title: "タスクB", column: "inprogress" }),
    ];
    saveTasks(tasks);
    const loaded = loadTasks();
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toEqual(tasks[0]);
    expect(loaded[1]).toEqual(tasks[1]);
  });

  it("保存した順序（sort_order）で返る", () => {
    const a = makeTask({ id: "a", title: "後から" });
    const b = makeTask({ id: "b", title: "先に" });
    saveTasks([a, b]);
    const loaded = loadTasks();
    expect(loaded[0]!.id).toBe("a");
    expect(loaded[1]!.id).toBe("b");
  });

  it("全件上書き保存が正しく反映される", () => {
    saveTasks([makeTask({ id: "t1", title: "旧" })]);
    saveTasks([makeTask({ id: "t2", title: "新" })]);
    const loaded = loadTasks();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe("t2");
  });

  it("done 列のタスクが保存・復元される (regression: AI操作で完了タスクが消えていた)", () => {
    const doneTask = makeTask({ id: "done1", title: "完了タスク", column: "done", completedAt: "2026-04-22T10:00:00" });
    const todoTask = makeTask({ id: "todo1", title: "未完了タスク", column: "todo" });
    saveTasks([doneTask, todoTask]);
    const loaded = loadTasks();
    expect(loaded).toHaveLength(2);
    const loadedDone = loaded.find((t) => t.id === "done1");
    expect(loadedDone).toBeDefined();
    expect(loadedDone!.column).toBe("done");
    expect(loadedDone!.completedAt).toBe("2026-04-22T10:00:00");
  });

  it("複数の done タスクが全て保持される", () => {
    const tasks = [
      makeTask({ id: "d1", title: "done1", column: "done" }),
      makeTask({ id: "d2", title: "done2", column: "done" }),
      makeTask({ id: "d3", title: "done3", column: "done" }),
      makeTask({ id: "t1", title: "todo1", column: "todo" }),
    ];
    saveTasks(tasks);
    const loaded = loadTasks();
    expect(loaded).toHaveLength(4);
    expect(loaded.filter((t) => t.column === "done")).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// kpiId / kpiContributed のデフォルト処理
// ─────────────────────────────────────────────────────────────────────────────

describe("loadTasks — kpiId / kpiContributed のデフォルト処理", () => {
  it("kpiId がない JSON から読み込むと空文字になる", () => {
    // kpiId を持たない古いレコードを直接 DB に INSERT して移行動作を確認
    const db = getDb();
    db.prepare(
      "INSERT INTO kanban_tasks (id, sort_order, data) VALUES (?, ?, ?)"
    ).run("legacy1", 0, JSON.stringify({ id: "legacy1", title: "旧タスク", column: "todo", description: "" }));

    const loaded = loadTasks();
    const task = loaded.find((t) => t.id === "legacy1");
    expect(task).toBeDefined();
    expect(task!.kpiId).toBe("");
  });

  it("kpiContributed が文字列 'true' でも Boolean に正規化される", () => {
    const db = getDb();
    db.prepare(
      "INSERT INTO kanban_tasks (id, sort_order, data) VALUES (?, ?, ?)"
    ).run("legacy2", 0, JSON.stringify({ id: "legacy2", title: "旧タスク", column: "todo", kpiContributed: "true" }));

    const loaded = loadTasks();
    const task = loaded.find((t) => t.id === "legacy2");
    expect(task).toBeDefined();
    expect(typeof task!.kpiContributed).toBe("boolean");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// タスクの更新挙動
// ─────────────────────────────────────────────────────────────────────────────

describe("タスクのアップサート挙動", () => {
  it("既存 id のタスクを更新するとリストの長さが変わらない", () => {
    const original = makeTask({ id: "t1", title: "元タイトル", description: "元説明" });
    saveTasks([original]);

    const tasks = loadTasks();
    const idx = tasks.findIndex((t) => t.id === "t1")!;
    tasks[idx] = { ...original, title: "新タイトル", description: "新説明" };
    saveTasks(tasks);

    const result = loadTasks();
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("新タイトル");
    expect(result[0]!.description).toBe("新説明");
  });

  it("1件更新しても他のタスクの内容が変わらない", () => {
    const t1 = makeTask({ id: "t1", title: "タスク1" });
    const t2 = makeTask({ id: "t2", title: "タスク2", column: "done" });
    saveTasks([t1, t2]);

    const tasks = loadTasks();
    const idx = tasks.findIndex((t) => t.id === "t1")!;
    tasks[idx] = { ...t1, title: "タスク1 更新" };
    saveTasks(tasks);

    const resultT2 = loadTasks().find((t) => t.id === "t2");
    expect(resultT2).toEqual(t2);
  });

  it("todo から done へ移動した後も全タスクが保持される", () => {
    const tasks = [
      makeTask({ id: "t1", title: "タスク1", column: "todo" }),
      makeTask({ id: "t2", title: "タスク2", column: "inprogress" }),
    ];
    saveTasks(tasks);

    // t1 を done に移動
    const updated = loadTasks();
    const idx = updated.findIndex((t) => t.id === "t1")!;
    updated[idx] = { ...updated[idx]!, column: "done", completedAt: "2026-04-22T12:00:00" };
    saveTasks(updated);

    const result = loadTasks();
    expect(result).toHaveLength(2);
    expect(result.find((t) => t.id === "t1")!.column).toBe("done");
    expect(result.find((t) => t.id === "t2")!.column).toBe("inprogress");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cross-data: タスク保存が他テーブルに影響しない
// ─────────────────────────────────────────────────────────────────────────────

describe("cross-data: saveTasks が goals / profile を変更しない", () => {
  it("saveTasks の前後で goals と profile が不変", () => {
    const goal = makeGoal({ id: "g1", name: "目標" });
    const profile = { ...DEFAULT_PROFILE, currentState: "テスト中" };
    saveGoals([goal]);
    saveProfile(profile);

    const beforeGoals = JSON.stringify(loadGoals());
    const beforeProfile = JSON.stringify(loadProfile());

    saveTasks([makeTask({ id: "t1", title: "新タスク" })]);

    expect(JSON.stringify(loadGoals())).toBe(beforeGoals);
    expect(JSON.stringify(loadProfile())).toBe(beforeProfile);
  });
});
