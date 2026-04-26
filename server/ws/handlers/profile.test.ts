// config.ts は読み込み時点で DATA_DIR を固定するため、server コードを import する前に
// テスト用ディレクトリを環境変数で指すようにする。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), "todome-profile-handler-test-"));
process.env.TODOME_DATA_DIR = TEST_DATA_DIR;

import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDb, resetDbCache } from "../../db.ts";
import {
  activeSockets,
  createSessionState,
  type AppWebSocket,
  type SessionState,
} from "../../state.ts";
import { DEFAULT_PROFILE, loadProfile } from "../../storage/profile.ts";
import type { Goal, KanbanTask, UserProfile } from "../../types.ts";
import { saveGoals, loadGoals } from "../../storage/goals.ts";
import { saveTasks, loadTasks } from "../../storage/kanban.ts";
import { profileUpdate } from "./profile.ts";

interface SentMessage {
  type: string;
  [k: string]: unknown;
}

function attachFakeBroadcastSocket(): SentMessage[] {
  const sent: SentMessage[] = [];
  const fake = {
    data: { id: "broadcast", session: createSessionState() },
    send(payload: string) {
      sent.push(JSON.parse(payload) as SentMessage);
    },
  } as unknown as AppWebSocket;
  activeSockets.add(fake);
  return sent;
}

function makeRequester(): { ws: AppWebSocket; session: SessionState } {
  const session = createSessionState();
  const ws = {
    data: { id: "requester", session },
    send() {},
  } as unknown as AppWebSocket;
  return { ws, session };
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

describe("profileUpdate handler", () => {
  let sent: SentMessage[];

  beforeEach(() => {
    activeSockets.clear();
    resetDbCache();
    const db = getDb();
    db.exec("DELETE FROM profile");
    db.exec("DELETE FROM goals");
    db.exec("DELETE FROM kanban_tasks");
    sent = attachFakeBroadcastSocket();
  });

  afterEach(() => {
    activeSockets.clear();
  });

  afterAll(() => {
    resetDbCache();
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it("正常な profile を保存して profile_sync を broadcast する", async () => {
    const { ws, session } = makeRequester();
    const incoming: UserProfile = {
      currentState: "集中作業中",
      balanceWheel: [{ id: "h", name: "健康", score: 7 }],
      actionPrinciples: [{ id: "a1", text: "毎朝散歩する" }],
      wantToDo: [{ id: "w1", text: "旅行" }],
      timezone: "Asia/Tokyo",
    };

    await profileUpdate(ws, session, { profile: incoming });

    expect(loadProfile()).toEqual(incoming);
    expect(session.profile).toEqual(incoming);
    const syncs = sent.filter((m) => m.type === "profile_sync");
    expect(syncs).toHaveLength(1);
    expect(syncs[0]?.profile).toEqual(incoming);
  });

  it("profile が未指定なら DEFAULT_PROFILE 相当を保存する", async () => {
    const { ws, session } = makeRequester();

    await profileUpdate(ws, session, {});

    expect(loadProfile()).toEqual(DEFAULT_PROFILE);
    const sync = sent.find((m) => m.type === "profile_sync");
    expect(sync?.profile).toEqual(DEFAULT_PROFILE);
  });

  it("profile が null でもクラッシュせず DEFAULT_PROFILE を保存する", async () => {
    const { ws, session } = makeRequester();

    await profileUpdate(ws, session, { profile: null });

    expect(loadProfile()).toEqual(DEFAULT_PROFILE);
  });

  it("profile が文字列など想定外の型でも DEFAULT_PROFILE を保存する", async () => {
    const { ws, session } = makeRequester();

    await profileUpdate(ws, session, { profile: "broken" });

    expect(loadProfile()).toEqual(DEFAULT_PROFILE);
  });

  it("配列フィールドに非配列値が来ても空配列に正規化されて保存される", async () => {
    const { ws, session } = makeRequester();

    await profileUpdate(ws, session, {
      profile: {
        currentState: "ok",
        balanceWheel: "not-an-array",
        actionPrinciples: 42,
        wantToDo: null,
        timezone: "Asia/Tokyo",
      },
    });

    const stored = loadProfile();
    expect(stored.currentState).toBe("ok");
    expect(stored.balanceWheel).toEqual([]);
    expect(stored.actionPrinciples).toEqual([]);
    expect(stored.wantToDo).toEqual([]);
    expect(stored.timezone).toBe("Asia/Tokyo");
  });

  it("currentState に非文字列が来ても空文字に正規化される", async () => {
    const { ws, session } = makeRequester();

    await profileUpdate(ws, session, {
      profile: { currentState: 42 },
    });

    expect(loadProfile().currentState).toBe("");
  });

  it("未知のキーは保存されず捨てられる", async () => {
    const { ws, session } = makeRequester();

    await profileUpdate(ws, session, {
      profile: { currentState: "ok", __evil: "<script>" },
    });

    const stored = loadProfile();
    expect(stored).toEqual({
      ...DEFAULT_PROFILE,
      currentState: "ok",
    });
    expect((stored as unknown as Record<string, unknown>).__evil).toBeUndefined();
  });

  it("profile 更新が goals / kanban_tasks を変更しない (cross-data 不変)", async () => {
    const goal = makeGoal({ id: "g1", name: "目標" });
    const task = makeTask({ id: "t1", title: "タスク", column: "done" });
    saveGoals([goal]);
    saveTasks([task]);

    const beforeGoals = JSON.stringify(loadGoals());
    const beforeTasks = JSON.stringify(loadTasks());

    const { ws, session } = makeRequester();
    await profileUpdate(ws, session, {
      profile: { currentState: "別件で更新" },
    });

    expect(JSON.stringify(loadGoals())).toBe(beforeGoals);
    expect(JSON.stringify(loadTasks())).toBe(beforeTasks);
  });

  it("壊れた payload を受け取っても既存の profile を破壊した形で保存しない", async () => {
    const { ws, session } = makeRequester();
    const initial: UserProfile = {
      currentState: "保存済み",
      balanceWheel: [{ id: "h", name: "健康", score: 7 }],
      actionPrinciples: [{ id: "a1", text: "原則" }],
      wantToDo: [{ id: "w1", text: "やりたいこと" }],
      timezone: "Asia/Tokyo",
    };
    await profileUpdate(ws, session, { profile: initial });
    sent.length = 0;

    // 壊れた payload を流す: 配列フィールドに非配列値、currentState は数値
    await profileUpdate(ws, session, {
      profile: { currentState: 999, balanceWheel: "x", actionPrinciples: 1 },
    });

    const stored = loadProfile();
    // 各フィールドは既存値を保持するわけではなく、デフォルトに正規化される。
    // ただし JSON として整合する形で保存され、後続の load で復元できることを保証する。
    expect(stored).toEqual({
      currentState: "",
      balanceWheel: [],
      actionPrinciples: [],
      wantToDo: [],
      timezone: "",
    });
    // broadcast された値も同じく正規化済み
    const sync = sent.find((m) => m.type === "profile_sync");
    expect(sync?.profile).toEqual(stored);
  });
});
