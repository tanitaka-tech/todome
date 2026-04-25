import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type {
  CalendarSubscription,
  Schedule,
  ScheduleColorContext,
} from "../types";
import { scheduleColor, sortSchedulesByStart } from "../types";
import { getHolidayName, isDayOff } from "../holiday";

interface Props {
  anchor: Date;
  schedules: Schedule[];
  subscriptions: CalendarSubscription[];
  colorContext: ScheduleColorContext;
  calendarWeekStart: 0 | 1;
  onEventClick: (schedule: Schedule) => void;
  onSlotClick: (start: string, end: string, allDay: boolean) => void;
}

interface DayCell {
  date: Date;
  inMonth: boolean;
  iso: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function weekdayOffset(day: number, weekStart: 0 | 1): number {
  return (day - weekStart + 7) % 7;
}

function buildMonthGrid(anchor: Date, weekStart: 0 | 1): DayCell[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(start.getDate() - weekdayOffset(first.getDay(), weekStart));
  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({
      date: d,
      inMonth: d.getMonth() === anchor.getMonth(),
      iso: formatLocalDate(d),
    });
  }
  return cells;
}

export function ScheduleMonthView({
  anchor,
  schedules,
  subscriptions,
  colorContext,
  calendarWeekStart,
  onEventClick,
  onSlotClick,
}: Props) {
  const { t } = useTranslation("schedule");

  const cells = useMemo(
    () => buildMonthGrid(anchor, calendarWeekStart),
    [anchor, calendarWeekStart],
  );
  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => (calendarWeekStart + i) % 7),
    [calendarWeekStart],
  );
  const sorted = useMemo(() => sortSchedulesByStart(schedules), [schedules]);
  const todayIso = formatLocalDate(new Date());

  const eventsByDate = useMemo(() => {
    const map = new Map<string, Schedule[]>();
    for (const s of sorted) {
      const startDate = (s.start || "").slice(0, 10);
      const endDate = (s.end || startDate).slice(0, 10);
      if (!startDate) continue;
      let cursor = startDate;
      while (cursor && cursor <= endDate) {
        const arr = map.get(cursor) ?? [];
        arr.push(s);
        map.set(cursor, arr);
        const [y, m, d] = cursor.split("-").map((v) => parseInt(v, 10));
        const next = new Date(y, m - 1, d + 1);
        cursor = formatLocalDate(next);
        if (cursor > endDate) break;
      }
    }
    return map;
  }, [sorted]);

  return (
    <div className="schedule-month">
      <div className="schedule-month-weekdays">
        {weekdays.map((i) => (
          <div key={i} className="schedule-month-weekday">
            {t(`wd_${i}`)}
          </div>
        ))}
      </div>
      <div className="schedule-month-grid">
        {cells.map((cell) => {
          const events = eventsByDate.get(cell.iso) ?? [];
          const isToday = cell.iso === todayIso;
          const off = isDayOff(cell.date);
          const holidayName = getHolidayName(cell.date);
          return (
            <div
              key={cell.iso}
              className={`schedule-month-cell${cell.inMonth ? "" : " is-out"}${isToday ? " is-today" : ""}${off ? " is-off" : ""}`}
              onClick={(e) => {
                if (e.target !== e.currentTarget) return;
                onSlotClick(
                  `${cell.iso}T00:00:00`,
                  `${cell.iso}T00:00:00`,
                  true,
                );
              }}
            >
              <div className="schedule-month-cell-head">
                {holidayName && (
                  <span
                    className="schedule-month-holiday-name"
                    title={holidayName}
                  >
                    {holidayName}
                  </span>
                )}
                <span className="schedule-month-day-num">
                  {cell.date.getDate()}
                </span>
              </div>
              <div className="schedule-month-events">
                {events.slice(0, 4).map((s) => {
                  const color = scheduleColor(s, subscriptions, colorContext);
                  const time = s.allDay
                    ? ""
                    : (s.start || "").slice(11, 16);
                  const startsThisCell = (s.start || "").slice(0, 10) === cell.iso;
                  return (
                    <button
                      key={`${s.id}-${cell.iso}`}
                      type="button"
                      className={`schedule-month-event${s.allDay ? " is-allday" : ""}${startsThisCell ? "" : " is-cont"}`}
                      style={{ backgroundColor: color }}
                      title={s.title}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(s);
                      }}
                    >
                      {time && <span className="schedule-month-event-time">{time}</span>}
                      <span className="schedule-month-event-title">{s.title || "(untitled)"}</span>
                    </button>
                  );
                })}
                {events.length > 4 && (
                  <div className="schedule-month-more">
                    +{events.length - 4}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
