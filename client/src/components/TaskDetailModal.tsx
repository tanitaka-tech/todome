import { useRef, useState } from "react";
import type { Goal, KanbanTask } from "../types";
import { formatDuration } from "../types";

interface Props {
  task: KanbanTask;
  goals: Goal[];
  onSave: (task: KanbanTask) => void;
  onClose: () => void;
}

export function TaskDetailModal({ task, goals, onSave, onClose }: Props) {
  const [title, setTitle] = useState(task.title);
  const [memo, setMemo] = useState(task.memo);
  const [goalId, setGoalId] = useState(task.goalId);
  const [estH, setEstH] = useState(Math.floor(task.estimatedMinutes / 60));
  const [estM, setEstM] = useState(task.estimatedMinutes % 60);

  const linkedGoal = goalId ? goals.find((g) => g.id === goalId) : undefined;
  const overlayMouseDownRef = useRef(false);

  const handleSave = () => {
    const estimatedMinutes = Math.max(0, estH * 60 + estM);
    onSave({ ...task, title: title.trim() || task.title, memo, goalId, estimatedMinutes });
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        overlayMouseDownRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && overlayMouseDownRef.current) {
          onClose();
        }
      }}
    >
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">タスク詳細</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body">
          {/* タイトル */}
          <label className="modal-label">タイトル</label>
          <input
            className="modal-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          {/* メモ */}
          <label className="modal-label">メモ</label>
          <textarea
            className="modal-textarea"
            rows={4}
            placeholder="メモを入力..."
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />

          {/* 見積もり時間 */}
          <label className="modal-label">見積もり時間</label>
          <div className="estimate-row">
            <input
              className="estimate-input"
              type="number"
              min={0}
              value={estH}
              onChange={(e) => setEstH(Math.max(0, Number(e.target.value) || 0))}
            />
            <span className="estimate-unit">時間</span>
            <input
              className="estimate-input"
              type="number"
              min={0}
              max={59}
              value={estM}
              onChange={(e) => setEstM(Math.max(0, Math.min(59, Number(e.target.value) || 0)))}
            />
            <span className="estimate-unit">分</span>
            {task.timeSpent > 0 && (
              <span className="estimate-actual">
                実績: {formatDuration(task.timeSpent)}
              </span>
            )}
          </div>

          {/* 目標の紐付け */}
          <label className="modal-label">紐付ける目標</label>
          <select
            className="modal-select"
            value={goalId}
            onChange={(e) => setGoalId(e.target.value)}
          >
            <option value="">なし</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>

          {linkedGoal && (
            <div className="modal-goal-preview">
              <div className="modal-goal-preview-name">{linkedGoal.name}</div>
              {linkedGoal.deadline && (
                <div className="modal-goal-preview-detail">
                  期日: {linkedGoal.deadline}
                </div>
              )}
              {linkedGoal.kpis.length > 0 && (
                <div className="modal-goal-preview-detail">
                  KPI: {linkedGoal.kpis.map((k) => k.name).join(", ")}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="modal-btn-secondary" onClick={onClose}>
            キャンセル
          </button>
          <button className="modal-btn-primary" onClick={handleSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
