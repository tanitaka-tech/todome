// config.ts は読み込み時点で DATA_DIR を固定するため、server コードを import する前に
// テスト用ディレクトリを環境変数で指すようにする。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), "todome-kanban-handler-test-"));
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
import {
  kanbanAdd,
  kanbanDelete,
  kanbanEdit,
  kanbanMove,
  kanbanReorder,
} from "./kanban.ts";

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

function makeGoalWithTimeKpi(
  goalId: string,
  kpiId: string,
  currentValue = 0
): Goal {
  return {
    id: goalId,
    name: "目標",
    memo: "",
    kpis: [
      {
        id: kpiId,
        name: "学習時間",
        unit: "time",
        targetValue: 3600,
        currentValue,
      },
    ],
    deadline: "",
    achieved: false,
    achievedAt: "",
  };
}

afterAll(() => {
  resetDbCache();
  rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

describe("kanbanAdd handler", () => {
  let ctx: ReturnType<typeof makeRequester>;

  beforeEach(() => {
    activeSockets.clear();
    ctx = makeRequester();
  });

  afterEach(() => {
    activeSockets.clear();
  });

  it("タスクを追加して kanban_sync を送る", async () => {
    await kanbanAdd(ctx.ws, ctx.session, {
      title: "買い物",
      description: "牛乳と卵",
      column: "todo",
      estimatedMinutes: 30,
    });

    expect(ctx.session.kanbanTasks).toHaveLength(1);
    const added = ctx.session.kanbanTasks[0]!;
    expect(added.title).toBe("買い物");
    expect(added.description).toBe("牛乳と卵");
    expect(added.column).toBe("todo");
    expect(added.estimatedMinutes).toBe(30);
    expect(added.id).toBeTruthy(); // shortId が付与される
    expect(added.kpiContributed).toBe(false);
    expect(added.timeSpent).toBe(0);

    const syncs = ctx.sent.filter((m) => m.type === "kanban_sync");
    expect(syncs).toHaveLength(1);
  });

  it("入力が空でもデフォルト値で追加される（handler は落ちない）", async () => {
    await kanbanAdd(ctx.ws, ctx.session, {});

    expect(ctx.session.kanbanTasks).toHaveLength(1);
    const t = ctx.session.kanbanTasks[0]!;
    expect(t.title).toBe("新しいタスク");
    expect(t.column).toBe("todo");
    expect(t.estimatedMinutes).toBe(0);
  });
});

describe("kanbanMove handler", () => {
  let ctx: ReturnType<typeof makeRequester>;

  beforeEach(() => {
    activeSockets.clear();
    ctx = makeRequester();
  });

  afterEach(() => {
    activeSockets.clear();
  });

  it("done に移動すると、紐づく time KPI に timeSpent が加算され、kpiContributed=true になる", async () => {
    ctx.session.goals.push(makeGoalWithTimeKpi("goal-1", "kpi-1", 0));
    ctx.session.kanbanTasks.push(
      makeTask({
        id: "t1",
        column: "in_progress",
        goalId: "goal-1",
        kpiId: "kpi-1",
        timeSpent: 600,
      })
    );

    await kanbanMove(ctx.ws, ctx.session, {
      taskId: "t1",
      column: "done",
    });

    const t = ctx.session.kanbanTasks[0]!;
    expect(t.column).toBe("done");
    expect(t.kpiContributed).toBe(true);
    expect(ctx.session.goals[0]!.kpis[0]!.currentValue).toBe(600);

    const types = ctx.sent.map((m) => m.type);
    expect(types).toContain("kanban_sync");
    expect(types).toContain("goal_sync");
  });

  it("done から todo に戻すと KPI から timeSpent が引かれ、kpiContributed=false になる", async () => {
    ctx.session.goals.push(makeGoalWithTimeKpi("goal-1", "kpi-1", 600));
    ctx.session.kanbanTasks.push(
      makeTask({
        id: "t1",
        column: "done",
        goalId: "goal-1",
        kpiId: "kpi-1",
        timeSpent: 600,
        kpiContributed: true,
      })
    );

    await kanbanMove(ctx.ws, ctx.session, {
      taskId: "t1",
      column: "todo",
    });

    const t = ctx.session.kanbanTasks[0]!;
    expect(t.column).toBe("todo");
    expect(t.kpiContributed).toBe(false);
    expect(ctx.session.goals[0]!.kpis[0]!.currentValue).toBe(0);
  });

  it("関係ない他のタスク・他の goal の状態は変わらない", async () => {
    ctx.session.goals.push(
      makeGoalWithTimeKpi("goal-1", "kpi-1", 0),
      makeGoalWithTimeKpi("goal-2", "kpi-2", 100)
    );
    ctx.session.kanbanTasks.push(
      makeTask({
        id: "target",
        column: "in_progress",
        goalId: "goal-1",
        kpiId: "kpi-1",
        timeSpent: 300,
      }),
      makeTask({
        id: "other",
        column: "in_progress",
        goalId: "goal-2",
        kpiId: "kpi-2",
        timeSpent: 999,
      })
    );

    await kanbanMove(ctx.ws, ctx.session, { taskId: "target", column: "done" });

    const other = ctx.session.kanbanTasks.find((t) => t.id === "other")!;
    expect(other.column).toBe("in_progress");
    expect(other.timeSpent).toBe(999);
    expect(other.kpiContributed).toBe(false);
    // goal-2 の KPI は触られない
    expect(ctx.session.goals[1]!.kpis[0]!.currentValue).toBe(100);
  });

  it("存在しない taskId が指定されても落ちずに sync を送る", async () => {
    ctx.session.kanbanTasks.push(makeTask({ id: "t1", column: "todo" }));

    await kanbanMove(ctx.ws, ctx.session, { taskId: "nonexistent", column: "done" });

    expect(ctx.session.kanbanTasks[0]!.column).toBe("todo");
    expect(ctx.sent.map((m) => m.type)).toContain("kanban_sync");
  });
});

describe("kanbanEdit handler", () => {
  let ctx: ReturnType<typeof makeRequester>;

  beforeEach(() => {
    activeSockets.clear();
    ctx = makeRequester();
  });

  afterEach(() => {
    activeSockets.clear();
  });

  it("title / memo / estimatedMinutes など指定したフィールドだけが更新される", async () => {
    ctx.session.kanbanTasks.push(
      makeTask({
        id: "t1",
        title: "古いタイトル",
        memo: "古いメモ",
        estimatedMinutes: 10,
        description: "保持される",
      })
    );

    await kanbanEdit(ctx.ws, ctx.session, {
      taskId: "t1",
      title: "新しいタイトル",
      memo: "新しいメモ",
    });

    const t = ctx.session.kanbanTasks[0]!;
    expect(t.title).toBe("新しいタイトル");
    expect(t.memo).toBe("新しいメモ");
    expect(t.estimatedMinutes).toBe(10); // 未指定なので変わらない
    expect(t.description).toBe("保持される");
  });

  it("goalId を空にすると kpiId もクリアされる", async () => {
    ctx.session.kanbanTasks.push(
      makeTask({ id: "t1", goalId: "goal-1", kpiId: "kpi-1" })
    );

    await kanbanEdit(ctx.ws, ctx.session, {
      taskId: "t1",
      goalId: "",
    });

    const t = ctx.session.kanbanTasks[0]!;
    expect(t.goalId).toBe("");
    expect(t.kpiId).toBe("");
  });

  it("done タスクの timeSpent を増やすと KPI も追従する（rebalance）", async () => {
    ctx.session.goals.push(makeGoalWithTimeKpi("goal-1", "kpi-1", 300));
    ctx.session.kanbanTasks.push(
      makeTask({
        id: "t1",
        column: "done",
        goalId: "goal-1",
        kpiId: "kpi-1",
        timeSpent: 300,
        kpiContributed: true,
      })
    );

    await kanbanEdit(ctx.ws, ctx.session, {
      taskId: "t1",
      timeSpent: 900,
    });

    const t = ctx.session.kanbanTasks[0]!;
    expect(t.timeSpent).toBe(900);
    expect(t.kpiContributed).toBe(true);
    expect(ctx.session.goals[0]!.kpis[0]!.currentValue).toBe(900);
  });
});

describe("kanbanDelete handler", () => {
  let ctx: ReturnType<typeof makeRequester>;

  beforeEach(() => {
    activeSockets.clear();
    ctx = makeRequester();
  });

  afterEach(() => {
    activeSockets.clear();
  });

  it("kpiContributed なタスクを削除すると KPI から timeSpent が引かれる", async () => {
    ctx.session.goals.push(makeGoalWithTimeKpi("goal-1", "kpi-1", 1200));
    ctx.session.kanbanTasks.push(
      makeTask({
        id: "t1",
        column: "done",
        goalId: "goal-1",
        kpiId: "kpi-1",
        timeSpent: 1200,
        kpiContributed: true,
      })
    );

    await kanbanDelete(ctx.ws, ctx.session, { taskId: "t1" });

    expect(ctx.session.kanbanTasks).toHaveLength(0);
    expect(ctx.session.goals[0]!.kpis[0]!.currentValue).toBe(0);
  });

  it("削除対象以外のタスクは温存される", async () => {
    ctx.session.kanbanTasks.push(
      makeTask({ id: "t1", title: "消す" }),
      makeTask({ id: "t2", title: "残す", column: "in_progress", timeSpent: 60 })
    );

    await kanbanDelete(ctx.ws, ctx.session, { taskId: "t1" });

    expect(ctx.session.kanbanTasks).toHaveLength(1);
    const remaining = ctx.session.kanbanTasks[0]!;
    expect(remaining.id).toBe("t2");
    expect(remaining.title).toBe("残す");
    expect(remaining.column).toBe("in_progress");
    expect(remaining.timeSpent).toBe(60);
  });
});

describe("kanbanReorder handler", () => {
  let ctx: ReturnType<typeof makeRequester>;

  beforeEach(() => {
    activeSockets.clear();
    ctx = makeRequester();
  });

  afterEach(() => {
    activeSockets.clear();
  });

  it("taskIds の順序通りに並び替わる", async () => {
    ctx.session.kanbanTasks.push(
      makeTask({ id: "a" }),
      makeTask({ id: "b" }),
      makeTask({ id: "c" })
    );

    await kanbanReorder(ctx.ws, ctx.session, { taskIds: ["c", "a", "b"] });

    expect(ctx.session.kanbanTasks.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("taskIds に含まれないタスクは末尾に温存される", async () => {
    ctx.session.kanbanTasks.push(
      makeTask({ id: "a" }),
      makeTask({ id: "b" }),
      makeTask({ id: "c" })
    );

    await kanbanReorder(ctx.ws, ctx.session, { taskIds: ["c"] });

    expect(ctx.session.kanbanTasks.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("重複した id は1回だけ反映され、未知の id は無視される", async () => {
    ctx.session.kanbanTasks.push(makeTask({ id: "a" }), makeTask({ id: "b" }));

    await kanbanReorder(ctx.ws, ctx.session, {
      taskIds: ["a", "a", "ghost", "b"],
    });

    expect(ctx.session.kanbanTasks.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("非配列入力でも落ちずに既存順序が温存される", async () => {
    ctx.session.kanbanTasks.push(makeTask({ id: "a" }), makeTask({ id: "b" }));

    await kanbanReorder(ctx.ws, ctx.session, { taskIds: "not-an-array" });

    expect(ctx.session.kanbanTasks.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
