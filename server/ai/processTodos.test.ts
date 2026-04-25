import { describe, expect, it } from "bun:test";
import type { Goal, KanbanTask, UserProfile } from "../types.ts";
import { processTodos } from "./processTodos.ts";


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

function makeProfile(partial: Partial<UserProfile> = {}): UserProfile {
  return {
    currentState: "平常運転",
    balanceWheel: [],
    actionPrinciples: [{ id: "p1", text: "小さく始める" }],
    wantToDo: [{ id: "w1", text: "読書" }],
    timezone: "",
    ...partial,
  };
}

const BASE_TASKS: KanbanTask[] = [
  makeTask({ id: "t1", title: "既存タスクA", column: "todo", memo: "メモA" }),
  makeTask({ id: "t2", title: "既存タスクB", column: "in_progress", timeSpent: 120 }),
];

const BASE_GOALS: Goal[] = [
  makeGoal({
    id: "g1",
    name: "既存目標X",
    memo: "メモX",
    kpis: [
      { id: "k1", name: "進捗", unit: "percent", targetValue: 100, currentValue: 40 },
    ],
  }),
];

describe("processTodos — データ分離保証 (regression: 目標追加でタスクが消えない)", () => {
  it("GOAL_ADDのみ: タスク・プロフィールは不変、目標のみ追加される", () => {
    const profile = makeProfile();
    const result = processTodos(
      [
        {
          content:
            'GOAL_ADD:{"name":"新目標","memo":"mm","kpis":[{"name":"売上","unit":"number","targetValue":1000,"currentValue":0}],"deadline":"2026-12-31"}',
          status: "completed",
        },
      ],
      BASE_TASKS,
      BASE_GOALS,
      profile
    );

    expect(result.tasks).toEqual(BASE_TASKS);
    expect(result.profile).toBe(profile);
    expect(result.goals).toHaveLength(BASE_GOALS.length + 1);
    expect(result.goals[0]).toEqual(BASE_GOALS[0]!);
    expect(result.goals[1]?.name).toBe("新目標");
    expect(result.goals[1]?.kpis[0]?.id).toBeTruthy();
  });

  it("GOAL_UPDATEのみ: タスク・プロフィール・他の目標は不変、対象目標のみ更新", () => {
    const profile = makeProfile();
    const goals = [
      ...BASE_GOALS,
      makeGoal({ id: "g2", name: "別目標", memo: "そのまま" }),
    ];
    const result = processTodos(
      [
        {
          content: 'GOAL_UPDATE:既存目標X:{"memo":"更新済み"}',
          status: "completed",
        },
      ],
      BASE_TASKS,
      goals,
      profile
    );

    expect(result.tasks).toEqual(BASE_TASKS);
    expect(result.profile).toBe(profile);
    expect(result.goals).toHaveLength(2);
    expect(result.goals[0]?.name).toBe("既存目標X");
    expect(result.goals[0]?.memo).toBe("更新済み");
    expect(result.goals[1]).toEqual(goals[1]!);
  });

  it("PROFILE_UPDATEのみ: タスク・目標は不変、プロフィールのみ更新", () => {
    const result = processTodos(
      [
        {
          content:
            'PROFILE_UPDATE:{"currentState":"集中モード","actionPrinciples":[{"id":"p1","text":"小さく始める"},{"id":"p2","text":"毎日進める"}]}',
          status: "completed",
        },
      ],
      BASE_TASKS,
      BASE_GOALS,
      makeProfile()
    );

    expect(result.tasks).toEqual(BASE_TASKS);
    expect(result.goals).toEqual(BASE_GOALS);
    expect(result.profile.currentState).toBe("集中モード");
    expect(result.profile.actionPrinciples).toHaveLength(2);
    expect(result.profile.wantToDo).toEqual([{ id: "w1", text: "読書" }]);
  });

  it("タスクエントリのみ: 目標・プロフィールは不変、タスクのみ置換", () => {
    const profile = makeProfile();
    const result = processTodos(
      [
        { content: "既存タスクA", status: "completed" },
        { content: "新タスクC", status: "pending" },
      ],
      BASE_TASKS,
      BASE_GOALS,
      profile
    );

    expect(result.goals).toEqual(BASE_GOALS);
    expect(result.profile).toBe(profile);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]?.id).toBe("t1");
    expect(result.tasks[0]?.column).toBe("done");
    expect(result.tasks[0]?.memo).toBe("メモA");
    expect(result.tasks[1]?.title).toBe("新タスクC");
    expect(result.tasks[1]?.column).toBe("todo");
    expect(result.tasks.map((t) => t.title)).not.toContain("既存タスクB");
  });

  it("空のtodos配列: タスク・目標・プロフィールすべて温存", () => {
    const profile = makeProfile();
    const result = processTodos([], BASE_TASKS, BASE_GOALS, profile);

    expect(result.tasks).toEqual(BASE_TASKS);
    expect(result.goals).toEqual(BASE_GOALS);
    expect(result.profile).toBe(profile);
  });

  it("todosが配列でない: すべて温存", () => {
    const profile = makeProfile();
    const result = processTodos(null, BASE_TASKS, BASE_GOALS, profile);

    expect(result.tasks).toEqual(BASE_TASKS);
    expect(result.goals).toEqual(BASE_GOALS);
    expect(result.profile).toBe(profile);
  });

  it("特殊エントリだけが並んでも (GOAL_ADD + PROFILE_UPDATE + GOAL_UPDATE)、タスクは温存される", () => {
    const result = processTodos(
      [
        {
          content:
            'GOAL_ADD:{"name":"新目標","kpis":[{"name":"件数","unit":"number","targetValue":10,"currentValue":0}]}',
          status: "completed",
        },
        {
          content: 'GOAL_UPDATE:既存目標X:{"memo":"更新"}',
          status: "completed",
        },
        {
          content: 'PROFILE_UPDATE:{"currentState":"走行中"}',
          status: "completed",
        },
      ],
      BASE_TASKS,
      BASE_GOALS,
      makeProfile()
    );

    expect(result.tasks).toEqual(BASE_TASKS);
    expect(result.goals).toHaveLength(2);
    expect(result.goals[0]?.memo).toBe("更新");
    expect(result.goals[1]?.name).toBe("新目標");
    expect(result.profile.currentState).toBe("走行中");
  });

  it("タスク+GOAL_ADD混在: タスク再構築と目標追加の両方が反映される", () => {
    const result = processTodos(
      [
        { content: "既存タスクA", status: "in_progress" },
        { content: "既存タスクB", status: "completed" },
        { content: "新タスクC", status: "pending" },
        {
          content:
            'GOAL_ADD:{"name":"新目標","kpis":[{"name":"件数","unit":"number","targetValue":10,"currentValue":0}]}',
          status: "completed",
        },
      ],
      BASE_TASKS,
      BASE_GOALS,
      makeProfile()
    );

    expect(result.tasks).toHaveLength(3);
    expect(result.tasks.map((t) => t.title)).toEqual([
      "既存タスクA",
      "既存タスクB",
      "新タスクC",
    ]);
    expect(result.tasks[0]?.column).toBe("in_progress");
    expect(result.tasks[1]?.column).toBe("done");
    expect(result.goals).toHaveLength(2);
    expect(result.goals[1]?.name).toBe("新目標");
  });

  it("GOAL_UPDATEが未知の目標名を指定: 目標は変わらない", () => {
    const result = processTodos(
      [{ content: 'GOAL_UPDATE:存在しない目標:{"memo":"x"}', status: "completed" }],
      BASE_TASKS,
      BASE_GOALS,
      makeProfile()
    );

    expect(result.goals).toEqual(BASE_GOALS);
    expect(result.tasks).toEqual(BASE_TASKS);
  });

  it("GOAL_ADDのJSONが壊れている: 何も追加されずタスクも温存", () => {
    const result = processTodos(
      [{ content: "GOAL_ADD:{this is not json", status: "completed" }],
      BASE_TASKS,
      BASE_GOALS,
      makeProfile()
    );

    expect(result.goals).toEqual(BASE_GOALS);
    expect(result.tasks).toEqual(BASE_TASKS);
  });

  it("引数の配列を破壊的に変更しない (immutability)", () => {
    const tasks = [...BASE_TASKS];
    const goals = [...BASE_GOALS];
    const tasksSnapshot = JSON.stringify(tasks);
    const goalsSnapshot = JSON.stringify(goals);

    processTodos(
      [
        { content: "新タスク", status: "pending" },
        {
          content:
            'GOAL_ADD:{"name":"追加目標","kpis":[{"name":"k","unit":"number","targetValue":1,"currentValue":0}]}',
          status: "completed",
        },
      ],
      tasks,
      goals,
      makeProfile()
    );

    expect(JSON.stringify(tasks)).toBe(tasksSnapshot);
    expect(JSON.stringify(goals)).toBe(goalsSnapshot);
  });

  it("GOAL_ADD + pending/in_progress のみ再送 (AIが done を落とす): done タスクは温存される", () => {
    const tasksWithDone: KanbanTask[] = [
      makeTask({ id: "t1", title: "既存タスクA", column: "todo" }),
      makeTask({ id: "t2", title: "既存タスクB", column: "in_progress" }),
      makeTask({ id: "t3", title: "完了タスクC", column: "done", memo: "done-memo" }),
      makeTask({ id: "t4", title: "完了タスクD", column: "done" }),
    ];
    const result = processTodos(
      [
        { content: "既存タスクA", status: "pending" },
        { content: "既存タスクB", status: "in_progress" },
        {
          content:
            'GOAL_ADD:{"name":"新目標","kpis":[{"name":"件数","unit":"number","targetValue":10,"currentValue":0}]}',
          status: "completed",
        },
      ],
      tasksWithDone,
      BASE_GOALS,
      makeProfile()
    );

    const titles = result.tasks.map((t) => t.title);
    expect(titles).toContain("完了タスクC");
    expect(titles).toContain("完了タスクD");
    expect(titles).toContain("既存タスクA");
    expect(titles).toContain("既存タスクB");
    const preservedC = result.tasks.find((t) => t.title === "完了タスクC");
    expect(preservedC?.id).toBe("t3");
    expect(preservedC?.column).toBe("done");
    expect(preservedC?.memo).toBe("done-memo");
    expect(result.goals).toHaveLength(2);
    expect(result.goals[1]?.name).toBe("新目標");
  });

  it("done タスクを todos に完了として再掲した場合は二重追加にならない", () => {
    const tasksWithDone: KanbanTask[] = [
      makeTask({ id: "t1", title: "完了タスクC", column: "done", memo: "keep" }),
    ];
    const result = processTodos(
      [
        { content: "完了タスクC", status: "completed" },
        { content: "新タスクE", status: "pending" },
      ],
      tasksWithDone,
      BASE_GOALS,
      makeProfile()
    );

    const doneCopies = result.tasks.filter((t) => t.title === "完了タスクC");
    expect(doneCopies).toHaveLength(1);
    expect(doneCopies[0]?.id).toBe("t1");
    expect(doneCopies[0]?.memo).toBe("keep");
    expect(doneCopies[0]?.column).toBe("done");
  });

  it("done タスクを pending に戻すと done には残らない (明示的な移動は尊重)", () => {
    const tasksWithDone: KanbanTask[] = [
      makeTask({ id: "t1", title: "完了タスクC", column: "done" }),
    ];
    const result = processTodos(
      [{ content: "完了タスクC", status: "pending" }],
      tasksWithDone,
      BASE_GOALS,
      makeProfile()
    );

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.title).toBe("完了タスクC");
    expect(result.tasks[0]?.column).toBe("todo");
  });

  it("[GOAL:<id>]プレフィックス付きタスク: goalIdが抽出され本体からは除去される", () => {
    const result = processTodos(
      [{ content: "[GOAL:g1] 企画書を作成", status: "pending" }],
      [],
      BASE_GOALS,
      makeProfile()
    );

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.title).toBe("企画書を作成");
    expect(result.tasks[0]?.goalId).toBe("g1");
  });
});
