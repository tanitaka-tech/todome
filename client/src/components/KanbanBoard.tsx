import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ColumnId, Goal, KanbanTask } from "../types";
import { formatDuration, totalSeconds } from "../types";

interface Props {
  tasks: KanbanTask[];
  goals: Goal[];
  setTasks: React.Dispatch<React.SetStateAction<KanbanTask[]>>;
  send: (data: unknown) => void;
  onCardClick: (task: KanbanTask) => void;
  onTimerToggle: (taskId: string) => void;
  onMoveColumn: (taskId: string, column: string) => void;
  tick: number;
}

const COLUMNS: { id: ColumnId; label: string; color: string }[] = [
  { id: "todo", label: "TODO", color: "#6b7280" },
  { id: "in_progress", label: "進行中", color: "#d4a24e" },
  { id: "done", label: "完了", color: "#9a5b2f" },
];

const PRIORITY_LABELS: Record<string, { label: string; className: string }> = {
  high: { label: "高", className: "priority-high" },
  medium: { label: "中", className: "priority-medium" },
  low: { label: "低", className: "priority-low" },
};

const GOAL_FILTER_NONE = "__none__";
const RECENT_DAYS_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "全期間" },
  { value: 1, label: "1日" },
  { value: 3, label: "3日" },
  { value: 7, label: "7日" },
  { value: 30, label: "30日" },
];

type InsertPos = "above" | "below";

export function KanbanBoard({
  tasks,
  goals,
  setTasks,
  send,
  onCardClick,
  onTimerToggle,
  onMoveColumn,
  tick: _tick,
}: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ColumnId | null>(null);
  const [dragOverCardId, setDragOverCardId] = useState<string | null>(null);
  const [dragOverPos, setDragOverPos] = useState<InsertPos>("above");
  const [addingTo, setAddingTo] = useState<ColumnId | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<"low" | "medium" | "high">("medium");
  const [goalFilter, setGoalFilter] = useState<string>("");
  const [recentDays, setRecentDays] = useState<number>(0);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);

  const cardRefs = useRef(new Map<string, HTMLElement>());
  const prevRects = useRef(new Map<string, DOMRect>());
  const originalTasksRef = useRef<KanbanTask[] | null>(null);
  const dropCommittedRef = useRef(false);

  useLayoutEffect(() => {
    const nextRects = new Map<string, DOMRect>();
    cardRefs.current.forEach((el, id) => {
      nextRects.set(id, el.getBoundingClientRect());
    });

    cardRefs.current.forEach((el, id) => {
      // The dragging card itself is handled by the OS drag ghost —
      // we don't want to FLIP-animate its in-flow placeholder.
      if (id === dragId) return;
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
      dragged,
      ...without.slice(insertIdx),
    ];
    const needsReorder = finalOrder.some((t, i) => t.id !== tasks[i]?.id);

    if (columnChanged) {
      onMoveColumn(draggedId, targetColumn);
    }
    if (needsReorder) {
      setTasks((prev) => {
        const map = new Map(prev.map((t) => [t.id, t]));
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
      send({ type: "kanban_reorder", taskIds: finalOrder.map((t) => t.id) });
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
    setNewPriority("medium");
    setTimeout(() => addInputRef.current?.focus(), 50);
  };

  const submitAdd = () => {
    const title = newTitle.trim();
    if (!title || !addingTo) return;
    const goalId =
      goalFilter && goalFilter !== GOAL_FILTER_NONE ? goalFilter : "";
    send({
      type: "kanban_add",
      title,
      column: addingTo,
      priority: newPriority,
      goalId,
    });
    setAddingTo(null);
    setNewTitle("");
  };

  const handleDelete = (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    send({ type: "kanban_delete", taskId });
  };

  const cyclePriority = (e: React.MouseEvent, task: KanbanTask) => {
    e.stopPropagation();
    const order: Array<"low" | "medium" | "high"> = ["low", "medium", "high"];
    const idx = order.indexOf(task.priority);
    const next = order[(idx + 1) % order.length];
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, priority: next } : t)),
    );
    send({ type: "kanban_edit", taskId: task.id, priority: next });
  };

  const visibleTasks = useMemo(() => {
    if (!goalFilter && recentDays === 0) return tasks;
    const cutoff =
      // eslint-disable-next-line react-hooks/purity
      recentDays > 0 ? Date.now() - recentDays * 24 * 60 * 60 * 1000 : 0;
    return tasks.filter((t) => {
      if (goalFilter) {
        if (goalFilter === GOAL_FILTER_NONE) {
          if (t.goalId) return false;
        } else if (t.goalId !== goalFilter) {
          return false;
        }
      }
      if (cutoff > 0 && t.column === "done") {
        if (!t.completedAt) return false;
        if (new Date(t.completedAt).getTime() < cutoff) return false;
      }
      return true;
    });
  }, [tasks, goalFilter, recentDays]);

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
    <div className="kanban-wrap">
      <div className="kanban-filter-bar">
        <div className="kanban-filter-group">
          <span className="kanban-filter-label">目標</span>
          <select
            className="kanban-filter-select"
            value={goalFilter}
            onChange={(e) => setGoalFilter(e.target.value)}
          >
            <option value="">すべて</option>
            <option value={GOAL_FILTER_NONE}>目標なし</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div className="kanban-filter-group">
          <span className="kanban-filter-label">完了</span>
          <div className="kanban-filter-tabs">
            {RECENT_DAYS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`kanban-filter-tab ${recentDays === opt.value ? "kanban-filter-tab--active" : ""}`}
                onClick={() => setRecentDays(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {hiddenCount > 0 && (
          <button
            className="kanban-filter-clear"
            onClick={() => {
              setGoalFilter("");
              setRecentDays(0);
            }}
            title="フィルターをクリア"
          >
            {hiddenCount}件を非表示 &times;
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
              <span className="kanban-column-title">{col.label}</span>
              <span className="kanban-column-count">{colTasks.length}</span>
              <button
                className="kanban-add-btn"
                onClick={() => handleAdd(col.id)}
                title="タスクを追加"
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
                    <div className="kanban-card-top">
                      <button
                        className={`kanban-priority-badge ${PRIORITY_LABELS[task.priority].className}`}
                        onClick={(e) => cyclePriority(e, task)}
                        title="優先度を変更"
                      >
                        {PRIORITY_LABELS[task.priority].label}
                      </button>
                      <div className="kanban-card-actions">
                        <button
                          className="kanban-card-action kanban-card-delete"
                          onClick={(e) => handleDelete(e, task.id)}
                          title="削除"
                        >
                          &times;
                        </button>
                      </div>
                    </div>
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
                          title={running ? "停止" : "開始"}
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
                        {new Date(task.completedAt).toLocaleString("ja-JP", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {" 完了"}
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
                    placeholder="タスク名を入力..."
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return;
                      if (e.key === "Enter") submitAdd();
                      if (e.key === "Escape") setAddingTo(null);
                    }}
                  />
                  <div className="kanban-add-row">
                    <select
                      className="kanban-priority-select"
                      value={newPriority}
                      onChange={(e) =>
                        setNewPriority(e.target.value as "low" | "medium" | "high")
                      }
                    >
                      <option value="low">低</option>
                      <option value="medium">中</option>
                      <option value="high">高</option>
                    </select>
                    <button className="kanban-add-submit" onClick={submitAdd}>追加</button>
                    <button className="kanban-add-cancel" onClick={() => setAddingTo(null)}>
                      キャンセル
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
