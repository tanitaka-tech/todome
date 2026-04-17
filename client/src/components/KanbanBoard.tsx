import { useRef, useState } from "react";
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
  const [dragOver, setDragOver] = useState<ColumnId | null>(null);
  const [addingTo, setAddingTo] = useState<ColumnId | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<"low" | "medium" | "high">("medium");
  const addInputRef = useRef<HTMLInputElement>(null);

  const goalMap = new Map(goals.map((g) => [g.id, g]));

  const handleDragStart = (taskId: string) => {
    setDragId(taskId);
  };

  const handleDragOver = (e: React.DragEvent, columnId: ColumnId) => {
    e.preventDefault();
    setDragOver(columnId);
  };

  const handleDragLeave = () => {
    setDragOver(null);
  };

  const handleDrop = (columnId: ColumnId) => {
    if (dragId) {
      onMoveColumn(dragId, columnId);
    }
    setDragId(null);
    setDragOver(null);
  };

  const handleDragEnd = () => {
    setDragId(null);
    setDragOver(null);
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
    send({
      type: "kanban_add",
      title,
      column: addingTo,
      priority: newPriority,
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

  return (
    <div className="kanban-board">
      {COLUMNS.map((col) => {
        const colTasks = tasks.filter((t) => t.column === col.id);
        return (
          <div
            key={col.id}
            className={`kanban-column ${dragOver === col.id ? "kanban-column--dragover" : ""}`}
            onDragOver={(e) => handleDragOver(e, col.id)}
            onDragLeave={handleDragLeave}
            onDrop={() => handleDrop(col.id)}
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
                return (
                  <div
                    key={task.id}
                    className={`kanban-card ${dragId === task.id ? "kanban-card--dragging" : ""} ${running ? "kanban-card--running" : ""}`}
                    draggable
                    onDragStart={() => handleDragStart(task.id)}
                    onDragEnd={handleDragEnd}
                    onClick={() => onCardClick(task)}
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
  );
}
