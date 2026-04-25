// config.ts は読み込み時点で DATA_DIR を固定するため、server コードを import する前に
// テスト用ディレクトリを環境変数で指すようにする。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), "todome-kanban-handler-test-"));
process.env.TODOME_DATA_DIR = TEST_DATA_DIR;

import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDb, resetDbCache } from "../../db.ts";
import {
  activeSockets,
  createSessionState,
  type AppWebSocket,
  type SessionState,
} from "../../state.ts";
import { loadTasks } from "../../storage/kanban.ts";
import type { Goal, KanbanTask } from "../../types.ts";
import { formatLocalIso } from "../../utils/time.ts";
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

function makeTask(
  partial: Partial<KanbanTask> & Pick<KanbanTask, "id" | "title">
): KanbanTask {
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

beforeEach(() => {
  activeSockets.clear();
  resetDbCache();
  const db = getDb();
  db.exec("DELETE FROM kanban_tasks");
  db.exec("DELETE FROM goals");
});

afterEach(() => {
  activeSockets.clear();
});

afterAll(() => {
  resetDbCache();
  rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

describe("kanbanAdd handler", () => {
  let ctx: ReturnType<typeof makeRequester>;

  beforeEach(() => {
    ctx = makeRequester();
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

  it("不正な column / estimatedMinutes は保存前に正規化される", async () => {
    await kanbanAdd(ctx.ws, ctx.session, {
      title: "不正入力",
      column: "blocked",
      estimatedMinutes: -30,
    });

    const t = ctx.session.kanbanTasks[0]!;
    expect(t.column).toBe("todo");
    expect(t.estimatedMinutes).toBe(0);
    expect(loadTasks()[0]!.column).toBe("todo");
  });
});

describe("kanbanMove handler", () => {
  let ctx: ReturnType<typeof makeRequester>;

  beforeEach(() => {
    ctx = makeRequester();
  });

  it("done に移動すると、紐づく time KPI に timeSpent が加算され、kpiContributed=true になる", async () => {
    ctx.session.goals.push(makeGoalWithTimeKpi("goal-1", "kpi-1", 0));
    ctx.session.kanbanTasks.push(
      makeTask({
        id: "t1",
        title: "対象タスク",
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
        title: "対象タスク",
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
        title: "対象",
        column: "in_progress",
        goalId: "goal-1",
        kpiId: "kpi-1",
        timeSpent: 300,
      }),
      makeTask({
        id: "other",
        title: "他人",
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
    ctx.session.kanbanTasks.push(
      makeTask({ id: "t1", title: "残るタスク", column: "todo" })
    );

    await kanbanMove(ctx.ws, ctx.session, { taskId: "nonexistent", column: "done" });

    expect(ctx.session.kanbanTasks[0]!.column).toBe("todo");
    expect(ctx.sent.map((m) => m.type)).toContain("kanban_sync");
  });

  it("不正な column が指定されても既存列を壊さない", async () => {
    ctx.session.kanbanTasks.push(
      makeTask({ id: "t1", title: "残るタスク", column: "in_progress" })
    );

    await kanbanMove(ctx.ws, ctx.session, { taskId: "t1", column: "blocked" });

    expect(ctx.session.kanbanTasks[0]!.column).toBe("in_progress");
    expect(loadTasks()[0]!.column).toBe("in_progress");
  });
});

describe("kanbanEdit handler", () => {
  let ctx: ReturnType<typeof makeRequester>;

  beforeEach(() => {
    ctx = makeRequester();
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
      makeTask({
        id: "t1",
        title: "タスク",
        goalId: "goal-1",
        kpiId: "kpi-1",
      })
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
        title: "完了タスク",
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

  it("不正な数値・timeLogs は保存前に正規化される", async () => {
    ctx.session.kanbanTasks.push(
      makeTask({
        id: "t1",
        title: "タスク",
        estimatedMinutes: 10,
        timeSpent: 120,
      })
    );

    await kanbanEdit(ctx.ws, ctx.session, {
      taskId: "t1",
      estimatedMinutes: Number.NaN,
      timeSpent: -60,
      timeLogs: [
        { start: "2026-04-25T09:00:00", end: "2026-04-25T09:10:00", duration: 600.9 },
        { start: "invalid", duration: 30 },
        "not-a-log",
      ],
    });

    const t = ctx.session.kanbanTasks[0]!;
    expect(t.estimatedMinutes).toBe(0);
    expect(t.timeSpent).toBe(0);
    expect(t.timeLogs).toEqual([
      {
        start: "2026-04-25T09:00:00",
        end: "2026-04-25T09:10:00",
        duration: 600,
      },
    ]);
  });

  it("タイマー開始時、他タスクの実行中タイマーはサーバー側でも停止される", async () => {
    const startedAt = formatLocalIso(new Date(Date.now() - 60_000));
    const target = makeTask({ id: "target", title: "開始する", column: "todo" });
    const running = makeTask({
      id: "running",
      title: "止める",
      column: "in_progress",
      timerStartedAt: startedAt,
      timeSpent: 30,
    });
    const untouched = makeTask({
      id: "untouched",
      title: "無関係",
      column: "todo",
      timeSpent: 10,
    });
    ctx.session.kanbanTasks = [target, running, untouched];

    await kanbanEdit(ctx.ws, ctx.session, {
      taskId: "target",
      timerStartedAt: formatLocalIso(new Date()),
    });

    const byId = new Map(ctx.session.kanbanTasks.map((t) => [t.id, t]));
    expect(byId.get("target")!.timerStartedAt).not.toBe("");
    expect(byId.get("running")!.timerStartedAt).toBe("");
    expect(byId.get("running")!.timeSpent).toBeGreaterThanOrEqual(30);
    expect(byId.get("running")!.timeLogs).toHaveLength(1);
    expect(byId.get("untouched")!.timeSpent).toBe(10);
  });

  it("存在しない taskId の timerStartedAt では既存タイマーを止めない", async () => {
    const startedAt = formatLocalIso(new Date(Date.now() - 60_000));
    ctx.session.kanbanTasks = [
      makeTask({
        id: "running",
        title: "実行中",
        column: "in_progress",
        timerStartedAt: startedAt,
        timeSpent: 30,
      }),
    ];

    await kanbanEdit(ctx.ws, ctx.session, {
      taskId: "ghost",
      timerStartedAt: formatLocalIso(new Date()),
    });

    const running = ctx.session.kanbanTasks[0]!;
    expect(running.timerStartedAt).toBe(startedAt);
    expect(running.timeSpent).toBe(30);
    expect(running.timeLogs).toEqual([]);
  });
});

describe("kanbanDelete handler", () => {
  let ctx: ReturnType<typeof makeRequester>;

  beforeEach(() => {
    ctx = makeRequester();
  });

  it("kpiContributed なタスクを削除すると KPI から timeSpent が引かれる", async () => {
    ctx.session.goals.push(makeGoalWithTimeKpi("goal-1", "kpi-1", 1200));
    ctx.session.kanbanTasks.push(
      makeTask({
        id: "t1",
        title: "削除するタスク",
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
      makeTask({
        id: "t2",
        title: "残す",
        column: "in_progress",
        timeSpent: 60,
      })
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
    ctx = makeRequester();
  });

  it("taskIds の順序通りに並び替わる", async () => {
    ctx.session.kanbanTasks.push(
      makeTask({ id: "a", title: "A" }),
      makeTask({ id: "b", title: "B" }),
      makeTask({ id: "c", title: "C" })
    );

    await kanbanReorder(ctx.ws, ctx.session, { taskIds: ["c", "a", "b"] });

    expect(ctx.session.kanbanTasks.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("taskIds に含まれないタスクは末尾に温存される", async () => {
    ctx.session.kanbanTasks.push(
      makeTask({ id: "a", title: "A" }),
      makeTask({ id: "b", title: "B" }),
      makeTask({ id: "c", title: "C" })
    );

    await kanbanReorder(ctx.ws, ctx.session, { taskIds: ["c"] });

    expect(ctx.session.kanbanTasks.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("重複した id は1回だけ反映され、未知の id は無視される", async () => {
    ctx.session.kanbanTasks.push(
      makeTask({ id: "a", title: "A" }),
      makeTask({ id: "b", title: "B" })
    );

    await kanbanReorder(ctx.ws, ctx.session, {
      taskIds: ["a", "a", "ghost", "b"],
    });

    expect(ctx.session.kanbanTasks.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("非配列入力でも落ちずに既存順序が温存される", async () => {
    ctx.session.kanbanTasks.push(
      makeTask({ id: "a", title: "A" }),
      makeTask({ id: "b", title: "B" })
    );

    await kanbanReorder(ctx.ws, ctx.session, { taskIds: "not-an-array" });

    expect(ctx.session.kanbanTasks.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("列移動と並び替えを同じ同期で反映する", async () => {
    const todo = makeTask({ id: "todo-1", title: "TODO", column: "todo" });
    const doing = makeTask({
      id: "doing-1",
      title: "進行中",
      column: "in_progress",
    });
    ctx.session.kanbanTasks = [todo, doing];

    await kanbanReorder(ctx.ws, ctx.session, {
      taskIds: ["todo-1", "doing-1"],
      move: { taskId: "todo-1", column: "in_progress", completedAt: "" },
    });

    expect(ctx.session.kanbanTasks.map((t) => [t.id, t.column])).toEqual([
      ["todo-1", "in_progress"],
      ["doing-1", "in_progress"],
    ]);
    expect(loadTasks().map((t) => [t.id, t.column])).toEqual([
      ["todo-1", "in_progress"],
      ["doing-1", "in_progress"],
    ]);
    expect(ctx.sent).toHaveLength(2);
    expect(ctx.sent[0]).toMatchObject({
      type: "kanban_sync",
      tasks: [
        { id: "todo-1", column: "in_progress" },
        { id: "doing-1", column: "in_progress" },
      ],
    });
    expect(ctx.sent[1]).toMatchObject({ type: "goal_sync", goals: [] });
  });

  it("関係ないタスクは列も順序も壊さない", async () => {
    const todo = makeTask({ id: "todo-1", title: "TODO", column: "todo" });
    const doing = makeTask({
      id: "doing-1",
      title: "進行中",
      column: "in_progress",
    });
    const done = makeTask({
      id: "done-1",
      title: "完了",
      column: "done",
      completedAt: "2026-04-24T09:00:00",
    });
    ctx.session.kanbanTasks = [todo, doing, done];

    await kanbanReorder(ctx.ws, ctx.session, {
      taskIds: ["doing-1", "todo-1", "done-1"],
    });

    expect(ctx.session.kanbanTasks).toEqual([doing, todo, done]);
  });
});
