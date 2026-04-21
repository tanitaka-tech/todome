import { existsSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class GitHubSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubSyncError";
  }
}

interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  check?: boolean;
  binary?: boolean;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  stdoutBytes: Uint8Array;
}

async function run(cmd: string[], opts: RunOptions = {}): Promise<RunResult> {
  const { cwd, env, check = true, binary = false } = opts;
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(cmd, {
      cwd,
      env: env ?? (process.env as Record<string, string>),
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (err) {
    throw new GitHubSyncError(
      `コマンドが見つかりません: ${cmd[0]} (${err instanceof Error ? err.message : String(err)})`
    );
  }
  const stdoutStream = proc.stdout as ReadableStream<Uint8Array>;
  const stderrStream = proc.stderr as ReadableStream<Uint8Array>;
  const [stdoutBytes, stderrText, code] = await Promise.all([
    new Response(stdoutStream).arrayBuffer(),
    new Response(stderrStream).text(),
    proc.exited,
  ]);
  const stdoutU8 = new Uint8Array(stdoutBytes);
  const stdoutStr = binary ? "" : new TextDecoder().decode(stdoutU8);
  if (check && code !== 0) {
    const msg = (stderrText || stdoutStr || `exit ${code}`).trim();
    throw new GitHubSyncError(
      `${cmd[0]} ${cmd[1] ?? ""} 失敗: ${msg}`
    );
  }
  return { code, stdout: stdoutStr, stderr: stderrText, stdoutBytes: stdoutU8 };
}

// --- gh ---

export async function ghAuthStatus(): Promise<{
  ok: boolean;
  username: string | null;
  error: string | null;
}> {
  try {
    const r = await run(["gh", "api", "user", "--jq", ".login"]);
    return { ok: true, username: r.stdout.trim(), error: null };
  } catch (err) {
    return {
      ok: false,
      username: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

interface UserMeta {
  login: string;
  email: string;
  name: string;
}

async function getUserMeta(): Promise<UserMeta> {
  const r = await run(["gh", "api", "user"]);
  const data = JSON.parse(r.stdout) as {
    login?: string;
    email?: string | null;
    id?: number;
    name?: string | null;
  };
  const login = data.login ?? "";
  let email = data.email ?? "";
  if (!email) {
    email = `${data.id ?? 0}+${login}@users.noreply.github.com`;
  }
  return { login, email, name: data.name || login };
}

export async function ghListOrgs(): Promise<string[]> {
  const r = await run(["gh", "api", "user/orgs", "--jq", ".[].login"], { check: false });
  if (r.code !== 0) return [];
  return r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export interface RepoInfo {
  name: string;
  owner: { login: string };
  nameWithOwner: string;
  isPrivate: boolean;
  updatedAt: string;
  url: string;
}

export async function ghListRepos(): Promise<RepoInfo[]> {
  const fields = "name,owner,isPrivate,updatedAt,url,nameWithOwner";
  const listOne = async (owner: string | null): Promise<RepoInfo[]> => {
    const cmd = ["gh", "repo", "list"];
    if (owner) cmd.push(owner);
    cmd.push("--json", fields, "--limit", "200");
    const r = await run(cmd);
    return JSON.parse(r.stdout) as RepoInfo[];
  };

  const repos: RepoInfo[] = [];
  const seen = new Set<string>();
  for (const r of await listOne(null)) {
    if (r.nameWithOwner && !seen.has(r.nameWithOwner)) {
      seen.add(r.nameWithOwner);
      repos.push(r);
    }
  }
  for (const org of await ghListOrgs()) {
    try {
      for (const r of await listOne(org)) {
        if (r.nameWithOwner && !seen.has(r.nameWithOwner)) {
          seen.add(r.nameWithOwner);
          repos.push(r);
        }
      }
    } catch {
      // skip orgs we don't have permission for
    }
  }
  return repos;
}

export async function ghRepoHasDb(
  owner: string,
  name: string,
  path = "todome.db"
): Promise<boolean> {
  const r = await run(
    ["gh", "api", `/repos/${owner}/${name}/contents/${path}`, "--silent"],
    { check: false }
  );
  return r.code === 0;
}

export async function ghCreateRepo(
  name: string,
  isPrivate = true
): Promise<{ owner: string; name: string; url: string }> {
  const visibility = isPrivate ? "--private" : "--public";
  const r = await run(["gh", "repo", "create", name, visibility, "--clone=false"]);
  let url = r.stdout.trim().split("\n").pop()?.trim() ?? "";
  if (!url.includes("github.com/")) {
    const meta = await getUserMeta();
    url = `https://github.com/${meta.login}/${name}`;
  }
  const parts = url.replace(/\/$/, "").split("/");
  const owner = parts[parts.length - 2] ?? "";
  let repoName = parts[parts.length - 1] ?? "";
  if (repoName.endsWith(".git")) repoName = repoName.slice(0, -4);
  return { owner, name: repoName, url };
}

// --- git ---

function gitEnv(): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    GIT_TERMINAL_PROMPT: "0",
  };
}

function authArgs(): string[] {
  return [
    "-c",
    "credential.helper=",
    "-c",
    "credential.helper=!gh auth git-credential",
  ];
}

export function repoHttpsUrl(owner: string, name: string): string {
  return `https://github.com/${owner}/${name}.git`;
}

export async function gitClone(owner: string, name: string, dest: string): Promise<void> {
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  const url = repoHttpsUrl(owner, name);
  await run(["git", ...authArgs(), "clone", url, dest], { env: gitEnv() });
}

export async function ensureGitIdentity(dest: string): Promise<void> {
  const meta = await getUserMeta();
  await run(["git", "-C", dest, "config", "user.email", meta.email], { env: gitEnv() });
  await run(["git", "-C", dest, "config", "user.name", meta.name], { env: gitEnv() });
}

export async function gitPull(dest: string): Promise<void> {
  try {
    await run(
      ["git", "-C", dest, ...authArgs(), "pull", "--rebase", "--autostash"],
      { env: gitEnv() }
    );
  } catch (err) {
    await run(["git", "-C", dest, "rebase", "--abort"], {
      env: gitEnv(),
      check: false,
    });
    throw err;
  }
}

export async function gitHasChanges(dest: string): Promise<boolean> {
  const r = await run(["git", "-C", dest, "status", "--porcelain"], { env: gitEnv() });
  return r.stdout.trim().length > 0;
}

export async function gitAddCommitPush(
  dest: string,
  message: string,
  paths?: string[]
): Promise<boolean> {
  const addPaths = paths ?? ["todome.db", ".gitattributes"];
  for (const p of addPaths) {
    if (existsSync(`${dest}/${p}`)) {
      await run(["git", "-C", dest, "add", p], { env: gitEnv() });
    }
  }
  if (!(await gitHasChanges(dest))) return false;
  await run(["git", "-C", dest, "commit", "-m", message], { env: gitEnv() });
  try {
    await run(["git", "-C", dest, ...authArgs(), "push"], { env: gitEnv() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      !msg.includes("fetch first") &&
      !msg.includes("non-fast-forward") &&
      !msg.includes("rejected")
    ) {
      throw err;
    }
    try {
      await run(
        [
          "git",
          "-C",
          dest,
          ...authArgs(),
          "pull",
          "--rebase",
          "--strategy-option=theirs",
        ],
        { env: gitEnv() }
      );
    } catch (err2) {
      await run(["git", "-C", dest, "rebase", "--abort"], {
        env: gitEnv(),
        check: false,
      });
      throw err2;
    }
    await run(["git", "-C", dest, ...authArgs(), "push"], { env: gitEnv() });
  }
  return true;
}

export function writeGitattributes(dest: string): void {
  const path = `${dest}/.gitattributes`;
  const content = "todome.db binary\n";
  if (existsSync(path) && readFileSync(path, "utf8") === content) return;
  writeFileSync(path, content);
}

// --- git log / restore ---

export interface GitCommitEntry {
  hash: string;
  shortHash: string;
  date: string;
  author: string;
  message: string;
}

export async function gitLog(
  dest: string,
  limit = 30,
  path = "todome.db"
): Promise<GitCommitEntry[]> {
  const sep = "\x1f";
  const fmt = ["%H", "%h", "%ct", "%an", "%s"].join(sep);
  const r = await run(
    [
      "git",
      "-C",
      dest,
      "log",
      `-n${limit}`,
      `--pretty=format:${fmt}`,
      "--",
      path,
    ],
    { env: gitEnv() }
  );
  const out: GitCommitEntry[] = [];
  for (const line of r.stdout.split("\n")) {
    if (!line) continue;
    const parts = line.split(sep);
    if (parts.length < 5) continue;
    const full = parts[0] ?? "";
    const short = parts[1] ?? "";
    const ts = parts[2] ?? "";
    const author = parts[3] ?? "";
    const message = parts.slice(4).join(sep);
    let iso = "";
    const n = Number(ts);
    if (Number.isFinite(n)) {
      iso = new Date(n * 1000).toISOString().slice(0, 19);
    }
    out.push({ hash: full, shortHash: short, date: iso, author, message });
  }
  return out;
}

export async function extractDbAtCommit(
  dest: string,
  commitHash: string,
  outPath: string,
  path = "todome.db"
): Promise<void> {
  const r = await run(["git", "-C", dest, "show", `${commitHash}:${path}`], {
    env: gitEnv(),
    binary: true,
    check: false,
  });
  if (r.code !== 0) {
    throw new GitHubSyncError(
      `git show 失敗: ${(r.stderr || `exit ${r.code}`).trim()}`
    );
  }
  if (!r.stdoutBytes.byteLength) {
    throw new GitHubSyncError(
      `${path} はコミット ${commitHash.slice(0, 7)} に存在しません`
    );
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, r.stdoutBytes);
}

export async function restoreDbToCommit(
  dest: string,
  commitHash: string,
  message: string,
  path = "todome.db"
): Promise<boolean> {
  await run(["git", "-C", dest, "checkout", commitHash, "--", path], {
    env: gitEnv(),
  });
  return gitAddCommitPush(dest, message, [path]);
}
