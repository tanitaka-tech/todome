import { useState } from "react";
import type { Goal, KPI } from "../types";

interface Props {
  goals: Goal[];
  setGoals: React.Dispatch<React.SetStateAction<Goal[]>>;
  send: (data: unknown) => void;
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

export function GoalPanel({ goals, setGoals, send }: Props) {
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [showForm, setShowForm] = useState(false);

  const openNew = () => {
    setEditingGoal({
      id: "",
      name: "",
      memo: "",
      kpis: [],
      deadline: "",
    });
    setShowForm(true);
  };

  const openEdit = (goal: Goal) => {
    setEditingGoal({ ...goal, kpis: goal.kpis.map((k) => ({ ...k })) });
    setShowForm(true);
  };

  const handleSave = () => {
    if (!editingGoal || !editingGoal.name.trim()) return;
    if (editingGoal.id) {
      // update
      setGoals((prev) =>
        prev.map((g) => (g.id === editingGoal.id ? editingGoal : g)),
      );
      send({ type: "goal_edit", goal: editingGoal });
    } else {
      // create
      const newGoal = { ...editingGoal, id: generateId() };
      setGoals((prev) => [...prev, newGoal]);
      send({ type: "goal_add", goal: newGoal });
    }
    setShowForm(false);
    setEditingGoal(null);
  };

  const handleDelete = (goalId: string) => {
    setGoals((prev) => prev.filter((g) => g.id !== goalId));
    send({ type: "goal_delete", goalId });
  };

  const addKpi = () => {
    if (!editingGoal) return;
    setEditingGoal({
      ...editingGoal,
      kpis: [...editingGoal.kpis, { id: generateId(), name: "", value: "" }],
    });
  };

  const updateKpi = (kpiId: string, field: keyof KPI, value: string) => {
    if (!editingGoal) return;
    setEditingGoal({
      ...editingGoal,
      kpis: editingGoal.kpis.map((k) =>
        k.id === kpiId ? { ...k, [field]: value } : k,
      ),
    });
  };

  const removeKpi = (kpiId: string) => {
    if (!editingGoal) return;
    setEditingGoal({
      ...editingGoal,
      kpis: editingGoal.kpis.filter((k) => k.id !== kpiId),
    });
  };

  return (
    <div className="goal-panel">
      <div className="goal-panel-header">
        <h2 className="goal-panel-title">目標一覧</h2>
        <button className="goal-add-btn" onClick={openNew}>
          + 新しい目標
        </button>
      </div>

      {/* 目標カード一覧 */}
      <div className="goal-list">
        {goals.length === 0 && !showForm && (
          <div className="goal-empty">
            目標がまだありません。「+ 新しい目標」から追加できます。
          </div>
        )}
        {goals.map((goal) => (
          <div key={goal.id} className="goal-card">
            <div className="goal-card-header">
              <div className="goal-card-name">{goal.name}</div>
              <div className="goal-card-actions">
                <button
                  className="goal-card-action"
                  onClick={() => openEdit(goal)}
                  title="編集"
                >
                  &#9998;
                </button>
                <button
                  className="goal-card-action goal-card-action--delete"
                  onClick={() => handleDelete(goal.id)}
                  title="削除"
                >
                  &times;
                </button>
              </div>
            </div>
            {goal.deadline && (
              <div className="goal-card-meta">期日: {goal.deadline}</div>
            )}
            {goal.memo && (
              <div className="goal-card-memo">{goal.memo}</div>
            )}
            {goal.kpis.length > 0 && (
              <div className="goal-card-kpis">
                {goal.kpis.map((kpi) => (
                  <div key={kpi.id} className="goal-kpi-chip">
                    <span className="goal-kpi-name">{kpi.name}</span>
                    {kpi.value && (
                      <span className="goal-kpi-value">{kpi.value}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 編集フォーム (モーダル) */}
      {showForm && editingGoal && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">
                {editingGoal.id ? "目標を編集" : "新しい目標"}
              </h2>
              <button
                className="modal-close"
                onClick={() => setShowForm(false)}
              >
                &times;
              </button>
            </div>

            <div className="modal-body">
              <label className="modal-label">目標名</label>
              <input
                className="modal-input"
                placeholder="例: Q3 売上目標"
                value={editingGoal.name}
                onChange={(e) =>
                  setEditingGoal({ ...editingGoal, name: e.target.value })
                }
              />

              <label className="modal-label">メモ</label>
              <textarea
                className="modal-textarea"
                rows={3}
                placeholder="目標に関するメモ..."
                value={editingGoal.memo}
                onChange={(e) =>
                  setEditingGoal({ ...editingGoal, memo: e.target.value })
                }
              />

              <label className="modal-label">期日</label>
              <input
                className="modal-input"
                type="date"
                value={editingGoal.deadline}
                onChange={(e) =>
                  setEditingGoal({ ...editingGoal, deadline: e.target.value })
                }
              />

              <div className="modal-label-row">
                <label className="modal-label" style={{ marginBottom: 0 }}>
                  KPI
                </label>
                <button className="kpi-add-btn" onClick={addKpi}>
                  + 追加
                </button>
              </div>
              <div className="kpi-list">
                {editingGoal.kpis.map((kpi) => (
                  <div key={kpi.id} className="kpi-row">
                    <input
                      className="kpi-input kpi-input-name"
                      placeholder="KPI名"
                      value={kpi.name}
                      onChange={(e) => updateKpi(kpi.id, "name", e.target.value)}
                    />
                    <input
                      className="kpi-input kpi-input-value"
                      placeholder="目標値"
                      value={kpi.value}
                      onChange={(e) =>
                        updateKpi(kpi.id, "value", e.target.value)
                      }
                    />
                    <button
                      className="kpi-remove-btn"
                      onClick={() => removeKpi(kpi.id)}
                    >
                      &times;
                    </button>
                  </div>
                ))}
                {editingGoal.kpis.length === 0 && (
                  <div className="kpi-empty">KPIが設定されていません</div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="modal-btn-secondary"
                onClick={() => setShowForm(false)}
              >
                キャンセル
              </button>
              <button className="modal-btn-primary" onClick={handleSave}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
