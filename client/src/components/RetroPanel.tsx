import { useMemo, useRef, useState } from "react";
import type {
  KanbanTask,
  RetroDocument,
  RetroType,
  Retrospective,
} from "../types";
import { isTaskCompletedInPeriod } from "../types";
import { RetroSession } from "./RetroSession";
import { RetroCalendar } from "./RetroCalendar";
import { useModalClose } from "../hooks/useModalClose";

export type RetroViewMode = "list" | "calendar";

interface Props {
  retros: Retrospective[];
  activeRetro: Retrospective | null;
  tasks: KanbanTask[];
  streamText: string;
  waiting: boolean;
  tab: RetroType;
  setTab: (tab: RetroType) => void;
  viewMode: RetroViewMode;
  setViewMode: (mode: RetroViewMode) => void;
  onStart: (type: RetroType, anchorDate?: string, resumeDraftId?: string) => void;
  onSend: (text: string) => void;
  onComplete: () => void;
  onReopen: () => void;
  onCloseSession: () => void;
  onOpenRetro: (retro: Retrospective) => void;
  onDiscardDraft: (draftId: string) => void;
  onDelete: (retroId: string) => void;
  onEditField: (
    retroId: string,
    key: "did" | "learned" | "next" | "aiComment",
    value: string,
  ) => void;
  onEditDayRating: (retroId: string, value: number) => void;
  onEditSleep: (
    retroId: string,
    key: "wakeUpTime" | "bedtime",
    value: string,
  ) => void;
}

const RETRO_TABS: { id: RetroType; label: string }[] = [
  { id: "daily", label: "日" },
  { id: "weekly", label: "週" },
  { id: "monthly", label: "月" },
  { id: "yearly", label: "年" },
];

const TYPE_LABEL: Record<RetroType, string> = {
  daily: "日次振り返り",
  weekly: "週次振り返り",
  monthly: "月次振り返り",
  yearly: "年次振り返り",
};

function formatDailyMeta(doc: RetroDocument): string {
  const parts: string[] = [];
  if (doc.dayRating > 0) parts.push(`評価 ${doc.dayRating}/10`);
  if (doc.wakeUpTime) parts.push(`起床 ${doc.wakeUpTime}`);
  if (doc.bedtime) parts.push(`就寝 ${doc.bedtime}`);
  return parts.join(" · ");
}

function RetroHistoryDoneTasks({
  tasks,
  periodStart,
  periodEnd,
}: {
  tasks: KanbanTask[];
  periodStart: string;
  periodEnd: string;
}) {
  const doneTasks = tasks.filter((t) =>
    isTaskCompletedInPeriod(t, periodStart, periodEnd),
  );
  return (
    <div className="retro-history-tasks">
      <div className="retro-history-tasks-title">
        ✅ 達成タスク ({doneTasks.length}件)
      </div>
      {doneTasks.length === 0 ? (
        <div className="retro-history-tasks-empty">
          この期間に完了したタスクはありません。
        </div>
      ) : (
        <ul className="retro-history-tasks-list">
          {doneTasks.map((t) => (
            <li key={t.id} className="retro-history-tasks-item">
              {t.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatDateTime(iso: string): string {
  if (!iso) return "";
  return iso.replace("T", " ").slice(0, 16);
}

function todayIsoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function computePeriod(
  type: RetroType,
  dateStr: string,
): { start: string; end: string } {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) {
    const t = todayIsoDate();
    return { start: t, end: t };
  }
  const date = new Date(y, m - 1, d);
  if (type === "daily") {
    const s = fmtDate(date);
    return { start: s, end: s };
  }
  if (type === "weekly") {
    const dow = (date.getDay() + 6) % 7; // Mon=0
    const start = new Date(date);
    start.setDate(date.getDate() - dow);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start: fmtDate(start), end: fmtDate(end) };
  }
  if (type === "monthly") {
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0);
    return { start: fmtDate(start), end: fmtDate(end) };
  }
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

export function RetroPanel({
  retros,
  activeRetro,
  tasks,
  streamText,
  waiting,
  tab,
  setTab,
  viewMode,
  setViewMode,
  onStart,
  onSend,
  onComplete,
  onReopen,
  onCloseSession,
  onOpenRetro,
  onDiscardDraft,
  onDelete,
  onEditField,
  onEditDayRating,
  onEditSleep,
}: Props) {
  const [anchorDate, setAnchorDate] = useState<string>(() => todayIsoDate());
  const [discardTarget, setDiscardTarget] = useState<Retrospective | null>(
    null,
  );
  const discardOverlayDownRef = useRef(false);
  const clearDiscardTarget = () => setDiscardTarget(null);
  const { closing: discardClosing, close: closeDiscard } = useModalClose(
    clearDiscardTarget,
  );

  const [deleteTarget, setDeleteTarget] = useState<Retrospective | null>(null);
  const deleteOverlayDownRef = useRef(false);
  const clearDeleteTarget = () => setDeleteTarget(null);
  const { closing: deleteClosing, close: closeDelete } = useModalClose(
    clearDeleteTarget,
  );

  const retrosByType = useMemo(() => {
    const map: Record<RetroType, Retrospective[]> = {
      daily: [],
      weekly: [],
      monthly: [],
      yearly: [],
    };
    for (const r of retros) {
      if (map[r.type]) map[r.type].push(r);
    }
    return map;
  }, [retros]);

  const currentList = retrosByType[tab];
  const targetPeriod = useMemo(
    () => computePeriod(tab, anchorDate),
    [tab, anchorDate],
  );
  const draft =
    currentList.find(
      (r) =>
        !r.completedAt &&
        r.periodStart === targetPeriod.start &&
        r.periodEnd === targetPeriod.end,
    ) || null;
  const otherDrafts = currentList.filter(
    (r) => !r.completedAt && r.id !== (draft?.id ?? ""),
  );
  const completed = currentList.filter((r) => !!r.completedAt);
  const today = todayIsoDate();
  const isPastPeriod = targetPeriod.end < today;

  if (activeRetro) {
    return (
      <RetroSession
        retro={activeRetro}
        tasks={tasks}
        typeLabel={TYPE_LABEL[activeRetro.type]}
        streamText={streamText}
        waiting={waiting}
        onSend={onSend}
        onComplete={onComplete}
        onReopen={onReopen}
        onClose={onCloseSession}
        onEditField={onEditField}
        onEditDayRating={onEditDayRating}
        onEditSleep={onEditSleep}
      />
    );
  }

  return (
    <div className="retro-panel">
      <div className="page-head">
        <div className="page-head-title-wrap">
          <h1 className="page-title">振り返り</h1>
          <div className="page-subtitle">
            {retros.filter((r) => !!r.completedAt).length} completed ·{" "}
            {retros.filter((r) => !r.completedAt).length} drafts
          </div>
        </div>
      </div>

      <div className="retro-tabs">
        {RETRO_TABS.map((t) => (
          <button
            key={t.id}
            className={`retro-tab ${tab === t.id ? "retro-tab--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="page-body">
        <div className="retro-start-card">
          <div className="retro-start-period-row">
            <label className="retro-start-period-label">対象日</label>
            <input
              type="date"
              className="retro-start-date-input"
              value={anchorDate}
              max={today}
              onChange={(e) => setAnchorDate(e.target.value || today)}
            />
            <span className="retro-start-period-range">
              {targetPeriod.start === targetPeriod.end
                ? targetPeriod.start
                : `${targetPeriod.start} 〜 ${targetPeriod.end}`}
              {isPastPeriod && (
                <span className="retro-start-period-tag">過去</span>
              )}
            </span>
            {anchorDate !== today && (
              <button
                className="retro-start-period-today"
                onClick={() => setAnchorDate(today)}
              >
                今日に戻す
              </button>
            )}
          </div>
          {draft ? (
            <>
              <div className="retro-start-title">
                この期間のドラフトがあります
              </div>
              <div className="retro-start-meta">
                {draft.periodStart} 〜 {draft.periodEnd} · 最終更新{" "}
                {formatDateTime(draft.updatedAt)}
              </div>
              <div className="retro-start-actions">
                <button
                  className="btn btn--primary"
                  onClick={() => onStart(tab, anchorDate, draft.id)}
                >
                  前回の続きから再開
                </button>
                <button
                  className="btn"
                  onClick={() => setDiscardTarget(draft)}
                >
                  ドラフトを破棄して新規作成
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="retro-start-title">
                {TYPE_LABEL[tab]}をはじめましょう
              </div>
              <div className="retro-start-meta">
                AI との対話で、この期間の振り返りをまとめます。
              </div>
              <div className="retro-start-actions">
                <button
                  className="btn btn--primary"
                  onClick={() => onStart(tab, anchorDate)}
                >
                  振り返りを始める
                </button>
              </div>
            </>
          )}
        </div>

        <div className="retro-history-title-row">
          <div className="retro-history-title">履歴</div>
          <div className="retro-view-toggle">
            <button
              className={`retro-view-toggle-btn ${viewMode === "list" ? "retro-view-toggle-btn--active" : ""}`}
              onClick={() => setViewMode("list")}
            >
              リスト
            </button>
            <button
              className={`retro-view-toggle-btn ${viewMode === "calendar" ? "retro-view-toggle-btn--active" : ""}`}
              onClick={() => setViewMode("calendar")}
            >
              カレンダー
            </button>
          </div>
        </div>
        {viewMode === "calendar" ? (
          <RetroCalendar
            retros={currentList}
            tasks={tasks}
            type={tab}
            onOpenRetro={onOpenRetro}
          />
        ) : (
        <div className="retro-history">
          {[...(draft ? [draft] : []), ...otherDrafts].map((d) => (
            <div key={d.id} className="retro-history-card-wrap">
              <button
                className="retro-history-card retro-history-card--draft"
                onClick={() => onOpenRetro(d)}
              >
                <div className="retro-history-card-head">
                  <span className="retro-history-badge retro-history-badge--draft">
                    ドラフト
                  </span>
                  <span className="retro-history-period">
                    {d.periodStart} 〜 {d.periodEnd}
                  </span>
                </div>
                {d.type === "daily" && formatDailyMeta(d.document) && (
                  <div className="retro-history-daily">
                    {formatDailyMeta(d.document)}
                  </div>
                )}
                {d.document.learned && (
                  <div className="retro-history-learned">
                    <div className="retro-history-learned-title">
                      わかったこと
                    </div>
                    <div className="retro-history-learned-body">
                      {d.document.learned}
                    </div>
                  </div>
                )}
                <RetroHistoryDoneTasks
                  tasks={tasks}
                  periodStart={d.periodStart}
                  periodEnd={d.periodEnd}
                />
                {d.aiComment && (
                  <div className="retro-history-ai">
                    <div className="retro-history-ai-title">AI コメント</div>
                    <div className="retro-history-ai-body">{d.aiComment}</div>
                  </div>
                )}
                <div className="retro-history-meta">
                  最終更新 {formatDateTime(d.updatedAt)}
                </div>
              </button>
              <button
                className="retro-history-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(d);
                }}
                title="削除"
                aria-label="削除"
              >
                &times;
              </button>
            </div>
          ))}
          {completed.length === 0 && !draft && otherDrafts.length === 0 && (
            <div className="retro-history-empty">
              まだ{TYPE_LABEL[tab]}の履歴はありません。
            </div>
          )}
          {completed.map((r) => (
            <div key={r.id} className="retro-history-card-wrap">
              <button
                className="retro-history-card"
                onClick={() => onOpenRetro(r)}
              >
                <div className="retro-history-card-head">
                  <span className="retro-history-badge">
                    {TYPE_LABEL[r.type]}
                  </span>
                  <span className="retro-history-period">
                    {r.periodStart} 〜 {r.periodEnd}
                  </span>
                </div>
                {r.type === "daily" && formatDailyMeta(r.document) && (
                  <div className="retro-history-daily">
                    {formatDailyMeta(r.document)}
                  </div>
                )}
                {r.document.learned && (
                  <div className="retro-history-learned">
                    <div className="retro-history-learned-title">
                      わかったこと
                    </div>
                    <div className="retro-history-learned-body">
                      {r.document.learned}
                    </div>
                  </div>
                )}
                <RetroHistoryDoneTasks
                  tasks={tasks}
                  periodStart={r.periodStart}
                  periodEnd={r.periodEnd}
                />
                {r.aiComment && (
                  <div className="retro-history-ai">
                    <div className="retro-history-ai-title">AI コメント</div>
                    <div className="retro-history-ai-body">{r.aiComment}</div>
                  </div>
                )}
                <div className="retro-history-meta">
                  完了 {formatDateTime(r.completedAt)}
                </div>
              </button>
              <button
                className="retro-history-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(r);
                }}
                title="削除"
                aria-label="削除"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
        )}
      </div>

      {discardTarget && (
        <div
          className={`modal-overlay${discardClosing ? " is-closing" : ""}`}
          onMouseDown={(e) => {
            discardOverlayDownRef.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            if (
              e.target === e.currentTarget &&
              discardOverlayDownRef.current
            ) {
              closeDiscard();
            }
          }}
        >
          <div
            className="modal-content modal-content--sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="modal-title">ドラフトを破棄</h2>
              <button className="modal-close" onClick={closeDiscard}>
                &times;
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-confirm-text">
                進行中のドラフト ({discardTarget.periodStart} 〜{" "}
                {discardTarget.periodEnd}) を破棄して新規作成しますか？
              </p>
              <p className="modal-confirm-sub">
                この操作は元に戻せません。
              </p>
            </div>
            <div className="modal-footer">
              <button className="modal-btn-secondary" onClick={closeDiscard}>
                キャンセル
              </button>
              <button
                className="modal-btn-primary modal-btn-danger"
                onClick={() => {
                  onDiscardDraft(discardTarget.id);
                  closeDiscard();
                  // 新規作成開始
                  setTimeout(() => onStart(tab, anchorDate), 0);
                }}
              >
                破棄して新規作成
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className={`modal-overlay${deleteClosing ? " is-closing" : ""}`}
          onMouseDown={(e) => {
            deleteOverlayDownRef.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            if (
              e.target === e.currentTarget &&
              deleteOverlayDownRef.current
            ) {
              closeDelete();
            }
          }}
        >
          <div
            className="modal-content modal-content--sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="modal-title">振り返りを削除</h2>
              <button className="modal-close" onClick={closeDelete}>
                &times;
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-confirm-text">
                {TYPE_LABEL[deleteTarget.type]} ({deleteTarget.periodStart}{" "}
                〜 {deleteTarget.periodEnd}) を削除しますか？
              </p>
              <p className="modal-confirm-sub">
                この操作は元に戻せません。
              </p>
            </div>
            <div className="modal-footer">
              <button className="modal-btn-secondary" onClick={closeDelete}>
                キャンセル
              </button>
              <button
                className="modal-btn-primary modal-btn-danger"
                onClick={() => {
                  onDelete(deleteTarget.id);
                  closeDelete();
                }}
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
