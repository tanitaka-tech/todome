import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Goal, KanbanTask, TimeLog } from "../types";
import { formatDuration } from "../types";

interface Props {
  tasks: KanbanTask[];
  goals: Goal[];
  tick: number;
}

type Period = "day" | "month" | "year";

const COLORS = [
  "#8a5ff0", "#6366f1", "#d4a24e", "#10b981", "#f43f5e",
  "#06b6d4", "#0ea5e9", "#f59e0b", "#64748b", "#ec4899",
];

function getColor(i: number) {
  return COLORS[i % COLORS.length];
}

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
  noGoalLabel: string,
  unknownGoalLabel: string,
) {
  const periods = generatePeriods(period);
  const goalMap = new Map(goals.map((g) => [g.id, g.name]));

  const allLogs: (TimeLog & { goalId: string })[] = [];
  for (const task of tasks) {
    for (const log of task.timeLogs) {
      allLogs.push({ ...log, goalId: task.goalId });
    }
  }

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
    name: id === "__none__" ? noGoalLabel : (goalMap.get(id) || unknownGoalLabel),
  }));

  return { periods, data, goalList };
}

function PieChart({
  slices,
  emptyLabel,
}: {
  slices: { label: string; value: number; color: string }[];
  emptyLabel: string;
}) {
  const total = slices.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return <div className="stats-empty">{emptyLabel}</div>;
  }

  const filtered = slices.filter((s) => s.value > 0);
  const angles = filtered.map((s) => (s.value / total) * Math.PI * 2);
  const startAngles = angles.map((_, i) =>
    angles.slice(0, i).reduce((acc, a) => acc + a, -Math.PI / 2),
  );
  const paths = filtered.map((slice, i) => {
    const angle = angles[i];
    const startAngle = startAngles[i];
    const endAngle = startAngle + angle;
    const startX = 100 + 80 * Math.cos(startAngle);
    const startY = 100 + 80 * Math.sin(startAngle);
    const endX = 100 + 80 * Math.cos(endAngle);
    const endY = 100 + 80 * Math.sin(endAngle);
    const large = angle > Math.PI ? 1 : 0;
    const d =
      filtered.length === 1
        ? `M 100 20 A 80 80 0 1 1 99.99 20 Z`
        : `M 100 100 L ${startX} ${startY} A 80 80 0 ${large} 1 ${endX} ${endY} Z`;
    return { ...slice, d, pct: ((slice.value / total) * 100).toFixed(1) };
  });

  return (
    <div className="pie-chart-wrap">
      <svg viewBox="0 0 200 200" className="pie-chart-svg">
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill={p.color} />
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

function BarChart({
  periods,
  data,
  goalList,
  emptyLabel,
}: {
  periods: { key: string; label: string }[];
  data: Record<string, Record<string, number>>;
  goalList: { id: string; name: string }[];
  emptyLabel: string;
}) {
  let maxVal = 0;
  for (const p of periods) {
    let sum = 0;
    for (const g of goalList) {
      sum += data[g.id]?.[p.key] || 0;
    }
    maxVal = Math.max(maxVal, sum);
  }

  if (maxVal === 0) {
    return <div className="stats-empty">{emptyLabel}</div>;
  }

  const barW = Math.max(16, Math.min(40, 600 / periods.length - 8));
  const chartH = 180;

  return (
    <div className="bar-chart-wrap">
      <div className="bar-chart">
        {periods.map((p) => {
          const segments: { goalId: string; height: number; color: string }[] = [];
          for (let gi = 0; gi < goalList.length; gi++) {
            const val = data[goalList[gi].id]?.[p.key] || 0;
            if (val > 0) {
              const h = (val / maxVal) * chartH;
              segments.push({
                goalId: goalList[gi].id,
                height: h,
                color: getColor(gi),
              });
            }
          }
          const totalSec = goalList.reduce(
            (s, g) => s + (data[g.id]?.[p.key] || 0),
            0,
          );
          return (
            <div key={p.key} className="bar-column" style={{ width: barW }}>
              <div className="bar-stack" style={{ height: chartH }}>
                {segments.map((seg, i) => (
                  <div
                    key={i}
                    className="bar-segment"
                    style={{ height: seg.height, background: seg.color }}
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
            <span
              className="pie-legend-dot"
              style={{ background: getColor(i) }}
            />
            <span className="pie-legend-label">{g.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatsPanel({ tasks, goals, tick: _tick }: Props) {
  const { t } = useTranslation("stats");
  const [period, setPeriod] = useState<Period>("day");
  const noGoalLabel = t("noGoalLabel");
  const unknownGoalLabel = t("unknownGoalLabel");

  const goalTimeMap: Record<string, number> = {};
  for (const task of tasks) {
    const gId = task.goalId || "__none__";
    goalTimeMap[gId] = (goalTimeMap[gId] || 0) + task.timeSpent;
    if (task.timerStartedAt) {
      const running = Math.floor(
        // eslint-disable-next-line react-hooks/purity
        (Date.now() - new Date(task.timerStartedAt).getTime()) / 1000,
      );
      goalTimeMap[gId] = (goalTimeMap[gId] || 0) + running;
    }
  }

  const goalNameMap = new Map(goals.map((g) => [g.id, g.name]));
  const pieSlices = Object.entries(goalTimeMap)
    .filter(([, v]) => v > 0)
    .map(([gId, v], i) => ({
      label: gId === "__none__" ? noGoalLabel : (goalNameMap.get(gId) || unknownGoalLabel),
      value: v,
      color: getColor(i),
    }));

  const { periods, data, goalList } = aggregateByGoalAndPeriod(
    tasks,
    goals,
    period,
    noGoalLabel,
    unknownGoalLabel,
  );

  const totalTime = Object.values(goalTimeMap).reduce((s, v) => s + v, 0);
  const completedCount = tasks.filter((t) => t.completedAt).length;

  const periodLabels: Record<Period, string> = {
    day: t("periodDay"),
    month: t("periodMonth"),
    year: t("periodYear"),
  };

  return (
    <div className="stats-panel">
      <div className="page-head">
        <div className="page-head-title-wrap">
          <h1 className="page-title">{t("pageTitle")}</h1>
          <div className="page-subtitle">{t("pageSubtitle")}</div>
        </div>
      </div>

      <div className="page-body">
        <div className="stats-summary">
          <div className="widget">
            <div className="kpi-tile">
              <div className="kpi-label">{t("summaryTotal")}</div>
              <div className="kpi-value kpi-value--accent">
                {formatDuration(totalTime)}
              </div>
            </div>
          </div>
          <div className="widget">
            <div className="kpi-tile">
              <div className="kpi-label">{t("summaryCompleted")}</div>
              <div className="kpi-value">{completedCount}</div>
            </div>
          </div>
          <div className="widget">
            <div className="kpi-tile">
              <div className="kpi-label">{t("summaryAll")}</div>
              <div className="kpi-value">{tasks.length}</div>
            </div>
          </div>
        </div>

        <div className="overview-grid">
          <div className="widget col-6">
            <div className="widget-head">
              <span className="widget-title">{t("sectionTimeByGoal")}</span>
            </div>
            <div className="widget-body">
              <PieChart slices={pieSlices} emptyLabel={t("noData")} />
            </div>
          </div>

          <div className="widget col-6">
            <div className="widget-head">
              <span className="widget-title">{t("sectionTimeTrend")}</span>
              <div className="stats-period-tabs">
                {(["day", "month", "year"] as const).map((p) => (
                  <button
                    key={p}
                    className={`stats-period-tab ${period === p ? "stats-period-tab--active" : ""}`}
                    onClick={() => setPeriod(p)}
                  >
                    {periodLabels[p]}
                  </button>
                ))}
              </div>
            </div>
            <div className="widget-body">
              <BarChart
                periods={periods}
                data={data}
                goalList={goalList}
                emptyLabel={t("noData")}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
