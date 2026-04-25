import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  CalDAVCalendarChoice,
  CalDAVStatus,
  CalendarSubscription,
  Schedule,
} from "../types";
import { nowLocalIso } from "../types";
import {
  loadScheduleView,
  saveScheduleView,
  type ScheduleViewMode,
} from "../viewState";
import { ScheduleMonthView } from "./ScheduleMonthView";
import {
  ScheduleWeekScroller,
  type ScheduleWeekScrollerHandle,
} from "./ScheduleWeekScroller";
import {
  ScheduleEventEditor,
  type EditorMode,
} from "./ScheduleEventEditor";
import { SubscriptionsModal } from "./SubscriptionsModal";
import { PeriodDropdown } from "./PeriodDropdown";

interface Props {
  schedules: Schedule[];
  subscriptions: CalendarSubscription[];
  send: (data: unknown) => void;
  dayBoundaryHour: number;
  caldavStatus: CalDAVStatus | null;
  caldavCalendars: CalDAVCalendarChoice[];
  caldavCalendarsError: string;
}

interface EditorState {
  mode: EditorMode;
  schedule: Schedule | null;
  initialStart?: string;
  initialEnd?: string;
  initialAllDay?: boolean;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  r.setDate(r.getDate() - day);
  return r;
}

function shiftMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1, 0, 0, 0, 0);
}

function shiftDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function formatYearMonth(d: Date, lang: string): string {
  if (lang.startsWith("ja")) {
    return `${d.getFullYear()}年 ${d.getMonth() + 1}月`;
  }
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long" });
}

function formatWeekRange(weekStart: Date, lang: string): string {
  const weekEnd = shiftDays(weekStart, 6);
  if (lang.startsWith("ja")) {
    return `${weekStart.getFullYear()}/${weekStart.getMonth() + 1}/${weekStart.getDate()} - ${weekEnd.getMonth() + 1}/${weekEnd.getDate()}`;
  }
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(weekStart)} – ${fmt(weekEnd)}, ${weekEnd.getFullYear()}`;
}

export function SchedulePanel({
  schedules,
  subscriptions,
  send,
  dayBoundaryHour: _dayBoundaryHour,
  caldavStatus,
  caldavCalendars,
  caldavCalendarsError,
}: Props) {
  const { t, i18n: i18nInst } = useTranslation("schedule");
  const lang = i18nInst.language;

  const [viewMode, setViewModeState] = useState<ScheduleViewMode>(() =>
    loadScheduleView(),
  );
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [showSubscriptions, setShowSubscriptions] = useState(false);
  const [scrollIdx, setScrollIdx] = useState(1);

  const pagerRef = useRef<HTMLDivElement>(null);
  const skipScrollRef = useRef(true);
  const scrollTimerRef = useRef<number | null>(null);
  const scrollerRef = useRef<ScheduleWeekScrollerHandle | null>(null);

  const setViewMode = useCallback((mode: ScheduleViewMode) => {
    setViewModeState(mode);
    saveScheduleView(mode);
  }, []);

  const visibleSchedules = useMemo(() => {
    const enabledSubs = new Set(
      subscriptions.filter((s) => s.enabled).map((s) => s.id),
    );
    return schedules.filter((s) => {
      if (s.source === "manual") return true;
      return enabledSubs.has(s.subscriptionId);
    });
  }, [schedules, subscriptions]);

  const goToday = useCallback(() => {
    setAnchor(new Date());
  }, []);

  // 月モード: 3 ページ snap pager に向けて scrollTo を連打すると、
  // 最初の遷移完了 (anchor 更新+中央リセット) を待たずに 2 度目の scrollTo が
  // 同じターゲットを指す状態 (= 動かない) になる。pending count で確定後に
  // 残りの方向を消費する。
  const monthScrollPendingRef = useRef(0);

  const fireMonthScroll = useCallback(() => {
    const el = pagerRef.current;
    if (!el) return;
    if (monthScrollPendingRef.current > 0) {
      el.scrollTo({ left: el.clientWidth * 2, behavior: "smooth" });
    } else if (monthScrollPendingRef.current < 0) {
      el.scrollTo({ left: 0, behavior: "smooth" });
    }
  }, []);

  const goPrev = useCallback(() => {
    if (viewMode === "month") {
      monthScrollPendingRef.current -= 1;
      fireMonthScroll();
    } else {
      scrollerRef.current?.scrollByDays(-7);
    }
  }, [viewMode, fireMonthScroll]);

  const goNext = useCallback(() => {
    if (viewMode === "month") {
      monthScrollPendingRef.current += 1;
      fireMonthScroll();
    } else {
      scrollerRef.current?.scrollByDays(7);
    }
  }, [viewMode, fireMonthScroll]);

  const handleNewEvent = useCallback(() => {
    setEditor({ mode: "create", schedule: null });
  }, []);

  const handleEventClick = useCallback(
    (schedule: Schedule) => {
      if (schedule.source === "subscription") {
        // CalDAV 購読の単発イベントなら iCloud に書き戻せるので edit モード
        const sub = subscriptions.find((s) => s.id === schedule.subscriptionId);
        const editable =
          sub?.provider === "caldav" && !schedule.rrule;
        setEditor({ mode: editable ? "edit" : "view", schedule });
        return;
      }
      setEditor({ mode: "edit", schedule });
    },
    [subscriptions],
  );

  const handleSlotClick = useCallback(
    (start: string, end: string, allDay: boolean) => {
      setEditor({
        mode: "create",
        schedule: null,
        initialStart: start,
        initialEnd: end,
        initialAllDay: allDay,
      });
    },
    [],
  );

  const handleSave = useCallback(
    (draft: Schedule) => {
      const now = nowLocalIso();
      if (editor?.mode === "create") {
        const next: Schedule = {
          ...draft,
          id: generateId(),
          source: "manual",
          subscriptionId: "",
          externalUid: "",
          caldavObjectUrl: "",
          caldavEtag: "",
          createdAt: now,
          updatedAt: now,
        };
        send({ type: "schedule_add", schedule: next });
      } else if (editor?.mode === "edit" && editor.schedule) {
        const original = editor.schedule;
        // subscription 由来なら identity / iCloud 識別子 / RRULE を維持
        const next: Schedule = {
          ...draft,
          id: original.id,
          source: original.source,
          subscriptionId: original.subscriptionId,
          externalUid: original.externalUid,
          caldavObjectUrl: original.caldavObjectUrl,
          caldavEtag: original.caldavEtag,
          rrule: original.rrule,
          recurrenceId: original.recurrenceId,
          createdAt: original.createdAt,
          updatedAt: now,
        };
        send({ type: "schedule_edit", schedule: next });
      }
      setEditor(null);
    },
    [editor, send],
  );

  const handleDelete = useCallback(
    (scheduleId: string) => {
      send({ type: "schedule_delete", scheduleId });
      setEditor(null);
    },
    [send],
  );

  const handleScheduleResize = useCallback(
    (schedule: Schedule, newStart: string, newEnd: string) => {
      const next: Schedule = {
        ...schedule,
        start: newStart,
        end: newEnd,
        updatedAt: nowLocalIso(),
      };
      send({ type: "schedule_edit", schedule: next });
    },
    [send],
  );

  // 月ページャー用 (3 ページ snap)
  const pages = useMemo<Date[]>(() => {
    return [
      shiftMonths(anchor, -1),
      startOfMonth(anchor),
      shiftMonths(anchor, 1),
    ];
  }, [anchor]);

  // 月モード時のみ、anchor 変更で中央ページに巻き戻す。
  // 巻き戻し直後に pending が残っていれば次の smooth scroll を継続する。
  useLayoutEffect(() => {
    if (viewMode !== "month") return;
    const el = pagerRef.current;
    if (!el) return;
    skipScrollRef.current = true;
    el.scrollLeft = el.clientWidth;
    setScrollIdx(1);
    const id = requestAnimationFrame(() => {
      skipScrollRef.current = false;
      if (monthScrollPendingRef.current !== 0) {
        fireMonthScroll();
      }
    });
    return () => cancelAnimationFrame(id);
  }, [anchor, viewMode, fireMonthScroll]);

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current !== null) {
        window.clearTimeout(scrollTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (editor || showSubscriptions) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tgt = e.target as HTMLElement | null;
      if (
        tgt &&
        (tgt.tagName === "INPUT" ||
          tgt.tagName === "TEXTAREA" ||
          tgt.tagName === "SELECT" ||
          tgt.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editor, showSubscriptions, goPrev, goNext]);

  const handleMonthScroll = useCallback(() => {
    if (skipScrollRef.current) return;
    const el = pagerRef.current;
    if (!el) return;
    const w = el.clientWidth;
    if (w === 0) return;
    const idx = Math.max(0, Math.min(2, Math.round(el.scrollLeft / w)));
    setScrollIdx(idx);

    if (scrollTimerRef.current !== null) {
      window.clearTimeout(scrollTimerRef.current);
    }
    scrollTimerRef.current = window.setTimeout(() => {
      if (skipScrollRef.current) return;
      if (idx === 0) {
        setAnchor((d) => shiftMonths(d, -1));
        // -1 が一つ消費された
        monthScrollPendingRef.current = Math.min(
          0,
          monthScrollPendingRef.current + 1,
        );
      } else if (idx === 2) {
        setAnchor((d) => shiftMonths(d, 1));
        monthScrollPendingRef.current = Math.max(
          0,
          monthScrollPendingRef.current - 1,
        );
      }
    }, 140);
  }, []);

  const headerLabel = useMemo(() => {
    if (viewMode === "month") {
      const d = pages[scrollIdx] ?? pages[1];
      if (!d) return "";
      return formatYearMonth(startOfMonth(d), lang);
    }
    return formatWeekRange(startOfWeek(anchor), lang);
  }, [viewMode, pages, scrollIdx, anchor, lang]);

  return (
    <div className="schedule-panel">
      <header className="schedule-toolbar">
        <div className="schedule-toolbar-left">
          <h2 className="schedule-title">{headerLabel}</h2>
        </div>
        <div className="schedule-toolbar-right">
          <PeriodDropdown
            ariaLabel={t("title")}
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: "month", label: t("monthView") },
              { value: "week", label: t("weekView") },
            ]}
          />
          <button type="button" className="btn" onClick={goToday}>
            {t("today")}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setShowSubscriptions(true)}
          >
            {t("manageSubscriptions")}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleNewEvent}
          >
            + {t("newEvent")}
          </button>
        </div>
      </header>

      <div className="schedule-body">
        {viewMode === "month" ? (
          <div
            className="schedule-pager"
            ref={pagerRef}
            onScroll={handleMonthScroll}
          >
            {pages.map((d, i) => (
              <div key={i} className="schedule-pager-page">
                <ScheduleMonthView
                  anchor={d}
                  schedules={visibleSchedules}
                  subscriptions={subscriptions}
                  onEventClick={handleEventClick}
                  onSlotClick={handleSlotClick}
                />
              </div>
            ))}
          </div>
        ) : (
          <ScheduleWeekScroller
            ref={scrollerRef}
            anchor={anchor}
            schedules={visibleSchedules}
            subscriptions={subscriptions}
            onAnchorChange={setAnchor}
            onEventClick={handleEventClick}
            onSlotClick={handleSlotClick}
            onScheduleResize={handleScheduleResize}
          />
        )}
      </div>

      {editor && (
        <ScheduleEventEditor
          key={editor.schedule?.id ?? "new"}
          mode={editor.mode}
          schedule={editor.schedule}
          subscriptions={subscriptions}
          initialStart={editor.initialStart}
          initialEnd={editor.initialEnd}
          initialAllDay={editor.initialAllDay}
          onSave={handleSave}
          onDelete={
            editor.mode === "edit" && editor.schedule
              ? handleDelete
              : undefined
          }
          onClose={() => setEditor(null)}
        />
      )}

      {showSubscriptions && (
        <SubscriptionsModal
          subscriptions={subscriptions}
          send={send}
          onClose={() => setShowSubscriptions(false)}
          caldavStatus={caldavStatus}
          caldavCalendars={caldavCalendars}
          caldavCalendarsError={caldavCalendarsError}
        />
      )}
    </div>
  );
}
