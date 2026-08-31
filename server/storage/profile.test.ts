import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDb, resetDbCache } from "../db.ts";
import { githubState } from "../state.ts";
import { loadGoals, saveGoals } from "./goals.ts";
import { loadTasks, saveTasks } from "./kanban.ts";
import {
  DEFAULT_PROFILE,
  applyProfileUpdate,
  loadProfile,
  normalizeProfile,
  saveProfile,
} from "./profile.ts";
import type { Goal, KanbanTask, UserProfile } from "../types.ts";

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

function makeProfile(partial: Partial<UserProfile> = {}): UserProfile {
  return { ...DEFAULT_PROFILE, ...partial };
}

beforeEach(() => {
  resetDbCache();
  const db = getDb();
  db.exec("DELETE FROM profile");
  db.exec("DELETE FROM goals");
  db.exec("DELETE FROM kanban_tasks");
  db.exec("DELETE FROM quotas");
  db.exec("DELETE FROM quota_logs");
  db.exec("DELETE FROM life_activities");
  db.exec("DELETE FROM life_logs");
  db.exec("DELETE FROM retrospectives");
  githubState.diffCache.clear();
});

afterEach(() => {
  resetDbCache();
});


// ─────────────────────────────────────────────────────────────────────────────
// applyProfileUpdate（純粋関数）
// ─────────────────────────────────────────────────────────────────────────────

describe("applyProfileUpdate — プロフィール部分更新 (純粋関数)", () => {
  it("currentState だけを更新できる", () => {
    const profile = makeProfile({ currentState: "旧状態" });
    const result = applyProfileUpdate(profile, { currentState: "新状態" });
    expect(result.currentState).toBe("新状態");
  });

  it("currentState 以外のフィールドが変わらない", () => {
    const profile = makeProfile({
      currentState: "旧状態",
      balanceWheel: [{ id: "h", name: "健康", score: 8 }],
      actionPrinciples: [{ id: "p1", text: "原則1" }],
      wantToDo: [{ id: "w1", text: "やりたいこと1" }],
    });
    const result = applyProfileUpdate(profile, { currentState: "新状態" });
    expect(result.balanceWheel).toEqual(profile.balanceWheel);
    expect(result.actionPrinciples).toEqual(profile.actionPrinciples);
    expect(result.wantToDo).toEqual(profile.wantToDo);
  });

  it("balanceWheel を配列で更新できる", () => {
    const profile = makeProfile({ balanceWheel: [] });
    const newWheel = [
      { id: "h", name: "健康", score: 7 },
      { id: "w", name: "仕事", score: 6 },
    ];
    const result = applyProfileUpdate(profile, { balanceWheel: newWheel });
    expect(result.balanceWheel).toEqual(newWheel);
  });

  it("balanceWheel 要素の shape を正規化し、不正要素は保存しない", () => {
    const profile = makeProfile({ balanceWheel: [] });
    const result = applyProfileUpdate(profile, {
      balanceWheel: [
        { id: " h ", name: " 健康 ", score: 12.8, icon: " 💪 " },
        { id: "bad", score: 5 },
        "not-object",
      ],
    });

    expect(result.balanceWheel).toEqual([
      { id: "h", name: "健康", score: 10, icon: "💪" },
    ]);
  });

  it("actionPrinciples を配列で更新できる", () => {
    const profile = makeProfile({
      actionPrinciples: [{ id: "p0", text: "旧原則" }],
    });
    const newList = [
      { id: "p1", text: "新原則1" },
      { id: "p2", text: "新原則2" },
    ];
    const result = applyProfileUpdate(profile, { actionPrinciples: newList });
    expect(result.actionPrinciples).toEqual(newList);
  });

  it("actionPrinciples / wantToDo 要素の shape を正規化する", () => {
    const profile = makeProfile();
    const result = applyProfileUpdate(profile, {
      actionPrinciples: [
        { id: " p1 ", text: "原則1" },
        { id: "missing-text" },
        42,
      ],
      wantToDo: [
        { text: "旅行" },
        { id: "", text: "" },
        null,
      ],
    });

    expect(result.actionPrinciples).toEqual([
      { id: "p1", text: "原則1" },
      { id: "missing-text", text: "" },
    ]);
    expect(result.wantToDo).toHaveLength(1);
    expect(result.wantToDo[0]?.id).toBeTruthy();
    expect(result.wantToDo[0]?.text).toBe("旅行");
  });

  it("wantToDo を配列で更新できる", () => {
    const profile = makeProfile({
      wantToDo: [{ id: "w0", text: "旧やりたいこと" }],
    });
    const newList = [{ id: "w1", text: "新やりたいこと" }];
    const result = applyProfileUpdate(profile, { wantToDo: newList });
    expect(result.wantToDo).toEqual(newList);
  });

  it("配列フィールドに非配列値を渡しても更新されない", () => {
    const profile = makeProfile({ balanceWheel: [{ id: "h", name: "健康", score: 8 }] });
    const result = applyProfileUpdate(profile, { balanceWheel: "invalid" });
    expect(result.balanceWheel).toEqual(profile.balanceWheel);
  });

  it("currentState に非文字列を渡しても更新されない", () => {
    const profile = makeProfile({ currentState: "元の状態" });
    const result = applyProfileUpdate(profile, { currentState: 42 });
    expect(result.currentState).toBe("元の状態");
  });

  it("空の updates オブジェクトはプロフィールを変更しない", () => {
    const profile = makeProfile({
      currentState: "状態",
      actionPrinciples: [{ id: "p", text: "原則" }],
    });
    const result = applyProfileUpdate(profile, {});
    expect(result.currentState).toBe("状態");
    expect(result.actionPrinciples).toEqual([{ id: "p", text: "原則" }]);
  });

  it("未知のキーを渡してもエラーにならない", () => {
    const profile = makeProfile({ currentState: "状態" });
    expect(() => applyProfileUpdate(profile, { unknownKey: "value" })).not.toThrow();
    const result = applyProfileUpdate(profile, { unknownKey: "value" });
    expect(result.currentState).toBe("状態");
  });

  it("入力プロフィールオブジェクトは変更されない (immutability)", () => {
    const profile = makeProfile({ currentState: "元" });
    const snapshot = JSON.stringify(profile);
    applyProfileUpdate(profile, { currentState: "新" });
    expect(JSON.stringify(profile)).toBe(snapshot);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// saveProfile / loadProfile
// ─────────────────────────────────────────────────────────────────────────────

describe("saveProfile / loadProfile — 永続化ラウンドトリップ", () => {
  it("プロフィールを保存して正確に復元できる", () => {
    const profile = makeProfile({
      currentState: "集中作業中",
      balanceWheel: [{ id: "h", name: "健康", score: 7 }],
      actionPrinciples: [{ id: "a", text: "原則A" }],
      wantToDo: [{ id: "t", text: "旅行" }],
    });
    saveProfile(profile);
    const loaded = loadProfile();
    expect(loaded).toEqual(profile);
  });

  it("profileがDBにない場合は DEFAULT_PROFILE のコピーを返す", () => {
    // beforeEach で profile テーブルを空にしている
    const loaded = loadProfile();
    expect(loaded).toEqual(DEFAULT_PROFILE);
  });

  it("DEFAULT_PROFILE 自体は変更されない (参照独立性)", () => {
    const loaded = loadProfile();
    loaded.currentState = "変更";
    expect(DEFAULT_PROFILE.currentState).toBe("");
  });

  it("上書き保存が正しく反映される", () => {
    saveProfile(makeProfile({ currentState: "旧" }));
    saveProfile(makeProfile({ currentState: "新" }));
    const loaded = loadProfile();
    expect(loaded.currentState).toBe("新");
  });

  it("空の配列フィールドも保存・復元できる", () => {
    const profile = makeProfile({ balanceWheel: [], actionPrinciples: [], wantToDo: [] });
    saveProfile(profile);
    const loaded = loadProfile();
    expect(loaded.balanceWheel).toEqual([]);
    expect(loaded.actionPrinciples).toEqual([]);
    expect(loaded.wantToDo).toEqual([]);
  });

  it("loadProfile は壊れた配列要素を正規化して返す", () => {
    getDb()
      .prepare(
        "INSERT INTO profile (id, data) VALUES (1, ?) " +
          "ON CONFLICT(id) DO UPDATE SET data = excluded.data",
      )
      .run(
        JSON.stringify({
          currentState: "状態",
          balanceWheel: [
            { id: " work ", name: " 仕事 ", score: -3 },
            { id: "bad" },
          ],
          actionPrinciples: ["文字列", { id: " p ", text: "続ける" }],
          wantToDo: [{ text: "温泉" }, { id: "", text: "" }],
        }),
      );

    const loaded = loadProfile();
    expect(loaded.currentState).toBe("状態");
    expect(loaded.balanceWheel).toEqual([
      { id: "work", name: "仕事", score: 1 },
    ]);
    expect(loaded.actionPrinciples).toEqual([{ id: "p", text: "続ける" }]);
    expect(loaded.wantToDo).toHaveLength(1);
    expect(loaded.wantToDo[0]?.id).toBeTruthy();
    expect(loaded.wantToDo[0]?.text).toBe("温泉");
  });
});

describe("normalizeProfile", () => {
  it("非 object 入力は既定値へ落とす", () => {
    expect(normalizeProfile(null)).toEqual(DEFAULT_PROFILE);
    expect(normalizeProfile("bad")).toEqual(DEFAULT_PROFILE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cross-data: プロフィール保存が他テーブルに影響しない
// (regression: プロフィール更新してもGit同期フラグが立たなかったバグ修正後の回帰)
// ─────────────────────────────────────────────────────────────────────────────

describe("cross-data: saveProfile が goals / kanban_tasks を変更しない", () => {
  it("saveProfile の前後で goals と tasks が不変", () => {
    const goal = makeGoal({ id: "g1", name: "目標" });
    const task = makeTask({ id: "t1", title: "タスク" });
    saveGoals([goal]);
    saveTasks([task]);

    const beforeGoals = JSON.stringify(loadGoals());
    const beforeTasks = JSON.stringify(loadTasks());

    saveProfile(makeProfile({ currentState: "テスト" }));

    expect(JSON.stringify(loadGoals())).toBe(beforeGoals);
    expect(JSON.stringify(loadTasks())).toBe(beforeTasks);
  });

  it("applyProfileUpdate + saveProfile でも goals / tasks は不変", () => {
    const goal = makeGoal({ id: "g1", name: "目標" });
    const task = makeTask({ id: "t1", title: "タスク", column: "done" });
    saveGoals([goal]);
    saveTasks([task]);

    const beforeGoals = JSON.stringify(loadGoals());
    const beforeTasks = JSON.stringify(loadTasks());

    const profile = makeProfile({ currentState: "旧" });
    saveProfile(profile);
    const updated = applyProfileUpdate(profile, { currentState: "新", actionPrinciples: ["新原則"] });
    saveProfile(updated);

    expect(JSON.stringify(loadGoals())).toBe(beforeGoals);
    expect(JSON.stringify(loadTasks())).toBe(beforeTasks);
  });
});
