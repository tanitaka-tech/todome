import { scheduleAutosync } from "../../github/autosync.ts";
import { normalizeProfile, saveProfile } from "../../storage/profile.ts";
import { broadcast, sendTo } from "../broadcast.ts";
import type { Handler } from "../dispatch.ts";

export const profileUpdate: Handler = async (ws, session, data) => {
  session.profile = normalizeProfile(data.profile);
  saveProfile(session.profile);
  scheduleAutosync();
  broadcast({ type: "profile_sync", profile: session.profile });
};

export const clearSession: Handler = async (ws, session) => {
  const prev = session.client as { close?: () => Promise<void> } | null;
  if (prev?.close) {
    try {
      await prev.close();
    } catch {
      // ignore
    }
  }
  session.client = null;
  session.cancelRequested = false;
  sendTo(ws, { type: "session_cleared" });
};
