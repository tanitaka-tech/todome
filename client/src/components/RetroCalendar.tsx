import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  KanbanTask,
  RetroType,
  Retrospective,
} from "../types";
import { RetroHoverPopup } from "./RetroHoverPopup";

interface Props {
  retros: Retrospective[];
  tasks: KanbanTask[];
  type: RetroType;
  onOpenRetro: (retro: Retrospective) => void;
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isoInRange(iso: string, start: string, end: string): boolean {
  return iso >= start && iso <= end;
}

const TYPE_LABEL_KEYS: Record<RetroType, string> = {
  daily: "typeShortDaily",
  weekly: "typeShortWeekly",
  monthly: "typeShortMonthly",
  yearly: "typeShortYearly",
};

export function RetroCalendar({ retros, tasks, type, onOpenRetro }: Props) {
  const { t, i18n } = useTranslation("retro");
  const [cursor, setCursor] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const weekdayLabels = useMemo(
    () => [0, 1, 2, 3, 4, 5, 6].map((i) => t(`weekday${i}`)),
    [t],
  );

  const days = useMemo(() => {
    const firstOfMonth = new Date(year, month, 1);
    const dow = (firstOfMonth.getDay() + 6) % 7; // Mon=0
    const gridStart = new Date(year, month, 1 - dow);

    const arr: {
      iso: string;
      dayNum: number;
      inMonth: boolean;
      retro: Retrospective | null;
    }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + i,
      );
      const iso = fmtDate(d);
      const matched =
        retros.find((r) => isoInRange(iso, r.periodStart, r.periodEnd)) ?? null;
      arr.push({
        iso,
        dayNum: d.getDate(),
        inMonth: d.getMonth() === month,
        retro: matched,
      });
    }
    return arr;
  }, [year, month, retros]);

  const today = fmtDate(new Date());
  const locale = i18n.language === "en" ? "en-US" : "ja-JP";
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long" }).format(
    new Date(year, month, 1),
  );
  const titleLabel = t("calendarTitle", { year, month: monthLabel });

  const goPrev = () => setCursor(new Date(year, month - 1, 1));
  const goNext = () => setCursor(new Date(year, month + 1, 1));
  const goThis = () => {
    const n = new Date();
    setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
  };

  return (
    <div className="retro-calendar">
      <div className="retro-calendar-head">
        <button
          className="retro-calendar-nav"
          onClick={goPrev}
          aria-label={t("calendarPrevMonth")}
        >
          ‹
        </button>
        <div className="retro-calendar-title">{titleLabel}</div>
        <button
          className="retro-calendar-nav"
          onClick={goNext}
          aria-label={t("calendarNextMonth")}
        >
          ›
        </button>
        <button className="retro-calendar-today-btn" onClick={goThis}>
          {t("calendarThisMonth")}
        </button>
        <div className="retro-calendar-type-label">
          {t("calendarTypeLabel", { type: t(TYPE_LABEL_KEYS[type]) })}
        </div>
      </div>
      <div className="retro-calendar-grid">
        {weekdayLabels.map((w, i) => (
          <div key={i} className="retro-calendar-weekday">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const hasRetro = !!d.retro;
          const isDraft = hasRetro && !d.retro!.completedAt;
          const isToday = d.iso === today;
          const classes = [
            "retro-calendar-cell",
            !d.inMonth ? "retro-calendar-cell--outside" : "",
            hasRetro ? "retro-calendar-cell--has" : "",
            isDraft ? "retro-calendar-cell--draft" : "",
            isToday ? "retro-calendar-cell--today" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={d.iso}
              className={classes}
              disabled={!hasRetro}
              onClick={() => d.retro && onOpenRetro(d.retro)}
            >
              <span className="retro-calendar-cell-day">{d.dayNum}</span>
              {hasRetro && <span className="retro-calendar-cell-dot" />}
              {hasRetro && (
                <RetroHoverPopup retro={d.retro!} tasks={tasks} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
