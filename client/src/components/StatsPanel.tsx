import { useState } from "react";
import type { Goal, KanbanTask, TimeLog } from "../types";
import { formatDuration } from "../types";

interface Props {
  tasks: KanbanTask[];
  goals: Goal[];
  tick: number;
}

type Period = "day" | "month" | "year";

const COLORS = [
  "#9a5b2f", "#6366f1", "#d4a24e", "#10b981", "#f43f5e",
  "#8b5cf6", "#0ea5e9", "#f59e0b", "#64748b", "#ec4899",
];

function getColor(i: number) {
  return COLORS[i % COLORS.length];
}

// --- Period helpers ---

function formatPeriodLabel(date: Date, period: Period): string {
  if (period === "day") {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }
  if (period === "month") {
    return `${date.getFullYear()}/${date.getMonth() + 1}`;
  }
  return `${date.getFullYear()}`;
}

function getPeriodKey(date: Date, period: Period): string {
  if (period === "day") {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }
  if (period === "month") {
    return `${date.getFullYear()}-${date.getMonth()}`;
  }
  return `${date.getFullYear()}`;
}

function generatePeriods(period: Period): { key: string; label: string; start: Date; end: Date }[] {
  const now = new Date();
  const periods: { key: string; label: string; start: Date; end: Date }[] = [];
  const count = period === "day" ? 14 : period === "month" ? 12 : 5;

  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now);
    if (period === "day") {
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const end = new Date(d);
      end.setDate(end.getDate() + 1);
      periods.push({
        key: getPeriodKey(d, period),
        label: formatPeriodLabel(d, period),
        start: d,
        end,
      });
    } else if (period === "month") {
      d.setMonth(d.getMonth() - i, 1);
      d.setHours(0, 0, 0, 0);
      const end = new Date(d);
      end.setMonth(end.getMonth() + 1);
      periods.push({
        key: getPeriodKey(d, period),
        label: formatPeriodLabel(d, period),
        start: d,
        end,
      });
    } else {
      d.setFullYear(d.getFullYear() - i, 0, 1);
      d.setHours(0, 0, 0, 0);
      const end = new Date(d);
      end.setFullYear(end.getFullYear() + 1);
      periods.push({
        key: getPeriodKey(d, period),
        label: formatPeriodLabel(d, period),
        start: d,
        end,
      });
    }
  }
  return periods;
}

function aggregateByGoalAndPeriod(
  tasks: KanbanTask[],
  goals: Goal[],
  period: Period,
) {
  const periods = generatePeriods(period);
  const goalMap = new Map(goals.map((g) => [g.id, g.name]));

  // Collect all logs
  const allLogs: (TimeLog & { goalId: string })[] = [];
  for (const task of tasks) {
    for (const log of task.timeLogs) {
      allLogs.push({ ...log, goalId: task.goalId });
    }
  }

  // goalId → periodKey → seconds
  const data: Record<string, Record<string, number>> = {};
  const goalIds = new Set<string>();

  for (const log of allLogs) {
    const logStart = new Date(log.start);
    for (const p of periods) {
      if (logStart >= p.start && logStart < p.end) {
        const gId = log.goalId || "__none__";
        goalIds.add(gId);
        if (!data[gId]) data[gId] = {};
        data[gId][p.key] = (data[gId][p.key] || 0) + log.duration;
        break;
      }
    }
  }

  const goalList = Array.from(goalIds).map((id) => ({
    id,
    name: id === "__none__" ? "目標なし" : (goalMap.get(id) || "不明"),
  }));

  return { periods, data, goalList };
}

// --- Pie Chart ---
function PieChart({ slices }: { slices: { label: string; value: number; color: string }[] }) {
  const total = slices.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return <div className="stats-empty">データがありません</div>;
  }

  let cumAngle = -Math.PI / 2;
  const paths = slices.filter((s) => s.value > 0).map((slice) => {
    const angle = (slice.value / total) * Math.PI * 2;
    const startX = 100 + 80 * Math.cos(cumAngle);
    const startY = 100 + 80 * Math.sin(cumAngle);
    cumAngle += angle;
    const endX = 100 + 80 * Math.cos(cumAngle);
    const endY = 100 + 80 * Math.sin(cumAngle);
    const large = angle > Math.PI ? 1 : 0;
    const d =
      slices.filter((s) => s.value > 0).length === 1
        ? `M 100 20 A 80 80 0 1 1 99.99 20 Z`
        : `M 100 100 L ${startX} ${startY} A 80 80 0 ${large} 1 ${endX} ${endY} Z`;
    return { ...slice, d, pct: ((slice.value / total) * 100).toFixed(1) };
  });

  return (
    <div className="pie-chart-wrap">
      <svg viewBox="0 0 200 200" className="pie-chart-svg">
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill={p.color} stroke="white" strokeWidth="2" />
        ))}
      </svg>
      <div className="pie-legend">
        {paths.map((p, i) => (
          <div key={i} className="pie-legend-item">
            <span className="pie-legend-dot" style={{ background: p.color }} />
            <span className="pie-legend-label">{p.label}</span>
            <span className="pie-legend-value">
              {formatDuration(p.value)} ({p.pct}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Bar Chart ---
function BarChart({
  periods,
  data,
  goalList,
}: {
  periods: { key: string; label: string }[];
  data: Record<string, Record<string, number>>;
  goalList: { id: string; name: string }[];
}) {
  // Find max value for scaling
  let maxVal = 0;
  for (const p of periods) {
    let sum = 0;
    for (const g of goalList) {
      sum += data[g.id]?.[p.key] || 0;
    }
    maxVal = Math.max(maxVal, sum);
  }

  if (maxVal === 0) {
    return <div className="stats-empty">データがありません</div>;
  }

  const barW = Math.max(16, Math.min(40, 600 / periods.length - 8));
  const chartH = 180;

  return (
    <div className="bar-chart-wrap">
      <div className="bar-chart">
        {periods.map((p) => {
          let y = 0;
          const segments: { goalId: string; height: number; color: string }[] = [];
          for (let gi = 0; gi < goalList.length; gi++) {
            const val = data[goalList[gi].id]?.[p.key] || 0;
            if (val > 0) {
              const h = (val / maxVal) * chartH;
              segments.push({ goalId: goalList[gi].id, height: h, color: getColor(gi) });
              y += h;
            }
          }
          const totalSec = goalList.reduce((s, g) => s + (data[g.id]?.[p.key] || 0), 0);
          return (
            <div key={p.key} className="bar-column" style={{ width: barW }}>
              <div className="bar-stack" style={{ height: chartH }}>
                {segments.map((seg, i) => (
                  <div
                    key={i}
                    className="bar-segment"
                    style={{
                      height: seg.height,
                      background: seg.color,
                    }}
                    title={`${goalList.find((g) => g.id === seg.goalId)?.name}: ${formatDuration(
                      data[seg.goalId]?.[p.key] || 0,
                    )}`}
                  />
                ))}
              </div>
              {totalSec > 0 && (
                <div className="bar-value">{formatDuration(totalSec)}</div>
              )}
              <div className="bar-label">{p.label}</div>
            </div>
          );
        })}
      </div>
      <div className="bar-legend">
        {goalList.map((g, i) => (
          <div key={g.id} className="pie-legend-item">
            <span className="pie-legend-dot" style={{ background: getColor(i) }} />
            <span className="pie-legend-label">{g.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatsPanel({ tasks, goals, tick: _tick }: Props) {
  const [period, setPeriod] = useState<Period>("day");

  // Pie: total time by goal
  const goalTimeMap: Record<string, number> = {};
  for (const task of tasks) {
    const gId = task.goalId || "__none__";
    goalTimeMap[gId] = (goalTimeMap[gId] || 0) + task.timeSpent;
    // Include running timer
    if (task.timerStartedAt) {
      const running = Math.floor(
        (Date.now() - new Date(task.timerStartedAt).getTime()) / 1000,
      );
      goalTimeMap[gId] = (goalTimeMap[gId] || 0) + running;
    }
  }

  const goalNameMap = new Map(goals.map((g) => [g.id, g.name]));
  const pieSlices = Object.entries(goalTimeMap)
    .filter(([, v]) => v > 0)
    .map(([gId, v], i) => ({
      label: gId === "__none__" ? "目標なし" : (goalNameMap.get(gId) || "不明"),
      value: v,
      color: getColor(i),
    }));

  // Bar: by period
  const { periods, data, goalList } = aggregateByGoalAndPeriod(tasks, goals, period);

  const totalTime = Object.values(goalTimeMap).reduce((s, v) => s + v, 0);
  const completedCount = tasks.filter((t) => t.completedAt).length;

  return (
    <div className="stats-panel">
      <div className="stats-header">
        <h2 className="stats-title">統計</h2>
      </div>

      <div className="stats-summary">
        <div className="stats-summary-card">
          <div className="stats-summary-value">{formatDuration(totalTime)}</div>
          <div className="stats-summary-label">合計作業時間</div>
        </div>
        <div className="stats-summary-card">
          <div className="stats-summary-value">{completedCount}</div>
          <div className="stats-summary-label">完了タスク</div>
        </div>
        <div className="stats-summary-card">
          <div className="stats-summary-value">{tasks.length}</div>
          <div className="stats-summary-label">全タスク</div>
        </div>
      </div>

      <section className="stats-section">
        <h3 className="stats-section-title">目標別 作業時間</h3>
        <PieChart slices={pieSlices} />
      </section>

      <section className="stats-section">
        <div className="stats-section-header">
          <h3 className="stats-section-title">作業時間の推移</h3>
          <div className="stats-period-tabs">
            {(["day", "month", "year"] as const).map((p) => (
              <button
                key={p}
                className={`stats-period-tab ${period === p ? "stats-period-tab--active" : ""}`}
                onClick={() => setPeriod(p)}
              >
                {p === "day" ? "日" : p === "month" ? "月" : "年"}
              </button>
            ))}
          </div>
        </div>
        <BarChart periods={periods} data={data} goalList={goalList} />
      </section>
    </div>
  );
}
