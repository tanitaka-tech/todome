import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ColumnId,
  Goal,
  KanbanTask,
  LifeActivity,
  LifeLog,
  Quota,
  QuotaLog,
  QuotaStreak,
} from "../types";
import { formatDuration, totalSeconds } from "../types";
import { formatDateTime } from "../i18n/format";
import { LifeLogSection } from "./LifeLogSection";
import { QuotaSection } from "./QuotaSection";
import {
  loadBoardBottomHeight,
  loadBoardQuotaWidth,
  saveBoardBottomHeight,
  saveBoardQuotaWidth,
} from "../viewState";

interface Props {
  tasks: KanbanTask[];
  goals: Goal[];
  setTasks: React.Dispatch<React.SetStateAction<KanbanTask[]>>;
  send: (data: unknown) => void;
  onCardClick: (task: KanbanTask) => void;
  onTimerToggle: (taskId: string) => void;
  onMoveColumn: (taskId: string, column: string) => void;
  goalFilters: string[];
  setGoalFilters: (value: string[]) => void;
  recentDays: number;
  setRecentDays: (value: number) => void;
  lifeActivities: LifeActivity[];
  lifeLogs: LifeLog[];
  quotas: Quota[];
  quotaLogs: QuotaLog[];
  quotaStreaks: QuotaStreak[];
  dayBoundaryHour: number;
}

export const KANBAN_GOAL_FILTER_NONE = "__none__";

const COLUMNS: { id: ColumnId; labelKey: string; color: string }[] = [
  { id: "todo", labelKey: "columnTodo", color: "#6b7280" },
  { id: "in_progress", labelKey: "columnInProgress", color: "#d4a24e" },
  { id: "done", labelKey: "columnDone", color: "#9a5b2f" },
];

const GOAL_FILTER_NONE = KANBAN_GOAL_FILTER_NONE;
const RECENT_DAYS_OPTIONS: { value: number; labelKey: string }[] = [
  { value: 0, labelKey: "filterAllPeriod" },
  { value: 1, labelKey: "filterDay1" },
  { value: 3, labelKey: "filterDay3" },
  { value: 7, labelKey: "filterDay7" },
  { value: 30, labelKey: "filterDay30" },
];

const MIN_BOTTOM_HEIGHT = 140;
const MIN_BOARD_HEIGHT = 220;

type InsertPos = "above" | "below";

function clampBottomHeight(height: number, availableHeight: number): number {
  const maxBottom = Math.max(MIN_BOTTOM_HEIGHT, availableHeight - MIN_BOARD_HEIGHT);
  return Math.max(MIN_BOTTOM_HEIGHT, Math.min(maxBottom, height));
}

function summarizeGoalFilters(
  selected: string[],
  goals: Goal[],
  t: (key: string) => string,
): string {
  if (selected.length === 0) return "";
  const labelOf = (id: string): string => {
    if (id === GOAL_FILTER_NONE) return t("filterNoGoal");
    const g = goals.find((x) => x.id === id);
    return g ? g.name : "";
  };
  const labels = selected.map(labelOf).filter(Boolean);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  return `${labels[0]} +${labels.length - 1}`;
}

export function KanbanBoard({
  tasks,
  goals,
  setTasks,
  send,
  onCardClick,
  onTimerToggle,
  onMoveColumn,
  goalFilters,
  setGoalFilters,
  recentDays,
  setRecentDays,
  lifeActivities,
  lifeLogs,
  quotas,
  quotaLogs,
  quotaStreaks,
  dayBoundaryHour,
}: Props) {
  const { t } = useTranslation("kanban");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ColumnId | null>(null);
  const [dragOverCardId, setDragOverCardId] = useState<string | null>(null);
  const [dragOverPos, setDragOverPos] = useState<InsertPos>("above");
  const [addingTo, setAddingTo] = useState<ColumnId | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);

  const cardRefs = useRef(new Map<string, HTMLElement>());
  const prevRects = useRef(new Map<string, DOMRect>());
  const prevColumns = useRef(new Map<string, ColumnId>());
  const originalTasksRef = useRef<KanbanTask[] | null>(null);
  const dropCommittedRef = useRef(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);
  const horizontalDividerRef = useRef<HTMLDivElement>(null);
  const bottomRowRef = useRef<HTMLDivElement>(null);
  const [bottomHeight, setBottomHeight] = useState<number>(loadBoardBottomHeight);
  const [quotaWidth, setQuotaWidth] = useState<number>(loadBoardQuotaWidth);
  const [openPopover, setOpenPopover] = useState<"goal" | "period" | null>(null);
  const goalPopoverRef = useRef<HTMLDivElement>(null);
  const periodPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openPopover) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      const ref =
        openPopover === "goal" ? goalPopoverRef.current : periodPopoverRef.current;
      if (ref && !ref.contains(target)) setOpenPopover(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenPopover(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openPopover]);

  const getAvailableBoardHeight = () => {
    const wrap = wrapRef.current;
    if (!wrap) return MIN_BOARD_HEIGHT + MIN_BOTTOM_HEIGHT;
    const filterHeight = filterBarRef.current?.getBoundingClientRect().height ?? 0;
    const dividerHeight =
      horizontalDividerRef.current?.getBoundingClientRect().height ?? 0;
    const bottomStyle = bottomRowRef.current
      ? window.getComputedStyle(bottomRowRef.current)
      : null;
    const bottomMargin =
      (bottomStyle ? Number.parseFloat(bottomStyle.marginTop) : 0) +
      (bottomStyle ? Number.parseFloat(bottomStyle.marginBottom) : 0);
    return wrap.clientHeight - filterHeight - dividerHeight - bottomMargin;
  };

  useEffect(() => {
    saveBoardBottomHeight(bottomHeight);
  }, [bottomHeight]);

  useEffect(() => {
    saveBoardQuotaWidth(quotaWidth);
  }, [quotaWidth]);

  const startResizeBottom = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = bottomHeight;
    const onMove = (ev: PointerEvent) => {
      const next = clampBottomHeight(
        startHeight - (ev.clientY - startY),
        getAvailableBoardHeight(),
      );
      setBottomHeight(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ns-resize";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const applyClamp = () => {
      setBottomHeight((prev) => {
        const next = clampBottomHeight(prev, getAvailableBoardHeight());
        return next === prev ? prev : next;
      });
    };

    applyClamp();
    const observer = new ResizeObserver(applyClamp);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  const startResizeQuota = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = quotaWidth;
    const row = bottomRowRef.current;
    const rowWidth = row ? row.clientWidth : 1200;
    const maxQuota = Math.max(260, rowWidth - 280);
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(260, Math.min(maxQuota, startWidth + (ev.clientX - startX)));
      setQuotaWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ew-resize";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  useLayoutEffect(() => {
    const nextColumns = new Map(tasks.map((task) => [task.id, task.column]));
    const nextRects = new Map<string, DOMRect>();
    cardRefs.current.forEach((el, id) => {
      nextRects.set(id, el.getBoundingClientRect());
    });

    cardRefs.current.forEach((el, id) => {
      // The dragging card itself is handled by the OS drag ghost —
      // we don't want to FLIP-animate its in-flow placeholder.
      if (id === dragId) return;
      const prevColumn = prevColumns.current.get(id);
      const nextColumn = nextColumns.get(id);
      if (prevColumn && nextColumn && prevColumn !== nextColumn) return;
      const prev = prevRects.current.get(id);
      const next = nextRects.get(id);
      if (!prev || !next) return;
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      el.style.transition = "transform 0s";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      // force reflow so the starting transform is committed
      void el.offsetWidth;
      el.style.transition = "transform 0.22s cubic-bezier(0.2, 0, 0, 1)";
      el.style.transform = "";
      const cleanup = () => {
        el.style.transition = "";
        el.removeEventListener("transitionend", cleanup);
      };
      el.addEventListener("transitionend", cleanup);
    });

    // Preserve the pre-drag rect for the dragging card so that when the drag
    // ends it animates from its original position to its final position.
    const newPrev = new Map(nextRects);
    if (dragId) {
      const preserved = prevRects.current.get(dragId);
      if (preserved) newPrev.set(dragId, preserved);
    }
    prevRects.current = newPrev;
    prevColumns.current = nextColumns;
  }, [tasks, dragId]);

  const setCardRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  };

  const goalMap = new Map(goals.map((g) => [g.id, g]));

  const resetDragState = () => {
    setDragId(null);
    setDragOverColumn(null);
    setDragOverCardId(null);
  };

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    setDragId(taskId);
    originalTasksRef.current = tasks;
    dropCommittedRef.current = false;
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", taskId);
    } catch {
      /* some browsers block this */
    }
  };

  const applyReorderLocally = (
    draggedId: string,
    targetCardId: string | null,
    targetColumn: ColumnId,
    insertAbove: boolean,
  ) => {
    setTasks((prev) => {
      const draggedIdx = prev.findIndex((t) => t.id === draggedId);
      if (draggedIdx === -1) return prev;
      const dragged = prev[draggedIdx];
      if (dragged.column !== targetColumn) return prev;
      const without = prev.filter((t) => t.id !== draggedId);

      let insertIdx: number;
      if (targetCardId === null) {
        let lastIdx = -1;
        for (let i = 0; i < without.length; i++) {
          if (without[i].column === targetColumn) lastIdx = i;
        }
        insertIdx = lastIdx + 1;
      } else {
        const targetIdx = without.findIndex((t) => t.id === targetCardId);
        if (targetIdx === -1) return prev;
        insertIdx = insertAbove ? targetIdx : targetIdx + 1;
      }

      const newArr = [
        ...without.slice(0, insertIdx),
        dragged,
        ...without.slice(insertIdx),
      ];
      const unchanged = newArr.every((t, i) => t.id === prev[i]?.id);
      return unchanged ? prev : newArr;
    });
  };

  const commitReorder = (
    draggedId: string,
    targetCardId: string | null,
    targetColumn: ColumnId,
    insertAbove: boolean,
  ) => {
    const dragged = tasks.find((t) => t.id === draggedId);
    if (!dragged) return;
    const columnChanged = dragged.column !== targetColumn;
    const shouldMoveWithReorder = columnChanged && targetColumn !== "done";
    const finalDragged =
      shouldMoveWithReorder
        ? { ...dragged, column: targetColumn, completedAt: "" }
        : dragged;

    const without = tasks.filter((t) => t.id !== draggedId);
    let insertIdx: number;
    if (targetCardId === null) {
      let lastIdx = -1;
      for (let i = 0; i < without.length; i++) {
        if (without[i].column === targetColumn) lastIdx = i;
      }
      insertIdx = lastIdx + 1;
    } else {
      const targetIdx = without.findIndex((t) => t.id === targetCardId);
      if (targetIdx === -1) return;
      insertIdx = insertAbove ? targetIdx : targetIdx + 1;
    }

    const finalOrder = [
      ...without.slice(0, insertIdx),
      finalDragged,
      ...without.slice(insertIdx),
    ];
    const needsReorder = finalOrder.some((t, i) => t.id !== tasks[i]?.id);

    if (columnChanged && !shouldMoveWithReorder) {
      onMoveColumn(draggedId, targetColumn);
    }
    if (needsReorder || shouldMoveWithReorder) {
      setTasks((prev) => {
        const map = new Map(prev.map((t) => [t.id, t]));
        if (shouldMoveWithReorder) {
          map.set(draggedId, {
            ...(map.get(draggedId) ?? dragged),
            column: targetColumn,
            completedAt: "",
          });
        }
        return finalOrder
          .map((t) => map.get(t.id))
          .filter((t): t is KanbanTask => !!t);
      });
    }

    const origOrder = originalTasksRef.current;
    const changedFromOriginal =
      !origOrder ||
      finalOrder.some((t, i) => t.id !== origOrder[i]?.id) ||
      columnChanged;
    if (changedFromOriginal) {
      send({
        type: "kanban_reorder",
        taskIds: finalOrder.map((t) => t.id),
        ...(shouldMoveWithReorder
          ? {
              move: {
                taskId: draggedId,
                column: targetColumn,
                completedAt: "",
              },
            }
          : {}),
      });
    }
  };

  const handleColumnDragOver = (e: React.DragEvent, columnId: ColumnId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCardId(null);
    const dragged = dragId ? tasks.find((t) => t.id === dragId) : null;
    if (dragId && dragged && dragged.column !== columnId) {
      setDragOverColumn(columnId);
    } else {
      setDragOverColumn(null);
    }
  };

  const handleColumnDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) {
      setDragOverColumn(null);
    }
  };

  const handleColumnDrop = (e: React.DragEvent, columnId: ColumnId) => {
    e.preventDefault();
    dropCommittedRef.current = true;
    if (dragId) {
      commitReorder(dragId, null, columnId, false);
    }
    resetDragState();
  };

  const handleCardDragOver = (
    e: React.DragEvent,
    targetId: string,
    targetCol: ColumnId,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (!dragId || dragId === targetId) return;

    const dragged = tasks.find((t) => t.id === dragId);
    if (!dragged) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const insertAbove = e.clientY < mid;

    if (dragged.column === targetCol) {
      // Same column — live reorder so neighbors shift to make space.
      setDragOverCardId(null);
      setDragOverColumn(null);
      applyReorderLocally(dragId, targetId, targetCol, insertAbove);
    } else {
      // Cross column — show an insertion indicator; commit on drop.
      setDragOverCardId(targetId);
      setDragOverPos(insertAbove ? "above" : "below");
      setDragOverColumn(null);
    }
  };

  const handleCardDrop = (
    e: React.DragEvent,
    targetId: string,
    targetCol: ColumnId,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    dropCommittedRef.current = true;
    if (dragId && dragId !== targetId) {
      const rect = e.currentTarget.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const insertAbove = e.clientY < mid;
      commitReorder(dragId, targetId, targetCol, insertAbove);
    }
    resetDragState();
  };

  const handleDragEnd = () => {
    // Revert if the drop was cancelled (dropped outside a valid target, ESC, etc.).
    if (!dropCommittedRef.current && originalTasksRef.current) {
      const original = originalTasksRef.current;
      setTasks((prev) => {
        const unchanged =
          prev.length === original.length &&
          prev.every((t, i) => t.id === original[i].id);
        return unchanged ? prev : original;
      });
    }
    originalTasksRef.current = null;
    dropCommittedRef.current = false;
    resetDragState();
  };

  const handleAdd = (columnId: ColumnId) => {
    setAddingTo(columnId);
    setNewTitle("");
    setTimeout(() => addInputRef.current?.focus(), 50);
  };

  const submitAdd = () => {
    const title = newTitle.trim();
    if (!title || !addingTo) return;
    const realGoals = goalFilters.filter((g) => g !== GOAL_FILTER_NONE);
    const goalId = realGoals.length === 1 ? realGoals[0] : "";
    send({
      type: "kanban_add",
      title,
      column: addingTo,
      goalId,
    });
    setAddingTo(null);
    setNewTitle("");
  };

  const toggleGoalFilter = (id: string) => {
    if (goalFilters.includes(id)) {
      setGoalFilters(goalFilters.filter((v) => v !== id));
    } else {
      setGoalFilters([...goalFilters, id]);
    }
  };

  const handleDelete = (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    send({ type: "kanban_delete", taskId });
  };

  const visibleTasks = useMemo(() => {
    if (goalFilters.length === 0 && recentDays === 0) return tasks;
    const cutoff =
      // eslint-disable-next-line react-hooks/purity
      recentDays > 0 ? Date.now() - recentDays * 24 * 60 * 60 * 1000 : 0;
    const filterSet = new Set(goalFilters);
    const includeNone = filterSet.has(GOAL_FILTER_NONE);
    return tasks.filter((t) => {
      if (filterSet.size > 0) {
        const matchesNone = includeNone && !t.goalId;
        const matchesGoal = !!t.goalId && filterSet.has(t.goalId);
        if (!matchesNone && !matchesGoal) return false;
      }
      if (cutoff > 0 && t.column === "done") {
        if (!t.completedAt) return false;
        if (new Date(t.completedAt).getTime() < cutoff) return false;
      }
      return true;
    });
  }, [tasks, goalFilters, recentDays]);

  const hiddenCount = tasks.length - visibleTasks.length;

  const effectiveFocusedId =
    focusedId && visibleTasks.some((t) => t.id === focusedId)
      ? focusedId
      : (visibleTasks[0]?.id ?? null);

  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      return false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (addingTo) return;

      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        const col =
          (effectiveFocusedId &&
            visibleTasks.find((t) => t.id === effectiveFocusedId)?.column) ||
          "todo";
        handleAdd(col as ColumnId);
        return;
      }

      if (!effectiveFocusedId) return;
      const focused = visibleTasks.find((t) => t.id === effectiveFocusedId);
      if (!focused) return;

      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const col = focused.column;
        const colTasks = visibleTasks.filter((t) => t.column === col);
        const idx = colTasks.findIndex((t) => t.id === effectiveFocusedId);
        const next =
          e.key === "ArrowUp"
            ? colTasks[Math.max(0, idx - 1)]
            : colTasks[Math.min(colTasks.length - 1, idx + 1)];
        if (next) setFocusedId(next.id);
        return;
      }

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const colIdx = COLUMNS.findIndex((c) => c.id === focused.column);
        const nextColIdx =
          e.key === "ArrowLeft"
            ? Math.max(0, colIdx - 1)
            : Math.min(COLUMNS.length - 1, colIdx + 1);
        if (nextColIdx === colIdx) return;
        onMoveColumn(focused.id, COLUMNS[nextColIdx].id);
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        onCardClick(focused);
        return;
      }

      if (e.key === " ") {
        e.preventDefault();
        onTimerToggle(focused.id);
        return;
      }

      if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        if (focused.column !== "done") onMoveColumn(focused.id, "done");
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        setTasks((prev) => prev.filter((t) => t.id !== focused.id));
        send({ type: "kanban_delete", taskId: focused.id });
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    effectiveFocusedId,
    visibleTasks,
    addingTo,
    onCardClick,
    onMoveColumn,
    onTimerToggle,
    send,
    setTasks,
  ]);

  return (
    <div className="kanban-wrap" ref={wrapRef}>
      <div className="kanban-filter-bar" ref={filterBarRef}>
        <div className="kanban-filter-pill-wrap" ref={goalPopoverRef}>
          <button
            className={`kanban-filter-pill ${goalFilters.length > 0 ? "kanban-filter-pill--active" : ""} ${openPopover === "goal" ? "kanban-filter-pill--open" : ""}`}
            onClick={() =>
              setOpenPopover((p) => (p === "goal" ? null : "goal"))
            }
          >
            <span className="kanban-filter-pill-caret">▾</span>
            <span className="kanban-filter-pill-label">{t("filterGoal")}</span>
            {goalFilters.length > 0 && (
              <span className="kanban-filter-pill-value">
                {summarizeGoalFilters(goalFilters, goals, t)}
              </span>
            )}
          </button>
          {openPopover === "goal" && (
            <div className="kanban-filter-popover" role="dialog">
              <div className="kanban-filter-popover-head">
                {t("filterGoalPopoverHead")}
              </div>
              <ul className="kanban-filter-popover-list">
                <li>
                  <label className="kanban-filter-popover-item">
                    <input
                      type="checkbox"
                      checked={goalFilters.includes(GOAL_FILTER_NONE)}
                      onChange={() => toggleGoalFilter(GOAL_FILTER_NONE)}
                    />
                    <span className="kanban-filter-popover-item-label">
                      {t("filterNoGoal")}
                    </span>
                  </label>
                </li>
                {goals
                  .filter((g) => !g.achieved)
                  .map((g) => (
                    <li key={g.id}>
                      <label className="kanban-filter-popover-item">
                        <input
                          type="checkbox"
                          checked={goalFilters.includes(g.id)}
                          onChange={() => toggleGoalFilter(g.id)}
                        />
                        <span className="kanban-filter-popover-item-label">
                          {g.name}
                        </span>
                      </label>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>

        <div className="kanban-filter-pill-wrap" ref={periodPopoverRef}>
          <button
            className={`kanban-filter-pill ${recentDays > 0 ? "kanban-filter-pill--active" : ""} ${openPopover === "period" ? "kanban-filter-pill--open" : ""}`}
            onClick={() =>
              setOpenPopover((p) => (p === "period" ? null : "period"))
            }
          >
            <span className="kanban-filter-pill-caret">▾</span>
            <span className="kanban-filter-pill-label">{t("filterDone")}</span>
            <span className="kanban-filter-pill-value">
              {t(
                RECENT_DAYS_OPTIONS.find((o) => o.value === recentDays)
                  ?.labelKey ?? "filterAllPeriod",
              )}
            </span>
          </button>
          {openPopover === "period" && (
            <div className="kanban-filter-popover" role="dialog">
              <div className="kanban-filter-popover-head">
                {t("filterDonePopoverHead")}
              </div>
              <ul className="kanban-filter-popover-list">
                {RECENT_DAYS_OPTIONS.map((opt) => (
                  <li key={opt.value}>
                    <button
                      type="button"
                      className={`kanban-filter-popover-radio ${recentDays === opt.value ? "kanban-filter-popover-radio--active" : ""}`}
                      onClick={() => {
                        setRecentDays(opt.value);
                        setOpenPopover(null);
                      }}
                    >
                      <span className="kanban-filter-popover-radio-dot" />
                      <span className="kanban-filter-popover-item-label">
                        {t(opt.labelKey)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {hiddenCount > 0 && (
          <button
            className="kanban-filter-clear"
            onClick={() => {
              setGoalFilters([]);
              setRecentDays(0);
              setOpenPopover(null);
            }}
          >
            {t("filterClear")}
          </button>
        )}
      </div>
      <div className="kanban-board">
      {COLUMNS.map((col) => {
        const colTasks = visibleTasks.filter((t) => t.column === col.id);
        return (
          <div
            key={col.id}
            className={`kanban-column ${dragOverColumn === col.id ? "kanban-column--dragover" : ""}`}
            onDragOver={(e) => handleColumnDragOver(e, col.id)}
            onDragLeave={handleColumnDragLeave}
            onDrop={(e) => handleColumnDrop(e, col.id)}
          >
            <div className="kanban-column-header">
              <span className="kanban-column-dot" style={{ background: col.color }} />
              <span className="kanban-column-title">{t(col.labelKey)}</span>
              <span className="kanban-column-count">{colTasks.length}</span>
              <button
                className="kanban-add-btn"
                onClick={() => handleAdd(col.id)}
                title={t("addTask")}
              >
                +
              </button>
            </div>

            <div className="kanban-cards">
              {colTasks.map((task) => {
                const linkedGoal = task.goalId ? goalMap.get(task.goalId) : undefined;
                const secs = totalSeconds(task);
                const running = !!task.timerStartedAt;
                const showInsertAbove =
                  !!dragId &&
                  dragId !== task.id &&
                  dragOverCardId === task.id &&
                  dragOverPos === "above";
                const showInsertBelow =
                  !!dragId &&
                  dragId !== task.id &&
                  dragOverCardId === task.id &&
                  dragOverPos === "below";
                return (
                  <div
                    key={task.id}
                    ref={setCardRef(task.id)}
                    className={`kanban-card ${dragId === task.id ? "kanban-card--dragging" : ""} ${running ? "kanban-card--running" : ""} ${showInsertAbove ? "kanban-card--insert-above" : ""} ${showInsertBelow ? "kanban-card--insert-below" : ""} ${effectiveFocusedId === task.id ? "kanban-card--focused" : ""}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, task.id)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleCardDragOver(e, task.id, col.id)}
                    onDrop={(e) => handleCardDrop(e, task.id, col.id)}
                    onClick={() => {
                      setFocusedId(task.id);
                      onCardClick(task);
                    }}
                  >
                    <button
                      className="kanban-card-action kanban-card-delete"
                      onClick={(e) => handleDelete(e, task.id)}
                      title={t("delete")}
                    >
                      &times;
                    </button>
                    <div
                      className={`kanban-card-title ${task.column === "done" ? "kanban-card-title--done" : ""}`}
                    >
                      {task.title}
                    </div>
                    {task.memo && (
                      <div className="kanban-card-memo-preview">
                        {task.memo.length > 40 ? task.memo.slice(0, 40) + "…" : task.memo}
                      </div>
                    )}
                    <div className="kanban-card-bottom">
                      {linkedGoal && (
                        <span className="kanban-card-goal-badge">{linkedGoal.name}</span>
                      )}
                      <div className="kanban-card-timer">
                        <button
                          className={`timer-btn ${running ? "timer-btn--stop" : "timer-btn--play"}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onTimerToggle(task.id);
                          }}
                          title={running ? t("timerStop") : t("timerStart")}
                        >
                          {running ? "\u25A0" : "\u25B6"}
                        </button>
                        <span className={`timer-display ${running ? "timer-display--running" : ""} ${task.estimatedMinutes > 0 && secs > task.estimatedMinutes * 60 ? "timer-display--over" : ""}`}>
                          {formatDuration(secs)}
                          {task.estimatedMinutes > 0 && (
                            <span className="timer-estimate">/{formatDuration(task.estimatedMinutes * 60)}</span>
                          )}
                        </span>
                      </div>
                    </div>
                    {task.completedAt && (
                      <div className="kanban-card-completed-at">
                        {formatDateTime(task.completedAt, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {" "}
                        {t("completedSuffix")}
                      </div>
                    )}
                  </div>
                );
              })}

              {addingTo === col.id && (
                <div className="kanban-card kanban-card--adding">
                  <input
                    ref={addInputRef}
                    className="kanban-add-input"
                    placeholder={t("taskNamePlaceholder")}
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                      if (e.key === "Enter") submitAdd();
                      if (e.key === "Escape") setAddingTo(null);
                    }}
                  />
                  <div className="kanban-add-row">
                    <button className="kanban-add-submit" onClick={submitAdd}>{t("add")}</button>
                    <button className="kanban-add-cancel" onClick={() => setAddingTo(null)}>
                      {t("cancel")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
      </div>
      <div
        className="board-divider board-divider--h"
        ref={horizontalDividerRef}
        role="separator"
        aria-orientation="horizontal"
        onPointerDown={startResizeBottom}
      />
      <div
        className="board-bottom-row"
        ref={bottomRowRef}
        style={
          {
            "--bottom-height": `${bottomHeight}px`,
            "--quota-width": `${quotaWidth}px`,
          } as React.CSSProperties
        }
      >
        <QuotaSection
          quotas={quotas}
          logs={quotaLogs}
          streaks={quotaStreaks}
          tasks={tasks}
          send={send}
          onStopTaskTimer={onTimerToggle}
          dayBoundaryHour={dayBoundaryHour}
        />
        <div
          className="board-divider board-divider--v"
          role="separator"
          aria-orientation="vertical"
          onPointerDown={startResizeQuota}
        />
        <LifeLogSection
          activities={lifeActivities}
          logs={lifeLogs}
          tasks={tasks}
          send={send}
          onStopTaskTimer={onTimerToggle}
          dayBoundaryHour={dayBoundaryHour}
        />
      </div>
    </div>
  );
}
