import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { CALDAV_CONFIG_PATH } from "../config.ts";
import type { CalDAVConfig } from "../types.ts";

// CalDAV credential は GitHub config と同様に data/caldav_config.json に平文で保管する。
// data/ 全体が gitignore + ローカル限定なので、暗号化は行わない（README に明記）。

let cache: CalDAVConfig | null = null;

function stringField(raw: unknown): string | undefined {
  return typeof raw === "string" && raw !== "" ? raw : undefined;
}

export function normalizeCalDAVConfig(raw: unknown): CalDAVConfig {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const result: CalDAVConfig = {};
  const appleId = stringField(r.appleId);
  if (appleId) result.appleId = appleId;
  const appPassword = stringField(r.appPassword);
  if (appPassword) result.appPassword = appPassword;
  const connectedAt = stringField(r.connectedAt);
  if (connectedAt) result.connectedAt = connectedAt;
  const writeUrl = stringField(r.writeTargetCalendarUrl);
  if (writeUrl) result.writeTargetCalendarUrl = writeUrl;
  const writeName = stringField(r.writeTargetCalendarName);
  if (writeName) result.writeTargetCalendarName = writeName;
  const writeColor = stringField(r.writeTargetCalendarColor);
  if (writeColor) result.writeTargetCalendarColor = writeColor;
  return result;
}

export function loadCalDAVConfig(): CalDAVConfig {
  if (cache !== null) return cache;
  if (!existsSync(CALDAV_CONFIG_PATH)) {
    cache = {};
    return cache;
  }
  try {
    cache = normalizeCalDAVConfig(JSON.parse(readFileSync(CALDAV_CONFIG_PATH, "utf8")));
  } catch (err) {
    // 認証情報の破損は気付かないと iCloud 接続が「黙って外れた」状態になるため、
    // 起動時ログに残してユーザーが復旧手順を取れるようにする。
    console.warn("[caldav] failed to parse caldav_config.json, falling back to empty config:", err);
    cache = {};
  }
  return cache;
}

export function saveCalDAVConfig(cfg: CalDAVConfig): void {
  cache = normalizeCalDAVConfig(cfg);
  writeFileSync(CALDAV_CONFIG_PATH, JSON.stringify(cache, null, 2));
}

export function clearCalDAVConfig(): void {
  cache = {};
  if (existsSync(CALDAV_CONFIG_PATH)) unlinkSync(CALDAV_CONFIG_PATH);
}

export function isCalDAVConnected(): boolean {
  const cfg = loadCalDAVConfig();
  return Boolean(cfg.appleId && cfg.appPassword);
}

export function resetCalDAVConfigCache(): void {
  cache = null;
}
