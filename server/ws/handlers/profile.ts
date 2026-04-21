import { scheduleAutosync } from "../../github/autosync.ts";
import { DEFAULT_PROFILE, saveProfile } from "../../storage/profile.ts";
import type { UserProfile } from "../../types.ts";
import { sendTo } from "../broadcast.ts";
import type { Handler } from "../dispatch.ts";

export const profileUpdate: Handler = async (ws, session, data) => {
  const incoming = (data.profile ?? { ...DEFAULT_PROFILE }) as UserProfile;
  session.profile = incoming;
  saveProfile(session.profile);
  scheduleAutosync();
  sendTo(ws, { type: "profile_sync", profile: session.profile });
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
