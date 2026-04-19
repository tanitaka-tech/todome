import { useMemo, useState } from "react";
import type {
  KanbanTask,
  RetroDocument,
  RetroType,
  Retrospective,
} from "../types";
import { isTaskCompletedInPeriod } from "../types";

interface Props {
  retros: Retrospective[];
  tasks: KanbanTask[];
  type: RetroType;
  onOpenRetro: (retro: Retrospective) => void;
}

const WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isoInRange(iso: string, start: string, end: string): boolean {
  return iso >= start && iso <= end;
}

const TYPE_LABEL: Record<RetroType, string> = {
  daily: "日次",
  weekly: "週次",
  monthly: "月次",
  yearly: "年次",
};

function formatDateTime(iso: string): string {
  if (!iso) return "";
  return iso.replace("T", " ").slice(0, 16);
}

function formatDailyMeta(doc: RetroDocument): string {
  const parts: string[] = [];
  if (doc.dayRating > 0) parts.push(`評価 ${doc.dayRating}/10`);
  if (doc.wakeUpTime) parts.push(`起床 ${doc.wakeUpTime}`);
  if (doc.bedtime) parts.push(`就寝 ${doc.bedtime}`);
  return parts.join(" · ");
}

export function RetroCalendar({ retros, tasks, type, onOpenRetro }: Props) {
  const [cursor, setCursor] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

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
  const titleLabel = `${year}年 ${month + 1}月`;

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
          aria-label="前の月"
        >
          ‹
        </button>
        <div className="retro-calendar-title">{titleLabel}</div>
        <button
          className="retro-calendar-nav"
          onClick={goNext}
          aria-label="次の月"
        >
          ›
        </button>
        <button className="retro-calendar-today-btn" onClick={goThis}>
          今月
        </button>
        <div className="retro-calendar-type-label">
          {TYPE_LABEL[type]}の振り返り
        </div>
      </div>
      <div className="retro-calendar-grid">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="retro-calendar-weekday">
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
                <div className="retro-calendar-popup" role="tooltip">
                  <div className="retro-calendar-popup-head">
                    <span className="retro-calendar-popup-badge">
                      {TYPE_LABEL[d.retro!.type]}
                    </span>
                    <span className="retro-calendar-popup-period">
                      {d.retro!.periodStart === d.retro!.periodEnd
                        ? d.retro!.periodStart
                        : `${d.retro!.periodStart} 〜 ${d.retro!.periodEnd}`}
                    </span>
                  </div>
                  {d.retro!.type === "daily" &&
                    formatDailyMeta(d.retro!.document) && (
                      <div className="retro-calendar-popup-daily">
                        {formatDailyMeta(d.retro!.document)}
                      </div>
                    )}
                  {d.retro!.document.learned && (
                    <div className="retro-calendar-popup-learned">
                      <div className="retro-calendar-popup-learned-title">
                        わかったこと
                      </div>
                      <div className="retro-calendar-popup-learned-body">
                        {d.retro!.document.learned}
                      </div>
                    </div>
                  )}
                  {(() => {
                    const doneTasks = tasks.filter((t) =>
                      isTaskCompletedInPeriod(
                        t,
                        d.retro!.periodStart,
                        d.retro!.periodEnd,
                      ),
                    );
                    return (
                      <div className="retro-calendar-popup-tasks">
                        <div className="retro-calendar-popup-tasks-title">
                          ✅ 達成タスク ({doneTasks.length}件)
                        </div>
                        {doneTasks.length === 0 ? (
                          <div className="retro-calendar-popup-tasks-empty">
                            この期間に完了したタスクはありません。
                          </div>
                        ) : (
                          <ul className="retro-calendar-popup-tasks-list">
                            {doneTasks.map((t) => (
                              <li
                                key={t.id}
                                className="retro-calendar-popup-tasks-item"
                              >
                                {t.title}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })()}
                  {d.retro!.aiComment && (
                    <div className="retro-calendar-popup-ai">
                      <div className="retro-calendar-popup-ai-title">
                        AI コメント
                      </div>
                      <div className="retro-calendar-popup-ai-body">
                        {d.retro!.aiComment}
                      </div>
                    </div>
                  )}
                  <div className="retro-calendar-popup-meta">
                    {d.retro!.completedAt
                      ? `完了 ${formatDateTime(d.retro!.completedAt)}`
                      : `ドラフト · 最終更新 ${formatDateTime(d.retro!.updatedAt)}`}
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
