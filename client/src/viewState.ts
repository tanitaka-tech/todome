import type { RetroType } from "./types";
import type { RetroViewMode } from "./components/RetroPanel";
import {
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage,
} from "./browserStorage";

const BOARD_GOAL_FILTER_KEY = "todome.board.goalFilters";
const BOARD_RECENT_DAYS_KEY = "todome.board.recentDays";
const RETRO_TAB_KEY = "todome.retro.tab";
const RETRO_VIEW_MODE_KEY = "todome.retro.viewMode";
const POPUP_TASK_ID_KEY = "todome.board.popupTaskId";
const DAY_BOUNDARY_HOUR_KEY = "todome.dayBoundaryHour";
const DEFAULT_DAY_BOUNDARY_HOUR = 4;
const BOARD_BOTTOM_HEIGHT_KEY = "todome.board.bottomHeight";
const BOARD_QUOTA_WIDTH_KEY = "todome.board.quotaWidth";
const SCHEDULE_VIEW_KEY = "todome.schedule.view";
const DEFAULT_BOARD_BOTTOM_HEIGHT = 300;
const DEFAULT_BOARD_QUOTA_WIDTH = 440;

const RETRO_TYPES: RetroType[] = ["daily", "weekly", "monthly", "yearly"];
const VALID_RECENT_DAYS = new Set([0, 1, 3, 7, 30]);

export function loadBoardGoalFilters(): string[] {
  const raw = readLocalStorage(BOARD_GOAL_FILTER_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === "string");
    }
  } catch {
    /* fall through */
  }
  return [];
}

export function saveBoardGoalFilters(value: string[]): void {
  writeLocalStorage(BOARD_GOAL_FILTER_KEY, JSON.stringify(value));
}

export function loadBoardRecentDays(): number {
  const raw = readLocalStorage(BOARD_RECENT_DAYS_KEY);
  if (raw === null) return 0;
  const n = Number(raw);
  return VALID_RECENT_DAYS.has(n) ? n : 0;
}

export function saveBoardRecentDays(value: number): void {
  writeLocalStorage(BOARD_RECENT_DAYS_KEY, String(value));
}

export function loadRetroTab(): RetroType {
  const v = readLocalStorage(RETRO_TAB_KEY) as RetroType | null;
  return v && RETRO_TYPES.includes(v) ? v : "weekly";
}

export function saveRetroTab(value: RetroType): void {
  writeLocalStorage(RETRO_TAB_KEY, value);
}

export function loadRetroViewMode(): RetroViewMode {
  const v = readLocalStorage(RETRO_VIEW_MODE_KEY);
  return v === "calendar" ? "calendar" : "list";
}

export function saveRetroViewMode(value: RetroViewMode): void {
  writeLocalStorage(RETRO_VIEW_MODE_KEY, value);
}

export function loadPopupTaskId(): string | null {
  return readLocalStorage(POPUP_TASK_ID_KEY);
}

export function savePopupTaskId(value: string | null): void {
  if (value) {
    writeLocalStorage(POPUP_TASK_ID_KEY, value);
  } else {
    removeLocalStorage(POPUP_TASK_ID_KEY);
  }
}

export function loadDayBoundaryHour(): number {
  const raw = readLocalStorage(DAY_BOUNDARY_HOUR_KEY);
  if (raw === null) return DEFAULT_DAY_BOUNDARY_HOUR;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 23) return DEFAULT_DAY_BOUNDARY_HOUR;
  return n;
}

export function saveDayBoundaryHour(value: number): void {
  writeLocalStorage(DAY_BOUNDARY_HOUR_KEY, String(value));
}

export function loadBoardBottomHeight(): number {
  const raw = readLocalStorage(BOARD_BOTTOM_HEIGHT_KEY);
  if (raw === null) return DEFAULT_BOARD_BOTTOM_HEIGHT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 120 || n > 2000) return DEFAULT_BOARD_BOTTOM_HEIGHT;
  return n;
}

export function saveBoardBottomHeight(value: number): void {
  writeLocalStorage(BOARD_BOTTOM_HEIGHT_KEY, String(Math.round(value)));
}

export function loadBoardQuotaWidth(): number {
  const raw = readLocalStorage(BOARD_QUOTA_WIDTH_KEY);
  if (raw === null) return DEFAULT_BOARD_QUOTA_WIDTH;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 240 || n > 4000) return DEFAULT_BOARD_QUOTA_WIDTH;
  return n;
}

export function saveBoardQuotaWidth(value: number): void {
  writeLocalStorage(BOARD_QUOTA_WIDTH_KEY, String(Math.round(value)));
}

export type ScheduleViewMode = "month" | "week";

export function loadScheduleView(): ScheduleViewMode {
  const v = readLocalStorage(SCHEDULE_VIEW_KEY);
  return v === "week" ? "week" : "month";
}

export function saveScheduleView(value: ScheduleViewMode): void {
  writeLocalStorage(SCHEDULE_VIEW_KEY, value);
}
