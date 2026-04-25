import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Schedule } from "../types";
import { nowLocalIso } from "../types";

export type EditorMode = "create" | "edit" | "view";

interface Props {
  mode: EditorMode;
  schedule: Schedule | null;
  initialStart?: string;
  initialEnd?: string;
  initialAllDay?: boolean;
  onSave: (schedule: Schedule) => void;
  onDelete?: (scheduleId: string) => void;
  onClose: () => void;
}

function emptySchedule(opts: {
  start: string;
  end: string;
  allDay: boolean;
}): Schedule {
  const now = nowLocalIso();
  return {
    id: "",
    source: "manual",
    subscriptionId: "",
    externalUid: "",
    title: "",
    description: "",
    location: "",
    start: opts.start,
    end: opts.end,
    allDay: opts.allDay,
    rrule: "",
    recurrenceId: "",
    createdAt: now,
    updatedAt: now,
    caldavObjectUrl: "",
    caldavEtag: "",
  };
}



function toInputDate(iso: string): string {
  return iso ? iso.slice(0, 10) : "";
}

function toInputDateTime(iso: string): string {
  return iso ? iso.slice(0, 16) : "";
}

function fromInputDate(d: string): string {
  return d ? `${d}T00:00:00` : "";
}

function fromInputDateTime(d: string): string {
  if (!d) return "";
  return d.length === 16 ? `${d}:00` : d;
}

function defaultStart(): string {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:00`;
}

function defaultEnd(start: string): string {
  if (!start) return "";
  const d = new Date(start);
  d.setHours(d.getHours() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

export function ScheduleEventEditor({
  mode,
  schedule,
  initialStart,
  initialEnd,
  initialAllDay,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const { t } = useTranslation("schedule");
  const isView = mode === "view";

  const [draft, setDraft] = useState<Schedule>(() => {
    if (schedule) return { ...schedule };
    const start = initialStart ?? defaultStart();
    const end = initialEnd ?? defaultEnd(start);
    return emptySchedule({
      start,
      end,
      allDay: initialAllDay ?? false,
    });
  });
  const [error, setError] = useState("");

  const titleLabel =
    mode === "create"
      ? t("createEvent")
      : mode === "edit"
        ? t("editEvent")
        : t("viewEvent");

  const update = <K extends keyof Schedule>(k: K, v: Schedule[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
  };

  const handleSave = () => {
    if (!draft.title.trim()) {
      setError(t("needTitle"));
      return;
    }
    if (!draft.start || !draft.end) {
      setError(t("invalidRange"));
      return;
    }
    if (draft.end <= draft.start) {
      setError(t("invalidRange"));
      return;
    }
    onSave({ ...draft, title: draft.title.trim() });
  };

  const handleDelete = () => {
    if (!schedule || !onDelete) return;
    onDelete(schedule.id);
  };

  const handleAllDayToggle = (allDay: boolean) => {
    setDraft((d) => {
      if (allDay) {
        const startDate = toInputDate(d.start) || toInputDate(defaultStart());
        const endDate = toInputDate(d.end) || startDate;
        return {
          ...d,
          allDay: true,
          start: fromInputDate(startDate),
          end: fromInputDate(endDate || startDate),
        };
      }
      const startDate = toInputDate(d.start);
      const start = startDate ? `${startDate}T09:00:00` : defaultStart();
      return {
        ...d,
        allDay: false,
        start,
        end: defaultEnd(start),
      };
    });
  };


  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-content schedule-editor"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="schedule-editor-header">
          <h2>{titleLabel}</h2>
          {schedule?.source === "subscription" && (
            isView ? (
              <span className="schedule-editor-readonly-badge">
                {t("readOnlyBadge")}
              </span>
            ) : (
              <span className="schedule-editor-icloud-badge">
                {t("icloudWriteBackBadge")}
              </span>
            )
          )}
        </header>

        <div className="schedule-editor-body">
          <label className="schedule-editor-field">
            <span>{t("fieldTitle")}</span>
            <input
              type="text"
              value={draft.title}
              disabled={isView}
              onChange={(e) => update("title", e.target.value)}
            />
          </label>

          <label className="schedule-editor-field schedule-editor-field--checkbox">
            <input
              type="checkbox"
              checked={draft.allDay}
              disabled={isView}
              onChange={(e) => handleAllDayToggle(e.target.checked)}
            />
            <span>{t("fieldAllDay")}</span>
          </label>

          <div className="schedule-editor-row">
            <label className="schedule-editor-field">
              <span>{t("fieldStart")}</span>
              {draft.allDay ? (
                <input
                  type="date"
                  value={toInputDate(draft.start)}
                  disabled={isView}
                  onChange={(e) =>
                    update("start", fromInputDate(e.target.value))
                  }
                />
              ) : (
                <input
                  type="datetime-local"
                  value={toInputDateTime(draft.start)}
                  disabled={isView}
                  onChange={(e) =>
                    update("start", fromInputDateTime(e.target.value))
                  }
                />
              )}
            </label>
            <label className="schedule-editor-field">
              <span>{t("fieldEnd")}</span>
              {draft.allDay ? (
                <input
                  type="date"
                  value={toInputDate(draft.end)}
                  disabled={isView}
                  onChange={(e) =>
                    update("end", fromInputDate(e.target.value))
                  }
                />
              ) : (
                <input
                  type="datetime-local"
                  value={toInputDateTime(draft.end)}
                  disabled={isView}
                  onChange={(e) =>
                    update("end", fromInputDateTime(e.target.value))
                  }
                />
              )}
            </label>
          </div>

          <label className="schedule-editor-field">
            <span>{t("fieldLocation")}</span>
            <input
              type="text"
              value={draft.location}
              disabled={isView}
              onChange={(e) => update("location", e.target.value)}
            />
          </label>

          <label className="schedule-editor-field">
            <span>{t("fieldDescription")}</span>
            <textarea
              value={draft.description}
              rows={4}
              disabled={isView}
              onChange={(e) => update("description", e.target.value)}
            />
          </label>

          {draft.rrule && (
            <div className="schedule-editor-field">
              <span>{t("fieldRrule")}</span>
              <code className="schedule-editor-rrule">{draft.rrule}</code>
            </div>
          )}

          {error && <div className="schedule-editor-error">{error}</div>}
        </div>

        <footer className="schedule-editor-footer">
          {mode === "edit" && onDelete && (
            <button
              type="button"
              className="btn schedule-editor-delete"
              onClick={handleDelete}
            >
              {t("delete")}
            </button>
          )}
          <div className="schedule-editor-footer-spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {isView ? t("close") : t("cancel")}
          </button>
          {!isView && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleSave}
            >
              {t("save")}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
