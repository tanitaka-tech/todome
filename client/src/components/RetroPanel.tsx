import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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

const RETRO_TABS: { id: RetroType; labelKey: string }[] = [
  { id: "daily", labelKey: "tabDaily" },
  { id: "weekly", labelKey: "tabWeekly" },
  { id: "monthly", labelKey: "tabMonthly" },
  { id: "yearly", labelKey: "tabYearly" },
];

const TYPE_LABEL_KEYS: Record<RetroType, string> = {
  daily: "typeDaily",
  weekly: "typeWeekly",
  monthly: "typeMonthly",
  yearly: "typeYearly",
};

function RetroHistoryDoneTasks({
  tasks,
  periodStart,
  periodEnd,
}: {
  tasks: KanbanTask[];
  periodStart: string;
  periodEnd: string;
}) {
  const { t } = useTranslation("retro");
  const doneTasks = tasks.filter((t) =>
    isTaskCompletedInPeriod(t, periodStart, periodEnd),
  );
  return (
    <div className="retro-history-tasks">
      <div className="retro-history-tasks-title">
        ✅ {t("doneTasksTitle", { count: doneTasks.length })}
      </div>
      {doneTasks.length === 0 ? (
        <div className="retro-history-tasks-empty">
          {t("doneTasksEmpty")}
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
  const { t } = useTranslation("retro");
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

  const formatDailyMeta = (doc: RetroDocument): string => {
    const parts: string[] = [];
    if (doc.dayRating > 0)
      parts.push(t("dailyMetaRating", { value: doc.dayRating }));
    if (doc.wakeUpTime)
      parts.push(t("dailyMetaWakeUp", { time: doc.wakeUpTime }));
    if (doc.bedtime) parts.push(t("dailyMetaBedtime", { time: doc.bedtime }));
    return parts.join(" · ");
  };

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
        typeLabel={t(TYPE_LABEL_KEYS[activeRetro.type])}
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
          <h1 className="page-title">{t("pageTitle")}</h1>
          <div className="page-subtitle">
            {t("summaryCompleted", {
              count: retros.filter((r) => !!r.completedAt).length,
            })}{" "}
            ·{" "}
            {t("summaryDrafts", {
              count: retros.filter((r) => !r.completedAt).length,
            })}
          </div>
        </div>
      </div>

      <div className="retro-tabs">
        {RETRO_TABS.map((tb) => (
          <button
            key={tb.id}
            className={`retro-tab ${tab === tb.id ? "retro-tab--active" : ""}`}
            onClick={() => setTab(tb.id)}
          >
            {t(tb.labelKey)}
          </button>
        ))}
      </div>

      <div className="page-body">
        <div className="retro-start-card">
          <div className="retro-start-period-row">
            <label className="retro-start-period-label">
              {t("targetDate")}
            </label>
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
                <span className="retro-start-period-tag">
                  {t("periodPast")}
                </span>
              )}
            </span>
            {anchorDate !== today && (
              <button
                className="retro-start-period-today"
                onClick={() => setAnchorDate(today)}
              >
                {t("backToToday")}
              </button>
            )}
          </div>
          {draft ? (
            <>
              <div className="retro-start-title">
                {t("draftExistsTitle")}
              </div>
              <div className="retro-start-meta">
                {draft.periodStart} 〜 {draft.periodEnd} ·{" "}
                {t("draftMetaUpdated", {
                  date: formatDateTime(draft.updatedAt),
                })}
              </div>
              <div className="retro-start-actions">
                <button
                  className="btn btn--primary"
                  onClick={() => onStart(tab, anchorDate, draft.id)}
                >
                  {t("resumeDraft")}
                </button>
                <button
                  className="btn"
                  onClick={() => setDiscardTarget(draft)}
                >
                  {t("discardDraftAndCreate")}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="retro-start-title">
                {t("startTitle", { type: t(TYPE_LABEL_KEYS[tab]) })}
              </div>
              <div className="retro-start-meta">
                {t("startDescription")}
              </div>
              <div className="retro-start-actions">
                <button
                  className="btn btn--primary"
                  onClick={() => onStart(tab, anchorDate)}
                >
                  {t("startButton")}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="retro-history-title-row">
          <div className="retro-history-title">{t("historyTitle")}</div>
          <div className="retro-view-toggle">
            <button
              className={`retro-view-toggle-btn ${viewMode === "list" ? "retro-view-toggle-btn--active" : ""}`}
              onClick={() => setViewMode("list")}
            >
              {t("viewList")}
            </button>
            <button
              className={`retro-view-toggle-btn ${viewMode === "calendar" ? "retro-view-toggle-btn--active" : ""}`}
              onClick={() => setViewMode("calendar")}
            >
              {t("viewCalendar")}
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
                    {t("badgeDraft")}
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
                      {t("learnedTitle")}
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
                    <div className="retro-history-ai-title">
                      {t("aiCommentTitle")}
                    </div>
                    <div className="retro-history-ai-body">{d.aiComment}</div>
                  </div>
                )}
                <div className="retro-history-meta">
                  {t("historyUpdated", {
                    date: formatDateTime(d.updatedAt),
                  })}
                </div>
              </button>
              <button
                className="retro-history-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(d);
                }}
                title={t("deleteLabel")}
                aria-label={t("deleteLabel")}
              >
                &times;
              </button>
            </div>
          ))}
          {completed.length === 0 && !draft && otherDrafts.length === 0 && (
            <div className="retro-history-empty">
              {t("historyEmpty", { type: t(TYPE_LABEL_KEYS[tab]) })}
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
                    {t(TYPE_LABEL_KEYS[r.type])}
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
                      {t("learnedTitle")}
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
                    <div className="retro-history-ai-title">
                      {t("aiCommentTitle")}
                    </div>
                    <div className="retro-history-ai-body">{r.aiComment}</div>
                  </div>
                )}
                <div className="retro-history-meta">
                  {t("historyCompleted", {
                    date: formatDateTime(r.completedAt),
                  })}
                </div>
              </button>
              <button
                className="retro-history-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(r);
                }}
                title={t("deleteLabel")}
                aria-label={t("deleteLabel")}
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
              <h2 className="modal-title">{t("modalDiscardTitle")}</h2>
              <button className="modal-close" onClick={closeDiscard}>
                &times;
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-confirm-text">
                {t("modalDiscardConfirm", {
                  start: discardTarget.periodStart,
                  end: discardTarget.periodEnd,
                })}
              </p>
              <p className="modal-confirm-sub">
                {t("modalIrreversible")}
              </p>
            </div>
            <div className="modal-footer">
              <button className="modal-btn-secondary" onClick={closeDiscard}>
                {t("modalCancel")}
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
                {t("modalDiscardAndCreate")}
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
              <h2 className="modal-title">{t("modalDeleteTitle")}</h2>
              <button className="modal-close" onClick={closeDelete}>
                &times;
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-confirm-text">
                {t("modalDeleteConfirm", {
                  type: t(TYPE_LABEL_KEYS[deleteTarget.type]),
                  start: deleteTarget.periodStart,
                  end: deleteTarget.periodEnd,
                })}
              </p>
              <p className="modal-confirm-sub">
                {t("modalIrreversible")}
              </p>
            </div>
            <div className="modal-footer">
              <button className="modal-btn-secondary" onClick={closeDelete}>
                {t("modalCancel")}
              </button>
              <button
                className="modal-btn-primary modal-btn-danger"
                onClick={() => {
                  onDelete(deleteTarget.id);
                  closeDelete();
                }}
              >
                {t("modalDelete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
