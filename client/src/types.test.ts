import { describe, expect, it } from "vitest";
import {
  areAllKpisAchieved,
  formatDuration,
  formatKpiTimeValue,
  getDayRangeForDate,
  getTodayDayRange,
  hmToSeconds,
  isKpiAchieved,
  isTaskCompletedInPeriod,
  kpiProgress,
  lifeLogAlertLevel,
  lifeLogDurationSeconds,
  logSecondsInRange,
  nowLocalIso,
  quotaIsAchieved,
  secondsToHM,
  streakRank,
  type KanbanTask,
  type KPI,
  type LifeActivity,
  type LifeLog,
  type Quota,
} from "./types";

function makeKpi(partial: Partial<KPI> & Pick<KPI, "id" | "name">): KPI {
  return {
    unit: "number",
    targetValue: 0,
    currentValue: 0,
    ...partial,
  };
}

function makeTask(
  partial: Partial<KanbanTask> & Pick<KanbanTask, "id" | "title">,
): KanbanTask {
  return {
    description: "",
    column: "todo",
    memo: "",
    goalId: "",
    kpiId: "",
    kpiContributed: false,
    estimatedMinutes: 0,
    timeSpent: 0,
    timerStartedAt: "",
    completedAt: "",
    timeLogs: [],
    ...partial,
  };
}

function makeActivity(
  partial: Partial<LifeActivity> & Pick<LifeActivity, "id" | "name">,
): LifeActivity {
  return {
    icon: "",
    category: "other",
    softLimitMinutes: 0,
    hardLimitMinutes: 0,
    limitScope: "per_day",
    archived: false,
    ...partial,
  };
}

function makeLifeLog(
  partial: Partial<LifeLog> & Pick<LifeLog, "id" | "activityId">,
): LifeLog {
  return {
    startedAt: "",
    endedAt: "",
    memo: "",
    alertTriggered: "",
    ...partial,
  };
}

function makeQuota(
  partial: Partial<Quota> & Pick<Quota, "id" | "name">,
): Quota {
  return {
    icon: "",
    targetMinutes: 0,
    archived: false,
    createdAt: "",
    ...partial,
  };
}

describe("kpiProgress / isKpiAchieved / areAllKpisAchieved", () => {
  it("targetValue が 0 なら進捗 0 を返す", () => {
    expect(
      kpiProgress(makeKpi({ id: "k", name: "n", targetValue: 0, currentValue: 5 })),
    ).toBe(0);
  });

  it("進捗は 0〜100 にクリップされる", () => {
    expect(
      kpiProgress(makeKpi({ id: "k", name: "n", targetValue: 10, currentValue: 25 })),
    ).toBe(100);
    expect(
      kpiProgress(makeKpi({ id: "k", name: "n", targetValue: 10, currentValue: -5 })),
    ).toBe(0);
    expect(
      kpiProgress(makeKpi({ id: "k", name: "n", targetValue: 10, currentValue: 3 })),
    ).toBe(30);
  });

  it("achieved 判定は target > 0 かつ current >= target のときだけ true", () => {
    expect(
      isKpiAchieved(makeKpi({ id: "k", name: "n", targetValue: 0, currentValue: 0 })),
    ).toBe(false);
    expect(
      isKpiAchieved(makeKpi({ id: "k", name: "n", targetValue: 10, currentValue: 9 })),
    ).toBe(false);
    expect(
      isKpiAchieved(makeKpi({ id: "k", name: "n", targetValue: 10, currentValue: 10 })),
    ).toBe(true);
  });

  it("areAllKpisAchieved は空配列のとき false、全達成で true", () => {
    expect(areAllKpisAchieved([])).toBe(false);
    expect(
      areAllKpisAchieved([
        makeKpi({ id: "a", name: "a", targetValue: 10, currentValue: 10 }),
        makeKpi({ id: "b", name: "b", targetValue: 5, currentValue: 5 }),
      ]),
    ).toBe(true);
    expect(
      areAllKpisAchieved([
        makeKpi({ id: "a", name: "a", targetValue: 10, currentValue: 10 }),
        makeKpi({ id: "b", name: "b", targetValue: 5, currentValue: 4 }),
      ]),
    ).toBe(false);
  });
});

describe("formatDuration / formatKpiTimeValue / secondsToHM / hmToSeconds", () => {
  it("formatDuration は桁に応じて単位を変える", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(125)).toBe("2m 5s");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(3660)).toBe("1h 1m");
  });

  it("formatKpiTimeValue は分を切り下げて h/m に変換する", () => {
    expect(formatKpiTimeValue(0)).toBe("0m");
    expect(formatKpiTimeValue(59)).toBe("0m");
    expect(formatKpiTimeValue(60)).toBe("1m");
    expect(formatKpiTimeValue(3600)).toBe("1h");
    expect(formatKpiTimeValue(3660)).toBe("1h1m");
    expect(formatKpiTimeValue(-1)).toBe("0m");
  });

  it("secondsToHM と hmToSeconds は往復で不変", () => {
    const { h, m } = secondsToHM(3 * 3600 + 25 * 60 + 40);
    expect(h).toBe(3);
    expect(m).toBe(25);
    expect(hmToSeconds(h, m)).toBe(3 * 3600 + 25 * 60);
    expect(hmToSeconds(-1, -10)).toBe(0);
  });
});

describe("isTaskCompletedInPeriod", () => {
  it("done 以外は false", () => {
    const t = makeTask({
      id: "1",
      title: "x",
      column: "todo",
      completedAt: "2025-04-22T10:00:00",
    });
    expect(isTaskCompletedInPeriod(t, "2025-04-22", "2025-04-22")).toBe(false);
  });

  it("completedAt が空なら false", () => {
    const t = makeTask({ id: "1", title: "x", column: "done", completedAt: "" });
    expect(isTaskCompletedInPeriod(t, "2025-04-22", "2025-04-22")).toBe(false);
  });

  it("範囲の境界（start 00:00:00, end 23:59:59）を含む", () => {
    const start = makeTask({
      id: "1",
      title: "x",
      column: "done",
      completedAt: "2025-04-22T00:00:00",
    });
    const end = makeTask({
      id: "2",
      title: "y",
      column: "done",
      completedAt: "2025-04-24T23:59:59",
    });
    const outside = makeTask({
      id: "3",
      title: "z",
      column: "done",
      completedAt: "2025-04-25T00:00:00",
    });
    expect(isTaskCompletedInPeriod(start, "2025-04-22", "2025-04-24")).toBe(true);
    expect(isTaskCompletedInPeriod(end, "2025-04-22", "2025-04-24")).toBe(true);
    expect(isTaskCompletedInPeriod(outside, "2025-04-22", "2025-04-24")).toBe(false);
  });
});

describe("nowLocalIso", () => {
  it("Z を含まないローカル形式で返す", () => {
    const iso = nowLocalIso();
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(iso.endsWith("Z")).toBe(false);
  });
});

describe("logSecondsInRange / lifeLogDurationSeconds", () => {
  const s = (iso: string) => new Date(iso).getTime();

  it("範囲内の秒だけを返す (clamp 両端)", () => {
    const startedAt = "2025-04-22T10:00:00";
    const endedAt = "2025-04-22T11:00:00";
    // range は 10:30-10:45 のみ
    const got = logSecondsInRange(
      startedAt,
      endedAt,
      s("2025-04-22T10:30:00"),
      s("2025-04-22T10:45:00"),
      s("2025-04-22T12:00:00"),
    );
    expect(got).toBe(15 * 60);
  });

  it("endedAt 空のとき now までとみなす", () => {
    const startedAt = "2025-04-22T10:00:00";
    const now = s("2025-04-22T10:30:00");
    const got = logSecondsInRange(
      startedAt,
      "",
      s("2025-04-22T00:00:00"),
      s("2025-04-22T23:59:59"),
      now,
    );
    expect(got).toBe(30 * 60);
  });

  it("startedAt 空なら 0", () => {
    expect(
      logSecondsInRange("", "", s("2025-04-22T00:00:00"), s("2025-04-22T01:00:00"), s("2025-04-22T02:00:00")),
    ).toBe(0);
  });

  it("lifeLogDurationSeconds は進行中なら nowMs まで計算", () => {
    const log = makeLifeLog({
      id: "l",
      activityId: "a",
      startedAt: "2025-04-22T10:00:00",
      endedAt: "",
    });
    expect(lifeLogDurationSeconds(log, s("2025-04-22T10:05:30"))).toBe(330);
  });
});

describe("lifeLogAlertLevel", () => {
  const activity = makeActivity({
    id: "a",
    name: "n",
    softLimitMinutes: 30,
    hardLimitMinutes: 60,
  });

  it("hard > soft > '' の順で優先", () => {
    expect(lifeLogAlertLevel(activity, 60 * 60)).toBe("hard");
    expect(lifeLogAlertLevel(activity, 59 * 60)).toBe("soft");
    expect(lifeLogAlertLevel(activity, 29 * 60)).toBe("");
  });

  it("limit=0 は無効（その閾値は発火しない）", () => {
    const noHard = { ...activity, hardLimitMinutes: 0 };
    expect(lifeLogAlertLevel(noHard, 10 * 3600)).toBe("soft");
    const none = { ...activity, softLimitMinutes: 0, hardLimitMinutes: 0 };
    expect(lifeLogAlertLevel(none, 10 * 3600)).toBe("");
  });
});

describe("quotaIsAchieved / streakRank", () => {
  it("targetMinutes=0 は常に未達成", () => {
    expect(quotaIsAchieved(makeQuota({ id: "q", name: "n", targetMinutes: 0 }), 99999)).toBe(false);
  });

  it("秒 >= target*60 で達成", () => {
    const q = makeQuota({ id: "q", name: "n", targetMinutes: 30 });
    expect(quotaIsAchieved(q, 30 * 60 - 1)).toBe(false);
    expect(quotaIsAchieved(q, 30 * 60)).toBe(true);
  });

  it("streakRank は 1/3/7/14 の閾値で段階的に上がる", () => {
    expect(streakRank(0)).toBe(0);
    expect(streakRank(1)).toBe(1);
    expect(streakRank(2)).toBe(1);
    expect(streakRank(3)).toBe(2);
    expect(streakRank(6)).toBe(2);
    expect(streakRank(7)).toBe(3);
    expect(streakRank(13)).toBe(3);
    expect(streakRank(14)).toBe(4);
    expect(streakRank(100)).toBe(4);
  });
});

describe("day range helpers", () => {
  it("getDayRangeForDate は境界時刻から 24h", () => {
    const r = getDayRangeForDate("2025-04-22", 4);
    expect(new Date(r.startMs).getHours()).toBe(4);
    expect(r.endMs - r.startMs).toBe(24 * 60 * 60 * 1000);
    expect(r.dateKey).toBe("2025-04-22");
  });

  it("getTodayDayRange は now < 境界なら前日基準", () => {
    // 2025-04-22 02:00, 境界 4時 → 前日 04:00 開始
    const now = new Date(2025, 3, 22, 2, 0, 0);
    const r = getTodayDayRange(4, now);
    expect(r.dateKey).toBe("2025-04-21");
    expect(new Date(r.startMs).getHours()).toBe(4);
    expect(new Date(r.startMs).getDate()).toBe(21);
  });

  it("getTodayDayRange は now >= 境界なら当日基準", () => {
    const now = new Date(2025, 3, 22, 5, 0, 0);
    const r = getTodayDayRange(4, now);
    expect(r.dateKey).toBe("2025-04-22");
  });
});
