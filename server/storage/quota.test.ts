import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDb, resetDbCache } from "../db.ts";
import { githubState } from "../state.ts";
import { loadGoals, saveGoals } from "./goals.ts";
import { loadTasks, saveTasks } from "./kanban.ts";
import { DEFAULT_PROFILE, loadProfile, saveProfile } from "./profile.ts";
import {
  computeAllQuotaStreaks,
  computeQuotaStreak,
  loadQuotas,
  normalizeQuota,
  saveQuotas,
  startQuotaLog,
  stopActiveQuotaLogIfAny,
  stopQuotaLog,
} from "./quota.ts";
import type { Goal, KanbanTask, Quota } from "../types.ts";

function makeQuota(partial: Partial<Quota> & Pick<Quota, "id" | "name">): Quota {
  return {
    icon: "🎯",
    targetMinutes: 30,
    archived: false,
    createdAt: "2026-04-22T00:00:00",
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

beforeEach(() => {
  resetDbCache();
  const db = getDb();
  db.exec("DELETE FROM quotas");
  db.exec("DELETE FROM quota_logs");
  db.exec("DELETE FROM goals");
  db.exec("DELETE FROM kanban_tasks");
  db.exec("DELETE FROM profile");
  db.exec("DELETE FROM life_activities");
  db.exec("DELETE FROM life_logs");
  db.exec("DELETE FROM retrospectives");
  saveProfile({ ...DEFAULT_PROFILE });
  // diffCache をクリアしてテスト用データが本番キャッシュを汚さないようにする
  githubState.diffCache.clear();
});

afterEach(() => {
  resetDbCache();
});


// ─────────────────────────────────────────────────────────────────────────────
// normalizeQuota
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeQuota — 入力値の正規化", () => {
  it("NaN の targetMinutes は 0 になる", () => {
    const q = normalizeQuota({ id: "q1", name: "テスト", icon: "🎯", targetMinutes: NaN, archived: false, createdAt: "" });
    expect(q.targetMinutes).toBe(0);
  });

  it("負の targetMinutes は 0 になる (regression: ノルマ更新でマイナス値が入ると壊れる)", () => {
    const q = normalizeQuota({ id: "q1", name: "テスト", icon: "🎯", targetMinutes: -10, archived: false, createdAt: "" });
    expect(q.targetMinutes).toBe(0);
  });

  it("小数の targetMinutes は切り捨てられる", () => {
    const q = normalizeQuota({ id: "q1", name: "テスト", icon: "🎯", targetMinutes: 15.9, archived: false, createdAt: "" });
    expect(q.targetMinutes).toBe(15);
  });

  it("空の name は '未命名ノルマ' になる", () => {
    const q = normalizeQuota({ id: "q1", name: "", icon: "🎯", targetMinutes: 30, archived: false, createdAt: "" });
    expect(q.name).toBe("未命名ノルマ");
  });

  it("空白のみの name は '未命名ノルマ' になる", () => {
    const q = normalizeQuota({ id: "q1", name: "   ", icon: "🎯", targetMinutes: 30, archived: false, createdAt: "" });
    expect(q.name).toBe("未命名ノルマ");
  });

  it("空の icon は '🎯' になる", () => {
    const q = normalizeQuota({ id: "q1", name: "テスト", icon: "", targetMinutes: 30, archived: false, createdAt: "" });
    expect(q.icon).toBe("🎯");
  });

  it("id が未設定の場合は新しい id が生成される", () => {
    const q = normalizeQuota({ name: "テスト", icon: "🎯", targetMinutes: 30, archived: false, createdAt: "" });
    expect(q.id).toBeTruthy();
    expect(typeof q.id).toBe("string");
  });

  it("既存の id は保持される", () => {
    const q = normalizeQuota({ id: "existing-id", name: "テスト", icon: "🎯", targetMinutes: 30, archived: false, createdAt: "" });
    expect(q.id).toBe("existing-id");
  });

  it("入力オブジェクトは変更されない (immutability)", () => {
    const raw = { id: "q1", name: "テスト", icon: "🎯", targetMinutes: -5, archived: false, createdAt: "" };
    const snapshot = JSON.stringify(raw);
    normalizeQuota(raw);
    expect(JSON.stringify(raw)).toBe(snapshot);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// saveQuotas / loadQuotas
// ─────────────────────────────────────────────────────────────────────────────

describe("saveQuotas / loadQuotas — 永続化ラウンドトリップ", () => {
  it("保存したノルマを正確に復元できる", () => {
    const quotas = [
      makeQuota({ id: "q1", name: "掃除", icon: "🧹", targetMinutes: 15 }),
      makeQuota({ id: "q2", name: "運動", icon: "🏃", targetMinutes: 30 }),
    ];
    saveQuotas(quotas);
    const loaded = loadQuotas();
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toEqual(quotas[0]);
    expect(loaded[1]).toEqual(quotas[1]);
  });

  it("保存した順序（sort_order）で返る", () => {
    const a = makeQuota({ id: "a", name: "後から" });
    const b = makeQuota({ id: "b", name: "先に" });
    saveQuotas([a, b]);
    const loaded = loadQuotas();
    expect(loaded[0]!.id).toBe("a");
    expect(loaded[1]!.id).toBe("b");
  });

  it("全件上書き保存が正しく反映される", () => {
    saveQuotas([makeQuota({ id: "q1", name: "旧" })]);
    saveQuotas([makeQuota({ id: "q2", name: "新" })]);
    const loaded = loadQuotas();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe("q2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// アップサート挙動（ハンドラが行う load→更新→save のパターン）
// ─────────────────────────────────────────────────────────────────────────────

describe("ノルマのアップサート挙動 (regression: 既存IDのノルマが追加でなく更新される)", () => {
  it("既存 id のノルマを更新するとリストの長さが変わらない", () => {
    const original = makeQuota({ id: "q1", name: "旧名前", targetMinutes: 15 });
    saveQuotas([original]);

    const updated = { ...original, name: "新名前", targetMinutes: 20 };
    const quotas = loadQuotas();
    const idx = quotas.findIndex((q) => q.id === updated.id);
    if (idx >= 0) quotas[idx] = updated;
    else quotas.push(updated);
    saveQuotas(quotas);

    const result = loadQuotas();
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("新名前");
    expect(result[0]!.targetMinutes).toBe(20);
  });

  it("新規 id のノルマは既存リストに追加される", () => {
    saveQuotas([makeQuota({ id: "q1", name: "既存" })]);

    const newQuota = makeQuota({ id: "q2", name: "新規" });
    const quotas = loadQuotas();
    const idx = quotas.findIndex((q) => q.id === newQuota.id);
    if (idx >= 0) quotas[idx] = newQuota;
    else quotas.push(newQuota);
    saveQuotas(quotas);

    const result = loadQuotas();
    expect(result).toHaveLength(2);
    expect(result.some((q) => q.id === "q1")).toBe(true);
    expect(result.some((q) => q.id === "q2")).toBe(true);
  });

  it("1件更新しても他のノルマの内容が変わらない", () => {
    const q1 = makeQuota({ id: "q1", name: "ノルマ1", targetMinutes: 15 });
    const q2 = makeQuota({ id: "q2", name: "ノルマ2", targetMinutes: 30 });
    saveQuotas([q1, q2]);

    const quotas = loadQuotas();
    const idx = quotas.findIndex((q) => q.id === "q1")!;
    quotas[idx] = { ...q1, name: "ノルマ1 更新" };
    saveQuotas(quotas);

    const resultQ2 = loadQuotas().find((q) => q.id === "q2");
    expect(resultQ2).toEqual(q2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 計測ログ
// ─────────────────────────────────────────────────────────────────────────────

describe("startQuotaLog / stopQuotaLog — 計測ログ操作", () => {
  it("startQuotaLog でログが作成され ended_at が空になる", () => {
    saveQuotas([makeQuota({ id: "q1", name: "掃除" })]);
    const log = startQuotaLog("q1");
    expect(log.quotaId).toBe("q1");
    expect(log.startedAt).toBeTruthy();
    expect(log.endedAt).toBe("");
  });

  it("stopQuotaLog で ended_at が設定される", () => {
    saveQuotas([makeQuota({ id: "q1", name: "掃除" })]);
    const started = startQuotaLog("q1");
    const stopped = stopQuotaLog(started.id);
    expect(stopped).not.toBeNull();
    expect(stopped!.endedAt).toBeTruthy();
    expect(stopped!.endedAt).not.toBe("");
  });

  it("stopQuotaLog で memo が保存される", () => {
    saveQuotas([makeQuota({ id: "q1", name: "掃除" })]);
    const started = startQuotaLog("q1");
    const stopped = stopQuotaLog(started.id, "メモ内容");
    expect(stopped!.memo).toBe("メモ内容");
  });

  it("startQuotaLog は既存のアクティブログを自動停止する", () => {
    saveQuotas([
      makeQuota({ id: "q1", name: "掃除" }),
      makeQuota({ id: "q2", name: "運動" }),
    ]);
    const first = startQuotaLog("q1");
    expect(first.endedAt).toBe("");

    startQuotaLog("q2");

    // 自動停止済みなので ended_at が設定されている
    const afterAutoStop = stopQuotaLog(first.id);
    expect(afterAutoStop).not.toBeNull();
    expect(afterAutoStop!.endedAt).not.toBe("");
  });
});

describe("stopActiveQuotaLogIfAny — アクティブログの停止", () => {
  it("アクティブなログがない場合は空文字を返す", () => {
    const result = stopActiveQuotaLogIfAny();
    expect(result).toBe("");
  });

  it("アクティブなログがある場合はそのIDを返して停止する", () => {
    saveQuotas([makeQuota({ id: "q1", name: "掃除" })]);
    const log = startQuotaLog("q1");

    const stoppedId = stopActiveQuotaLogIfAny();
    expect(stoppedId).toBe(log.id);

    // 停止後はアクティブログがない
    expect(stopActiveQuotaLogIfAny()).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeQuotaStreak（純粋関数）
// ─────────────────────────────────────────────────────────────────────────────

describe("computeQuotaStreak — ストリーク計算 (純粋関数)", () => {
  it("ログなし → current/best ともに 0", () => {
    const result = computeQuotaStreak({}, 1800, "2026-04-22");
    expect(result).toEqual({ current: 0, best: 0, lastAchievedDate: "" });
  });

  it("targetSeconds が 0 → 常に current/best 0 を返す", () => {
    const result = computeQuotaStreak({ "2026-04-22": 3600 }, 0, "2026-04-22");
    expect(result).toEqual({ current: 0, best: 0, lastAchievedDate: "" });
  });

  it("当日だけ達成 → current=1, best=1", () => {
    const result = computeQuotaStreak({ "2026-04-22": 3600 }, 1800, "2026-04-22");
    expect(result.current).toBe(1);
    expect(result.best).toBe(1);
    expect(result.lastAchievedDate).toBe("2026-04-22");
  });

  it("連続3日達成 → current=3, best=3", () => {
    const totals = { "2026-04-20": 2000, "2026-04-21": 2000, "2026-04-22": 2000 };
    const result = computeQuotaStreak(totals, 1800, "2026-04-22");
    expect(result.current).toBe(3);
    expect(result.best).toBe(3);
  });

  it("1日空きがある → current がリセットされる", () => {
    const totals = { "2026-04-20": 2000, "2026-04-22": 2000 }; // 21日が空き
    const result = computeQuotaStreak(totals, 1800, "2026-04-22");
    expect(result.current).toBe(1);
    expect(result.best).toBe(1);
  });

  it("過去の連続が今より長ければ best に反映される", () => {
    const totals = {
      "2026-04-10": 2000, "2026-04-11": 2000, "2026-04-12": 2000,
      "2026-04-22": 2000, // 空きあり
    };
    const result = computeQuotaStreak(totals, 1800, "2026-04-22");
    expect(result.current).toBe(1);
    expect(result.best).toBe(3);
  });

  it("最終達成日が2日以上前 → current=0 になる", () => {
    const result = computeQuotaStreak({ "2026-04-20": 2000 }, 1800, "2026-04-22");
    expect(result.current).toBe(0);
    expect(result.best).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeAllQuotaStreaks
// ─────────────────────────────────────────────────────────────────────────────

describe("computeAllQuotaStreaks — 全ノルマのストリーク一括計算", () => {
  it("空のノルマリストは空配列を返す", () => {
    const result = computeAllQuotaStreaks([], [], "2026-04-22");
    expect(result).toEqual([]);
  });

  it("ログなしのノルマは current/best ともに 0 になる", () => {
    const quota = makeQuota({ id: "q1", name: "掃除", targetMinutes: 30 });
    const result = computeAllQuotaStreaks([quota], [], "2026-04-22");
    expect(result).toHaveLength(1);
    expect(result[0]!.quotaId).toBe("q1");
    expect(result[0]!.current).toBe(0);
    expect(result[0]!.best).toBe(0);
  });

  it("あるノルマのログ追加が他ノルマのストリークに影響しない", () => {
    const q1 = makeQuota({ id: "q1", name: "掃除", targetMinutes: 30 });
    const q2 = makeQuota({ id: "q2", name: "運動", targetMinutes: 30 });
    const log = {
      id: "l1", quotaId: "q1",
      startedAt: "2026-04-22T10:00:00", endedAt: "2026-04-22T10:35:00", memo: "",
    };
    const result = computeAllQuotaStreaks([q1, q2], [log], "2026-04-22");
    expect(result.find((s) => s.quotaId === "q1")!.current).toBe(1);
    expect(result.find((s) => s.quotaId === "q2")!.current).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cross-data: ノルマ保存が他テーブルに影響しない
// ─────────────────────────────────────────────────────────────────────────────

describe("cross-data: ノルマ保存が goals / kanban_tasks / profile を変更しない", () => {
  it("saveQuotas の前後で goals / tasks / profile が不変", () => {
    const goal = makeGoal({ id: "g1", name: "目標" });
    const task = makeTask({ id: "t1", title: "タスク" });
    const profile = { ...DEFAULT_PROFILE, currentState: "テスト中" };
    saveGoals([goal]);
    saveTasks([task]);
    saveProfile(profile);

    const beforeGoals = JSON.stringify(loadGoals());
    const beforeTasks = JSON.stringify(loadTasks());
    const beforeProfile = JSON.stringify(loadProfile());

    saveQuotas([makeQuota({ id: "q1", name: "ノルマ" })]);

    expect(JSON.stringify(loadGoals())).toBe(beforeGoals);
    expect(JSON.stringify(loadTasks())).toBe(beforeTasks);
    expect(JSON.stringify(loadProfile())).toBe(beforeProfile);
  });
});
