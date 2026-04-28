import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { CalendarSubscription, Schedule } from "../types";

interface Props {
  schedule: Schedule;
  subscriptions: CalendarSubscription[];
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}
function fmtTime(iso: string): string {
  return iso.slice(11, 16);
}

// 親 button 等の hover/focus に反応して document.body へ portal で popup を出す。
// 祖先の overflow:hidden に切られない & ブラウザネイティブ title の遅延を避けるため。
export function ScheduleEventHoverPopup({ schedule, subscriptions }: Props) {
  const { t } = useTranslation("schedule");
  const sentinelRef = useRef<HTMLSpanElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const triggerRectRef = useRef<DOMRect | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    placement: "above" | "below";
    maxHeight: number;
  } | null>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const trigger = sentinel?.parentElement;
    if (!trigger) return;

    const computePos = (rect: DOMRect, assumedWidth: number) => {
      const margin = 8;
      const halfW = assumedWidth / 2;
      const minLeft = halfW + margin;
      const maxLeft = window.innerWidth - halfW - margin;
      const desiredLeft = rect.left + rect.width / 2;
      const left = Math.min(maxLeft, Math.max(minLeft, desiredLeft));
      const spaceBelow = window.innerHeight - rect.bottom - margin * 2;
      const spaceAbove = rect.top - margin * 2;
      const useBelow = spaceBelow >= spaceAbove;
      const placement: "above" | "below" = useBelow ? "below" : "above";
      const top = useBelow ? rect.bottom + margin : rect.top - margin;
      const maxHeight = Math.max(120, useBelow ? spaceBelow : spaceAbove);
      return { top, left, placement, maxHeight };
    };

    const handleEnter = () => {
      const rect = trigger.getBoundingClientRect();
      triggerRectRef.current = rect;
      setPos(computePos(rect, 280));
      setOpen(true);
    };
    const handleLeave = () => {
      setOpen(false);
      triggerRectRef.current = null;
    };
    trigger.addEventListener("mouseenter", handleEnter);
    trigger.addEventListener("mouseleave", handleLeave);
    trigger.addEventListener("focusin", handleEnter);
    trigger.addEventListener("focusout", handleLeave);
    return () => {
      trigger.removeEventListener("mouseenter", handleEnter);
      trigger.removeEventListener("mouseleave", handleLeave);
      trigger.removeEventListener("focusin", handleEnter);
      trigger.removeEventListener("focusout", handleLeave);
    };
  }, []);

  useLayoutEffect(() => {
    if (!open || !pos) return;
    const popupEl = popupRef.current;
    const rect = triggerRectRef.current;
    if (!popupEl || !rect) return;
    const w = popupEl.offsetWidth;
    if (w <= 0) return;
    const margin = 8;
    const halfW = w / 2;
    const minLeft = halfW + margin;
    const maxLeft = window.innerWidth - halfW - margin;
    const desiredLeft = rect.left + rect.width / 2;
    const newLeft = Math.min(maxLeft, Math.max(minLeft, desiredLeft));
    if (Math.abs(newLeft - pos.left) > 0.5) {
      setPos((p) => (p ? { ...p, left: newLeft } : p));
    }
  }, [open, pos]);

  const startD = fmtDate(schedule.start);
  const endD = fmtDate(schedule.end);
  const sameStartEndDay = startD === endD;
  const timeLine = schedule.allDay
    ? sameStartEndDay
      ? `${t("allDay")} — ${startD}`
      : `${t("allDay")} — ${startD} 〜 ${endD}`
    : sameStartEndDay
      ? `${startD} ${fmtTime(schedule.start)} 〜 ${fmtTime(schedule.end)}`
      : `${startD} ${fmtTime(schedule.start)} 〜 ${endD} ${fmtTime(schedule.end)}`;

  let sourceLabel = "";
  if (schedule.source === "subscription") {
    const sub = subscriptions.find((s) => s.id === schedule.subscriptionId);
    sourceLabel = sub?.name || "";
  } else if (schedule.googleEventId) {
    sourceLabel = "Google";
  } else if (schedule.caldavObjectUrl) {
    sourceLabel = "iCloud";
  }

  const placement = pos?.placement ?? "above";
  const cls = `schedule-event-popup schedule-event-popup--${placement}`;

  return (
    <>
      <span ref={sentinelRef} style={{ display: "none" }} aria-hidden />
      {open &&
        pos &&
        createPortal(
          <div
            ref={popupRef}
            className={cls}
            role="tooltip"
            style={{ top: pos.top, left: pos.left, maxHeight: pos.maxHeight }}
          >
            <div className="schedule-event-popup-title">
              {schedule.title || "(untitled)"}
            </div>
            <div className="schedule-event-popup-time">{timeLine}</div>
            {schedule.location && (
              <div className="schedule-event-popup-location">
                📍 {schedule.location}
              </div>
            )}
            {schedule.description && (
              <div className="schedule-event-popup-desc">
                {schedule.description}
              </div>
            )}
            {sourceLabel && (
              <div className="schedule-event-popup-source">{sourceLabel}</div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
