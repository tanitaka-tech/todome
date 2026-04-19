import { useEffect, useMemo, useRef, useState } from "react";
import type { Goal, KanbanTask } from "../types";
import { formatDuration, formatKpiTimeValue } from "../types";
import { useModalClose } from "../hooks/useModalClose";

interface Props {
  task: KanbanTask;
  goals: Goal[];
  onSave: (task: KanbanTask) => void;
  onClose: () => void;
}

const AUTOSAVE_DELAY = 400;

const PRIORITY_OPTIONS: Array<{
  value: KanbanTask["priority"];
  label: string;
}> = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

export function TaskDetailModal({ task, goals, onSave, onClose }: Props) {
  const [title, setTitle] = useState(task.title);
  const [memo, setMemo] = useState(task.memo);
  const [goalId, setGoalId] = useState(task.goalId);
  const [kpiId, setKpiId] = useState(task.kpiId);
  const [priority, setPriority] = useState<KanbanTask["priority"]>(task.priority);
  const [estH, setEstH] = useState(Math.floor(task.estimatedMinutes / 60));
  const [estM, setEstM] = useState(task.estimatedMinutes % 60);

  const linkedGoal = goalId ? goals.find((g) => g.id === goalId) : undefined;
  const timeKpis = useMemo(
    () => (linkedGoal ? linkedGoal.kpis.filter((k) => k.unit === "time") : []),
    [linkedGoal],
  );
  const overlayMouseDownRef = useRef(false);
  const { closing, close } = useModalClose(onClose);
  const isFirstRender = useRef(true);

  // 目標が変わって紐付け先 KPI が存在しない場合は紐付けをクリアする。
  useEffect(() => {
    if (kpiId && !timeKpis.some((k) => k.id === kpiId)) {
      setKpiId("");
    }
  }, [kpiId, timeKpis]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const estimatedMinutes = Math.max(0, estH * 60 + estM);
    const nextTitle = title.trim() || task.title;
    const nextKpiId = goalId ? kpiId : "";
    if (
      nextTitle === task.title &&
      memo === task.memo &&
      goalId === task.goalId &&
      nextKpiId === task.kpiId &&
      priority === task.priority &&
      estimatedMinutes === task.estimatedMinutes
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      onSave({
        ...task,
        title: nextTitle,
        memo,
        goalId,
        kpiId: nextKpiId,
        priority,
        estimatedMinutes,
      });
    }, AUTOSAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [title, memo, goalId, kpiId, priority, estH, estM, task, onSave]);

  return (
    <div
      className={`modal-overlay${closing ? " is-closing" : ""}`}
      onMouseDown={(e) => {
        overlayMouseDownRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && overlayMouseDownRef.current) {
          close();
        }
      }}
    >
      <div
        className="modal-content modal-content--detail"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="detail-topbar">
          <button className="modal-close" onClick={close} aria-label="閉じる">
            &times;
          </button>
        </div>

        <div className="detail-body">
          <input
            className="detail-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="無題"
          />

          <div className="detail-properties">
            <div className="detail-prop">
              <div className="detail-prop-label">優先度</div>
              <div className="detail-prop-value">
                <div className="detail-priority-group">
                  {PRIORITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={`detail-priority-chip detail-priority-chip--${opt.value}${
                        priority === opt.value ? " is-active" : ""
                      }`}
                      onClick={() => setPriority(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="detail-prop">
              <div className="detail-prop-label">目標</div>
              <div className="detail-prop-value">
                <select
                  className="detail-prop-select"
                  value={goalId}
                  onChange={(e) => setGoalId(e.target.value)}
                >
                  <option value="">なし</option>
                  {goals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
                {linkedGoal && (
                  <div className="detail-prop-meta">
                    {linkedGoal.deadline && (
                      <span>期日 {linkedGoal.deadline}</span>
                    )}
                    {linkedGoal.kpis.length > 0 && (
                      <span>KPI {linkedGoal.kpis.length}</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {linkedGoal && timeKpis.length > 0 && (
              <div className="detail-prop">
                <div className="detail-prop-label">KPI紐付け</div>
                <div className="detail-prop-value">
                  <select
                    className="detail-prop-select"
                    value={kpiId}
                    onChange={(e) => setKpiId(e.target.value)}
                  >
                    <option value="">なし</option>
                    {timeKpis.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name} ({formatKpiTimeValue(k.currentValue)}/
                        {formatKpiTimeValue(k.targetValue)})
                      </option>
                    ))}
                  </select>
                  <div className="detail-prop-meta">
                    {task.kpiContributed
                      ? "完了済み: 計測時間が加算されています"
                      : "完了すると計測時間がKPIに加算されます"}
                  </div>
                </div>
              </div>
            )}

            <div className="detail-prop">
              <div className="detail-prop-label">見積もり</div>
              <div className="detail-prop-value">
                <div className="detail-estimate">
                  <input
                    className="detail-estimate-input"
                    type="number"
                    min={0}
                    value={estH}
                    onChange={(e) =>
                      setEstH(Math.max(0, Number(e.target.value) || 0))
                    }
                  />
                  <span className="detail-estimate-unit">h</span>
                  <input
                    className="detail-estimate-input"
                    type="number"
                    min={0}
                    max={59}
                    value={estM}
                    onChange={(e) =>
                      setEstM(
                        Math.max(0, Math.min(59, Number(e.target.value) || 0)),
                      )
                    }
                  />
                  <span className="detail-estimate-unit">m</span>
                </div>
              </div>
            </div>

            {task.timeSpent > 0 && (
              <div className="detail-prop">
                <div className="detail-prop-label">実績</div>
                <div className="detail-prop-value">
                  <span className="detail-prop-static">
                    {formatDuration(task.timeSpent)}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="detail-divider" />

          <textarea
            className="detail-memo"
            placeholder="メモを書く..."
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
