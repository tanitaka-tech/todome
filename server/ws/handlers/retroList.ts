import { scheduleAutosync } from "../../github/autosync.ts";
import { deleteRetroById, loadRetros } from "../../storage/retro.ts";
import { broadcast, sendTo } from "../broadcast.ts";
import type { Handler } from "../dispatch.ts";

export const retroList: Handler = async (ws) => {
  sendTo(ws, { type: "retro_list_sync", retros: loadRetros() });
};

export const retroDiscardDraft: Handler = async (ws, session, data) => {
  const draftId = String(data.draftId ?? "");
  if (draftId) {
    session.pendingRetros.delete(draftId);
    deleteRetroById(draftId);
    scheduleAutosync();
  }
  sendTo(ws, { type: "retro_list_sync", retros: loadRetros() });
};

export const retroDelete: Handler = async (_ws, session, data) => {
  const retroId = String(data.retroId ?? "");
  if (retroId) {
    session.pendingRetros.delete(retroId);
    deleteRetroById(retroId);
    scheduleAutosync();
  }
  broadcast({ type: "retro_list_sync", retros: loadRetros() });
};
