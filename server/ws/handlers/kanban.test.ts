import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDb, resetDbCache } from "../../db.ts";
import { createSessionState, type AppWebSocket } from "../../state.ts";
import { loadTasks } from "../../storage/kanban.ts";
import type { KanbanTask } from "../../types.ts";
import { kanbanReorder } from "./kanban.ts";

interface SentMessage {
  type: string;
  [k: string]: unknown;
}

function makeTask(
  partial: Partial<KanbanTask> & Pick<KanbanTask, "id" | "title">,
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

function makeFakeWs(): { ws: AppWebSocket; sent: SentMessage[] } {
  const sent: SentMessage[] = [];
  const fake = {
    data: { id: "test-ws", session: createSessionState() },
    send(payload: string) {
      sent.push(JSON.parse(payload) as SentMessage);
    },
  } as unknown as AppWebSocket;
  return { ws: fake, sent };
}

beforeEach(() => {
  resetDbCache();
  const db = getDb();
  db.exec("DELETE FROM kanban_tasks");
  db.exec("DELETE FROM goals");
});

afterEach(() => {
  resetDbCache();
});

describe("kanbanReorder", () => {
  it("列移動と並び替えを同じ同期で反映する", async () => {
    const { ws, sent } = makeFakeWs();
    const todo = makeTask({ id: "todo-1", title: "TODO", column: "todo" });
    const doing = makeTask({
      id: "doing-1",
      title: "進行中",
      column: "in_progress",
    });
    ws.data.session.kanbanTasks = [todo, doing];

    await kanbanReorder(ws, ws.data.session, {
      taskIds: ["todo-1", "doing-1"],
      move: { taskId: "todo-1", column: "in_progress", completedAt: "" },
    });

    expect(ws.data.session.kanbanTasks.map((t) => [t.id, t.column])).toEqual([
      ["todo-1", "in_progress"],
      ["doing-1", "in_progress"],
    ]);
    expect(loadTasks().map((t) => [t.id, t.column])).toEqual([
      ["todo-1", "in_progress"],
      ["doing-1", "in_progress"],
    ]);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      type: "kanban_sync",
      tasks: [
        { id: "todo-1", column: "in_progress" },
        { id: "doing-1", column: "in_progress" },
      ],
    });
    expect(sent[1]).toMatchObject({ type: "goal_sync", goals: [] });
  });

  it("関係ないタスクは列も順序も壊さない", async () => {
    const { ws } = makeFakeWs();
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
    ws.data.session.kanbanTasks = [todo, doing, done];

    await kanbanReorder(ws, ws.data.session, {
      taskIds: ["doing-1", "todo-1", "done-1"],
    });

    expect(ws.data.session.kanbanTasks).toEqual([doing, todo, done]);
  });
});
