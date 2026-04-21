import { activeSockets, type AppWebSocket } from "../state.ts";

export function sendTo(ws: AppWebSocket, msg: unknown): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    activeSockets.delete(ws);
  }
}

export function broadcast(msg: unknown): void {
  const payload = JSON.stringify(msg);
  for (const ws of [...activeSockets]) {
    try {
      ws.send(payload);
    } catch {
      activeSockets.delete(ws);
    }
  }
}
