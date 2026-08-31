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

function stringField(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

export function normalizeCalDAVConfig(raw: unknown): CalDAVConfig {
  if (!raw || typeof raw !== "object") return {};
  const cfg = raw as Record<string, unknown>;
  const normalized: CalDAVConfig = {};
  const appleId = stringField(cfg.appleId);
  const appPassword = stringField(cfg.appPassword);
  const connectedAt = stringField(cfg.connectedAt);
  const writeTargetCalendarUrl = stringField(cfg.writeTargetCalendarUrl);
  const writeTargetCalendarName = stringField(cfg.writeTargetCalendarName);
  const writeTargetCalendarColor = stringField(cfg.writeTargetCalendarColor);
  if (appleId) normalized.appleId = appleId;
  if (appPassword) normalized.appPassword = appPassword;
  if (connectedAt) normalized.connectedAt = connectedAt;
  if (writeTargetCalendarUrl) normalized.writeTargetCalendarUrl = writeTargetCalendarUrl;
  if (writeTargetCalendarName) normalized.writeTargetCalendarName = writeTargetCalendarName;
  if (writeTargetCalendarColor) normalized.writeTargetCalendarColor = writeTargetCalendarColor;
  return normalized;
}

function readFrom(path: string): unknown | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function loadCalDAVConfig(): CalDAVConfig {
  if (cache !== null) return cache;
  const fromCurrent = readFrom(currentPath());
  if (fromCurrent !== null) {
    cache = normalizeCalDAVConfig(fromCurrent);
    return cache;
  }
  // 旧 data/ 直下に残っていれば、現在の保存先へ寄せて掃除する。
  if (currentPath() !== CALDAV_CONFIG_PATH) {
    const fromLegacy = readFrom(CALDAV_CONFIG_PATH);
    if (fromLegacy !== null) {
      cache = normalizeCalDAVConfig(fromLegacy);
      writeFileSync(currentPath(), JSON.stringify(cache, null, 2));
      unlinkSync(CALDAV_CONFIG_PATH);
      return cache;
    }
  }
  cache = {};
  return cache;
}

export function saveCalDAVConfig(cfg: CalDAVConfig): void {
  cache = normalizeCalDAVConfig(cfg);
  writeFileSync(currentPath(), JSON.stringify(cache, null, 2));
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
