import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatDate, formatDateTime } from "../i18n/format";
import type {
  Goal,
  KanbanTask,
  LifeActivity,
  LifeLog,
  Quota,
  QuotaLog,
} from "../types";
import { formatDuration, getTodayDayRange, totalSeconds } from "../types";
import { TimelineBar } from "./TimelineBar";

interface Props {
  tasks: KanbanTask[];
  goals: Goal[];
  tick: number;
  onOpenBoard: () => void;
  onCardClick: (task: KanbanTask) => void;
  lifeActivities: LifeActivity[];
  lifeLogs: LifeLog[];
  quotas: Quota[];
  quotaLogs: QuotaLog[];
  dayBoundaryHour: number;
}

const COLUMN_COLORS: Record<string, string> = {
  todo: "var(--fg-muted)",
  in_progress: "var(--warning)",
  done: "var(--success)",
};

function isToday(iso: string): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
}

function todaySecondsOfTask(task: KanbanTask): number {
  let sum = 0;
  for (const log of task.timeLogs) {
    if (isToday(log.start)) sum += log.duration;
  }
  if (task.timerStartedAt && isToday(task.timerStartedAt)) {
    sum += Math.floor(
      (Date.now() - new Date(task.timerStartedAt).getTime()) / 1000,
    );
  }
  return sum;
}

export function OverviewPanel({
  tasks,
  goals,
  tick: _tick,
  onOpenBoard,
  onCardClick,
  lifeActivities,
  lifeLogs,
  quotas,
  quotaLogs,
  dayBoundaryHour,
}: Props) {
  const { t } = useTranslation("overview");
  const [timelineOrientation, setTimelineOrientation] = useState<
    "vertical" | "horizontal"
  >(() => {
    const saved = localStorage.getItem("timeline:orientation");
    return saved === "horizontal" ? "horizontal" : "vertical";
  });
  const setOrientation = (o: "vertical" | "horizontal") => {
    setTimelineOrientation(o);
    localStorage.setItem("timeline:orientation", o);
  };
  const todayRange = useMemo(
    () => getTodayDayRange(dayBoundaryHour),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayBoundaryHour, _tick],
  );
  const activeTask = tasks.find((t) => t.timerStartedAt);

  const todaySeconds = useMemo(() => {
    return tasks.reduce((s, t) => s + todaySecondsOfTask(t), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, _tick]);

  const totalTimeSeconds = useMemo(() => {
    return tasks.reduce((s, t) => s + totalSeconds(t), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, _tick]);

  const completedToday = tasks.filter((t) => isToday(t.completedAt)).length;
  const totalCompleted = tasks.filter((t) => !!t.completedAt).length;
  const inProgress = tasks.filter((t) => t.column === "in_progress").length;
  const todoCount = tasks.filter((t) => t.column === "todo").length;

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
              <div className="kpi-delta">
                {t("kpiTotalSuffix", { total: formatDuration(totalTimeSeconds) })}
              </div>
            </div>
          </div>
          <div className="widget col-3">
            <div className="kpi-tile">
              <div className="kpi-label">{t("kpiTodayDone")}</div>
              <div className="kpi-value">{completedToday}</div>
              <div className="kpi-delta">
                {t("kpiTotalSuffix", { total: totalCompleted })}
              </div>
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
              <div className="kpi-label">{t("kpiActiveTimer")}</div>
              <div
                className="kpi-value"
                style={{
                  color: activeTask ? "var(--accent)" : "var(--fg-muted)",
                  fontSize: activeTask ? 20 : 22,
                }}
              >
                {activeTask ? formatDuration(totalSeconds(activeTask)) : "—"}
              </div>
              <div
                className="kpi-delta"
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {activeTask ? activeTask.title : t("kpiNoActiveTask")}
              </div>
            </div>
          </div>

          <div className="widget col-12">
            <div className="widget-head">
              <span className="widget-title">
                {t("sectionTimeline", "今日のタイムスケジュール")}
              </span>
              <div className="retro-view-toggle" role="group">
                <button
                  type="button"
                  className={`retro-view-toggle-btn${timelineOrientation === "vertical" ? " retro-view-toggle-btn--active" : ""}`}
                  onClick={() => setOrientation("vertical")}
                >
                  {t("timelineOrientVertical", "縦")}
                </button>
                <button
                  type="button"
                  className={`retro-view-toggle-btn${timelineOrientation === "horizontal" ? " retro-view-toggle-btn--active" : ""}`}
                  onClick={() => setOrientation("horizontal")}
                >
                  {t("timelineOrientHorizontal", "横")}
                </button>
              </div>
            </div>
            <div className="widget-body">
              <TimelineBar
                rangeStartMs={todayRange.startMs}
                rangeEndMs={todayRange.endMs}
                tasks={tasks}
                lifeLogs={lifeLogs}
                lifeActivities={lifeActivities}
                quotas={quotas}
                quotaLogs={quotaLogs}
                tick={_tick}
                autoScrollToNow
                orientation={timelineOrientation}
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
