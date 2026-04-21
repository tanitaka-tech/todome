import {
  REPO_DIR,
  loadGitHubConfig,
  saveGitHubConfig,
} from "../../config.ts";
import {
  ghListRepos,
  gitLog,
  GitHubSyncError,
} from "../../github/cli.ts";
import { computeCommitDiff } from "../../github/diff.ts";
import {
  buildGitHubStatus,
  doLink,
  doPull,
  doPush,
  doRestore,
  doUnlink,
} from "../../github/sync.ts";
import { githubState } from "../../state.ts";
import { broadcast, sendTo } from "../broadcast.ts";
import type { Handler } from "../dispatch.ts";

export const githubStatusRequest: Handler = async (ws) => {
  sendTo(ws, await buildGitHubStatus());
};

export const githubListRepos: Handler = async (ws) => {
  try {
    const repos = await ghListRepos();
    sendTo(ws, { type: "github_repo_list", repos });
  } catch (err) {
    githubState.lastError = err instanceof Error ? err.message : String(err);
    sendTo(ws, await buildGitHubStatus());
  }
};

export const githubLink: Handler = async (_ws, _session, data) => {
  void doLink({
    owner: typeof data.owner === "string" ? data.owner : null,
    name: typeof data.name === "string" ? data.name : "",
    create: Boolean(data.create),
    private: data.private === undefined ? true : Boolean(data.private),
  });
};

export const githubUnlink: Handler = async () => {
  void doUnlink();
};

export const githubSyncNow: Handler = async () => {
  void doPush("manual sync");
};

export const githubPullNow: Handler = async () => {
  void doPull();
};

export const githubSetAutoSync: Handler = async (_ws, _session, data) => {
  const cfg = loadGitHubConfig();
  cfg.autoSync = data.value === undefined ? true : Boolean(data.value);
  saveGitHubConfig(cfg);
  broadcast(await buildGitHubStatus());
};

export const githubListCommits: Handler = async (ws) => {
  try {
    const commits = await gitLog(REPO_DIR, 30);
    sendTo(ws, { type: "github_commit_list", commits });
  } catch (err) {
    githubState.lastError = err instanceof Error ? err.message : String(err);
    sendTo(ws, await buildGitHubStatus());
  }
};

export const githubCommitDiff: Handler = async (ws, _session, data) => {
  const commitHash = typeof data.hash === "string" ? data.hash : "";
  if (!commitHash) return;
  try {
    const diff = await computeCommitDiff(commitHash);
    sendTo(ws, {
      type: "github_commit_diff_result",
      hash: commitHash,
      summary: diff.summary,
      details: diff.details,
      error: null,
    });
  } catch (err) {
    const message =
      err instanceof GitHubSyncError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    sendTo(ws, {
      type: "github_commit_diff_result",
      hash: commitHash,
      summary: null,
      details: null,
      error: message,
    });
  }
};

export const githubRestoreCommit: Handler = async (_ws, _session, data) => {
  const commitHash = typeof data.hash === "string" ? data.hash : "";
  if (commitHash) void doRestore(commitHash);
};
