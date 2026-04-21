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
import { MESSAGE_HANDLERS } from "./dispatch.ts";
import { loadSessionState, sendInitialState } from "./initialState.ts";

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
    } catch {
      return;
    }
    if (wsNeedsReload.has(ws)) {
      wsNeedsReload.delete(ws);
      ws.data.session.kanbanTasks = loadTasks();
      ws.data.session.goals = loadGoals();
      ws.data.session.profile = loadProfile();
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
      return;
    }
    try {
      await handler(ws, ws.data.session, data);
    } catch (err) {
      console.error(`[ws] handler ${type} failed:`, err);
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
