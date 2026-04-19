import { useMemo, useRef, useState } from "react";
import type { KanbanTask, RetroType, Retrospective } from "../types";
import { RetroSession } from "./RetroSession";
import { useModalClose } from "../hooks/useModalClose";

interface Props {
  retros: Retrospective[];
  activeRetro: Retrospective | null;
  tasks: KanbanTask[];
  streamText: string;
  waiting: boolean;
  onStart: (type: RetroType, resumeDraftId?: string) => void;
  onSend: (text: string) => void;
  onComplete: () => void;
  onCloseSession: () => void;
  onOpenRetro: (retro: Retrospective) => void;
  onDiscardDraft: (draftId: string) => void;
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

function summaryFromRetro(r: Retrospective): string {
  if (r.aiComment) {
    const s = r.aiComment.trim().replace(/\s+/g, " ");
    return s.length > 90 ? s.slice(0, 88) + "…" : s;
  }
  if (r.document.findings) {
    const s = r.document.findings.trim().replace(/\s+/g, " ");
    return s.length > 90 ? s.slice(0, 88) + "…" : s;
  }
  return "(まだ内容がありません)";
}

function formatDateTime(iso: string): string {
  if (!iso) return "";
  return iso.replace("T", " ").slice(0, 16);
}

export function RetroPanel({
  retros,
  activeRetro,
  tasks,
  streamText,
  waiting,
  onStart,
  onSend,
  onComplete,
  onCloseSession,
  onOpenRetro,
  onDiscardDraft,
}: Props) {
  const [tab, setTab] = useState<RetroType>("weekly");
  const [discardTarget, setDiscardTarget] = useState<Retrospective | null>(
    null,
  );
  const discardOverlayDownRef = useRef(false);
  const clearDiscardTarget = () => setDiscardTarget(null);
  const { closing: discardClosing, close: closeDiscard } = useModalClose(
    clearDiscardTarget,
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
  const draft = currentList.find((r) => !r.completedAt) || null;
  const completed = currentList.filter((r) => !!r.completedAt);

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
        onClose={onCloseSession}
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
          {draft ? (
            <>
              <div className="retro-start-title">
                進行中のドラフトがあります
              </div>
              <div className="retro-start-meta">
                {draft.periodStart} 〜 {draft.periodEnd} · 最終更新{" "}
                {formatDateTime(draft.updatedAt)}
              </div>
              <div className="retro-start-actions">
                <button
                  className="btn btn--primary"
                  onClick={() => onStart(tab, draft.id)}
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
                  onClick={() => onStart(tab)}
                >
                  振り返りを始める
                </button>
              </div>
            </>
          )}
        </div>

        <div className="retro-history-title">履歴</div>
        <div className="retro-history">
          {draft && (
            <button
              key={draft.id}
              className="retro-history-card retro-history-card--draft"
              onClick={() => onOpenRetro(draft)}
            >
              <div className="retro-history-card-head">
                <span className="retro-history-badge retro-history-badge--draft">
                  ドラフト
                </span>
                <span className="retro-history-period">
                  {draft.periodStart} 〜 {draft.periodEnd}
                </span>
              </div>
              <div className="retro-history-summary">
                {summaryFromRetro(draft)}
              </div>
              <div className="retro-history-meta">
                最終更新 {formatDateTime(draft.updatedAt)}
              </div>
            </button>
          )}
          {completed.length === 0 && !draft && (
            <div className="retro-history-empty">
              まだ{TYPE_LABEL[tab]}の履歴はありません。
            </div>
          )}
          {completed.map((r) => (
            <button
              key={r.id}
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
              <div className="retro-history-summary">
                {summaryFromRetro(r)}
              </div>
              <div className="retro-history-meta">
                完了 {formatDateTime(r.completedAt)}
              </div>
            </button>
          ))}
        </div>
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
                  setTimeout(() => onStart(tab), 0);
                }}
              >
                破棄して新規作成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
