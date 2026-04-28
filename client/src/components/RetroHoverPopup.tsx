import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type {
  KanbanTask,
  RetroDocument,
  RetroType,
  Retrospective,
} from "../types";
import { isTaskCompletedInPeriod } from "../types";

interface Props {
  retro: Retrospective;
  tasks: KanbanTask[];
}

const TYPE_LABEL_KEYS: Record<RetroType, string> = {
  daily: "typeShortDaily",
  weekly: "typeShortWeekly",
  monthly: "typeShortMonthly",
  yearly: "typeShortYearly",
};

function formatDateTime(iso: string): string {
  if (!iso) return "";
  return iso.replace("T", " ").slice(0, 16);
}

// 自身を子として埋め込んだ親 (button 等) の hover/focus に反応して、
// document.body に portal で popup を出す。これによりカレンダーや
// スケジュールの overflow:hidden 祖先で popup がクリップされない。
export function RetroHoverPopup({ retro, tasks }: Props) {
  const { t } = useTranslation("retro");
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

    // popup 幅は max-content で可変。最初は仮想幅 260 で位置決めし、
    // mount 後の useLayoutEffect で実幅を測って left を再計算する。
    const computeInitialPos = (rect: DOMRect, assumedWidth: number) => {
      const margin = 8;
      const halfW = assumedWidth / 2;
      const minLeft = halfW + margin;
      const maxLeft = window.innerWidth - halfW - margin;
      const desiredLeft = rect.left + rect.width / 2;
      const left = Math.min(maxLeft, Math.max(minLeft, desiredLeft));
      // 上下どちらが広いかで自動選択 (常に広い方)
      const spaceBelow = window.innerHeight - rect.bottom - margin * 2;
      const spaceAbove = rect.top - margin * 2;
      const useBelow = spaceBelow >= spaceAbove;
      const actualPlacement: "above" | "below" = useBelow ? "below" : "above";
      const top = useBelow ? rect.bottom + margin : rect.top - margin;
      const maxHeight = Math.max(120, useBelow ? spaceBelow : spaceAbove);
      return { top, left, placement: actualPlacement, maxHeight };
    };

    const handleEnter = () => {
      const rect = trigger.getBoundingClientRect();
      triggerRectRef.current = rect;
      setPos(computeInitialPos(rect, 260));
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

  // mount 後に実幅を測り、トリガー中央配置できるよう left を再計算。
  // popup が viewport をはみ出すなら clamp する。
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

  const formatDailyMeta = (doc: RetroDocument): string => {
    const parts: string[] = [];
    if (doc.dayRating > 0)
      parts.push(t("dailyMetaRating", { value: doc.dayRating }));
    if (doc.wakeUpTime)
      parts.push(t("dailyMetaWakeUp", { time: doc.wakeUpTime }));
    if (doc.bedtime) parts.push(t("dailyMetaBedtime", { time: doc.bedtime }));
    return parts.join(" · ");
  };

  const doneTasks = tasks.filter((task) =>
    isTaskCompletedInPeriod(task, retro.periodStart, retro.periodEnd),
  );

  const actualPlacement = pos?.placement ?? "above";
  const popupClass = `retro-calendar-popup retro-calendar-popup--floating${actualPlacement === "below" ? " retro-calendar-popup--below" : ""}${retro.completedAt ? "" : " retro-calendar-popup--draft"}`;

  return (
    <>
      <span ref={sentinelRef} style={{ display: "none" }} aria-hidden />
      {open &&
        pos &&
        createPortal(
          <div
            ref={popupRef}
            className={popupClass}
            role="tooltip"
            style={{ top: pos.top, left: pos.left, maxHeight: pos.maxHeight }}
          >
            <div className="retro-calendar-popup-head">
              <span className="retro-calendar-popup-badge">
                {t(TYPE_LABEL_KEYS[retro.type])}
              </span>
              <span className="retro-calendar-popup-period">
                {retro.periodStart === retro.periodEnd
                  ? retro.periodStart
                  : `${retro.periodStart} 〜 ${retro.periodEnd}`}
              </span>
            </div>
            {retro.type === "daily" && formatDailyMeta(retro.document) && (
              <div className="retro-calendar-popup-daily">
                {formatDailyMeta(retro.document)}
              </div>
            )}
            {retro.document.learned && (
              <div className="retro-calendar-popup-learned">
                <div className="retro-calendar-popup-learned-title">
                  {t("learnedTitle")}
                </div>
                <div className="retro-calendar-popup-learned-body">
                  {retro.document.learned}
                </div>
              </div>
            )}
            <div className="retro-calendar-popup-tasks">
              <div className="retro-calendar-popup-tasks-title">
                ✅ {t("doneTasksTitle", { count: doneTasks.length })}
              </div>
              {doneTasks.length === 0 ? (
                <div className="retro-calendar-popup-tasks-empty">
                  {t("doneTasksEmpty")}
                </div>
              ) : (
                <ul className="retro-calendar-popup-tasks-list">
                  {doneTasks.map((task) => (
                    <li
                      key={task.id}
                      className="retro-calendar-popup-tasks-item"
                    >
                      {task.title}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {retro.aiComment && (
              <div className="retro-calendar-popup-ai">
                <div className="retro-calendar-popup-ai-title">
                  {t("aiCommentTitle")}
                </div>
                <div className="retro-calendar-popup-ai-body">
                  {retro.aiComment}
                </div>
              </div>
            )}
            <div className="retro-calendar-popup-meta">
              {retro.completedAt
                ? t("historyCompleted", {
                    date: formatDateTime(retro.completedAt),
                  })
                : t("calendarDraftMeta", {
                    date: formatDateTime(retro.updatedAt),
                  })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
