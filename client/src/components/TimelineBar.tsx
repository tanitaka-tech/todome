import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { KanbanTask, LifeActivity, LifeLog } from "../types";
import { LIFE_CATEGORY_COLORS, formatDuration } from "../types";

interface Props {
  rangeStartMs: number;
  rangeEndMs: number;
  tasks: KanbanTask[];
  lifeLogs: LifeLog[];
  lifeActivities: LifeActivity[];
  /** live update用。値が変われば再描画。 */
  tick?: number;
  /** 現在時刻にスクロールするか。Overview では true、retro (過去日) では false。 */
  autoScrollToNow?: boolean;
  /** 縦 (デフォルト) or 横。 */
  orientation?: "vertical" | "horizontal";
}

interface Segment {
  key: string;
  kind: "task" | "life";
  startMs: number;
  endMs: number;
  label: string;
  sublabel: string;
  color: string;
  tooltip: string;
}

const HOUR_HEIGHT_PX = 56;
const HOUR_WIDTH_PX = 80;
const HORIZONTAL_LANE_HEIGHT_PX = 44;

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
  tasks,
  lifeLogs,
  lifeActivities,
  tick: _tick,
  autoScrollToNow = false,
  orientation = "vertical",
}: Props) {
  const { t } = useTranslation("lifeLog");
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollHRef = useRef<HTMLDivElement>(null);
  const containerHRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{
    seg: Segment;
    x: number;
    y: number;
  } | null>(null);
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const totalMs = rangeEndMs - rangeStartMs;
  const totalHours = Math.round(totalMs / (60 * 60 * 1000));
  const totalHeight = totalHours * HOUR_HEIGHT_PX;

  const segments = useMemo<Segment[]>(() => {
    const out: Segment[] = [];
    for (const task of tasks) {
      for (const log of task.timeLogs || []) {
        const start = Date.parse(log.start);
        const end = Date.parse(log.end);
        if (Number.isNaN(start) || Number.isNaN(end)) continue;
        if (!overlaps(start, end, rangeStartMs, rangeEndMs)) continue;
        out.push({
          key: `t-${task.id}-${log.start}`,
          kind: "task",
          startMs: Math.max(start, rangeStartMs),
          endMs: Math.min(end, rangeEndMs),
          label: task.title,
          sublabel: `${formatTimeOfDay(start)}–${formatTimeOfDay(end)}`,
          color: "var(--accent)",
          tooltip: `${task.title}\n${formatTimeOfDay(start)}–${formatTimeOfDay(end)} (${formatDuration(Math.max(0, Math.floor((end - start) / 1000)))})`,
        });
      }
      if (task.timerStartedAt) {
        const start = Date.parse(task.timerStartedAt);
        const end = nowMs;
        if (
          !Number.isNaN(start) &&
          overlaps(start, end, rangeStartMs, rangeEndMs)
        ) {
          out.push({
            key: `t-${task.id}-active`,
            kind: "task",
            startMs: Math.max(start, rangeStartMs),
            endMs: Math.min(end, rangeEndMs),
            label: task.title,
            sublabel: `${formatTimeOfDay(start)}–`,
            color: "var(--accent)",
            tooltip: `${task.title} (計測中)\n${formatTimeOfDay(start)}–`,
          });
        }
      }
    }

    const activityMap = new Map(lifeActivities.map((a) => [a.id, a]));
    for (const log of lifeLogs) {
      const start = Date.parse(log.startedAt);
      const end = log.endedAt ? Date.parse(log.endedAt) : nowMs;
      if (Number.isNaN(start) || Number.isNaN(end)) continue;
      if (!overlaps(start, end, rangeStartMs, rangeEndMs)) continue;
      const activity = activityMap.get(log.activityId);
      const color = activity
        ? LIFE_CATEGORY_COLORS[activity.category]
        : LIFE_CATEGORY_COLORS.other;
      const name = activity
        ? `${activity.icon} ${activity.name}`
        : log.activityId;
      out.push({
        key: `l-${log.id}`,
        kind: "life",
        startMs: Math.max(start, rangeStartMs),
        endMs: Math.min(end, rangeEndMs),
        label: name,
        sublabel: `${formatTimeOfDay(start)}–${formatTimeOfDay(end)}`,
        color,
        tooltip: `${name}\n${formatTimeOfDay(start)}–${formatTimeOfDay(end)} (${formatDuration(Math.max(0, Math.floor((end - start) / 1000)))})`,
      });
    }

    return out;
  }, [tasks, lifeLogs, lifeActivities, rangeStartMs, rangeEndMs, nowMs]);

  const hourMarkers = useMemo(() => {
    const markers: { hour: number; top: number }[] = [];
    const startDate = new Date(rangeStartMs);
    for (let i = 0; i <= totalHours; i += 1) {
      markers.push({
        hour: (startDate.getHours() + i) % 24,
        top: i * HOUR_HEIGHT_PX,
      });
    }
    return markers;
  }, [rangeStartMs, totalHours]);

  const safeNow = clamp(nowMs, rangeStartMs, rangeEndMs);
  const nowIsInRange = nowMs > rangeStartMs && nowMs < rangeEndMs;
  const nowTop = ((safeNow - rangeStartMs) / totalMs) * totalHeight;

  const totalWidth = totalHours * HOUR_WIDTH_PX;
  const nowLeftPx = ((safeNow - rangeStartMs) / totalMs) * totalWidth;

  // 初回マウント時 + autoScrollToNow=true のときだけ現在時刻にスクロール。
  // orientation 切替でも再度スクロールできるよう、orientation ごとにリセット。
  const didAutoScroll = useRef(false);
  useEffect(() => {
    didAutoScroll.current = false;
  }, [orientation]);
  useEffect(() => {
    if (orientation !== "vertical") return;
    if (didAutoScroll.current) return;
    if (!autoScrollToNow) return;
    if (!scrollRef.current) return;
    if (!nowIsInRange) return;
    didAutoScroll.current = true;
    const container = scrollRef.current;
    container.scrollTop = Math.max(0, nowTop - container.clientHeight / 3);
  }, [autoScrollToNow, nowIsInRange, nowTop, orientation]);
  useEffect(() => {
    if (orientation !== "horizontal") return;
    if (didAutoScroll.current) return;
    if (!autoScrollToNow) return;
    if (!scrollHRef.current) return;
    if (!nowIsInRange) return;
    didAutoScroll.current = true;
    const container = scrollHRef.current;
    container.scrollLeft = Math.max(0, nowLeftPx - container.clientWidth / 3);
  }, [autoScrollToNow, nowIsInRange, nowLeftPx, orientation]);

  const hasAny = segments.length > 0;

  if (orientation === "horizontal") {
    const onSegEnter = (e: React.MouseEvent<HTMLDivElement>, s: Segment) => {
      const container = containerHRef.current;
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
      <div className="timeline-h" ref={containerHRef}>
        <div className="timeline-h-scroll" ref={scrollHRef}>
          <div
            className="timeline-h-canvas"
            style={{ width: `${totalWidth}px` }}
          >
            <div className="timeline-h-axis">
              {hourMarkers.map((m, i) => (
                <span
                  key={`${m.hour}-${i}`}
                  className="timeline-h-axis-label"
                  style={{ left: `${i * HOUR_WIDTH_PX}px` }}
                >
                  {String(m.hour).padStart(2, "0")}:00
                </span>
              ))}
            </div>
            <div
              className="timeline-h-lane"
              style={{ height: `${HORIZONTAL_LANE_HEIGHT_PX}px` }}
            >
              {hourMarkers.map((_m, i) => (
                <div
                  key={`g-${i}`}
                  className="timeline-h-grid-line"
                  style={{ left: `${i * HOUR_WIDTH_PX}px` }}
                />
              ))}
              {segments.map((s) => {
                const leftPx =
                  ((s.startMs - rangeStartMs) / totalMs) * totalWidth;
                const widthPx = Math.max(
                  2,
                  ((s.endMs - s.startMs) / totalMs) * totalWidth,
                );
                return (
                  <div
                    key={s.key}
                    className={`timeline-h-seg timeline-h-seg--${s.kind}`}
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
                >
                  <span className="timeline-h-now-dot" />
                </div>
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
          <div className="timeline-v-empty">
            {t("timelineEmpty", "この日はまだ計測がありません。")}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="timeline-v">
      <div className="timeline-v-scroll" ref={scrollRef}>
        <div
          className="timeline-v-canvas"
          style={{ height: `${totalHeight}px` }}
        >
          <div className="timeline-v-axis">
            {hourMarkers.map((m) => (
              <div
                key={m.top}
                className="timeline-v-axis-row"
                style={{ top: `${m.top}px` }}
              >
                <span className="timeline-v-axis-label">
                  {String(m.hour).padStart(2, "0")}:00
                </span>
              </div>
            ))}
          </div>
          <div className="timeline-v-lane">
            {hourMarkers.map((m) => (
              <div
                key={m.top}
                className="timeline-v-grid-line"
                style={{ top: `${m.top}px` }}
              />
            ))}
            {segments.map((s) => {
              const top = ((s.startMs - rangeStartMs) / totalMs) * totalHeight;
              const height = Math.max(
                14,
                ((s.endMs - s.startMs) / totalMs) * totalHeight,
              );
              return (
                <div
                  key={s.key}
                  className={`timeline-v-seg timeline-v-seg--${s.kind}`}
                  style={{
                    top: `${top}px`,
                    height: `${height}px`,
                    background: s.color,
                  }}
                  title={s.tooltip}
                >
                  <div className="timeline-v-seg-label">{s.label}</div>
                  <div className="timeline-v-seg-sub">{s.sublabel}</div>
                </div>
              );
            })}
            {nowIsInRange && (
              <div
                className="timeline-v-now"
                style={{ top: `${nowTop}px` }}
                title={t("timelineNow", "現在")}
              >
                <span className="timeline-v-now-dot" />
              </div>
            )}
          </div>
        </div>
      </div>
      {!hasAny && (
        <div className="timeline-v-empty">
          {t("timelineEmpty", "この日はまだ計測がありません。")}
        </div>
      )}
    </div>
  );
}
