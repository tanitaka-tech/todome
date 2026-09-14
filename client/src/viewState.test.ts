import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadBoardBottomHeight,
  loadBoardGoalFilters,
  loadBoardQuotaWidth,
  loadBoardRecentDays,
  loadDayBoundaryHour,
  loadPopupTaskId,
  loadRetroTab,
  loadRetroViewMode,
  loadScheduleView,
  saveBoardBottomHeight,
  saveBoardGoalFilters,
  saveBoardQuotaWidth,
  saveBoardRecentDays,
  saveDayBoundaryHour,
  savePopupTaskId,
  saveRetroTab,
  saveRetroViewMode,
  saveScheduleView,
} from "./viewState";

class ThrowingStorage implements Storage {
  get length(): number {
    throw new Error("storage unavailable");
  }

  clear(): void {
    throw new Error("storage unavailable");
  }

  getItem(): string | null {
    throw new Error("storage unavailable");
  }

  key(): string | null {
    throw new Error("storage unavailable");
  }

  removeItem(): void {
    throw new Error("storage unavailable");
  }

  setItem(): void {
    throw new Error("storage unavailable");
  }
}

describe("viewState storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("localStorage が読めないときは全 loader が既定値に戻す", () => {
    vi.stubGlobal("window", { localStorage: new ThrowingStorage() });

    expect(loadBoardGoalFilters()).toEqual([]);
    expect(loadBoardRecentDays()).toBe(0);
    expect(loadRetroTab()).toBe("weekly");
    expect(loadRetroViewMode()).toBe("list");
    expect(loadPopupTaskId()).toBeNull();
    expect(loadDayBoundaryHour()).toBe(4);
    expect(loadBoardBottomHeight()).toBe(300);
    expect(loadBoardQuotaWidth()).toBe(440);
    expect(loadScheduleView()).toBe("month");
  });

  it("localStorage が書けないときも全 saver が例外を投げない", () => {
    vi.stubGlobal("window", { localStorage: new ThrowingStorage() });

    expect(() => saveBoardGoalFilters(["goal-1"])).not.toThrow();
    expect(() => saveBoardRecentDays(7)).not.toThrow();
    expect(() => saveRetroTab("daily")).not.toThrow();
    expect(() => saveRetroViewMode("calendar")).not.toThrow();
    expect(() => savePopupTaskId("task-1")).not.toThrow();
    expect(() => savePopupTaskId(null)).not.toThrow();
    expect(() => saveDayBoundaryHour(5)).not.toThrow();
    expect(() => saveBoardBottomHeight(360)).not.toThrow();
    expect(() => saveBoardQuotaWidth(520)).not.toThrow();
    expect(() => saveScheduleView("week")).not.toThrow();
  });
});
