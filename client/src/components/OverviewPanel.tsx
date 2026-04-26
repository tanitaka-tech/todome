import { useMemo } from "react";
import { useTick } from "../hooks/useTick";
import { useTranslation } from "react-i18next";
import { formatDate, formatDateTime } from "../i18n/format";
import type {
  Goal,
  KanbanTask,
  LifeActivity,
  LifeLog,
  Quota,
  QuotaLog,
  Schedule,
} from "../types";
import {
  formatDuration,
  getTodayDayRange,
  logSecondsInRange,
  totalSeconds,
} from "../types";
import { TimelineBar } from "./TimelineBar";

interface Props {
  tasks: KanbanTask[];
  goals: Goal[];
  onOpenBoard: () => void;
  onCardClick: (task: KanbanTask) => void;
  lifeActivities: LifeActivity[];
  lifeLogs: LifeLog[];
  quotas: Quota[];
  quotaLogs: QuotaLog[];
  schedules: Schedule[];
  dayBoundaryHour: number;
}

const COLUMN_COLORS: Record<string, string> = {
  todo: "var(--fg-muted)",
  in_progress: "var(--warning)",
  done: "var(--success)",
};

function isoInRange(iso: string, startMs: number, endMs: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= startMs && t < endMs;
}

function computeTodaySeconds(
  tasks: KanbanTask[],
  rangeStartMs: number,
  rangeEndMs: number,
): number {
  const nowMs = Date.now();
  return tasks.reduce(
    (s, t) => s + todaySecondsOfTask(t, rangeStartMs, rangeEndMs, nowMs),
    0,
  );
}

function todaySecondsOfTask(
  task: KanbanTask,
  rangeStartMs: number,
  rangeEndMs: number,
  nowMs: number,
): number {
  let sum = 0;
  for (const log of task.timeLogs) {
    const start = new Date(log.start).getTime();
    if (Number.isNaN(start)) continue;
    const end = start + log.duration * 1000;
    const clippedStart = Math.max(start, rangeStartMs);
    const clippedEnd = Math.min(end, rangeEndMs);
    if (clippedEnd > clippedStart) {
      sum += Math.floor((clippedEnd - clippedStart) / 1000);
    }
  }
  if (task.timerStartedAt) {
    sum += logSecondsInRange(
      task.timerStartedAt,
      "",
      rangeStartMs,
      rangeEndMs,
      nowMs,
    );
  }
  return sum;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function dayKeyWithBoundary(iso: string, boundaryHour: number): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getHours() < boundaryHour) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

interface DayStat {
  completed: number;
  seconds: number;
}

function buildDayStats(
  tasks: KanbanTask[],
  boundaryHour: number,
): Record<string, DayStat> {
  const nowMs = Date.now();
  const byDay: Record<string, DayStat> = {};
  const add = (key: string | null, completed: number, seconds: number) => {
    if (!key) return;
    const entry = (byDay[key] ??= { completed: 0, seconds: 0 });
    entry.completed += completed;
    entry.seconds += seconds;
  };
  for (const task of tasks) {
    if (task.completedAt) add(dayKeyWithBoundary(task.completedAt, boundaryHour), 1, 0);
    for (const log of task.timeLogs) {
      add(dayKeyWithBoundary(log.start, boundaryHour), 0, log.duration);
    }
    if (task.timerStartedAt) {
      const elapsed = Math.max(
        0,
        Math.floor((nowMs - new Date(task.timerStartedAt).getTime()) / 1000),
      );
      add(dayKeyWithBoundary(task.timerStartedAt, boundaryHour), 0, elapsed);
    }
  }
  return byDay;
}

const PROGRESS_MIN_SECONDS = 30 * 60;

function computeProgressStreak(
  dayStats: Record<string, DayStat>,
  todayKey: string,
): { current: number; best: number } {
  const progressDays = Object.entries(dayStats)
    .filter(([, v]) => v.completed >= 1 || v.seconds >= PROGRESS_MIN_SECONDS)
    .map(([k]) => k)
    .sort();
  if (progressDays.length === 0) return { current: 0, best: 0 };

  let best = 1;
  let run = 1;
  for (let i = 1; i < progressDays.length; i++) {
    const prev = new Date(`${progressDays[i - 1]}T00:00:00`);
    const cur = new Date(`${progressDays[i]}T00:00:00`);
    const diff = Math.round((cur.getTime() - prev.getTime()) / 86400000);
    if (diff === 1) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 1;
    }
  }

  const today = new Date(`${todayKey}T00:00:00`);
  const last = progressDays[progressDays.length - 1]!;
  const lastDate = new Date(`${last}T00:00:00`);
  const gap = Math.round((today.getTime() - lastDate.getTime()) / 86400000);
  if (gap > 1) return { current: 0, best };

  let current = 1;
  let cursor = lastDate;
  for (let i = progressDays.length - 2; i >= 0; i--) {
    const prev = new Date(`${progressDays[i]}T00:00:00`);
    const diff = Math.round((cursor.getTime() - prev.getTime()) / 86400000);
    if (diff === 1) {
      current += 1;
      cursor = prev;
    } else break;
  }
  return { current, best: Math.max(best, current) };
}

function computeWeeklyAvgRatio(
  dayStats: Record<string, DayStat>,
  todayKey: string,
  todaySeconds: number,
): number | null {
  const today = new Date(`${todayKey}T00:00:00`);
  let sum = 0;
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today.getTime() - i * 86400000);
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    sum += dayStats[key]?.seconds ?? 0;
  }
  const avg = sum / 7;
  if (avg <= 0) return null;
  return Math.round(((todaySeconds - avg) / avg) * 100);
}

export function OverviewPanel({
  tasks,
  goals,
  onOpenBoard,
  onCardClick,
  lifeActivities,
  lifeLogs,
  quotas,
  quotaLogs,
  schedules,
  dayBoundaryHour,
}: Props) {
  const { t } = useTranslation("overview");
  const _tick = useTick();
  const todayRange = useMemo(
    () => getTodayDayRange(dayBoundaryHour),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayBoundaryHour, _tick],
  );
  const todaySeconds = useMemo(
    () => computeTodaySeconds(tasks, todayRange.startMs, todayRange.endMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, todayRange, _tick],
  );

  const totalTimeSeconds = useMemo(() => {
    return tasks.reduce((s, t) => s + totalSeconds(t), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, _tick]);

  const completedToday = tasks.filter((t) =>
    isoInRange(t.completedAt, todayRange.startMs, todayRange.endMs),
  ).length;
  const inProgress = tasks.filter((t) => t.column === "in_progress").length;
  const todoCount = tasks.filter((t) => t.column === "todo").length;

  const dayStats = useMemo(
    () => buildDayStats(tasks, dayBoundaryHour),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, dayBoundaryHour, _tick],
  );
  const streak = useMemo(
    () => computeProgressStreak(dayStats, todayRange.dateKey),
    [dayStats, todayRange.dateKey],
  );
  const weeklyRatio = useMemo(
    () => computeWeeklyAvgRatio(dayStats, todayRange.dateKey, todaySeconds),
    [dayStats, todayRange.dateKey, todaySeconds],
  );

  const recentActive = useMemo(() => {
    return [...tasks]
      .filter((t) => t.column !== "done")
      .sort((a, b) => {
        if (!!a.timerStartedAt !== !!b.timerStartedAt)
          return a.timerStartedAt ? -1 : 1;
        return totalSeconds(b) - totalSeconds(a);
      })
      .slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, _tick]);

  const recentDone = useMemo(() => {
    return [...tasks]
      .filter((t) => t.completedAt)
      .sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""))
      .slice(0, 5);
  }, [tasks]);

  const goalProgress = useMemo(() => {
    const byGoal: Record<string, number> = {};
    for (const t of tasks) {
      const gId = t.goalId || "__none__";
      byGoal[gId] = (byGoal[gId] || 0) + totalSeconds(t);
    }
    const max = Math.max(1, ...Object.values(byGoal));
    return goals
      .map((g) => ({
        id: g.id,
        name: g.name,
        seconds: byGoal[g.id] || 0,
        pct: Math.round(((byGoal[g.id] || 0) / max) * 100),
      }))
      .filter((g) => g.seconds > 0)
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, goals, _tick]);

  return (
    <div className="overview-panel">
      <div className="page-head">
        <div className="page-head-title-wrap">
          <h1 className="page-title">{t("pageTitle")}</h1>
          <div className="page-subtitle">
            {formatDate(new Date(), {
              year: "numeric",
              month: "long",
              day: "numeric",
              weekday: "long",
            })}
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn--primary" onClick={onOpenBoard}>
            {t("openBoard")}
          </button>
        </div>
      </div>

      <div className="page-body">
        <div className="overview-grid">
          <div className="widget col-3">
            <div className="kpi-tile">
              <div className="kpi-label">{t("kpiTodayWork")}</div>
              <div className="kpi-value kpi-value--accent">
                {formatDuration(todaySeconds)}
              </div>
              <div
                className={`kpi-delta${
                  weeklyRatio !== null && weeklyRatio > 0
                    ? " kpi-delta--up"
                    : weeklyRatio !== null && weeklyRatio < 0
                      ? " kpi-delta--down"
                      : ""
                }`}
              >
                {weeklyRatio === null
                  ? t("kpiTodayWorkDeltaNoAvg", {
                      total: formatDuration(totalTimeSeconds),
                    })
                  : t("kpiTodayWorkDelta", {
                      total: formatDuration(totalTimeSeconds),
                      ratio: `${weeklyRatio > 0 ? "+" : ""}${weeklyRatio}%`,
                    })}
              </div>
            </div>
          </div>
          <div className="widget col-3">
            <div className="kpi-tile">
              <div className="kpi-label">{t("kpiTodayDone")}</div>
              <div className="kpi-value">{completedToday}</div>
            </div>
          </div>
          <div className="widget col-3">
            <div className="kpi-tile">
              <div className="kpi-label">{t("kpiInProgress")}</div>
              <div className="kpi-value">{inProgress}</div>
              <div className="kpi-delta">
                {t("kpiInProgressSub", { todo: todoCount, total: tasks.length })}
              </div>
            </div>
          </div>
          <div className="widget col-3">
            <div className="kpi-tile">
              <div className="kpi-label">{t("kpiStreak")}</div>
              <div
                className="kpi-value"
                style={{
                  color:
                    streak.current > 0 ? "var(--accent)" : "var(--fg-muted)",
                }}
              >
                {streak.current > 0
                  ? t("kpiStreakDays", { count: streak.current })
                  : "—"}
              </div>
              <div className="kpi-delta">
                {streak.best > 0
                  ? t("kpiStreakBest", { count: streak.best })
                  : t("kpiStreakNone")}
              </div>
            </div>
          </div>

          <div className="widget col-12">
            <div className="widget-head widget-head--flush">
              <span className="widget-title">
                {t("sectionTimeline", "今日のスケジュール")}
              </span>
            </div>
            <div className="widget-body">
              <TimelineBar
                rangeStartMs={todayRange.startMs}
                rangeEndMs={todayRange.endMs}
                schedules={schedules}
                tasks={tasks}
                lifeLogs={lifeLogs}
                lifeActivities={lifeActivities}
                quotas={quotas}
                quotaLogs={quotaLogs}
                tick={_tick}
                autoScrollToNow
              />
            </div>
          </div>

          <div className="widget col-8">
            <div className="widget-head">
              <span className="widget-title">{t("sectionActive")}</span>
              <span className="widget-sub">
                {t("sectionActiveCount", { count: recentActive.length })}
              </span>
            </div>
            <div className="widget-body widget-body--flush">
              {recentActive.length === 0 ? (
                <div className="overview-empty">{t("emptyActive")}</div>
              ) : (
                recentActive.map((t) => (
                  <div
                    key={t.id}
                    className="overview-task-row"
                    onClick={() => onCardClick(t)}
                  >
                    <span
                      className="overview-task-dot"
                      style={{ background: COLUMN_COLORS[t.column] }}
                    />
                    <span className="overview-task-title">{t.title}</span>
                    <span className="overview-task-time">
                      {formatDuration(totalSeconds(t))}
                      {t.estimatedMinutes > 0 &&
                        ` / ${formatDuration(t.estimatedMinutes * 60)}`}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="widget col-4">
            <div className="widget-head">
              <span className="widget-title">{t("sectionGoalTime")}</span>
            </div>
            <div className="widget-body widget-body--flush">
              {goalProgress.length === 0 ? (
                <div className="overview-empty">{t("emptyGoalTime")}</div>
              ) : (
                goalProgress.map((g) => (
                  <div key={g.id} className="goal-progress-row">
                    <div className="goal-progress-head">
                      <span className="goal-progress-name">{g.name}</span>
                      <span className="goal-progress-val">
                        {formatDuration(g.seconds)}
                      </span>
                    </div>
                    <div className="goal-progress-bar">
                      <div
                        className="goal-progress-bar-fill"
                        style={{ width: `${g.pct}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="widget col-12">
            <div className="widget-head">
              <span className="widget-title">{t("sectionRecentDone")}</span>
              <span className="widget-sub">
                {t("sectionRecentDoneCount", { count: recentDone.length })}
              </span>
            </div>
            <div className="widget-body widget-body--flush">
              {recentDone.length === 0 ? (
                <div className="overview-empty">{t("emptyRecentDone")}</div>
              ) : (
                recentDone.map((t) => (
                  <div
                    key={t.id}
                    className="overview-task-row"
                    onClick={() => onCardClick(t)}
                  >
                    <span
                      className="overview-task-dot"
                      style={{ background: "var(--success)" }}
                    />
                    <span className="overview-task-title">{t.title}</span>
                    <span className="overview-task-time">
                      {t.completedAt &&
                        formatDateTime(new Date(t.completedAt), {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      {" · "}
                      {formatDuration(totalSeconds(t))}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
