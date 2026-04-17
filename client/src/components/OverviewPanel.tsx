import { useMemo } from "react";
import type { Goal, KanbanTask } from "../types";
import { formatDuration, totalSeconds } from "../types";

interface Props {
  tasks: KanbanTask[];
  goals: Goal[];
  tick: number;
  onOpenBoard: () => void;
  onCardClick: (task: KanbanTask) => void;
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
}: Props) {
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
          <h1 className="page-title">Overview</h1>
          <div className="page-subtitle">
            {new Date().toLocaleDateString("ja-JP", {
              year: "numeric",
              month: "long",
              day: "numeric",
              weekday: "long",
            })}
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn--primary" onClick={onOpenBoard}>
            ボードを開く →
          </button>
        </div>
      </div>

      <div className="page-body">
        <div className="overview-grid">
          <div className="widget col-3">
            <div className="kpi-tile">
              <div className="kpi-label">Today · 作業時間</div>
              <div className="kpi-value kpi-value--accent">
                {formatDuration(todaySeconds)}
              </div>
              <div className="kpi-delta">
                累計 {formatDuration(totalTimeSeconds)}
              </div>
            </div>
          </div>
          <div className="widget col-3">
            <div className="kpi-tile">
              <div className="kpi-label">Today · 完了</div>
              <div className="kpi-value">{completedToday}</div>
              <div className="kpi-delta">累計 {totalCompleted}</div>
            </div>
          </div>
          <div className="widget col-3">
            <div className="kpi-tile">
              <div className="kpi-label">進行中タスク</div>
              <div className="kpi-value">{inProgress}</div>
              <div className="kpi-delta">
                TODO {todoCount} · 全 {tasks.length}
              </div>
            </div>
          </div>
          <div className="widget col-3">
            <div className="kpi-tile">
              <div className="kpi-label">Active timer</div>
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
                {activeTask ? activeTask.title : "計測中のタスクなし"}
              </div>
            </div>
          </div>

          <div className="widget col-8">
            <div className="widget-head">
              <span className="widget-title">作業中のタスク</span>
              <span className="widget-sub">{recentActive.length} items</span>
            </div>
            <div className="widget-body widget-body--flush">
              {recentActive.length === 0 ? (
                <div className="overview-empty">進行中のタスクはありません</div>
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
              <span className="widget-title">目標別 作業時間</span>
            </div>
            <div className="widget-body widget-body--flush">
              {goalProgress.length === 0 ? (
                <div className="overview-empty">
                  目標に紐付いた作業記録はありません
                </div>
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
              <span className="widget-title">最近完了</span>
              <span className="widget-sub">last {recentDone.length}</span>
            </div>
            <div className="widget-body widget-body--flush">
              {recentDone.length === 0 ? (
                <div className="overview-empty">完了したタスクはまだありません</div>
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
                        new Date(t.completedAt).toLocaleString("ja-JP", {
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
