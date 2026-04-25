import { shortId } from "../utils/shortId.ts";
import {
  activeSockets,
  createSessionState,
  pendingApprovals,
  wsNeedsReload,
  type AppWebSocket,
  type WSData,
} from "../state.ts";
import { loadGoals } from "../storage/goals.ts";
import { loadTasks } from "../storage/kanban.ts";
import { loadProfile } from "../storage/profile.ts";
import { loadSchedules } from "../storage/schedule.ts";
import { loadSubscriptions } from "../storage/subscription.ts";
import { sendTo } from "./broadcast.ts";
import { MESSAGE_HANDLERS } from "./dispatch.ts";
import { loadSessionState, sendInitialState } from "./initialState.ts";

// Error.message のみを返す。任意 throw されたオブジェクトを JSON.stringify すると
// 内部プロパティがそのままクライアントへ漏れるため、非 Error は固定文字列で塞ぐ。
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "internal error";
}

export const wsHandlers = {
  async open(ws: AppWebSocket) {
    activeSockets.add(ws);
    loadSessionState(ws.data.session);
    await sendInitialState(ws, ws.data.session);
  },

  async message(ws: AppWebSocket, raw: string | Buffer) {
    let data: Record<string, unknown>;
    try {
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      data = JSON.parse(text) as Record<string, unknown>;
    } catch (err) {
      console.error("[ws] malformed JSON:", err);
      sendTo(ws, {
        type: "error",
        scope: "parse",
        message: "受信メッセージの JSON パースに失敗しました",
      });
      return;
    }
    if (wsNeedsReload.has(ws)) {
      wsNeedsReload.delete(ws);
      ws.data.session.kanbanTasks = loadTasks();
      ws.data.session.goals = loadGoals();
      ws.data.session.profile = loadProfile();
      ws.data.session.schedules = loadSchedules();
      ws.data.session.subscriptions = loadSubscriptions();
    }
    const type = typeof data.type === "string" ? data.type : "";

    if (type === "ask_response") {
      const requestId = typeof data.requestId === "string" ? data.requestId : "";
      const pending = pendingApprovals.get(requestId);
      if (pending) {
        pendingApprovals.delete(requestId);
        const answers =
          data.answers && typeof data.answers === "object"
            ? (data.answers as Record<string, unknown>)
            : {};
        pending.resolve({ answers });
      }
      return;
    }

    if (type === "cancel") {
      ws.data.session.cancelRequested = true;
      return;
    }

    const handler = MESSAGE_HANDLERS.get(type);
    if (!handler) {
      console.warn(`[ws] unknown message type: ${type}`);
      sendTo(ws, {
        type: "error",
        scope: "unknown_type",
        requestType: type,
        message: `未知のメッセージ種別: ${type || "(empty)"}`,
      });
      return;
    }
    try {
      await handler(ws, ws.data.session, data);
    } catch (err) {
      console.error(`[ws] handler ${type} failed:`, err);
      sendTo(ws, {
        type: "error",
        scope: "handler",
        requestType: type,
        message: errorMessage(err),
      });
    }
  },

  close(ws: AppWebSocket) {
    activeSockets.delete(ws);
    const client = ws.data.session.client as { close?: () => Promise<void> } | null;
    if (client?.close) {
      void client.close().catch(() => {});
    }
    ws.data.session.client = null;
  },
};

export function makeWSData(): WSData {
  return {
    id: shortId(),
    session: createSessionState(),
  };
}
