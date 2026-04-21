import { pendingApprovals, type AppWebSocket } from "../state.ts";
import { sendTo } from "../ws/broadcast.ts";
import { shortId } from "../utils/shortId.ts";

interface PermissionResultAllow {
  behavior: "allow";
  updatedInput: Record<string, unknown>;
}

export async function handleAskUserViaWS(
  ws: AppWebSocket,
  toolInput: Record<string, unknown>
): Promise<PermissionResultAllow> {
  const requestId = `ask_${shortId()}_${Date.now()}`;
  const questions = toolInput.questions ?? [];
  sendTo(ws, { type: "ask_user", requestId, questions });
  const answers = await new Promise<Record<string, unknown>>((resolve, reject) => {
    pendingApprovals.set(requestId, {
      resolve: (v) => resolve(v.answers ?? {}),
      reject,
    });
  }).finally(() => {
    pendingApprovals.delete(requestId);
  });
  return {
    behavior: "allow",
    updatedInput: { questions, answers },
  };
}
