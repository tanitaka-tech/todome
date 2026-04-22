import { describe, expect, it } from "bun:test";
import type {
  KanbanTask,
  LifeActivity,
  LifeLog,
  Quota,
  QuotaLog,
} from "../types.ts";
import { buildTimelineContext } from "./context.ts";

function makeTask(partial: Partial<KanbanTask> & Pick<KanbanTask, "id" | "title">): KanbanTask {
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

function makeActivity(partial: Partial<LifeActivity> & Pick<LifeActivity, "id" | "name">): LifeActivity {
  return {
    icon: "⏱",
    category: "other",
    softLimitMinutes: 0,
    hardLimitMinutes: 0,
    limitScope: "per_session",
    archived: false,
    ...partial,
  };
}

function makeQuota(partial: Partial<Quota> & Pick<Quota, "id" | "name">): Quota {
  return {
    icon: "🎯",
    targetMinutes: 30,
    archived: false,
    createdAt: "2026-04-22T00:00:00",
    ...partial,
  };
}

// タイムレンジ: 2026-04-22 04:00 〜 2026-04-23 04:00 (4 時境界)
const RANGE_START = new Date(2026, 3, 22, 4, 0, 0, 0).getTime();
const RANGE_END = RANGE_START + 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 3, 22, 14, 0, 0, 0).getTime();

function iso(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

describe("buildTimelineContext", () => {
  it("何も計測されていない日は空メッセージを返す", () => {
    const out = buildTimelineContext({
      nowMs: NOW,
      rangeStartMs: RANGE_START,
      rangeEndMs: RANGE_END,
      tasks: [],
      lifeActivities: [],
      lifeLogs: [],
      quotas: [],
      quotaLogs: [],
    });
    expect(out).toContain("=== 今日のタイムスケジュール ===");
    expect(out).toContain("現在時刻: 14:00");
    expect(out).toContain("今日はまだ計測されていません");
  });

  it("タスクの TimeLog と計測中タイマーを時系列で出力する", () => {
    const tasks: KanbanTask[] = [
      makeTask({
        id: "t1",
        title: "企画書作成",
        timeLogs: [
          {
            start: iso(new Date(2026, 3, 22, 9, 0, 0).getTime()),
            end: iso(new Date(2026, 3, 22, 10, 30, 0).getTime()),
            duration: 5400,
          },
        ],
      }),
      makeTask({
        id: "t2",
        title: "バグ修正",
        timerStartedAt: iso(new Date(2026, 3, 22, 13, 30, 0).getTime()),
      }),
    ];

    const out = buildTimelineContext({
      nowMs: NOW,
      rangeStartMs: RANGE_START,
      rangeEndMs: RANGE_END,
      tasks,
      lifeActivities: [],
      lifeLogs: [],
      quotas: [],
      quotaLogs: [],
    });

    expect(out).toContain("[タスク] 09:00–10:30 (1時間30分) 企画書作成");
    expect(out).toContain("[タスク] 13:30–14:00 (30分) バグ修正 [計測中]");
    const enkakuIdx = out.indexOf("企画書作成");
    const bugIdx = out.indexOf("バグ修正");
    expect(enkakuIdx).toBeLessThan(bugIdx);
  });

  it("LifeLog を activity の icon + 名前で表示し、endedAt 空なら計測中を付与", () => {
    const activities: LifeActivity[] = [
      makeActivity({ id: "a1", name: "遊び", icon: "🎮", category: "play" }),
    ];
    const logs: LifeLog[] = [
      {
        id: "l1",
        activityId: "a1",
        startedAt: iso(new Date(2026, 3, 22, 12, 0, 0).getTime()),
        endedAt: "",
        memo: "",
        alertTriggered: "",
      },
    ];
    const out = buildTimelineContext({
      nowMs: NOW,
      rangeStartMs: RANGE_START,
      rangeEndMs: RANGE_END,
      tasks: [],
      lifeActivities: activities,
      lifeLogs: logs,
      quotas: [],
      quotaLogs: [],
    });
    expect(out).toContain("[ライフログ] 12:00–14:00 (2時間) 🎮 遊び [計測中]");
  });

  it("ノルマ達成状況を集計し、達成済みに ✓ を付ける", () => {
    const quotas: Quota[] = [
      makeQuota({ id: "q1", name: "掃除", icon: "🧹", targetMinutes: 15 }),
      makeQuota({ id: "q2", name: "運動", icon: "🏃", targetMinutes: 30 }),
    ];
    const logs: QuotaLog[] = [
      {
        id: "ql1",
        quotaId: "q1",
        startedAt: iso(new Date(2026, 3, 22, 8, 0, 0).getTime()),
        endedAt: iso(new Date(2026, 3, 22, 8, 20, 0).getTime()),
        memo: "",
      },
      {
        id: "ql2",
        quotaId: "q2",
        startedAt: iso(new Date(2026, 3, 22, 9, 0, 0).getTime()),
        endedAt: iso(new Date(2026, 3, 22, 9, 10, 0).getTime()),
        memo: "",
      },
    ];
    const out = buildTimelineContext({
      nowMs: NOW,
      rangeStartMs: RANGE_START,
      rangeEndMs: RANGE_END,
      tasks: [],
      lifeActivities: [],
      lifeLogs: [],
      quotas,
      quotaLogs: logs,
    });
    expect(out).toContain("【ノルマ達成状況 (今日)】");
    expect(out).toContain("🧹 掃除: 20分 / 15分 ✓達成");
    expect(out).toContain("🏃 運動: 10分 / 30分");
    expect(out).not.toContain("🏃 運動: 10分 / 30分 ✓達成");
  });

  it("範囲外のログは除外される", () => {
    const tasks: KanbanTask[] = [
      makeTask({
        id: "t1",
        title: "昨日のタスク",
        timeLogs: [
          {
            start: iso(new Date(2026, 3, 21, 10, 0, 0).getTime()),
            end: iso(new Date(2026, 3, 21, 11, 0, 0).getTime()),
            duration: 3600,
          },
        ],
      }),
    ];
    const out = buildTimelineContext({
      nowMs: NOW,
      rangeStartMs: RANGE_START,
      rangeEndMs: RANGE_END,
      tasks,
      lifeActivities: [],
      lifeLogs: [],
      quotas: [],
      quotaLogs: [],
    });
    expect(out).not.toContain("昨日のタスク");
    expect(out).toContain("今日はまだ計測されていません");
  });

  it("入力配列を破壊的に変更しない", () => {
    const tasks: KanbanTask[] = [
      makeTask({
        id: "t1",
        title: "タスクA",
        timeLogs: [
          {
            start: iso(new Date(2026, 3, 22, 11, 0, 0).getTime()),
            end: iso(new Date(2026, 3, 22, 11, 30, 0).getTime()),
            duration: 1800,
          },
        ],
      }),
      makeTask({
        id: "t2",
        title: "タスクB",
        timeLogs: [
          {
            start: iso(new Date(2026, 3, 22, 9, 0, 0).getTime()),
            end: iso(new Date(2026, 3, 22, 9, 30, 0).getTime()),
            duration: 1800,
          },
        ],
      }),
    ];
    const snapshot = JSON.parse(JSON.stringify(tasks));
    buildTimelineContext({
      nowMs: NOW,
      rangeStartMs: RANGE_START,
      rangeEndMs: RANGE_END,
      tasks,
      lifeActivities: [],
      lifeLogs: [],
      quotas: [],
      quotaLogs: [],
    });
    expect(tasks).toEqual(snapshot);
  });

  it("archived ノルマは達成状況に表示されない", () => {
    const quotas: Quota[] = [
      makeQuota({ id: "q1", name: "掃除", icon: "🧹", archived: true }),
    ];
    const out = buildTimelineContext({
      nowMs: NOW,
      rangeStartMs: RANGE_START,
      rangeEndMs: RANGE_END,
      tasks: [],
      lifeActivities: [],
      lifeLogs: [],
      quotas,
      quotaLogs: [],
    });
    expect(out).not.toContain("【ノルマ達成状況");
  });
});
