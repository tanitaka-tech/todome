import type { AppWebSocket, SessionState } from "../state.ts";

export type Handler = (
  ws: AppWebSocket,
  session: SessionState,
  data: Record<string, unknown>
) => Promise<void>;

export const MESSAGE_HANDLERS = new Map<string, Handler>();

export function registerHandler(type: string, handler: Handler): void {
  MESSAGE_HANDLERS.set(type, handler);
}
