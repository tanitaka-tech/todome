import { saveAIConfig } from "../../storage/aiConfig.ts";
import { broadcast } from "../broadcast.ts";
import type { Handler } from "../dispatch.ts";

export const aiConfigUpdate: Handler = async (_ws, session, data) => {
  const normalized = saveAIConfig(data.config ?? {});
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
  broadcast({ type: "ai_config_sync", config: normalized });
};
