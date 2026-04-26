import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  KanbanTask,
  LifeActivity,
  LifeLog,
  Quota,
  QuotaLog,
  Schedule,
} from "../types";
import {
  DEFAULT_SCHEDULE_COLOR,
  LIFE_CATEGORY_COLORS,
  formatDuration,
} from "../types";

interface Props {
  rangeStartMs: number;
  rangeEndMs: number;
  schedules: Schedule[];
  /** active 計測表示用 (timerStartedAt から作る)。 */
  tasks: KanbanTask[];
  /** active 計測表示用 (endedAt 空) + origin.id から activity 引き当て用。 */
  lifeLogs: LifeLog[];
  /** active 計測表示用 (endedAt 空) + origin.id から quota 引き当て用。 */
  quotaLogs?: QuotaLog[];
  lifeActivities: LifeActivity[];
  quotas?: Quota[];
  /** live update用。値が変われば再描画。 */
  tick?: number;
  /** 現在時刻にスクロールするか。Overview では true、retro (過去日) では false。 */
  autoScrollToNow?: boolean;
}

type SegmentKind = "task" | "life" | "quota" | "manual";

interface Segment {
  key: string;
  kind: SegmentKind;
  startMs: number;
  endMs: number;
  label: string;
  sublabel: string;
  color: string;
  faint?: boolean;
  active?: boolean;
}

const QUOTA_SEG_COLOR = "#8b5cf6";
const HOUR_WIDTH_PX = 56;
const LANE_HEIGHT_PX = 28;
/** 計測中で 15 秒未満のものは「誤操作の可能性」として薄く表示する。 */
const FAINT_ACTIVE_THRESHOLD_MS = 15_000;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function overlaps(
  segStart: number,
  segEnd: number,
  rangeStart: number,
  rangeEnd: number,
): boolean {
  return segEnd > rangeStart && segStart < rangeEnd;
}

function formatTimeOfDay(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function TimelineBar({
  rangeStartMs,
  rangeEndMs,
  schedules,
  tasks,
  lifeLogs,
  lifeActivities,
  quotas,
  quotaLogs,
  tick: _tick,
  autoScrollToNow = false,
}: Props) {
  const { t } = useTranslation("lifeLog");
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{
    seg: Segment;
    x: number;
    y: number;
  } | null>(null);
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const totalMs = rangeEndMs - rangeStartMs;
  const totalHours = Math.round(totalMs / (60 * 60 * 1000));
  const totalWidth = totalHours * HOUR_WIDTH_PX;

  const segments = useMemo<Segment[]>(() => {
    const out: Segment[] = [];
    const activityMap = new Map(lifeActivities.map((a) => [a.id, a]));
    const quotaMap = new Map((quotas ?? []).map((q) => [q.id, q]));
    const lifeLogMap = new Map(lifeLogs.map((l) => [l.id, l]));
    const quotaLogMap = new Map((quotaLogs ?? []).map((l) => [l.id, l]));

    for (const sch of schedules) {
      if (sch.allDay) continue;
      const start = Date.parse(sch.start);
      const end = Date.parse(sch.end);
      if (Number.isNaN(start) || Number.isNaN(end)) continue;
      if (!overlaps(start, end, rangeStartMs, rangeEndMs)) continue;
      let kind: SegmentKind = "manual";
      let label = sch.title || "(無題)";
      let color = DEFAULT_SCHEDULE_COLOR;
      if (sch.origin?.type === "task") {
        kind = "task";
        color = "var(--accent)";
      } else if (sch.origin?.type === "lifelog") {
        kind = "life";
        const log = lifeLogMap.get(sch.origin.id);
        const activity = log ? activityMap.get(log.activityId) : undefined;
        if (activity) {
          color = LIFE_CATEGORY_COLORS[activity.category];
          label = `${activity.icon} ${activity.name}`;
        } else {
          color = LIFE_CATEGORY_COLORS.other;
        }
      } else if (sch.origin?.type === "quota") {
        kind = "quota";
        color = QUOTA_SEG_COLOR;
        const log = quotaLogMap.get(sch.origin.id);
        const quota = log ? quotaMap.get(log.quotaId) : undefined;
        if (quota) label = `${quota.icon} ${quota.name}`;
      }
      out.push({
        key: `s-${sch.id}`,
        kind,
        startMs: Math.max(start, rangeStartMs),
        endMs: Math.min(end, rangeEndMs),
        label,
        sublabel: `${formatTimeOfDay(start)}–${formatTimeOfDay(end)}`,
        color,
      });
    }

    for (const task of tasks) {
      if (!task.timerStartedAt) continue;
      const start = Date.parse(task.timerStartedAt);
      const end = nowMs;
      if (Number.isNaN(start)) continue;
      if (!overlaps(start, end, rangeStartMs, rangeEndMs)) continue;
      out.push({
        key: `t-${task.id}-active`,
        kind: "task",
        startMs: Math.max(start, rangeStartMs),
        endMs: Math.min(end, rangeEndMs),
        label: task.title,
        sublabel: `${formatTimeOfDay(start)}–`,
        color: "var(--accent)",
        faint: end - start < FAINT_ACTIVE_THRESHOLD_MS,
        active: true,
      });
    }

    for (const log of lifeLogs) {
      if (log.endedAt) continue;
      const start = Date.parse(log.startedAt);
      if (Number.isNaN(start)) continue;
      const end = nowMs;
      if (!overlaps(start, end, rangeStartMs, rangeEndMs)) continue;
      const activity = activityMap.get(log.activityId);
      const color = activity
        ? LIFE_CATEGORY_COLORS[activity.category]
        : LIFE_CATEGORY_COLORS.other;
      const name = activity
        ? `${activity.icon} ${activity.name}`
        : log.activityId;
      out.push({
        key: `l-${log.id}-active`,
        kind: "life",
        startMs: Math.max(start, rangeStartMs),
        endMs: Math.min(end, rangeEndMs),
        label: name,
        sublabel: `${formatTimeOfDay(start)}–`,
        color,
        faint: end - start < FAINT_ACTIVE_THRESHOLD_MS,
        active: true,
      });
    }

    for (const log of quotaLogs ?? []) {
      if (log.endedAt) continue;
      const start = Date.parse(log.startedAt);
      if (Number.isNaN(start)) continue;
      const end = nowMs;
      if (!overlaps(start, end, rangeStartMs, rangeEndMs)) continue;
      const quota = quotaMap.get(log.quotaId);
      const name = quota ? `${quota.icon} ${quota.name}` : log.quotaId;
      out.push({
        key: `q-${log.id}-active`,
        kind: "quota",
        startMs: Math.max(start, rangeStartMs),
        endMs: Math.min(end, rangeEndMs),
        label: name,
        sublabel: `${formatTimeOfDay(start)}–`,
        color: QUOTA_SEG_COLOR,
        faint: end - start < FAINT_ACTIVE_THRESHOLD_MS,
        active: true,
      });
    }

    return out;
  }, [
    schedules,
    tasks,
    lifeLogs,
    lifeActivities,
    quotas,
    quotaLogs,
    rangeStartMs,
    rangeEndMs,
    nowMs,
  ]);

  const hourMarkers = useMemo(() => {
    const markers: { hour: number; left: number }[] = [];
    const startDate = new Date(rangeStartMs);
    for (let i = 0; i <= totalHours; i += 1) {
      markers.push({
        hour: (startDate.getHours() + i) % 24,
        left: i * HOUR_WIDTH_PX,
      });
    }
    return markers;
  }, [rangeStartMs, totalHours]);

  const safeNow = clamp(nowMs, rangeStartMs, rangeEndMs);
  const nowIsInRange = nowMs > rangeStartMs && nowMs < rangeEndMs;
  const nowLeftPx = ((safeNow - rangeStartMs) / totalMs) * totalWidth;

  const didAutoScroll = useRef(false);
  useEffect(() => {
    if (didAutoScroll.current) return;
    if (!autoScrollToNow) return;
    if (!scrollRef.current) return;
    if (!nowIsInRange) return;
    didAutoScroll.current = true;
    const container = scrollRef.current;
    container.scrollLeft = Math.max(0, nowLeftPx - container.clientWidth / 3);
  }, [autoScrollToNow, nowIsInRange, nowLeftPx]);

  const hasAny = segments.length > 0;

  const onSegEnter = (e: React.MouseEvent<HTMLDivElement>, s: Segment) => {
    const container = containerRef.current;
    if (!container) return;
    const segRect = e.currentTarget.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    setHover({
      seg: s,
      x: segRect.left - containerRect.left + segRect.width / 2,
      y: segRect.top - containerRect.top,
    });
  };
  const durationSec = hover
    ? Math.max(0, Math.floor((hover.seg.endMs - hover.seg.startMs) / 1000))
    : 0;

  return (
    <div className="timeline-h" ref={containerRef}>
      <div className="timeline-h-scroll" ref={scrollRef}>
        <div
          className="timeline-h-canvas"
          style={{ width: `${totalWidth}px` }}
        >
          <div className="timeline-h-axis">
            {hourMarkers.map((m, i) => (
              <span
                key={`${m.hour}-${i}`}
                className="timeline-h-axis-label"
                style={{ left: `${m.left}px` }}
              >
                {String(m.hour).padStart(2, "0")}
              </span>
            ))}
          </div>
          <div
            className="timeline-h-lane"
            style={{ height: `${LANE_HEIGHT_PX}px` }}
          >
            {hourMarkers.map((m, i) => (
              <div
                key={`g-${i}`}
                className="timeline-h-grid-line"
                style={{ left: `${m.left}px` }}
              />
            ))}
            {segments.map((s) => {
              const leftPx = ((s.startMs - rangeStartMs) / totalMs) * totalWidth;
              const widthPx = Math.max(
                2,
                ((s.endMs - s.startMs) / totalMs) * totalWidth,
              );
              return (
                <div
                  key={s.key}
                  className={`timeline-h-seg timeline-h-seg--${s.kind}${s.faint ? " is-faint" : ""}${s.active ? " is-active" : ""}`}
                  style={{
                    left: `${leftPx}px`,
                    width: `${widthPx}px`,
                    background: s.color,
                  }}
                  onMouseEnter={(e) => onSegEnter(e, s)}
                  onMouseLeave={() => setHover(null)}
                >
                  <div className="timeline-h-seg-label">{s.label}</div>
                </div>
              );
            })}
            {nowIsInRange && (
              <div
                className="timeline-h-now"
                style={{ left: `${nowLeftPx}px` }}
                title={t("timelineNow", "現在")}
              />
            )}
          </div>
        </div>
      </div>
      {hover && (
        <div
          className="timeline-h-popup"
          style={{ left: `${hover.x}px`, top: `${hover.y}px` }}
        >
          <div className="timeline-h-popup-title">{hover.seg.label}</div>
          <div className="timeline-h-popup-time">{hover.seg.sublabel}</div>
          <div className="timeline-h-popup-duration">
            {formatDuration(durationSec)}
          </div>
        </div>
      )}
      {!hasAny && (
        <div className="timeline-h-empty">
          {t("timelineEmpty", "この日はまだ計測がありません。")}
        </div>
      )}
    </div>
  );
}
