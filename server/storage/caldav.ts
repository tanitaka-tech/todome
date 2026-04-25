import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { CALDAV_CONFIG_PATH } from "../config.ts";
import type { CalDAVConfig } from "../types.ts";

// CalDAV credential は GitHub config と同様に data/caldav_config.json に平文で保管する。
// data/ 全体が gitignore + ローカル限定なので、暗号化は行わない（README に明記）。

let cache: CalDAVConfig | null = null;

export function loadCalDAVConfig(): CalDAVConfig {
  if (cache !== null) return cache;
  if (!existsSync(CALDAV_CONFIG_PATH)) {
    cache = {};
    return cache;
  }
  try {
    cache = JSON.parse(readFileSync(CALDAV_CONFIG_PATH, "utf8")) as CalDAVConfig;
  } catch {
    cache = {};
  }
  return cache;
}

export function saveCalDAVConfig(cfg: CalDAVConfig): void {
  cache = cfg;
  writeFileSync(CALDAV_CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

export function clearCalDAVConfig(): void {
  cache = {};
  if (existsSync(CALDAV_CONFIG_PATH)) unlinkSync(CALDAV_CONFIG_PATH);
}

export function isCalDAVConnected(): boolean {
  const cfg = loadCalDAVConfig();
  return Boolean(cfg.appleId && cfg.appPassword);
}
