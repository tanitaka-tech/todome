import { loadGitHubConfig } from "../config.ts";
import { githubState } from "../state.ts";
import { broadcastGitHubStatus, doPush } from "./sync.ts";

const DEBOUNCE_MS = 20_000;

export function scheduleAutosync(): void {
  const cfg = loadGitHubConfig();
  if (!cfg.linked) return;
  if (!githubState.pendingSync) {
    githubState.pendingSync = true;
    void broadcastGitHubStatus();
  }
  if (!(cfg.autoSync ?? true)) return;
  if (githubState.debounceTimer) clearTimeout(githubState.debounceTimer);
  githubState.debounceTimer = setTimeout(() => {
    githubState.debounceTimer = null;
    void doPush("auto sync");
  }, DEBOUNCE_MS);
}
