// config.ts は読み込み時点で DATA_DIR を固定するため、server コードを import する前に
// テスト用ディレクトリを環境変数で指すようにする。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), "todome-goal-handler-test-"));
process.env.TODOME_DATA_DIR = TEST_DATA_DIR;

import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetDbCache } from "../../db.ts";
import {
  activeSockets,
  createSessionState,
  type AppWebSocket,
  type SessionState,
} from "../../state.ts";
import type { Goal, KanbanTask } from "../../types.ts";
import { goalAdd, goalDelete, goalEdit } from "./goal.ts";

interface SentMessage {
  type: string;
  [k: string]: unknown;
}

function makeRequester(): {
  ws: AppWebSocket;
  session: SessionState;
  sent: SentMessage[];
} {
  const session = createSessionState();
  const sent: SentMessage[] = [];
  const ws = {
    data: { id: "requester", session },
    send(payload: string) {
      sent.push(JSON.parse(payload) as SentMessage);
    },
  } as unknown as AppWebSocket;
  return { ws, session, sent };
}

function makeTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: "task-1",
    title: "テストタスク",
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
    ...overrides,
  };
}

describe("goalAdd handler", () => {
  let ctx: ReturnType<typeof makeRequester>;

  beforeEach(() => {
    activeSockets.clear();
    ctx = makeRequester();
  });

  afterEach(() => {
    activeSockets.clear();
  });

  afterAll(() => {
    resetDbCache();
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it("goal を追加して goal_sync を送り返す", async () => {
    await goalAdd(ctx.ws, ctx.session, {
      goal: {
        name: "英語学習",
        memo: "毎日30分",
        kpis: [{ name: "学習時間", unit: "time", targetValue: 1800, currentValue: 0 }],
        deadline: "2026-12-31",
      },
    });

    expect(ctx.session.goals).toHaveLength(1);
    const added = ctx.session.goals[0]!;
    expect(added.name).toBe("英語学習");
    expect(added.id).toBeTruthy();
    expect(added.kpis).toHaveLength(1);
    expect(added.kpis[0]!.id).toBeTruthy(); // ensureKpiIds が id を付与する

    const syncs = ctx.sent.filter((m) => m.type === "goal_sync");
    expect(syncs).toHaveLength(1);
  });

  it("goal 未指定でも空の goal として追加される（handler は落ちない）", async () => {
    await goalAdd(ctx.ws, ctx.session, {});

    expect(ctx.session.goals).toHaveLength(1);
    expect(ctx.session.goals[0]!.name).toBe("");
  });

  it("不正な repository 文字列は normalize で削除される", async () => {
    await goalAdd(ctx.ws, ctx.session, {
      goal: { name: "g", repository: "not a repo" },
    });

    expect(ctx.session.goals[0]!.repository).toBeUndefined();
  });
});

describe("goalEdit handler", () => {
  let ctx: ReturnType<typeof makeRequester>;

  beforeEach(() => {
    activeSockets.clear();
    ctx = makeRequester();
  });

  afterEach(() => {
    activeSockets.clear();
  });

  it("KPI を time から number に切り替えると、該当タスクの kpiId / kpiContributed がクリアされる", async () => {
    const existing: Goal = {
      id: "goal-1",
      name: "g",
      memo: "",
      kpis: [
        { id: "kpi-time", name: "time", unit: "time", targetValue: 60, currentValue: 0 },
      ],
      deadline: "",
      achieved: false,
      achievedAt: "",
    };
    ctx.session.goals.push(existing);
    ctx.session.kanbanTasks.push(
      makeTask({ id: "t1", goalId: "goal-1", kpiId: "kpi-time", kpiContributed: true }),
      makeTask({ id: "t2", goalId: "other-goal", kpiId: "kpi-time", kpiContributed: true })
    );

    // unit を number に変更して再送（= time KPI が無くなった扱い）
    await goalEdit(ctx.ws, ctx.session, {
      goal: {
        id: "goal-1",
        name: "g",
        memo: "",
        kpis: [
          { id: "kpi-time", name: "time", unit: "number", targetValue: 5, currentValue: 0 },
        ],
        deadline: "",
        achieved: false,
        achievedAt: "",
      },
    });

    const t1 = ctx.session.kanbanTasks.find((t) => t.id === "t1")!;
    expect(t1.kpiId).toBe("");
    expect(t1.kpiContributed).toBe(false);

    // 別の goal に紐づくタスクは影響を受けない（CLAUDE.md: 関係ない他のデータが変更されないことを assert）
    const t2 = ctx.session.kanbanTasks.find((t) => t.id === "t2")!;
    expect(t2.goalId).toBe("other-goal");
    expect(t2.kpiId).toBe("kpi-time");
    expect(t2.kpiContributed).toBe(true);

    const types = ctx.sent.map((m) => m.type);
    expect(types).toContain("goal_sync");
    expect(types).toContain("kanban_sync");
  });
});

describe("goalDelete handler", () => {
  let ctx: ReturnType<typeof makeRequester>;

  beforeEach(() => {
    activeSockets.clear();
    ctx = makeRequester();
  });

  afterEach(() => {
    activeSockets.clear();
  });

  it("goal 削除時、紐づくタスクの goalId/kpiId はクリアされ、他 goal のタスクは温存される", async () => {
    ctx.session.goals.push(
      {
        id: "goal-1",
        name: "消す",
        memo: "",
        kpis: [],
        deadline: "",
        achieved: false,
        achievedAt: "",
      },
      {
        id: "goal-2",
        name: "残す",
        memo: "",
        kpis: [],
        deadline: "",
        achieved: false,
        achievedAt: "",
      }
    );
    ctx.session.kanbanTasks.push(
      makeTask({ id: "t1", goalId: "goal-1", kpiId: "kpi-x", kpiContributed: true }),
      makeTask({ id: "t2", goalId: "goal-2", kpiId: "kpi-y", kpiContributed: true })
    );

    await goalDelete(ctx.ws, ctx.session, { goalId: "goal-1" });

    expect(ctx.session.goals.map((g) => g.id)).toEqual(["goal-2"]);

    const t1 = ctx.session.kanbanTasks.find((t) => t.id === "t1")!;
    expect(t1.goalId).toBe("");
    expect(t1.kpiId).toBe("");
    expect(t1.kpiContributed).toBe(false);

    const t2 = ctx.session.kanbanTasks.find((t) => t.id === "t2")!;
    expect(t2.goalId).toBe("goal-2");
    expect(t2.kpiId).toBe("kpi-y");
    expect(t2.kpiContributed).toBe(true);
  });
});
