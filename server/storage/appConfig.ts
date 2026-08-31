import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { APP_CONFIG_PATH } from "../config.ts";

export interface AppConfig {
  dayBoundaryHour: number;
  calendarWeekStart: number;
}

const DEFAULT_DAY_BOUNDARY_HOUR = 4;
const DEFAULT_CALENDAR_WEEK_START = 1;

let cache: AppConfig | null = null;

function clampBoundaryHour(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 23) {
    return DEFAULT_DAY_BOUNDARY_HOUR;
  }
  return raw;
}

function normalizeCalendarWeekStart(raw: unknown): number {
  return raw === 0 || raw === 1 ? raw : DEFAULT_CALENDAR_WEEK_START;
}

export function normalizeAppConfig(raw: unknown): AppConfig {
  if (!raw || typeof raw !== "object") {
    return {
      dayBoundaryHour: DEFAULT_DAY_BOUNDARY_HOUR,
      calendarWeekStart: DEFAULT_CALENDAR_WEEK_START,
    };
  }
  const cfg = raw as Record<string, unknown>;
  return {
    dayBoundaryHour: clampBoundaryHour(cfg.dayBoundaryHour),
    calendarWeekStart: normalizeCalendarWeekStart(cfg.calendarWeekStart),
  };
}

export function loadAppConfig(): AppConfig {
  if (cache) return cache;
  if (existsSync(APP_CONFIG_PATH)) {
    try {
      cache = normalizeAppConfig(JSON.parse(readFileSync(APP_CONFIG_PATH, "utf8")));
    } catch {
      cache = normalizeAppConfig(null);
    }
  } else {
    cache = normalizeAppConfig(null);
  }
  return cache;
}

export function saveAppConfig(partial: unknown): AppConfig {
  const current = loadAppConfig();
  const merged: AppConfig = { ...current };
  if (partial && typeof partial === "object") {
    const p = partial as Record<string, unknown>;
    if ("dayBoundaryHour" in p) {
      merged.dayBoundaryHour = clampBoundaryHour(p.dayBoundaryHour);
    }
    if ("calendarWeekStart" in p) {
      merged.calendarWeekStart = normalizeCalendarWeekStart(p.calendarWeekStart);
    }
  }
  cache = merged;
  writeFileSync(APP_CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

export function getDayBoundaryHour(): number {
  return loadAppConfig().dayBoundaryHour;
}

export function resetAppConfigCache(): void {
  cache = null;
}
