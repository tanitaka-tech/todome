import type { RetroType } from "./types";
import type { RetroViewMode } from "./components/RetroPanel";

const BOARD_GOAL_FILTER_KEY = "todome.board.goalFilter";
const BOARD_RECENT_DAYS_KEY = "todome.board.recentDays";
const RETRO_TAB_KEY = "todome.retro.tab";
const RETRO_VIEW_MODE_KEY = "todome.retro.viewMode";
const POPUP_TASK_ID_KEY = "todome.board.popupTaskId";
const DAY_BOUNDARY_HOUR_KEY = "todome.dayBoundaryHour";
const DEFAULT_DAY_BOUNDARY_HOUR = 4;
const BOARD_BOTTOM_HEIGHT_KEY = "todome.board.bottomHeight";
const BOARD_QUOTA_WIDTH_KEY = "todome.board.quotaWidth";
const DEFAULT_BOARD_BOTTOM_HEIGHT = 300;
const DEFAULT_BOARD_QUOTA_WIDTH = 440;

const RETRO_TYPES: RetroType[] = ["daily", "weekly", "monthly", "yearly"];
const VALID_RECENT_DAYS = new Set([0, 1, 3, 7, 30]);

export function loadBoardGoalFilter(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(BOARD_GOAL_FILTER_KEY) ?? "";
}

export function saveBoardGoalFilter(value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BOARD_GOAL_FILTER_KEY, value);
  } catch {
    /* ignore quota errors */
  }
}

export function loadBoardRecentDays(): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(BOARD_RECENT_DAYS_KEY);
  if (raw === null) return 0;
  const n = Number(raw);
  return VALID_RECENT_DAYS.has(n) ? n : 0;
}

export function saveBoardRecentDays(value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BOARD_RECENT_DAYS_KEY, String(value));
  } catch {
    /* ignore quota errors */
  }
}

export function loadRetroTab(): RetroType {
  if (typeof window === "undefined") return "weekly";
  const v = window.localStorage.getItem(RETRO_TAB_KEY) as RetroType | null;
  return v && RETRO_TYPES.includes(v) ? v : "weekly";
}

export function saveRetroTab(value: RetroType): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RETRO_TAB_KEY, value);
  } catch {
    /* ignore quota errors */
  }
}

export function loadRetroViewMode(): RetroViewMode {
  if (typeof window === "undefined") return "list";
  const v = window.localStorage.getItem(RETRO_VIEW_MODE_KEY);
  return v === "calendar" ? "calendar" : "list";
}

export function saveRetroViewMode(value: RetroViewMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RETRO_VIEW_MODE_KEY, value);
  } catch {
    /* ignore quota errors */
  }
}

export function loadPopupTaskId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(POPUP_TASK_ID_KEY);
}

export function savePopupTaskId(value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.localStorage.setItem(POPUP_TASK_ID_KEY, value);
    } else {
      window.localStorage.removeItem(POPUP_TASK_ID_KEY);
    }
  } catch {
    /* ignore quota errors */
  }
}

export function loadDayBoundaryHour(): number {
  if (typeof window === "undefined") return DEFAULT_DAY_BOUNDARY_HOUR;
  const raw = window.localStorage.getItem(DAY_BOUNDARY_HOUR_KEY);
  if (raw === null) return DEFAULT_DAY_BOUNDARY_HOUR;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 23) return DEFAULT_DAY_BOUNDARY_HOUR;
  return n;
}

export function saveDayBoundaryHour(value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DAY_BOUNDARY_HOUR_KEY, String(value));
  } catch {
    /* ignore quota errors */
  }
}

export function loadBoardBottomHeight(): number {
  if (typeof window === "undefined") return DEFAULT_BOARD_BOTTOM_HEIGHT;
  const raw = window.localStorage.getItem(BOARD_BOTTOM_HEIGHT_KEY);
  if (raw === null) return DEFAULT_BOARD_BOTTOM_HEIGHT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 120 || n > 2000) return DEFAULT_BOARD_BOTTOM_HEIGHT;
  return n;
}

export function saveBoardBottomHeight(value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BOARD_BOTTOM_HEIGHT_KEY, String(Math.round(value)));
  } catch {
    /* ignore quota errors */
  }
}

export function loadBoardQuotaWidth(): number {
  if (typeof window === "undefined") return DEFAULT_BOARD_QUOTA_WIDTH;
  const raw = window.localStorage.getItem(BOARD_QUOTA_WIDTH_KEY);
  if (raw === null) return DEFAULT_BOARD_QUOTA_WIDTH;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 240 || n > 4000) return DEFAULT_BOARD_QUOTA_WIDTH;
  return n;
}

export function saveBoardQuotaWidth(value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BOARD_QUOTA_WIDTH_KEY, String(Math.round(value)));
  } catch {
    /* ignore quota errors */
  }
}
