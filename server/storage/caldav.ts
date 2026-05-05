import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import {
  CALDAV_CONFIG_FILENAME,
  CALDAV_CONFIG_PATH,
  getRepoConfigPath,
} from "../config.ts";
import type { CalDAVConfig } from "../types.ts";

// CalDAV credential は平文で保管する。
// GitHub 連携時は data/repo/ 配下（ユーザーのプライベートリポジトリ）に置き、
// メインのコードリポジトリへ混入しないようにする。
// 未連携時は data/caldav_config.json に置く（gitignore 対象）。

let cache: CalDAVConfig | null = null;

function currentPath(): string {
  return getRepoConfigPath(CALDAV_CONFIG_FILENAME);
}

function readFrom(path: string): CalDAVConfig | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CalDAVConfig;
  } catch {
    return null;
  }
}

export function loadCalDAVConfig(): CalDAVConfig {
  if (cache !== null) return cache;
  const fromCurrent = readFrom(currentPath());
  if (fromCurrent) {
    cache = fromCurrent;
    return cache;
  }
  // 旧 data/ 直下に残っていれば、現在の保存先へ寄せて掃除する。
  if (currentPath() !== CALDAV_CONFIG_PATH) {
    const fromLegacy = readFrom(CALDAV_CONFIG_PATH);
    if (fromLegacy) {
      cache = fromLegacy;
      writeFileSync(currentPath(), JSON.stringify(fromLegacy, null, 2));
      unlinkSync(CALDAV_CONFIG_PATH);
      return cache;
    }
  }
  cache = {};
  return cache;
}

export function saveCalDAVConfig(cfg: CalDAVConfig): void {
  cache = cfg;
  writeFileSync(currentPath(), JSON.stringify(cfg, null, 2));
  if (currentPath() !== CALDAV_CONFIG_PATH && existsSync(CALDAV_CONFIG_PATH)) {
    unlinkSync(CALDAV_CONFIG_PATH);
  }
}

export function clearCalDAVConfig(): void {
  cache = {};
  for (const p of new Set([currentPath(), CALDAV_CONFIG_PATH])) {
    if (existsSync(p)) unlinkSync(p);
  }
}

export function isCalDAVConnected(): boolean {
  const cfg = loadCalDAVConfig();
  return Boolean(cfg.appleId && cfg.appPassword);
}

export function resetCalDAVCache(): void {
  cache = null;
}
