import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";
import {
  areAllKpisAchieved,
  isKpiAchieved,
  kpiProgress,
  type Goal,
  type KPI,
  type KPIUnit,
  type RepoInfo,
} from "../types";
import { DARK_THEMES, type ThemeName } from "../theme";
import { useModalClose } from "../hooks/useModalClose";

function getEmojiPickerTheme(): Theme {
  if (typeof document === "undefined") return Theme.AUTO;
  const t = document.documentElement.getAttribute("data-theme") as ThemeName | null;
  if (!t) return Theme.AUTO;
  return DARK_THEMES.includes(t) ? Theme.DARK : Theme.LIGHT;
}

interface Props {
  goals: Goal[];
  setGoals: React.Dispatch<React.SetStateAction<Goal[]>>;
  send: (data: unknown) => void;
  githubRepos: RepoInfo[];
  onRequestRepoList: () => void;
  githubAuthOk: boolean;
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function formatKpiValue(value: number, unit: KPIUnit): string {
  const v = Math.round(value);
  return unit === "percent" ? `${v}%` : String(v);
}

function toInt(v: string | number): number {
  return Math.max(0, Math.round(Number(v) || 0));
}

function newKpi(): KPI {
  return {
    id: generateId(),
    name: "",
    unit: "number",
    targetValue: 0,
    currentValue: 0,
  };
}

const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export function GoalPanel({
  goals,
  setGoals,
  send,
  githubRepos,
  onRequestRepoList,
  githubAuthOk,
}: Props) {
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState<"active" | "achieved">("active");
  const [formError, setFormError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Goal | null>(null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [pickerStyle, setPickerStyle] = useState<React.CSSProperties | null>(
    null,
  );
  const iconWrapRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const formOverlayMouseDownRef = useRef(false);
  const deleteOverlayMouseDownRef = useRef(false);

  useEffect(() => {
    if (!iconPickerOpen) {
      setPickerStyle(null);
      return;
    }
    const compute = () => {
      const el = iconWrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const gap = 8;
      const width = Math.min(340, window.innerWidth - 16);
      const left = Math.max(
        8,
        Math.min(r.left, window.innerWidth - width - 8),
      );
      const height = 380 + 40;
      const spaceBelow = window.innerHeight - r.bottom;
      const openBelow = spaceBelow >= height + gap;
      setPickerStyle({
        position: "fixed",
        left,
        ...(openBelow
          ? { top: r.bottom + gap }
          : { bottom: window.innerHeight - r.top + gap }),
        width,
        zIndex: 1000,
      });
    };
    compute();
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      const inWrap = iconWrapRef.current?.contains(t);
      const inPicker = pickerRef.current?.contains(t);
      if (!inWrap && !inPicker) setIconPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIconPickerOpen(false);
    };
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [iconPickerOpen]);

  const ensureRepoList = useCallback(() => {
    if (githubAuthOk && githubRepos.length === 0) {
      onRequestRepoList();
    }
  }, [githubAuthOk, githubRepos.length, onRequestRepoList]);

  const openNew = () => {
    setEditingGoal({
      id: "",
      name: "",
      memo: "",
      kpis: [newKpi()],
      deadline: "",
      achieved: false,
      achievedAt: "",
      repository: "",
    });
    setFormError("");
    setShowForm(true);
    ensureRepoList();
  };

  const openEdit = (goal: Goal) => {
    setEditingGoal({ ...goal, kpis: goal.kpis.map((k) => ({ ...k })) });
    setFormError("");
    setShowForm(true);
    ensureRepoList();
  };

  const resetForm = useCallback(() => {
    setShowForm(false);
    setEditingGoal(null);
    setFormError("");
    setIconPickerOpen(false);
  }, []);
  const { closing: formClosing, close: closeForm } = useModalClose(resetForm);

  const clearDeleteTarget = useCallback(() => setDeleteTarget(null), []);
  const { closing: deleteClosing, close: closeDelete } = useModalClose(clearDeleteTarget);

  const handleSave = () => {
    if (!editingGoal) return;
    if (!editingGoal.name.trim()) {
      setFormError("目標名を入力してください");
      return;
    }
    if (editingGoal.kpis.length === 0) {
      setFormError("KPIを最低1つ設定してください");
      return;
    }
    for (const kpi of editingGoal.kpis) {
      if (!kpi.name.trim()) {
        setFormError("KPI名を入力してください");
        return;
      }
      if (!(kpi.targetValue > 0)) {
        setFormError("KPIの目標値は0より大きい数値を入力してください");
        return;
      }
    }

    const repoTrimmed = (editingGoal.repository || "").trim();
    if (repoTrimmed && !REPO_PATTERN.test(repoTrimmed)) {
      setFormError("リポジトリは owner/name 形式で入力してください");
      return;
    }

    const nowAchieved = areAllKpisAchieved(editingGoal.kpis);
    const wasAchieved = editingGoal.achieved;
    const finalGoal: Goal = {
      ...editingGoal,
      repository: repoTrimmed || undefined,
      achieved: nowAchieved,
      achievedAt: nowAchieved
        ? wasAchieved && editingGoal.achievedAt
          ? editingGoal.achievedAt
          : new Date().toISOString()
        : "",
    };

    if (finalGoal.id) {
      setGoals((prev) =>
        prev.map((g) => (g.id === finalGoal.id ? finalGoal : g)),
      );
      send({ type: "goal_edit", goal: finalGoal });
    } else {
      const newGoal = { ...finalGoal, id: generateId() };
      setGoals((prev) => [...prev, newGoal]);
      send({ type: "goal_add", goal: newGoal });
    }
    closeForm();
  };

  const requestDelete = (goal: Goal) => {
    setDeleteTarget(goal);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    setGoals((prev) => prev.filter((g) => g.id !== deleteTarget.id));
    send({ type: "goal_delete", goalId: deleteTarget.id });
    closeDelete();
  };

  const updateCardKpiCurrent = (
    goalId: string,
    kpiId: string,
    newValue: number,
  ) => {
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) return;
    const newKpis = goal.kpis.map((k) =>
      k.id === kpiId ? { ...k, currentValue: toInt(newValue) } : k,
    );
    const nowAchieved = areAllKpisAchieved(newKpis);
    const updated: Goal = {
      ...goal,
      kpis: newKpis,
      achieved: nowAchieved,
      achievedAt: nowAchieved
        ? goal.achieved && goal.achievedAt
          ? goal.achievedAt
          : new Date().toISOString()
        : "",
    };
    setGoals((prev) => prev.map((g) => (g.id === goalId ? updated : g)));
    send({ type: "goal_edit", goal: updated });
  };

  const addKpi = () => {
    if (!editingGoal) return;
    setEditingGoal({
      ...editingGoal,
      kpis: [...editingGoal.kpis, newKpi()],
    });
  };

  const updateKpi = <K extends keyof KPI>(
    kpiId: string,
    field: K,
    value: KPI[K],
  ) => {
    if (!editingGoal) return;
    setEditingGoal({
      ...editingGoal,
      kpis: editingGoal.kpis.map((k) => {
        if (k.id !== kpiId) return k;
        const next = { ...k, [field]: value };
        if (field === "unit" && value === "percent") {
          next.targetValue = 100;
        }
        return next;
      }),
    });
  };

  const removeKpi = (kpiId: string) => {
    if (!editingGoal) return;
    setEditingGoal({
      ...editingGoal,
      kpis: editingGoal.kpis.filter((k) => k.id !== kpiId),
    });
  };

  const activeGoals = goals.filter((g) => !g.achieved);
  const achievedGoals = goals.filter((g) => g.achieved);
  const visibleGoals = tab === "active" ? activeGoals : achievedGoals;

  return (
    <div className="goal-panel">
      <div className="page-head">
        <div className="page-head-title-wrap">
          <h1 className="page-title">目標管理</h1>
          <div className="page-subtitle">
            {activeGoals.length} active · {achievedGoals.length} achieved
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn--primary" onClick={openNew}>
            + 新しい目標
          </button>
        </div>
      </div>

      <div className="goal-tabs">
        <button
          className={`goal-tab ${tab === "active" ? "goal-tab--active" : ""}`}
          onClick={() => setTab("active")}
        >
          進行中 ({activeGoals.length})
        </button>
        <button
          className={`goal-tab ${tab === "achieved" ? "goal-tab--active" : ""}`}
          onClick={() => setTab("achieved")}
        >
          達成済み ({achievedGoals.length})
        </button>
      </div>

      <div className="page-body">
        <div className="goal-list">
          {visibleGoals.length === 0 && !showForm && (
            <div className="goal-empty">
              {tab === "active"
                ? "目標がまだありません。「+ 新しい目標」から追加できます。"
                : "達成済みの目標はまだありません。"}
            </div>
          )}
          {visibleGoals.map((goal) => {
            const overall =
              goal.kpis.length > 0
                ? goal.kpis.reduce((sum, k) => sum + kpiProgress(k), 0) /
                  goal.kpis.length
                : 0;
            return (
              <div
                key={goal.id}
                className={`goal-card ${goal.achieved ? "goal-card--achieved" : ""}`}
              >
                <div className="goal-card-header">
                  <div className="goal-card-name">
                    {goal.icon && (
                      <span className="goal-card-icon">{goal.icon}</span>
                    )}
                    {goal.name}
                  </div>
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
                      onClick={() => requestDelete(goal)}
                      title="削除"
                    >
                      &times;
                    </button>
                  </div>
                </div>
                {goal.deadline && (
                  <div className="goal-card-meta">期日: {goal.deadline}</div>
                )}
                {goal.achieved && goal.achievedAt && (
                  <div className="goal-card-meta">
                    達成: {goal.achievedAt.slice(0, 10)}
                  </div>
                )}
                {goal.repository && (
                  <div className="goal-card-meta">
                    <a
                      className="goal-card-repo"
                      href={`https://github.com/${goal.repository}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="goal-card-repo-mark">⎇</span>
                      {goal.repository}
                    </a>
                  </div>
                )}
                {goal.memo && <div className="goal-card-memo">{goal.memo}</div>}

                {goal.kpis.length > 0 && (
                  <div className="goal-card-overall">
                    <div className="goal-card-overall-head">
                      <span>全体進捗</span>
                      <span>{Math.round(overall)}%</span>
                    </div>
                    <div className="goal-progress-bar">
                      <div
                        className="goal-progress-bar-fill"
                        style={{ width: `${overall}%` }}
                      />
                    </div>
                  </div>
                )}

                {goal.kpis.length > 0 && (
                  <div className="goal-kpi-list">
                    {goal.kpis.map((kpi) => {
                      const pct = kpiProgress(kpi);
                      const achieved = isKpiAchieved(kpi);
                      const trackColor = achieved
                        ? "var(--success, #4ca864)"
                        : "var(--accent, #4c8cf5)";
                      return (
                        <div
                          key={kpi.id}
                          className={`goal-kpi-item ${achieved ? "goal-kpi-item--done" : ""}`}
                        >
                          <div className="goal-kpi-item-head">
                            <span className="goal-kpi-item-name">
                              {achieved && (
                                <span className="goal-kpi-check">✓</span>
                              )}
                              {kpi.name}
                            </span>
                            <span className="goal-kpi-item-value">
                              {formatKpiValue(kpi.currentValue, kpi.unit)} /{" "}
                              {formatKpiValue(kpi.targetValue, kpi.unit)}
                              <span className="goal-kpi-item-pct">
                                ({Math.round(pct)}%)
                              </span>
                            </span>
                          </div>
                          <input
                            type="range"
                            className={`kpi-slider kpi-slider--card ${achieved ? "kpi-slider--done" : ""}`}
                            min={0}
                            max={kpi.targetValue > 0 ? kpi.targetValue : 100}
                            step={1}
                            value={Math.min(
                              Math.round(kpi.currentValue),
                              kpi.targetValue > 0
                                ? Math.round(kpi.targetValue)
                                : 100,
                            )}
                            disabled={kpi.targetValue <= 0}
                            style={{
                              background: `linear-gradient(to right, ${trackColor} 0%, ${trackColor} ${pct}%, var(--surface-hover) ${pct}%, var(--surface-hover) 100%)`,
                            }}
                            onChange={(e) =>
                              updateCardKpiCurrent(
                                goal.id,
                                kpi.id,
                                toInt(e.target.value),
                              )
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {showForm && editingGoal && (
        <div
          className={`modal-overlay${formClosing ? " is-closing" : ""}`}
          onMouseDown={(e) => {
            formOverlayMouseDownRef.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && formOverlayMouseDownRef.current) {
              closeForm();
            }
          }}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">
                {editingGoal.id ? "目標を編集" : "新しい目標"}
              </h2>
              <button className="modal-close" onClick={closeForm}>
                &times;
              </button>
            </div>

            <div className="modal-body">
              <label className="modal-label">目標名</label>
              <div className="goal-name-row">
                <div className="goal-icon-wrap" ref={iconWrapRef}>
                  <button
                    type="button"
                    className={`goal-icon-btn ${iconPickerOpen ? "is-active" : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setIconPickerOpen((v) => !v)}
                    title="アイコンを選択"
                    aria-label="アイコンを選択"
                  >
                    {editingGoal.icon || (
                      <span className="goal-icon-placeholder">🎯</span>
                    )}
                  </button>
                  {iconPickerOpen &&
                    pickerStyle &&
                    createPortal(
                      <div
                        ref={pickerRef}
                        className="bw-cat-editor-picker"
                        style={pickerStyle}
                        onMouseDown={(e) => {
                          const t = e.target as HTMLElement;
                          if (
                            t.tagName === "INPUT" ||
                            t.tagName === "TEXTAREA"
                          )
                            return;
                          e.preventDefault();
                        }}
                      >
                        <div className="bw-cat-editor-picker-head">
                          <button
                            type="button"
                            className="bw-cat-editor-icon-clear"
                            onClick={() => {
                              setEditingGoal((g) =>
                                g ? { ...g, icon: "" } : g,
                              );
                              setIconPickerOpen(false);
                            }}
                          >
                            アイコンなし
                          </button>
                        </div>
                        <EmojiPicker
                          onEmojiClick={(data) => {
                            setEditingGoal((g) =>
                              g ? { ...g, icon: data.emoji } : g,
                            );
                            setIconPickerOpen(false);
                          }}
                          theme={getEmojiPickerTheme()}
                          emojiStyle={EmojiStyle.NATIVE}
                          searchPlaceHolder="検索"
                          lazyLoadEmojis
                          width="100%"
                          height={380}
                          previewConfig={{ showPreview: false }}
                          autoFocusSearch={false}
                        />
                      </div>,
                      document.body,
                    )}
                </div>
                <input
                  className="modal-input"
                  placeholder="例: Q3 売上目標"
                  value={editingGoal.name}
                  onChange={(e) =>
                    setEditingGoal({ ...editingGoal, name: e.target.value })
                  }
                />
              </div>

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

              <label className="modal-label">
                リポジトリ{" "}
                <span className="modal-label-hint">
                  (任意 / owner/name 形式)
                </span>
              </label>
              <input
                className="modal-input"
                placeholder="例: tanitaka_tech/todome"
                list="goal-repo-suggest"
                value={editingGoal.repository ?? ""}
                onChange={(e) =>
                  setEditingGoal({
                    ...editingGoal,
                    repository: e.target.value,
                  })
                }
              />
              {githubRepos.length > 0 && (
                <datalist id="goal-repo-suggest">
                  {githubRepos.map((r) => (
                    <option key={r.nameWithOwner} value={r.nameWithOwner} />
                  ))}
                </datalist>
              )}

              <div className="modal-label-row">
                <label className="modal-label" style={{ marginBottom: 0 }}>
                  KPI <span className="modal-label-hint">(最低1つ必須)</span>
                </label>
                <button className="kpi-add-btn" onClick={addKpi}>
                  + 追加
                </button>
              </div>
              <div className="kpi-list">
                {editingGoal.kpis.map((kpi) => (
                  <div key={kpi.id} className="kpi-edit-row">
                    <div className="kpi-edit-row-top">
                      <input
                        className="kpi-input kpi-input-name"
                        placeholder="KPI名 (例: 月間売上)"
                        value={kpi.name}
                        onChange={(e) =>
                          updateKpi(kpi.id, "name", e.target.value)
                        }
                      />
                      <button
                        className="kpi-remove-btn"
                        onClick={() => removeKpi(kpi.id)}
                        title="削除"
                      >
                        &times;
                      </button>
                    </div>
                    <div className="kpi-edit-row-bottom">
                      <label className="kpi-field">
                        <span className="kpi-field-label">目標値</span>
                        <input
                          className="kpi-input kpi-input-num"
                          type="number"
                          inputMode="numeric"
                          step={1}
                          min={0}
                          value={kpi.unit === "percent" ? 100 : kpi.targetValue}
                          disabled={kpi.unit === "percent"}
                          onChange={(e) =>
                            updateKpi(
                              kpi.id,
                              "targetValue",
                              toInt(e.target.value),
                            )
                          }
                        />
                      </label>
                      <label className="kpi-field">
                        <span className="kpi-field-label">単位</span>
                        <select
                          className="kpi-input kpi-input-unit"
                          value={kpi.unit}
                          onChange={(e) =>
                            updateKpi(
                              kpi.id,
                              "unit",
                              e.target.value as KPIUnit,
                            )
                          }
                        >
                          <option value="number">数値</option>
                          <option value="percent">パーセンテージ</option>
                        </select>
                      </label>
                    </div>
                    <div className="kpi-edit-slider-row">
                      <div className="kpi-edit-slider-head">
                        <span className="kpi-field-label">現在値</span>
                        <span className="kpi-edit-slider-value">
                          {formatKpiValue(kpi.currentValue, kpi.unit)} /{" "}
                          {formatKpiValue(kpi.targetValue, kpi.unit)}
                          {kpi.targetValue > 0 && (
                            <span className="kpi-edit-progress-pct">
                              ({Math.round(kpiProgress(kpi))}%)
                            </span>
                          )}
                        </span>
                      </div>
                      <input
                        type="range"
                        className={`kpi-slider ${isKpiAchieved(kpi) ? "kpi-slider--done" : ""}`}
                        min={0}
                        max={kpi.targetValue > 0 ? kpi.targetValue : 100}
                        step={1}
                        value={Math.min(
                          Math.round(kpi.currentValue),
                          kpi.targetValue > 0
                            ? Math.round(kpi.targetValue)
                            : 100,
                        )}
                        disabled={kpi.targetValue <= 0}
                        style={(() => {
                          const pct = kpiProgress(kpi);
                          const c = isKpiAchieved(kpi)
                            ? "var(--success, #4ca864)"
                            : "var(--accent, #4c8cf5)";
                          return {
                            background: `linear-gradient(to right, ${c} 0%, ${c} ${pct}%, var(--surface-hover) ${pct}%, var(--surface-hover) 100%)`,
                          };
                        })()}
                        onChange={(e) =>
                          updateKpi(
                            kpi.id,
                            "currentValue",
                            toInt(e.target.value),
                          )
                        }
                      />
                    </div>
                  </div>
                ))}
                {editingGoal.kpis.length === 0 && (
                  <div className="kpi-empty">KPIが設定されていません</div>
                )}
              </div>

              {formError && <div className="modal-error">{formError}</div>}
            </div>

            <div className="modal-footer">
              <button className="modal-btn-secondary" onClick={closeForm}>
                キャンセル
              </button>
              <button className="modal-btn-primary" onClick={handleSave}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className={`modal-overlay${deleteClosing ? " is-closing" : ""}`}
          onMouseDown={(e) => {
            deleteOverlayMouseDownRef.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && deleteOverlayMouseDownRef.current) {
              closeDelete();
            }
          }}
        >
          <div
            className="modal-content modal-content--sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="modal-title">目標を削除</h2>
              <button
                className="modal-close"
                onClick={closeDelete}
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-confirm-text">
                「<strong>{deleteTarget.name}</strong>」を削除しますか？
              </p>
              <p className="modal-confirm-sub">この操作は元に戻せません。</p>
            </div>
            <div className="modal-footer">
              <button
                className="modal-btn-secondary"
                onClick={closeDelete}
              >
                キャンセル
              </button>
              <button
                className="modal-btn-primary modal-btn-danger"
                onClick={confirmDelete}
              >
                削除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
