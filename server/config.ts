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
export const CALDAV_CONFIG_PATH = join(DATA_DIR, "caldav_config.json");
export const GOOGLE_CONFIG_PATH = join(DATA_DIR, "google_config.json");

export const PORT = Number(process.env.TODOME_BACKEND_PORT ?? 3002);

let githubConfigCache: GitHubConfig | null = null;

export function loadGitHubConfig(): GitHubConfig {
  if (githubConfigCache !== null) return githubConfigCache;
  if (existsSync(GITHUB_CONFIG_PATH)) {
    try {
      githubConfigCache = JSON.parse(readFileSync(GITHUB_CONFIG_PATH, "utf8")) as GitHubConfig;
    } catch {
      githubConfigCache = {};
    }
  } else {
    githubConfigCache = {};
  }
  return githubConfigCache;
}

export function saveGitHubConfig(cfg: GitHubConfig): void {
  githubConfigCache = cfg;
  writeFileSync(GITHUB_CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

export function clearGitHubConfig(): void {
  githubConfigCache = {};
  if (existsSync(GITHUB_CONFIG_PATH)) unlinkSync(GITHUB_CONFIG_PATH);
}

export function getDbPath(): string {
  const cfg = loadGitHubConfig();
  const repoDb = join(REPO_DIR, "todome.db");
  if (cfg.linked && existsSync(repoDb)) return repoDb;
  return DEFAULT_DB;
}
