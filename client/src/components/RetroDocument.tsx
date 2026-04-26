import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import type {
  KanbanTask,
  LifeActivity,
  LifeLog,
  Quota,
  QuotaLog,
  RetroDocument as RetroDocumentT,
  RetroType,
  Schedule,
} from "../types";
import { getDayRangeForDate, isTaskCompletedInPeriod } from "../types";
import { TimelineBar } from "./TimelineBar";


type DocFieldKey = "did" | "learned" | "next";
type EditableKey = DocFieldKey | "aiComment";
type SleepKey = "wakeUpTime" | "bedtime";

interface Props {
  document: RetroDocumentT;
  retroType: RetroType;
  tasks: KanbanTask[];
  aiComment?: string;
  periodStart: string;
  periodEnd: string;
  typeLabel: string;
  lifeActivities: LifeActivity[];
  lifeLogsForPeriod: LifeLog[];
  quotas: Quota[];
  quotaLogsForPeriod: QuotaLog[];
  schedules: Schedule[];
  dayBoundaryHour: number;
  onEditField?: (key: EditableKey, value: string) => void;
  onEditDayRating?: (value: number) => void;
  onEditSleep?: (key: SleepKey, value: string) => void;
}

const SECTIONS: {
  key: DocFieldKey;
  labelKey: string;
  placeholderKey: string;
}[] = [
  {
    key: "did",
    labelKey: "docSectionDid",
    placeholderKey: "placeholderDid",
  },
  {
    key: "learned",
    labelKey: "docSectionLearned",
    placeholderKey: "placeholderLearned",
  },
  {
    key: "next",
    labelKey: "docSectionNext",
    placeholderKey: "placeholderNext",
  },
];

function EditableMarkdownSection({
  value,
  placeholder,
  onSave,
}: {
  value: string;
  placeholder: string;
  onSave?: (next: string) => void;
}) {
  const { t } = useTranslation("retro");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  const taRef = useRef<HTMLTextAreaElement>(null);

  if (value !== lastValue) {
    setLastValue(value);
    if (!editing) setDraft(value);
  }

  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus();
      const len = taRef.current.value.length;
      taRef.current.setSelectionRange(len, len);
    }
  }, [editing]);

  const startEdit = () => {
    setDraft(value);
    setEditing(true);
  };
  const cancel = () => setEditing(false);
  const save = () => {
    setEditing(false);
    if (draft !== value) onSave?.(draft);
  };

  if (editing) {
    return (
      <div className="retro-doc-edit">
        <textarea
          ref={taRef}
          className="retro-doc-edit-textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            } else if (
              (e.metaKey || e.ctrlKey) &&
              e.key === "Enter"
            ) {
              e.preventDefault();
              save();
            }
          }}
          rows={Math.max(4, draft.split("\n").length + 1)}
        />
        <div className="retro-doc-edit-actions">
          <button className="btn" onClick={cancel}>
            {t("editCancel")}
          </button>
          <button className="btn btn--primary" onClick={save}>
            {t("editSave")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`retro-doc-view${onSave ? " retro-doc-view--editable" : ""}`}
      onClick={onSave ? startEdit : undefined}
      role={onSave ? "button" : undefined}
      tabIndex={onSave ? 0 : undefined}
      onKeyDown={(e) => {
        if (!onSave) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          startEdit();
        }
      }}
      title={onSave ? t("editClickHint") : undefined}
    >
      {value ? (
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{value}</ReactMarkdown>
      ) : (
        <div className="retro-doc-placeholder">{placeholder}</div>
      )}
    </div>
  );
}

function SleepTimeRow({
  wakeUpTime,
  bedtime,
  onChange,
}: {
  wakeUpTime: string;
  bedtime: string;
  onChange?: (key: SleepKey, value: string) => void;
}) {
  const { t } = useTranslation("retro");
  const readonly = !onChange;
  return (
    <div className="retro-sleep">
      <label className="retro-sleep-field">
        <span className="retro-sleep-label">{t("sleepWakeUp")}</span>
        <input
          type="time"
          className="retro-sleep-input"
          value={wakeUpTime}
          disabled={readonly}
          onChange={(e) => onChange?.("wakeUpTime", e.target.value)}
        />
        {wakeUpTime && !readonly && (
          <button
            type="button"
            className="retro-sleep-clear"
            onClick={() => onChange?.("wakeUpTime", "")}
          >
            {t("sleepClear")}
          </button>
        )}
      </label>
      <label className="retro-sleep-field">
        <span className="retro-sleep-label">{t("sleepBedtime")}</span>
        <input
          type="time"
          className="retro-sleep-input"
          value={bedtime}
          disabled={readonly}
          onChange={(e) => onChange?.("bedtime", e.target.value)}
        />
        {bedtime && !readonly && (
          <button
            type="button"
            className="retro-sleep-clear"
            onClick={() => onChange?.("bedtime", "")}
          >
            {t("sleepClear")}
          </button>
        )}
      </label>
    </div>
  );
}

function DayRatingSlider({
  value,
  onChange,
}: {
  value: number;
  onChange?: (v: number) => void;
}) {
  const { t } = useTranslation("retro");
  const readonly = !onChange;
  const rated = value > 0;
  const sliderValue = rated ? value : 5;
  return (
    <div className="retro-rating">
      <div className="retro-rating-row">
        <span className="retro-rating-end">1</span>
        <input
          type="range"
          className="retro-rating-slider"
          min={1}
          max={10}
          step={1}
          value={sliderValue}
          disabled={readonly}
          onChange={(e) => onChange?.(Number(e.target.value))}
          aria-label={t("ratingAriaLabel")}
        />
        <span className="retro-rating-end">10</span>
      </div>
      <div className="retro-rating-meta">
        <span
          className={`retro-rating-value${rated ? "" : " retro-rating-value--unset"}`}
        >
          {rated ? t("ratingValue", { value }) : t("ratingUnset")}
        </span>
        {rated && !readonly && (
          <button
            type="button"
            className="retro-rating-clear"
            onClick={() => onChange?.(0)}
          >
            {t("ratingClear")}
          </button>
        )}
      </div>
    </div>
  );
}

export function RetroDocumentView({
  document,
  retroType,
  tasks,
  aiComment,
  periodStart,
  periodEnd,
  typeLabel,
  lifeActivities,
  lifeLogsForPeriod,
  quotas,
  quotaLogsForPeriod,
  schedules,
  dayBoundaryHour,
  onEditField,
  onEditDayRating,
  onEditSleep,
}: Props) {
  const { t } = useTranslation("retro");
  const [timelineOrientation, setTimelineOrientation] = useState<
    "vertical" | "horizontal"
  >(() => {
    const saved = localStorage.getItem("timeline:orientation");
    return saved === "horizontal" ? "horizontal" : "vertical";
  });
  const setOrientation = (o: "vertical" | "horizontal") => {
    setTimelineOrientation(o);
    localStorage.setItem("timeline:orientation", o);
  };
  const completedTasks = tasks.filter((t) =>
    isTaskCompletedInPeriod(t, periodStart, periodEnd),
  );
  const isDaily = retroType === "daily";
  const dayRange = isDaily
    ? getDayRangeForDate(periodStart, dayBoundaryHour)
    : null;

  return (
    <div className="retro-doc">
      <div className="retro-doc-head">
        <div className="retro-doc-type">{typeLabel}</div>
        <div className="retro-doc-period">
          {periodStart} 〜 {periodEnd}
        </div>
      </div>

      {isDaily && (
        <section className="retro-doc-section">
          <h3 className="retro-doc-section-title">{t("docSectionRating")}</h3>
          <div className="retro-doc-section-body">
            <DayRatingSlider
              value={document.dayRating || 0}
              onChange={onEditDayRating}
            />
          </div>
        </section>
      )}

      {isDaily && (
        <section className="retro-doc-section">
          <h3 className="retro-doc-section-title">{t("docSectionSleep")}</h3>
          <div className="retro-doc-section-body">
            <SleepTimeRow
              wakeUpTime={document.wakeUpTime || ""}
              bedtime={document.bedtime || ""}
              onChange={onEditSleep}
            />
          </div>
        </section>
      )}

      {isDaily && dayRange && (
        <section className="retro-doc-section">
          <div className="retro-doc-section-title-row">
            <h3 className="retro-doc-section-title">
              {t("docSectionTimeline", "タイムスケジュール")}
            </h3>
            <div className="retro-view-toggle" role="group">
              <button
                type="button"
                className={`retro-view-toggle-btn${timelineOrientation === "vertical" ? " retro-view-toggle-btn--active" : ""}`}
                onClick={() => setOrientation("vertical")}
              >
                {t("timelineOrientVertical", "縦")}
              </button>
              <button
                type="button"
                className={`retro-view-toggle-btn${timelineOrientation === "horizontal" ? " retro-view-toggle-btn--active" : ""}`}
                onClick={() => setOrientation("horizontal")}
              >
                {t("timelineOrientHorizontal", "横")}
              </button>
            </div>
          </div>
          <div className="retro-doc-section-body">
            <TimelineBar
              rangeStartMs={dayRange.startMs}
              rangeEndMs={dayRange.endMs}
              schedules={schedules}
              tasks={tasks}
              lifeLogs={lifeLogsForPeriod}
              lifeActivities={lifeActivities}
              quotas={quotas}
              quotaLogs={quotaLogsForPeriod}
              orientation={timelineOrientation}
            />
          </div>
        </section>
      )}

      {SECTIONS.map((s) => (
        <section key={s.key} className="retro-doc-section">
          <h3 className="retro-doc-section-title">{t(s.labelKey)}</h3>
          <div className="retro-doc-section-body">
            <EditableMarkdownSection
              value={document[s.key]}
              placeholder={t(s.placeholderKey)}
              onSave={
                onEditField
                  ? (next) => onEditField(s.key, next)
                  : undefined
              }
            />
          </div>
        </section>
      ))}

      <section className="retro-doc-section">
        <h3 className="retro-doc-section-title">
          ✅ {t("docSectionDoneTasks", { count: completedTasks.length })}
        </h3>
        <div className="retro-doc-section-body">
          {completedTasks.length === 0 ? (
            <div className="retro-doc-placeholder">
              {t("placeholderDoneTasksEmpty")}
            </div>
          ) : (
            <ul className="retro-doc-task-list">
              {completedTasks.map((t) => (
                <li key={t.id}>{t.title}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {(aiComment || onEditField) && (
        <section className="retro-doc-section retro-doc-section--ai">
          <h3 className="retro-doc-section-title">{t("docSectionAiComment")}</h3>
          <div className="retro-doc-section-body">
            <EditableMarkdownSection
              value={aiComment || ""}
              placeholder={t("placeholderAiCommentEmpty")}
              onSave={
                onEditField
                  ? (next) => onEditField("aiComment", next)
                  : undefined
              }
            />
          </div>
        </section>
      )}
    </div>
  );
}
