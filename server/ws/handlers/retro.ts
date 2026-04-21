import { scheduleAutosync } from "../../github/autosync.ts";
import {
  RETRO_DOC_TEXT_KEYS,
  RETRO_DOC_TIME_KEYS,
  RETRO_TYPES,
  computeRetroPeriod,
  isValidHHMM,
  retroWelcomeText,
} from "../../ai/retroPrompt.ts";
import {
  finalizeRetro,
  runRetroReopenGreeting,
  runRetroTurn,
} from "../../ai/retroRunner.ts";
import {
  deleteRetroById,
  getRetro,
  loadRetros,
  saveRetro,
} from "../../storage/retro.ts";
import { shortId } from "../../utils/shortId.ts";
import type { Retrospective, RetroDocument, RetroType } from "../../types.ts";
import { broadcast, sendTo } from "../broadcast.ts";
import type { Handler } from "../dispatch.ts";

function nowIso(): string {
  return new Date().toISOString().slice(0, 19);
}

export const retroStart: Handler = async (ws, session, data) => {
  let retroType = (data.retroType as string) || "weekly";
  if (!RETRO_TYPES.includes(retroType as RetroType)) retroType = "weekly";
  const resumeId = typeof data.resumeDraftId === "string" ? data.resumeDraftId : "";
  const anchorRaw =
    typeof data.anchorDate === "string" ? data.anchorDate.trim() : "";
  let anchorDate: Date | undefined;
  if (anchorRaw) {
    const parsed = new Date(`${anchorRaw}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) anchorDate = parsed;
  }

  let retroEntry: Retrospective | null = null;
  if (resumeId) {
    const found = getRetro(resumeId);
    if (found && !found.completedAt) retroEntry = found;
  }
  if (!retroEntry) {
    const { start, end } = computeRetroPeriod(retroType as RetroType, anchorDate);
    const now = nowIso();
    const welcome = retroWelcomeText(retroType as RetroType, start, end);
    retroEntry = {
      id: `${shortId()}${shortId()}`,
      type: retroType as RetroType,
      periodStart: start,
      periodEnd: end,
      document: {
        did: "",
        learned: "",
        next: "",
        dayRating: 0,
        wakeUpTime: "",
        bedtime: "",
      },
      messages: [{ role: "assistant", text: welcome }],
      aiComment: "",
      completedAt: "",
      createdAt: now,
      updatedAt: now,
    };
    session.pendingRetros.set(retroEntry.id, retroEntry);
  }
  sendTo(ws, { type: "retro_sync", retro: retroEntry });
};

export const retroMessage: Handler = async (ws, session, data) => {
  const retroId = typeof data.retroId === "string" ? data.retroId : "";
  const userText =
    typeof data.text === "string" ? data.text.trim() : "";
  if (!retroId || !userText) return;
  const entry = getRetro(retroId) ?? session.pendingRetros.get(retroId) ?? null;
  if (!entry || entry.completedAt) {
    sendTo(ws, { type: "retro_error", message: "セッションが見つかりません" });
    return;
  }
  sendTo(ws, { type: "retro_session_waiting", waiting: true });
  try {
    const updated = await runRetroTurn(
      ws,
      entry,
      userText,
      session.kanbanTasks,
      session.goals,
      session.profile
    );
    const persisted = getRetro(retroId) !== null;
    if (persisted) {
      session.pendingRetros.delete(retroId);
      sendTo(ws, { type: "retro_list_sync", retros: loadRetros() });
    } else {
      session.pendingRetros.set(retroId, updated);
    }
  } catch (err) {
    console.error("retro turn error:", err);
    sendTo(ws, {
      type: "retro_error",
      message: `AI応答中にエラーが発生しました: ${err instanceof Error ? err.message : String(err)}`,
    });
  } finally {
    sendTo(ws, { type: "retro_session_waiting", waiting: false });
  }
};

export const retroComplete: Handler = async (ws, session, data) => {
  const retroId = typeof data.retroId === "string" ? data.retroId : "";
  const entry = getRetro(retroId) ?? session.pendingRetros.get(retroId) ?? null;
  if (!entry) {
    sendTo(ws, { type: "retro_error", message: "セッションが見つかりません" });
    return;
  }
  if (entry.completedAt) {
    sendTo(ws, { type: "retro_completed", retro: entry });
    return;
  }
  sendTo(ws, { type: "retro_session_waiting", waiting: true });
  try {
    await finalizeRetro(
      ws,
      entry,
      session.kanbanTasks,
      session.goals,
      session.profile
    );
    session.pendingRetros.delete(retroId);
    sendTo(ws, { type: "retro_list_sync", retros: loadRetros() });
  } catch (err) {
    console.error("retro complete error:", err);
    sendTo(ws, {
      type: "retro_error",
      message: `完了処理中にエラーが発生しました: ${err instanceof Error ? err.message : String(err)}`,
    });
  } finally {
    sendTo(ws, { type: "retro_session_waiting", waiting: false });
  }
};

export const retroReopen: Handler = async (ws, session, data) => {
  const retroId = typeof data.retroId === "string" ? data.retroId : "";
  const entry = getRetro(retroId);
  if (!entry || !entry.completedAt) {
    sendTo(ws, {
      type: "retro_error",
      message: "完了済みの振り返りが見つかりません",
    });
    return;
  }
  const now = nowIso();
  let reopened: Retrospective = {
    ...entry,
    completedAt: "",
    aiComment: "",
    messages: [],
    updatedAt: now,
  };
  saveRetro(reopened);
  scheduleAutosync();
  sendTo(ws, { type: "retro_sync", retro: reopened });
  sendTo(ws, { type: "retro_session_waiting", waiting: true });
  try {
    reopened = await runRetroReopenGreeting(
      ws,
      reopened,
      session.kanbanTasks,
      session.goals,
      session.profile
    );
    broadcast({ type: "retro_list_sync", retros: loadRetros() });
  } catch (err) {
    console.error("retro reopen greeting error:", err);
    sendTo(ws, {
      type: "retro_error",
      message: `再開時の挨拶生成中にエラーが発生しました: ${err instanceof Error ? err.message : String(err)}`,
    });
  } finally {
    sendTo(ws, { type: "retro_session_waiting", waiting: false });
  }
};

export const retroEditDocument: Handler = async (ws, session, data) => {
  const retroId = typeof data.retroId === "string" ? data.retroId : "";
  if (!retroId) return;
  const entry = getRetro(retroId) ?? session.pendingRetros.get(retroId) ?? null;
  if (!entry) {
    sendTo(ws, { type: "retro_error", message: "セッションが見つかりません" });
    return;
  }
  const updatedDoc: RetroDocument = { ...entry.document };
  const docUpdate = data.document;
  if (docUpdate && typeof docUpdate === "object") {
    const up = docUpdate as Record<string, unknown>;
    for (const key of RETRO_DOC_TEXT_KEYS) {
      if (key in up && typeof up[key] === "string") {
        updatedDoc[key] = up[key] as string;
      }
    }
    if ("dayRating" in up) {
      const v = up.dayRating;
      if (typeof v === "number") {
        const iv = Math.trunc(v);
        if (iv >= 0 && iv <= 10) updatedDoc.dayRating = iv;
      }
    }
    for (const key of RETRO_DOC_TIME_KEYS) {
      if (!(key in up)) continue;
      const v = up[key];
      if (typeof v !== "string") continue;
      const stripped = v.trim();
      if (stripped === "" || isValidHHMM(stripped)) {
        updatedDoc[key] = stripped;
      }
    }
  }

  const aiCommentUpdate = data.aiComment;
  const newAiComment =
    typeof aiCommentUpdate === "string" ? aiCommentUpdate : entry.aiComment;

  const updated: Retrospective = {
    ...entry,
    document: updatedDoc,
    aiComment: newAiComment,
    updatedAt: nowIso(),
  };

  const docForCheck = updated.document;
  const textFilled = RETRO_DOC_TEXT_KEYS.some(
    (k) => (docForCheck[k] ?? "").trim() !== ""
  );
  const timeFilled = RETRO_DOC_TIME_KEYS.some(
    (k) => (docForCheck[k] ?? "").trim() !== ""
  );
  const hasContent =
    textFilled ||
    Boolean(docForCheck.dayRating) ||
    timeFilled ||
    (updated.aiComment ?? "").trim() !== "";
  const wasPersisted = getRetro(retroId) !== null;

  if (hasContent) {
    saveRetro(updated);
    session.pendingRetros.delete(retroId);
    scheduleAutosync();
  } else if (wasPersisted) {
    deleteRetroById(retroId);
    session.pendingRetros.set(retroId, updated);
    scheduleAutosync();
  } else {
    session.pendingRetros.set(retroId, updated);
  }

  broadcast({ type: "retro_list_sync", retros: loadRetros() });
  sendTo(ws, { type: "retro_sync", retro: updated });
};

export const retroCloseSession: Handler = async (ws) => {
  sendTo(ws, { type: "retro_session_closed" });
};
