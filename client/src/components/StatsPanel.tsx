import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useTick } from "../hooks/useTick";
import type { Goal, KanbanTask, TimeLog } from "../types";
import { formatDuration, formatLocalIso } from "../types";
import { PeriodDropdown } from "./PeriodDropdown";

interface Props {
  tasks: KanbanTask[];
  goals: Goal[];
}

type Period = "day" | "month" | "year";
type GoalLog = TimeLog & { goalId: string };

const COLORS = [
  "#8a5ff0", "#6366f1", "#d4a24e", "#10b981", "#f43f5e",
  "#06b6d4", "#0ea5e9", "#f59e0b", "#64748b", "#ec4899",
];

function getColor(i: number) {
  return COLORS[i % COLORS.length];
}

function formatPercent(value: number): string {
  const safe = Math.max(0, value);
  if (safe === 0) return "0%";
  if (safe >= 99.5) return "100%";
  if (safe < 10) return `${safe.toFixed(1)}%`;
  return `${Math.round(safe)}%`;
}

function polarPoint(cx: number, cy: number, radius: number, angle: number) {
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

function donutSlicePath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
) {
  const sweep = endAngle - startAngle;
  if (sweep >= Math.PI * 2 - 0.0001) {
    const outerStart = polarPoint(cx, cy, outerRadius, startAngle);
    const outerMid = polarPoint(cx, cy, outerRadius, startAngle + Math.PI);
    const innerStart = polarPoint(cx, cy, innerRadius, startAngle);
    const innerMid = polarPoint(cx, cy, innerRadius, startAngle + Math.PI);
    return [
      `M ${outerStart.x} ${outerStart.y}`,
      `A ${outerRadius} ${outerRadius} 0 1 1 ${outerMid.x} ${outerMid.y}`,
      `A ${outerRadius} ${outerRadius} 0 1 1 ${outerStart.x} ${outerStart.y}`,
      `L ${innerStart.x} ${innerStart.y}`,
      `A ${innerRadius} ${innerRadius} 0 1 0 ${innerMid.x} ${innerMid.y}`,
      `A ${innerRadius} ${innerRadius} 0 1 0 ${innerStart.x} ${innerStart.y}`,
      "Z",
    ].join(" ");
  }

  const outerStart = polarPoint(cx, cy, outerRadius, startAngle);
  const outerEnd = polarPoint(cx, cy, outerRadius, endAngle);
  const innerEnd = polarPoint(cx, cy, innerRadius, endAngle);
  const innerStart = polarPoint(cx, cy, innerRadius, startAngle);
  const largeArc = sweep > Math.PI ? 1 : 0;

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
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

function collectGoalLogs(tasks: KanbanTask[]): GoalLog[] {
  const now = new Date();
  const nowMs = now.getTime();
  const nowIso = formatLocalIso(now);

  return tasks.flatMap((task) => {
    const goalId = task.goalId || "__none__";
    const logs: GoalLog[] = task.timeLogs.map((log) => ({ ...log, goalId }));

    if (task.timerStartedAt) {
      const startedAt = new Date(task.timerStartedAt).getTime();
      if (Number.isFinite(startedAt) && startedAt < nowMs) {
        const duration = Math.floor((nowMs - startedAt) / 1000);
        if (duration > 0) {
          logs.push({
            start: task.timerStartedAt,
            end: nowIso,
            duration,
            goalId,
          });
        }
      }
    }

    return logs;
  });
}

function getPeriodTotal(
  data: Record<string, Record<string, number>>,
  goalList: { id: string; name: string }[],
  periodKey: string,
) {
  return goalList.reduce((sum, goal) => sum + (data[goal.id]?.[periodKey] || 0), 0);
}

function buildPeriodTotals(
  periods: { key: string; label: string }[],
  data: Record<string, Record<string, number>>,
  goalList: { id: string; name: string }[],
) {
  return periods.map((period) => ({
    ...period,
    total: getPeriodTotal(data, goalList, period.key),
  }));
}

function aggregateByGoalAndPeriod(
  goalLogs: GoalLog[],
  goals: Goal[],
  period: Period,
  noGoalLabel: string,
  unknownGoalLabel: string,
) {
  const periods = generatePeriods(period);
  const goalMap = new Map(goals.map((g) => [g.id, g.name]));

  const data: Record<string, Record<string, number>> = {};
  const goalIds = new Set<string>();

  for (const log of goalLogs) {
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

  const goalList = Array.from(goalIds)
    .map((id) => ({
      id,
      name: id === "__none__" ? noGoalLabel : (goalMap.get(id) || unknownGoalLabel),
      total: periods.reduce((sum, p) => sum + (data[id]?.[p.key] || 0), 0),
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ja"))
    .map(({ id, name }) => ({ id, name }));

  return { periods, data, goalList };
}

function PieChart({
  slices,
  emptyLabel,
  centerLabel,
  centerValue,
  centerSub,
}: {
  slices: { label: string; value: number; color: string }[];
  emptyLabel: string;
  centerLabel: string;
  centerValue: string;
  centerSub: string;
}) {
  const total = slices.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return <div className="stats-empty">{emptyLabel}</div>;
  }

  const filtered = slices.filter((s) => s.value > 0);
  const cx = 110;
  const cy = 110;
  const outerRadius = 78;
  const innerRadius = 56;
  const trackRadius = (outerRadius + innerRadius) / 2;
  const trackWidth = outerRadius - innerRadius;
  const segments = filtered.reduce<{
    angle: number;
    items: { label: string; value: number; color: string; pct: number; path: string }[];
  }>((acc, slice) => {
    const sweep = (slice.value / total) * Math.PI * 2;
    const startAngle = acc.angle;
    const endAngle = startAngle + sweep;
    return {
      angle: endAngle,
      items: [
        ...acc.items,
        {
          ...slice,
          pct: (slice.value / total) * 100,
          path: donutSlicePath(cx, cy, outerRadius, innerRadius, startAngle, endAngle),
        },
      ],
    };
  }, { angle: -Math.PI / 2, items: [] }).items;

  return (
    <div className="pie-chart-wrap">
      <div className="pie-chart-stage">
        <svg viewBox="0 0 220 220" className="pie-chart-svg">
          <circle
            cx={cx}
            cy={cy}
            r={trackRadius}
            className="pie-chart-track"
            strokeWidth={trackWidth}
          />
          {segments.map((segment, i) => (
            <path
              key={i}
              d={segment.path}
              className="pie-chart-slice"
              fill={segment.color}
            />
          ))}
          <circle cx={cx} cy={cy} r={innerRadius - 2} className="pie-chart-core" />
        </svg>
        <div className="pie-chart-center">
          <span className="pie-chart-center-label">{centerLabel}</span>
          <strong className="pie-chart-center-value">{centerValue}</strong>
          <span className="pie-chart-center-sub">{centerSub}</span>
        </div>
      </div>
      <div className="pie-legend">
        {segments.map((segment, i) => (
          <div key={i} className="pie-legend-item">
            <div className="pie-legend-row">
              <span className="pie-legend-dot" style={{ background: segment.color }} />
              <span className="pie-legend-label">{segment.label}</span>
              <span className="pie-legend-value">
                {formatDuration(segment.value)} ({formatPercent(segment.pct)})
              </span>
            </div>
            <div className="pie-legend-meter">
              <span
                className="pie-legend-meter-fill"
                style={{
                  width: `${Math.max(segment.pct, 6)}%`,
                  background: segment.color,
                }}
              />
            </div>
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
  peakLabel,
  averageLabel,
}: {
  periods: { key: string; label: string }[];
  data: Record<string, Record<string, number>>;
  goalList: { id: string; name: string }[];
  emptyLabel: string;
  peakLabel: string;
  averageLabel: string;
}) {
  const totals = buildPeriodTotals(periods, data, goalList);
  const maxVal = totals.reduce((max, period) => Math.max(max, period.total), 0);

  if (maxVal === 0) {
    return <div className="stats-empty">{emptyLabel}</div>;
  }

  const peakPeriod = totals.reduce((best, current) => (
    current.total > best.total ? current : best
  ), totals[0]);
  const average = Math.round(totals.reduce((sum, period) => sum + period.total, 0) / totals.length);
  const ticks = Array.from(new Set([0.25, 0.5, 0.75, 1]
    .map((ratio) => Math.round(maxVal * ratio))
    .filter((value) => value > 0)))
    .sort((a, b) => a - b);
  const chartPadding = { top: 12, right: 12, bottom: 38, left: 46 };
  const plotHeight = 178;
  const step = periods.length <= 5 ? 60 : periods.length <= 8 ? 44 : periods.length <= 12 ? 34 : 28;
  const barWidth = Math.max(18, Math.round(step * 0.58));
  const plotWidth = periods.length * step;
  const chartWidth = chartPadding.left + chartPadding.right + plotWidth;
  const chartHeight = chartPadding.top + chartPadding.bottom + plotHeight;
  const showBarTotals = periods.length <= 8;
  const columns = periods.map((period, periodIndex) => {
    const x = chartPadding.left + periodIndex * step + (step - barWidth) / 2;
    const total = getPeriodTotal(data, goalList, period.key);
    let cursorY = chartPadding.top + plotHeight;
    const segments = goalList
      .map((goal, goalIndex) => ({
        goalId: goal.id,
        label: goal.name,
        value: data[goal.id]?.[period.key] || 0,
        color: getColor(goalIndex),
      }))
      .filter((segment) => segment.value > 0)
      .map((segment) => {
        const rawHeight = (segment.value / maxVal) * plotHeight;
        const height = Math.max(2, rawHeight);
        cursorY -= height;
        return {
          ...segment,
          height,
          y: cursorY,
        };
      });

    return {
      ...period,
      x,
      total,
      segments,
      centerX: x + barWidth / 2,
      labelVisible:
        periods.length <= 10 || periodIndex % 2 === 0 || periodIndex === periods.length - 1,
      tooltip: [
        `${period.label}: ${formatDuration(total)}`,
        ...segments.map((segment) => `${segment.label}: ${formatDuration(segment.value)}`),
      ].join("\n"),
    };
  });

  return (
    <div className="bar-chart-wrap">
      <div className="bar-chart-summary">
        <div className="bar-chart-summary-item">
          <span className="bar-chart-summary-label">{peakLabel}</span>
          <strong className="bar-chart-summary-value">{peakPeriod.label}</strong>
          <span className="bar-chart-summary-meta">{formatDuration(peakPeriod.total)}</span>
        </div>
        <div className="bar-chart-summary-item">
          <span className="bar-chart-summary-label">{averageLabel}</span>
          <strong className="bar-chart-summary-value">{formatDuration(average)}</strong>
          <span className="bar-chart-summary-meta">{formatPercent((average / maxVal) * 100)}</span>
        </div>
      </div>

      <div className="bar-chart-frame">
        <div className="bar-chart-svg-wrap">
          <svg
            className="bar-chart-svg"
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            role="img"
            aria-label={averageLabel}
          >
            {ticks.map((tick) => {
              const y = chartPadding.top + plotHeight - (tick / maxVal) * plotHeight;
              return (
                <g key={tick} aria-hidden="true">
                  <line
                    className="bar-grid-line-svg"
                    x1={chartPadding.left}
                    y1={y}
                    x2={chartWidth - chartPadding.right}
                    y2={y}
                  />
                  <text
                    className="bar-grid-label-svg"
                    x={chartPadding.left - 8}
                    y={y + 3}
                    textAnchor="end"
                  >
                    {formatDuration(tick)}
                  </text>
                </g>
              );
            })}

            <line
              className="bar-axis-line-svg"
              x1={chartPadding.left}
              y1={chartPadding.top + plotHeight}
              x2={chartWidth - chartPadding.right}
              y2={chartPadding.top + plotHeight}
            />

            {columns.map((column) => {
              const totalTop = chartPadding.top + plotHeight - (column.total / maxVal) * plotHeight;
              return (
                <g key={column.key}>
                  <title>{column.tooltip}</title>
                  <rect
                    className="bar-track-svg"
                    x={column.x}
                    y={chartPadding.top}
                    width={barWidth}
                    height={plotHeight}
                  />

                  {column.segments.map((segment) => (
                    <rect
                      key={`${column.key}-${segment.goalId}`}
                      className="bar-segment-svg"
                      x={column.x + 1}
                      y={segment.y}
                      width={barWidth - 2}
                      height={segment.height}
                      fill={segment.color}
                    />
                  ))}

                  {showBarTotals && column.total > 0 && (
                    <text
                      className="bar-total-svg"
                      x={column.centerX}
                      y={Math.max(chartPadding.top + 10, totalTop - 6)}
                      textAnchor="middle"
                    >
                      {formatDuration(column.total)}
                    </text>
                  )}

                  <text
                    className="bar-label-svg"
                    x={column.centerX}
                    y={chartPadding.top + plotHeight + 20}
                    textAnchor="middle"
                  >
                    {column.labelVisible ? column.label : ""}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <div className="bar-legend">
        {goalList.map((g, i) => (
          <div key={g.id} className="pie-legend-item">
            <div className="pie-legend-row">
              <span
                className="pie-legend-dot"
                style={{ background: getColor(i) }}
              />
              <span className="pie-legend-label">{g.name}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatsPanel({ tasks, goals }: Props) {
  const { t } = useTranslation("stats");
  useTick();
  const [period, setPeriod] = useState<Period>("day");
  const noGoalLabel = t("noGoalLabel");
  const unknownGoalLabel = t("unknownGoalLabel");
  const goalLogs = collectGoalLogs(tasks);

  const goalTimeMap: Record<string, number> = {};
  for (const log of goalLogs) {
    goalTimeMap[log.goalId] = (goalTimeMap[log.goalId] || 0) + log.duration;
  }

  const goalNameMap = new Map(goals.map((g) => [g.id, g.name]));
  const pieSlices = Object.entries(goalTimeMap)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([gId, v], i) => ({
      label: gId === "__none__" ? noGoalLabel : (goalNameMap.get(gId) || unknownGoalLabel),
      value: v,
      color: getColor(i),
    }));

  const { periods, data, goalList } = aggregateByGoalAndPeriod(
    goalLogs,
    goals,
    period,
    noGoalLabel,
    unknownGoalLabel,
  );
  const dailyAggregation = aggregateByGoalAndPeriod(
    goalLogs,
    goals,
    "day",
    noGoalLabel,
    unknownGoalLabel,
  );

  const totalTime = Object.values(goalTimeMap).reduce((s, v) => s + v, 0);
  const completedCount = tasks.filter((t) => t.completedAt).length;
  const completionRate = tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0;
  const trackedSessions = goalLogs.length;
  const averageSession = trackedSessions > 0
    ? goalLogs.reduce((sum, log) => sum + log.duration, 0) / trackedSessions
    : 0;
  const activeGoalsCount = pieSlices.filter((slice) => slice.label !== noGoalLabel).length;
  const topGoal = pieSlices[0];
  const topGoalShare = topGoal && totalTime > 0 ? (topGoal.value / totalTime) * 100 : 0;
  const dailyTotals = buildPeriodTotals(
    dailyAggregation.periods,
    dailyAggregation.data,
    dailyAggregation.goalList,
  );
  const focusDays = dailyTotals.filter((periodEntry) => periodEntry.total > 0).length;
  let currentStreak = 0;
  for (let i = dailyTotals.length - 1; i >= 0; i--) {
    if (dailyTotals[i].total <= 0) break;
    currentStreak += 1;
  }

  const periodLabels: Record<Period, string> = {
    day: t("periodDay"),
    month: t("periodMonth"),
    year: t("periodYear"),
  };
  const summaryCards = [
    {
      key: "total",
      tone: "accent",
      label: t("summaryTotal"),
      value: formatDuration(totalTime),
      detail: t("summaryTotalHint", { days: focusDays, sessions: trackedSessions }),
    },
    {
      key: "rate",
      tone: "info",
      label: t("summaryRate"),
      value: formatPercent(completionRate),
      detail: t("summaryCompletedHint", { done: completedCount, all: tasks.length }),
    },
    {
      key: "goals",
      tone: "success",
      label: t("summaryGoals"),
      value: String(activeGoalsCount),
      detail: topGoal
        ? t("summaryGoalsHint", { goal: topGoal.label, share: formatPercent(topGoalShare) })
        : t("summaryGoalsHintEmpty"),
    },
    {
      key: "streak",
      tone: "warm",
      label: t("summaryStreak"),
      value: `${currentStreak}${t("periodDay")}`,
      detail: trackedSessions > 0
        ? t("summaryStreakHint", { duration: formatDuration(Math.round(averageSession)) })
        : t("summaryStreakHintEmpty"),
    },
  ];

  return (
    <div className="stats-panel">
      <div className="page-head">
        <div className="page-head-title-wrap">
          <h1 className="page-title">{t("pageTitle")}</h1>
          <div className="page-subtitle">{t("pageSubtitle")}</div>
        </div>
      </div>

      <div className="page-body">
        <section className="stats-hero">
          <div className="stats-hero-copy">
            <span className="stats-hero-kicker">{t("heroKicker")}</span>
            <h2 className="stats-hero-title">
              {topGoal ? t("heroTitle", { goal: topGoal.label }) : t("heroTitleEmpty")}
            </h2>
            <p className="stats-hero-text">
              {topGoal
                ? t("heroDescription", { share: formatPercent(topGoalShare) })
                : t("heroDescriptionEmpty")}
            </p>
            <div className="stats-hero-pills">
              <span className="stats-hero-pill">{t("heroChipDays", { count: focusDays })}</span>
              <span className="stats-hero-pill">{t("heroChipSessions", { count: trackedSessions })}</span>
              <span className="stats-hero-pill">{t("heroChipGoals", { count: activeGoalsCount })}</span>
            </div>
          </div>

          <div className="stats-spotlight">
            <span className="stats-spotlight-label">{t("spotlightLabel")}</span>
            <strong className="stats-spotlight-value">
              {topGoal ? topGoal.label : t("spotlightEmpty")}
            </strong>
            <span className="stats-spotlight-sub">
              {topGoal
                ? `${formatDuration(topGoal.value)} · ${t("spotlightShare", { share: formatPercent(topGoalShare) })}`
                : t("pageSubtitle")}
            </span>

            <div className="stats-spotlight-grid">
              <div className="stats-spotlight-metric">
                <span className="stats-spotlight-metric-label">{t("spotlightSessions")}</span>
                <strong className="stats-spotlight-metric-value">{trackedSessions}</strong>
              </div>
              <div className="stats-spotlight-metric">
                <span className="stats-spotlight-metric-label">{t("spotlightActiveDays")}</span>
                <strong className="stats-spotlight-metric-value">{focusDays}</strong>
              </div>
              <div className="stats-spotlight-metric">
                <span className="stats-spotlight-metric-label">{t("spotlightStreak")}</span>
                <strong className="stats-spotlight-metric-value">{`${currentStreak}${t("periodDay")}`}</strong>
              </div>
              <div className="stats-spotlight-metric">
                <span className="stats-spotlight-metric-label">{t("spotlightAverageSession")}</span>
                <strong className="stats-spotlight-metric-value">{formatDuration(Math.round(averageSession))}</strong>
              </div>
            </div>
          </div>
        </section>

        <div className="stats-summary">
          {summaryCards.map((card) => (
            <div
              key={card.key}
              className={`widget stats-summary-card stats-summary-card--${card.tone}`}
            >
              <div className="widget-body">
                <div className="stats-summary-label">{card.label}</div>
                <div className="stats-summary-value">{card.value}</div>
                <div className="stats-summary-detail">{card.detail}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="overview-grid">
          <div className="widget col-6 stats-visual-card">
            <div className="widget-head">
              <span className="widget-title">{t("sectionTimeByGoal")}</span>
            </div>
            <div className="widget-body">
              <PieChart
                slices={pieSlices}
                emptyLabel={t("noData")}
                centerLabel={t("chartCenterTotal")}
                centerValue={formatDuration(totalTime)}
                centerSub={t("chartCenterGoals", { count: pieSlices.length })}
              />
            </div>
          </div>

          <div className="widget col-6 stats-visual-card">
            <div className="widget-head">
              <span className="widget-title">{t("sectionTimeTrend")}</span>
              <PeriodDropdown
                value={period}
                onChange={setPeriod}
                options={(["day", "month", "year"] as const).map((p) => ({
                  value: p,
                  label: periodLabels[p],
                }))}
              />
            </div>
            <div className="widget-body">
              <BarChart
                periods={periods}
                data={data}
                goalList={goalList}
                emptyLabel={t("noData")}
                peakLabel={t("trendPeak")}
                averageLabel={t("trendAverage")}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
