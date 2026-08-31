import { existsSync, mkdirSync } from "node:fs";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GitHubConfig } from "./types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const PROJECT_ROOT = resolve(__dirname, "..");

const envDataDir = process.env.TODOME_DATA_DIR;
export const DATA_DIR = envDataDir ? resolve(envDataDir) : join(PROJECT_ROOT, "data");
mkdirSync(DATA_DIR, { recursive: true });

export const DEFAULT_DB = join(DATA_DIR, "todome.db");
export const REPO_DIR = join(DATA_DIR, "repo");
export const GITHUB_CONFIG_PATH = join(DATA_DIR, "github_config.json");
export const AI_CONFIG_PATH = join(DATA_DIR, "ai_config.json");
export const APP_CONFIG_PATH = join(DATA_DIR, "app_config.json");
export const CALDAV_CONFIG_FILENAME = "caldav_config.json";
export const CALDAV_CONFIG_PATH = join(DATA_DIR, CALDAV_CONFIG_FILENAME);
export const GOOGLE_CONFIG_PATH = join(DATA_DIR, "google_config.json");

export const PORT = Number(process.env.TODOME_BACKEND_PORT ?? 3002);

let githubConfigCache: GitHubConfig | null = null;

function stringField(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

export function normalizeGitHubConfig(raw: unknown): GitHubConfig {
  const cfg =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const owner = stringField(cfg.owner);
  const repo = stringField(cfg.repo);
  const linked = cfg.linked === true && owner !== "" && repo !== "";
  const normalized: GitHubConfig = linked
    ? { linked: true, owner, repo }
    : cfg.linked === false
      ? { linked: false }
      : {};
  if (typeof cfg.autoSync === "boolean") normalized.autoSync = cfg.autoSync;
  if (typeof cfg.lastSyncAt === "string" || cfg.lastSyncAt === null) {
    normalized.lastSyncAt = cfg.lastSyncAt;
  }
  return normalized;
}

export function loadGitHubConfig(): GitHubConfig {
  if (githubConfigCache !== null) return githubConfigCache;
  if (existsSync(GITHUB_CONFIG_PATH)) {
    try {
      githubConfigCache = normalizeGitHubConfig(
        JSON.parse(readFileSync(GITHUB_CONFIG_PATH, "utf8"))
      );
    } catch {
      githubConfigCache = normalizeGitHubConfig(null);
    }
  } else {
    githubConfigCache = normalizeGitHubConfig(null);
  }
  return githubConfigCache;
}

export function saveGitHubConfig(cfg: GitHubConfig): void {
  githubConfigCache = normalizeGitHubConfig(cfg);
  writeFileSync(GITHUB_CONFIG_PATH, JSON.stringify(githubConfigCache, null, 2));
}

export function clearGitHubConfig(): void {
  githubConfigCache = normalizeGitHubConfig(null);
  if (existsSync(GITHUB_CONFIG_PATH)) unlinkSync(GITHUB_CONFIG_PATH);
}

export function resetGitHubConfigCache(): void {
  githubConfigCache = null;
}

export function getDbPath(): string {
  const cfg = loadGitHubConfig();
  const repoDb = join(REPO_DIR, "todome.db");
  if (cfg.linked && existsSync(repoDb)) return repoDb;
  return DEFAULT_DB;
}

// 機密 config（CalDAV 等）はメインリポジトリに混入させないため、
// GitHub 連携リポジトリ (data/repo/) が利用可能ならそちらに置く。
export function getRepoConfigPath(filename: string): string {
  const cfg = loadGitHubConfig();
  if (cfg.linked && existsSync(REPO_DIR)) {
    return join(REPO_DIR, filename);
  }
  return join(DATA_DIR, filename);
}
