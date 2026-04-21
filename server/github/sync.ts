import { copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_DB,
  REPO_DIR,
  clearGitHubConfig,
  loadGitHubConfig,
  saveGitHubConfig,
} from "../config.ts";
import { initDb, resetDbCache, walCheckpoint } from "../db.ts";
import { activeSockets, githubState, wsNeedsReload } from "../state.ts";
import { loadGoals, saveGoals } from "../storage/goals.ts";
import { loadTasks, saveTasks } from "../storage/kanban.ts";
import {
  loadLifeActivities,
  loadTodayLifeLogs,
} from "../storage/life.ts";
import { loadProfile, saveProfile } from "../storage/profile.ts";
import {
  computeAllQuotaStreaks,
  loadAllQuotaLogs,
  loadQuotas,
  loadTodayQuotaLogs,
} from "../storage/quota.ts";
import { loadRetros } from "../storage/retro.ts";
import type { GitHubStatus } from "../types.ts";
import { nowLocalIso } from "../utils/time.ts";
import { broadcast } from "../ws/broadcast.ts";
import {
  ensureGitIdentity,
  gitAddCommitPush,
  gitClone,
  gitPull,
  GitHubSyncError,
  ghAuthStatus,
  ghCreateRepo,
  ghRepoHasDb,
  restoreDbToCommit,
  writeGitattributes,
} from "./cli.ts";

const nowIso = nowLocalIso;

async function withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = githubState.syncChain;
  let release!: () => void;
  const next = new Promise<void>((r) => {
    release = r;
  });
  githubState.syncChain = prev.then(() => next);
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function buildGitHubStatus(): Promise<{
  type: "github_status";
  status: GitHubStatus;
}> {
  const cfg = loadGitHubConfig();
  const auth = await ghAuthStatus();
  return {
    type: "github_status",
    status: {
      authUser: auth.username,
      authOk: auth.ok,
      authError: auth.error,
      linked: Boolean(cfg.linked),
      owner: cfg.owner ?? null,
      repo: cfg.repo ?? null,
      autoSync: Boolean(cfg.autoSync ?? true),
      syncing: githubState.syncing,
      lastSyncAt: githubState.lastSyncAt ?? cfg.lastSyncAt ?? null,
      lastError: githubState.lastError,
      pendingSync: githubState.pendingSync,
    },
  };
}

export async function broadcastGitHubStatus(): Promise<void> {
  broadcast(await buildGitHubStatus());
}

function broadcastDbState(): void {
  for (const ws of activeSockets) wsNeedsReload.add(ws);
  const tasks = loadTasks();
  const goals = loadGoals();
  const profile = loadProfile();
  const retros = loadRetros();
  const activities = loadLifeActivities();
  const lifeLogs = loadTodayLifeLogs();
  const quotas = loadQuotas();
  const quotaLogs = loadTodayQuotaLogs();
  const allQuotaLogs = loadAllQuotaLogs();
  broadcast({ type: "kanban_sync", tasks });
  broadcast({ type: "goal_sync", goals });
  broadcast({ type: "profile_sync", profile });
  broadcast({ type: "retro_list_sync", retros });
  broadcast({ type: "life_activity_sync", activities });
  broadcast({ type: "life_log_sync", logs: lifeLogs });
  broadcast({ type: "quota_sync", quotas });
  broadcast({ type: "quota_log_sync", logs: quotaLogs });
  broadcast({
    type: "quota_streak_sync",
    streaks: computeAllQuotaStreaks(quotas, allQuotaLogs),
  });
}

async function finalizeStatus(): Promise<void> {
  githubState.syncing = false;
  await broadcastGitHubStatus();
}

export async function doPush(message: string): Promise<void> {
  const cfg = loadGitHubConfig();
  if (!cfg.linked) return;
  await withSyncLock(async () => {
    githubState.syncing = true;
    githubState.lastError = null;
    await broadcastGitHubStatus();
    try {
      walCheckpoint();
      const now = nowIso();
      const commitMsg = `todome ${message}: ${now}`;
      const pushed = await gitAddCommitPush(REPO_DIR, commitMsg);
      if (pushed) {
        githubState.lastSyncAt = now;
        const cfg2 = loadGitHubConfig();
        cfg2.lastSyncAt = now;
        saveGitHubConfig(cfg2);
      }
      githubState.pendingSync = false;
    } catch (err) {
      githubState.lastError =
        err instanceof GitHubSyncError
          ? err.message
          : `unexpected: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      await finalizeStatus();
    }
  });
}

export async function doPull(): Promise<void> {
  const cfg = loadGitHubConfig();
  if (!cfg.linked) return;
  await withSyncLock(async () => {
    githubState.syncing = true;
    githubState.lastError = null;
    await broadcastGitHubStatus();
    try {
      await gitPull(REPO_DIR);
      resetDbCache();
      initDb();
      githubState.diffCache.clear();
      broadcastDbState();
      const now = nowIso();
      githubState.lastSyncAt = now;
      const cfg2 = loadGitHubConfig();
      cfg2.lastSyncAt = now;
      saveGitHubConfig(cfg2);
    } catch (err) {
      githubState.lastError =
        err instanceof GitHubSyncError
          ? err.message
          : `unexpected: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      await finalizeStatus();
    }
  });
}

export async function doLink(options: {
  owner?: string | null;
  name: string;
  create: boolean;
  private: boolean;
}): Promise<void> {
  await withSyncLock(async () => {
    githubState.syncing = true;
    githubState.lastError = null;
    await broadcastGitHubStatus();
    try {
      const auth = await ghAuthStatus();
      if (!auth.ok) {
        throw new GitHubSyncError(auth.error ?? "gh 認証が必要です");
      }
      let { owner, name } = options;
      if (options.create) {
        const created = await ghCreateRepo(name, options.private);
        owner = created.owner;
        name = created.name;
      }
      if (!owner) owner = auth.username ?? "";
      if (!owner) throw new GitHubSyncError("owner が不明です");

      const remoteHasDb = await ghRepoHasDb(owner, name);

      resetDbCache();
      if (existsSync(REPO_DIR)) {
        rmSync(REPO_DIR, { recursive: true, force: true });
      }
      await gitClone(owner, name, REPO_DIR);
      await ensureGitIdentity(REPO_DIR);
      writeGitattributes(REPO_DIR);

      const clonedDb = join(REPO_DIR, "todome.db");
      if (!remoteHasDb && !existsSync(clonedDb)) {
        if (existsSync(DEFAULT_DB)) {
          copyFileSync(DEFAULT_DB, clonedDb);
        } else {
          saveGitHubConfig({
            linked: true,
            owner,
            repo: name,
            autoSync: true,
            lastSyncAt: null,
          });
          resetDbCache();
          initDb();
        }
      }

      saveGitHubConfig({
        linked: true,
        owner,
        repo: name,
        autoSync: true,
        lastSyncAt: loadGitHubConfig().lastSyncAt ?? null,
      });
      resetDbCache();
      initDb();

      if (!remoteHasDb) {
        const now = nowIso();
        const commitMsg = `todome initial sync: ${now}`;
        const pushed = await gitAddCommitPush(REPO_DIR, commitMsg);
        if (pushed) {
          githubState.lastSyncAt = now;
          const cfg2 = loadGitHubConfig();
          cfg2.lastSyncAt = now;
          saveGitHubConfig(cfg2);
        }
      }

      broadcastDbState();
    } catch (err) {
      githubState.lastError =
        err instanceof GitHubSyncError
          ? err.message
          : `unexpected: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      await finalizeStatus();
    }
  });
}

export async function doUnlink(): Promise<void> {
  await withSyncLock(async () => {
    githubState.syncing = true;
    githubState.lastError = null;
    await broadcastGitHubStatus();
    try {
      if (githubState.debounceTimer) {
        clearTimeout(githubState.debounceTimer);
        githubState.debounceTimer = null;
      }
      clearGitHubConfig();
      resetDbCache();
      if (existsSync(REPO_DIR)) {
        rmSync(REPO_DIR, { recursive: true, force: true });
      }
      initDb();
      githubState.diffCache.clear();
      broadcastDbState();
    } catch (err) {
      githubState.lastError = `unexpected: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      await finalizeStatus();
    }
  });
}

export async function doRestore(commitHash: string): Promise<void> {
  const cfg = loadGitHubConfig();
  if (!cfg.linked) return;
  await withSyncLock(async () => {
    githubState.syncing = true;
    githubState.lastError = null;
    await broadcastGitHubStatus();
    try {
      walCheckpoint();
      const short = commitHash.slice(0, 7);
      const now = nowIso();
      const commitMsg = `todome restore to ${short}: ${now}`;
      const pushed = await restoreDbToCommit(REPO_DIR, commitHash, commitMsg);
      resetDbCache();
      initDb();
      githubState.diffCache.clear();
      broadcastDbState();
      if (pushed) {
        githubState.lastSyncAt = now;
        const cfg2 = loadGitHubConfig();
        cfg2.lastSyncAt = now;
        saveGitHubConfig(cfg2);
      }
      githubState.pendingSync = false;
    } catch (err) {
      githubState.lastError =
        err instanceof GitHubSyncError
          ? err.message
          : `unexpected: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      await finalizeStatus();
    }
  });
}
