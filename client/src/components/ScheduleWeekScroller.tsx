import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  CalendarSubscription,
  KanbanTask,
  Retrospective,
  Schedule,
  ScheduleColorContext,
} from "../types";
import { scheduleColor } from "../types";
import { getHolidayName, isDayOff } from "../holiday";
import { RetroHoverPopup } from "./RetroHoverPopup";
import { ScheduleEventHoverPopup } from "./ScheduleEventHoverPopup";

interface SelectingState {
  dayIso: string;
  anchorMin: number;
  currentMin: number;
}

type ResizeEdge = "start" | "end";

interface ResizingState {
  scheduleId: string;
  edge: ResizeEdge;
  dayIso: string;
  fixedMin: number;
  currentMin: number;
}

interface HoverState {
  scheduleId: string;
  edge: ResizeEdge;
  time: string;
  x: number;
  y: number;
}

interface ZoomingState {
  startHourHeight: number;
  anchorMin: number;
  anchorOffsetInBody: number;
}

export interface ScheduleWeekScrollerHandle {
  scrollByDays: (n: number) => void;
}

interface Props {
  anchor: Date;
  schedules: Schedule[];
  dailyRetros: Retrospective[];
  tasks: KanbanTask[];
  subscriptions: CalendarSubscription[];
  colorContext: ScheduleColorContext;
  calendarWeekStart: 0 | 1;
  onAnchorChange: (d: Date) => void;
  onEventClick: (schedule: Schedule) => void;
  onSlotClick: (start: string, end: string, allDay: boolean) => void;
  onOpenDailyRetro: (date: string) => void;
  onScheduleResize: (
    schedule: Schedule,
    newStart: string,
    newEnd: string,
  ) => void;
  ref?: React.RefObject<ScheduleWeekScrollerHandle | null>;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DEFAULT_HOUR_HEIGHT = 48;
const MIN_HOUR_HEIGHT = 16;
const MAX_HOUR_HEIGHT = 200;
const ZOOM_DRAG_SENSITIVITY = 0.006;
const SNAP_MIN = 15;
const DEFAULT_DRAG_DURATION_MIN = 30;
const GUTTER_WIDTH = 64;
const MIN_DAY_WIDTH = 110;
const DAYS_BEFORE = 21;
const DAYS_AFTER = 21;
const TOTAL_DAYS = DAYS_BEFORE + 7 + DAYS_AFTER;
// 端到達でリスト拡張するしきい値
const EDGE_GROW_DAYS = 7;
const EDGE_THRESHOLD_DAYS = 5;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatHHMM(min: number): string {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startOfWeek(d: Date, weekStart: 0 | 1): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const day = (d.getDay() - weekStart + 7) % 7;
  r.setDate(r.getDate() - day);
  return r;
}

function shiftDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function buildInitialDayList(anchor: Date, weekStart: 0 | 1): Date[] {
  const ws = startOfWeek(anchor, weekStart);
  const first = shiftDays(ws, -DAYS_BEFORE);
  return Array.from({ length: TOTAL_DAYS }, (_, i) => shiftDays(first, i));
}

function snapMinutes(raw: number): number {
  const snapped = Math.round(raw / SNAP_MIN) * SNAP_MIN;
  return Math.max(0, Math.min(24 * 60, snapped));
}

// hourHeight に応じて時間軸ガターに表示する補助分ラベルを返す。
function getSubTickMinutes(hh: number): number[] {
  if (hh >= 180) return [10, 20, 30, 40, 50];
  if (hh >= 110) return [15, 30, 45];
  if (hh >= 64) return [30];
  return [];
}

function minutesFromMidnight(iso: string): number {
  const hh = parseInt(iso.slice(11, 13), 10);
  const mm = parseInt(iso.slice(14, 16), 10);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return 0;
  return hh * 60 + mm;
}

function computeResizedRange(
  r: ResizingState,
): { startMin: number; endMin: number } {
  if (r.edge === "start") {
    const startMin = Math.max(
      0,
      Math.min(r.currentMin, r.fixedMin - SNAP_MIN),
    );
    return { startMin, endMin: r.fixedMin };
  }
  const endMin = Math.min(
    24 * 60,
    Math.max(r.currentMin, r.fixedMin + SNAP_MIN),
  );
  return { startMin: r.fixedMin, endMin };
}

interface PositionedEvent {
  schedule: Schedule;
  topPx: number;
  heightPx: number;
  startMin: number;
  endMin: number;
  leftPct: number;
  widthPct: number;
  isContStart: boolean;
  isContEnd: boolean;
}

// 開始時刻順に並んだイベント列に対し、時間が重なるものを 1 グループにまとめ、
// 各イベントを最も左で空いている列に割り当てる。グループ全体の列数で等幅に分割する。
function assignOverlapColumns(items: PositionedEvent[]): void {
  let groupStart = 0;
  let groupMaxEnd = -Infinity;
  const flush = (from: number, to: number) => {
    if (from >= to) return;
    const colEnds: number[] = [];
    const colIdx: number[] = [];
    for (let i = from; i < to; i++) {
      const it = items[i];
      let c = 0;
      while (c < colEnds.length && colEnds[c] > it.startMin) c++;
      if (c === colEnds.length) colEnds.push(it.endMin);
      else colEnds[c] = it.endMin;
      colIdx.push(c);
    }
    const total = colEnds.length;
    for (let i = from; i < to; i++) {
      items[i].leftPct = colIdx[i - from] / total;
      items[i].widthPct = 1 / total;
    }
  };
  for (let i = 0; i < items.length; i++) {
    if (items[i].startMin >= groupMaxEnd) {
      flush(groupStart, i);
      groupStart = i;
      groupMaxEnd = items[i].endMin;
    } else {
      groupMaxEnd = Math.max(groupMaxEnd, items[i].endMin);
    }
  }
  flush(groupStart, items.length);
}

export function ScheduleWeekScroller({
  anchor,
  schedules,
  dailyRetros,
  tasks,
  subscriptions,
  colorContext,
  calendarWeekStart,
  onAnchorChange,
  onEventClick,
  onSlotClick,
  onOpenDailyRetro,
  onScheduleResize,
  ref,
}: Props) {
  const { t } = useTranslation("schedule");

  const containerRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const dayColMapRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const onAnchorChangeRef = useRef(onAnchorChange);
  const onScheduleResizeRef = useRef(onScheduleResize);
  const schedulesRef = useRef(schedules);

  // 自前で scrollLeft を制御する間は handleScroll を抑止
  const skipScrollRef = useRef(true);
  // 自分の onAnchorChange で送った直近の iso。外部入力との区別に使う。
  const lastEmittedAnchorIsoRef = useRef<string>(formatLocalDate(anchor));
  // smooth scroll 中の最終目標位置。連打時に累積させるための起点。
  const scrollTargetRef = useRef<number | null>(null);
  // ユーザー操作 (手動スクロール / 矢印 / today) があるまでは
  // dayWidth が ResizeObserver で確定したタイミングで anchor 週を左端に再配置する
  const userInteractedRef = useRef(false);

  useLayoutEffect(() => {
    onAnchorChangeRef.current = onAnchorChange;
  });
  useLayoutEffect(() => {
    onScheduleResizeRef.current = onScheduleResize;
  });
  useLayoutEffect(() => {
    schedulesRef.current = schedules;
  });

  const [dayWidth, setDayWidth] = useState<number>(MIN_DAY_WIDTH);
  // ヘッダ行の実高。allday 行の sticky top をヘッダの直下に揃えるため、
  // ResizeObserver で追従する。祝日名の有無で高さが変わるので静的指定では
  // overlap or gap が出る。
  const [headHeight, setHeadHeight] = useState<number>(49);
  const [dayList, setDayList] = useState<Date[]>(() =>
    buildInitialDayList(anchor, calendarWeekStart),
  );
  const [hourHeight, setHourHeight] = useState<number>(DEFAULT_HOUR_HEIGHT);
  const hourHeightRef = useRef(hourHeight);
  useLayoutEffect(() => {
    hourHeightRef.current = hourHeight;
  });
  // 現在時刻 (1分ごとに更新)。今ライン (Apple Calendar 風) の描画に使う。
  const [nowDate, setNowDate] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNowDate(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // 初期表示 + ResizeObserver で dayWidth が確定したタイミングで anchor 週始まりを
  // 画面左端 (gutter 直後) に位置取りし、現在時刻が時間軸方向の中央付近に来るよう
  // scrollTop を設定する。ユーザーが操作したら以降は触らない。
  // anchor 変更 (今日ボタン等) は別 useEffect で smooth scroll するので deps から外す。
  useLayoutEffect(() => {
    if (userInteractedRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    if (dayWidth <= 0) return;
    const anchorIso = formatLocalDate(startOfWeek(anchor, calendarWeekStart));
    const idx = dayList.findIndex((d) => formatLocalDate(d) === anchorIso);
    if (idx < 0) return;
    skipScrollRef.current = true;
    el.scrollLeft = idx * dayWidth;
    // 縦方向: 現在時刻を時間軸の中央付近に。head + allday 行 (sticky) の分は
    // クライアント高から差し引いて、可視のタイムグリッド領域の中央に合わせる。
    const now = new Date();
    const currentMin = now.getHours() * 60 + now.getMinutes();
    const currentY = (currentMin / 60) * hourHeight;
    const headEl = el.querySelector(".schedule-week-scroller-head") as HTMLElement | null;
    const allDayEl = el.querySelector(".schedule-week-scroller-allday") as HTMLElement | null;
    const headersHeight =
      (headEl?.offsetHeight ?? 0) + (allDayEl?.offsetHeight ?? 0);
    const visibleGridHeight = Math.max(
      hourHeight,
      el.clientHeight - headersHeight,
    );
    el.scrollTop = Math.max(0, currentY - visibleGridHeight / 2);
    lastEmittedAnchorIsoRef.current = anchorIso;
    requestAnimationFrame(() => {
      skipScrollRef.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayWidth, dayList, calendarWeekStart]);

  // ResizeObserver で 1 日幅をビューポートから算出
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
      const next = Math.max(MIN_DAY_WIDTH, (w - GUTTER_WIDTH) / 7);
      setDayWidth((prev) => (Math.abs(prev - next) > 0.5 ? next : prev));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = headRef.current;
    if (!el) return;
    const update = () => {
      const h = el.offsetHeight;
      if (h <= 0) return;
      setHeadHeight((prev) => (Math.abs(prev - h) > 0.5 ? h : prev));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 親 (SchedulePanel) からの anchor 変更 (今日ボタン / 矢印キー後の同期) に反応してスクロール
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const targetIso = formatLocalDate(startOfWeek(anchor, calendarWeekStart));
    if (lastEmittedAnchorIsoRef.current === targetIso) return; // 自分が出した変更
    let idx = dayList.findIndex((d) => formatLocalDate(d) === targetIso);
    if (idx < 0) {
      const next = buildInitialDayList(anchor, calendarWeekStart);
      // 親 anchor が現リストの範囲外に飛んだとき (今日ボタン等) のみリスト再構築。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDayList(next);
      idx = next.findIndex((d) => formatLocalDate(d) === targetIso);
      if (idx < 0) return;
      // setDayList 後は次回 layout で scroll する
      requestAnimationFrame(() => {
        skipScrollRef.current = true;
        el.scrollLeft = idx * dayWidth;
        lastEmittedAnchorIsoRef.current = targetIso;
        requestAnimationFrame(() => {
          skipScrollRef.current = false;
        });
      });
      return;
    }
    skipScrollRef.current = true;
    el.scrollTo({ left: idx * dayWidth, behavior: "smooth" });
    lastEmittedAnchorIsoRef.current = targetIso;
    setTimeout(() => {
      skipScrollRef.current = false;
    }, 600);
  }, [anchor, dayList, dayWidth, calendarWeekStart]);

  // ref で外部 (SchedulePanel) から N 日分スクロールを呼べるようにする。
  // smooth scroll 中に連打されても上書きされず累積する。target が現在の
  // dayList 範囲外になる場合は、拡張してからスクロールする。
  // 注意: 連打で setDayList が前のレンダー前に再呼出される場合があるので、
  // 配列の末尾/先頭は必ず updater 内 (= 最新 state) で参照する。
  useImperativeHandle(
    ref,
    () => ({
      scrollByDays: (n: number) => {
        const el = containerRef.current;
        if (!el) return;
        const base = scrollTargetRef.current ?? el.scrollLeft;
        let target = base + n * dayWidth;

        // 右端を超える場合: 必要日数を末尾に追加
        const maxLeft = el.scrollWidth - el.clientWidth;
        if (target > maxLeft) {
          const overshootPx = target - maxLeft;
          const extraDays =
            Math.ceil(overshootPx / dayWidth) + EDGE_GROW_DAYS;
          setDayList((prev) => {
            const lastDay = prev[prev.length - 1];
            if (!lastDay) return prev;
            const append = Array.from({ length: extraDays }, (_, i) =>
              shiftDays(lastDay, i + 1),
            );
            return [...prev, ...append];
          });
        }

        // 左端を超える場合: 必要日数を先頭に追加し、scrollLeft / target をシフト
        if (target < 0) {
          const extraDays =
            Math.ceil(-target / dayWidth) + EDGE_GROW_DAYS;
          setDayList((prev) => {
            const firstDay = prev[0];
            if (!firstDay) return prev;
            const prepend = Array.from({ length: extraDays }, (_, i) =>
              shiftDays(firstDay, -(extraDays - i)),
            );
            return [...prepend, ...prev];
          });
          const offset = extraDays * dayWidth;
          target += offset;
          // 拡張で既存 day-col が右にずれた分、scrollLeft も同じだけ進める
          requestAnimationFrame(() => {
            skipScrollRef.current = true;
            el.scrollLeft += offset;
            requestAnimationFrame(() => {
              skipScrollRef.current = false;
            });
          });
        }

        scrollTargetRef.current = target;
        // setDayList 後のレンダーで scrollWidth が拡張されるのを待ってから scrollTo
        requestAnimationFrame(() => {
          const cur = scrollTargetRef.current;
          if (cur === null) return;
          el.scrollTo({ left: cur, behavior: "smooth" });
        });
      },
    }),
    [dayWidth],
  );

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el || skipScrollRef.current) return;
    if (dayWidth <= 0) return;
    // 手動スクロール検出 → 以降は dayWidth 変化での自動再配置を停止
    userInteractedRef.current = true;
    // smooth scroll 目標に到達したらクリア
    if (
      scrollTargetRef.current !== null &&
      Math.abs(el.scrollLeft - scrollTargetRef.current) < 2
    ) {
      scrollTargetRef.current = null;
    }
    // ビューポートの左端から見える日 = 現在週の始まり
    const leftIdx = Math.round(el.scrollLeft / dayWidth);
    const day = dayList[Math.max(0, leftIdx)];
    if (day) {
      const weekStart = startOfWeek(day, calendarWeekStart);
      const wsIso = formatLocalDate(weekStart);
      if (wsIso !== lastEmittedAnchorIsoRef.current) {
        lastEmittedAnchorIsoRef.current = wsIso;
        onAnchorChangeRef.current(weekStart);
      }
    }
    // 端到達でリスト拡張
    if (leftIdx <= EDGE_THRESHOLD_DAYS) {
      const first = dayList[0];
      if (!first) return;
      const prepend = Array.from({ length: EDGE_GROW_DAYS }, (_, i) =>
        shiftDays(first, -(EDGE_GROW_DAYS - i)),
      );
      setDayList((prev) => [...prepend, ...prev]);
      requestAnimationFrame(() => {
        skipScrollRef.current = true;
        const offset = EDGE_GROW_DAYS * dayWidth;
        el.scrollLeft += offset;
        // 進行中の smooth scroll 目標も同じ分シフトしないと、連打時に位置がずれる
        if (scrollTargetRef.current !== null) {
          scrollTargetRef.current += offset;
        }
        requestAnimationFrame(() => {
          skipScrollRef.current = false;
        });
      });
    } else if (leftIdx >= dayList.length - 7 - EDGE_THRESHOLD_DAYS) {
      const last = dayList[dayList.length - 1];
      if (!last) return;
      const append = Array.from({ length: EDGE_GROW_DAYS }, (_, i) =>
        shiftDays(last, i + 1),
      );
      setDayList((prev) => [...prev, ...append]);
    }
  };

  // ===== drag-to-select / resize / hover (ScheduleWeekView と同じ) =====

  const [selecting, setSelecting] = useState<SelectingState | null>(null);
  const selectingRef = useRef<SelectingState | null>(null);
  const [resizing, setResizing] = useState<ResizingState | null>(null);
  const resizingRef = useRef<ResizingState | null>(null);
  const didResizeRef = useRef(false);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [zooming, setZooming] = useState<ZoomingState | null>(null);
  const zoomingRef = useRef<ZoomingState | null>(null);
  const zoomDxRef = useRef(0);

  useLayoutEffect(() => {
    selectingRef.current = selecting;
  });
  useLayoutEffect(() => {
    resizingRef.current = resizing;
  });
  useLayoutEffect(() => {
    zoomingRef.current = zooming;
  });

  const isSelecting = selecting !== null;
  const isResizing = resizing !== null;
  const isZooming = zooming !== null;
  const dragActive = isSelecting || isResizing || isZooming;

  useEffect(() => {
    if (!dragActive) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = prev;
    };
  }, [dragActive]);


  useEffect(() => {
    if (!isSelecting) return;
    const handleMove = (e: MouseEvent) => {
      const cur = selectingRef.current;
      if (!cur) return;
      const col = dayColMapRef.current.get(cur.dayIso);
      if (!col) return;
      const rect = col.getBoundingClientRect();
      const min = snapMinutes(((e.clientY - rect.top) / hourHeightRef.current) * 60);
      setSelecting((prev) =>
        prev && prev.currentMin !== min ? { ...prev, currentMin: min } : prev,
      );
    };
    const handleUp = () => {
      const cur = selectingRef.current;
      if (!cur) return;
      setSelecting(null);
      const start = Math.min(cur.anchorMin, cur.currentMin);
      let end = Math.max(cur.anchorMin, cur.currentMin);
      if (end - start < SNAP_MIN) end = start + DEFAULT_DRAG_DURATION_MIN;
      const sIso = `${cur.dayIso}T${formatHHMM(start)}:00`;
      const eIso = `${cur.dayIso}T${formatHHMM(end)}:00`;
      onSlotClick(sIso, eIso, false);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isSelecting, onSlotClick]);

  useEffect(() => {
    if (!isResizing) return;
    const handleMove = (e: MouseEvent) => {
      const cur = resizingRef.current;
      if (!cur) return;
      const col = dayColMapRef.current.get(cur.dayIso);
      if (!col) return;
      const rect = col.getBoundingClientRect();
      const min = snapMinutes(((e.clientY - rect.top) / hourHeightRef.current) * 60);
      const next = min !== cur.currentMin ? { ...cur, currentMin: min } : cur;
      if (min !== cur.currentMin) {
        didResizeRef.current = true;
        setResizing(next);
      }
      const { startMin, endMin } = computeResizedRange(next);
      setHover({
        scheduleId: cur.scheduleId,
        edge: cur.edge,
        time: cur.edge === "start" ? formatHHMM(startMin) : formatHHMM(endMin),
        x: e.clientX,
        y: e.clientY,
      });
    };
    const handleUp = () => {
      const cur = resizingRef.current;
      if (!cur) return;
      setResizing(null);
      setHover(null);
      if (!didResizeRef.current) return;
      const sched = schedulesRef.current.find(
        (s) => s.id === cur.scheduleId,
      );
      if (!sched) return;
      const { startMin, endMin } = computeResizedRange(cur);
      const sIso = `${cur.dayIso}T${formatHHMM(startMin)}:00`;
      const eIso = `${cur.dayIso}T${formatHHMM(endMin)}:00`;
      if (sIso === sched.start && eIso === sched.end) return;
      onScheduleResizeRef.current(sched, sIso, eIso);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isResizing]);

  const handleColMouseDown = (e: React.MouseEvent, dayIso: string) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".schedule-week-event")) return;
    const col = dayColMapRef.current.get(dayIso);
    if (!col) return;
    const rect = col.getBoundingClientRect();
    const min = snapMinutes(((e.clientY - rect.top) / hourHeight) * 60);
    setSelecting({ dayIso, anchorMin: min, currentMin: min });
    e.preventDefault();
  };

  // 時間軸ガターを掴んで水平方向にドラッグ → 1時間あたりのpxを伸縮。
  // Pointer Lock でカーソル非表示・位置固定。掴んだ時刻が画面上で動かないよう
  // scrollTop を補正する (ピンチ的にカーソル位置を中心にズーム)。
  const handleHoursMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;
    const hoursEl = e.currentTarget as HTMLElement;
    const hoursRect = hoursEl.getBoundingClientRect();
    const offsetY = e.clientY - hoursRect.top;
    const anchorMin = (offsetY / hourHeight) * 60;
    const anchorOffsetInBody = (anchorMin / 60) * hourHeight - el.scrollTop;
    zoomDxRef.current = 0;
    setZooming({
      startHourHeight: hourHeight,
      anchorMin,
      anchorOffsetInBody,
    });
    e.preventDefault();
  };

  useEffect(() => {
    if (!isZooming) return;
    const handleMove = (e: MouseEvent) => {
      const cur = zoomingRef.current;
      if (!cur) return;
      const el = containerRef.current;
      if (!el) return;
      zoomDxRef.current += e.movementX;
      const factor = Math.exp(zoomDxRef.current * ZOOM_DRAG_SENSITIVITY);
      const next = Math.min(
        MAX_HOUR_HEIGHT,
        Math.max(MIN_HOUR_HEIGHT, cur.startHourHeight * factor),
      );
      setHourHeight(next);
      // setHourHeight 後 DOM 反映前に scrollTop を当てる必要があるので
      // requestAnimationFrame で次フレームに補正
      requestAnimationFrame(() => {
        const elNow = containerRef.current;
        if (!elNow) return;
        const wantedScrollTop = (cur.anchorMin / 60) * next - cur.anchorOffsetInBody;
        const maxScrollTop = Math.max(0, elNow.scrollHeight - elNow.clientHeight);
        skipScrollRef.current = true;
        elNow.scrollTop = Math.max(0, Math.min(maxScrollTop, wantedScrollTop));
        requestAnimationFrame(() => {
          skipScrollRef.current = false;
        });
      });
    };
    const handleUp = () => {
      zoomDxRef.current = 0;
      setZooming(null);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isZooming]);

  const handleResizeStart = (
    e: React.MouseEvent,
    schedule: Schedule,
    dayIso: string,
    edge: ResizeEdge,
  ) => {
    if (e.button !== 0) return;
    if (schedule.source === "subscription") return;
    e.stopPropagation();
    e.preventDefault();
    didResizeRef.current = false;
    const startMin = minutesFromMidnight(schedule.start);
    const endMin = schedule.end
      ? Math.max(startMin + SNAP_MIN, minutesFromMidnight(schedule.end))
      : startMin + 60;
    setResizing({
      scheduleId: schedule.id,
      edge,
      dayIso,
      fixedMin: edge === "start" ? endMin : startMin,
      currentMin: edge === "start" ? startMin : endMin,
    });
  };

  // ===== レイアウト計算 =====

  const todayIso = formatLocalDate(new Date());

  const allDayByDay = useMemo(() => {
    const map = new Map<string, Schedule[]>();
    for (const day of dayList) {
      const iso = formatLocalDate(day);
      const items = schedules.filter((s) => {
        if (!s.allDay) return false;
        const startDate = (s.start || "").slice(0, 10);
        const endDate = (s.end || startDate).slice(0, 10);
        return startDate <= iso && iso <= endDate;
      });
      map.set(iso, items);
    }
    return map;
  }, [dayList, schedules]);

  const retrosByDay = useMemo(() => {
    const map = new Map<string, Retrospective[]>();
    for (const day of dayList) {
      const iso = formatLocalDate(day);
      map.set(
        iso,
        dailyRetros.filter((retro) => retro.periodStart === iso),
      );
    }
    return map;
  }, [dayList, dailyRetros]);

  const timedByDay = useMemo(() => {
    const map = new Map<string, PositionedEvent[]>();
    for (const day of dayList) {
      const iso = formatLocalDate(day);
      const items: PositionedEvent[] = [];
      for (const s of schedules) {
        if (s.allDay) continue;
        const startDate = (s.start || "").slice(0, 10);
        if (!startDate) continue;
        const endDate = (s.end || s.start).slice(0, 10);
        if (!(startDate <= iso && iso <= endDate)) continue;
        const isContStart = iso > startDate;
        const isContEnd = iso < endDate;
        const segStartMin = isContStart ? 0 : minutesFromMidnight(s.start);
        const segEndMin = isContEnd
          ? 24 * 60
          : s.end
            ? Math.max(segStartMin + 15, minutesFromMidnight(s.end))
            : segStartMin + 60;
        const topPx = (segStartMin / 60) * hourHeight;
        const heightPx = Math.max(
          16,
          ((segEndMin - segStartMin) / 60) * hourHeight,
        );
        items.push({
          schedule: s,
          topPx,
          heightPx,
          startMin: segStartMin,
          endMin: segEndMin,
          leftPct: 0,
          widthPct: 1,
          isContStart,
          isContEnd,
        });
      }
      items.sort((a, b) =>
        a.startMin - b.startMin || b.endMin - a.endMin,
      );
      assignOverlapColumns(items);
      map.set(iso, items);
    }
    return map;
  }, [dayList, schedules, hourHeight]);

  const daysGridStyle: React.CSSProperties = {
    gridTemplateColumns: `repeat(${dayList.length}, ${dayWidth}px)`,
  };

  return (
    <div
      className="schedule-week-scroller"
      ref={containerRef}
      onScroll={handleScroll}
    >
      {/* 一段目: ヘッダ (曜日 + 日付) */}
      <div className="schedule-week-scroller-head" ref={headRef}>
        <div className="schedule-week-scroller-corner" />
        <div className="schedule-week-scroller-day-heads" style={daysGridStyle}>
          {dayList.map((d) => {
            const iso = formatLocalDate(d);
            const isToday = iso === todayIso;
            const off = isDayOff(d);
            const holidayName = getHolidayName(d);
            return (
              <div
                key={`head-${iso}`}
                className={`schedule-week-day-head${isToday ? " is-today" : ""}${off ? " is-off" : ""}`}
              >
                <div className="schedule-week-wd">{t(`wd_${d.getDay()}`)}</div>
                <div className="schedule-week-dnum">{d.getDate()}</div>
                {holidayName && (
                  <div
                    className="schedule-week-holiday-name"
                    title={holidayName}
                  >
                    {holidayName}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 二段目: allDay 行 */}
      <div
        className="schedule-week-scroller-allday"
        style={{ top: headHeight }}
      >
        <div className="schedule-week-scroller-allday-gutter">
          {t("allDay")}
        </div>
        <div
          className="schedule-week-scroller-allday-cells"
          style={daysGridStyle}
        >
          {dayList.map((d) => {
            const iso = formatLocalDate(d);
            const items = allDayByDay.get(iso) ?? [];
            const retros = retrosByDay.get(iso) ?? [];
            const off = isDayOff(d);
            return (
              <div
                key={`ad-${iso}`}
                className={`schedule-week-allday-cell${off ? " is-off" : ""}`}
                onClick={(e) => {
                  if (e.target !== e.currentTarget) return;
                  onSlotClick(`${iso}T00:00:00`, `${iso}T00:00:00`, true);
                }}
              >
                {retros.map((retro) => (
                  <button
                    key={retro.id}
                    type="button"
                    className={`schedule-week-retro${retro.completedAt ? "" : " is-draft"}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDailyRetro(iso);
                    }}
                  >
                    <span className="schedule-week-retro-mark">
                      {t("retroDailyMark")}
                    </span>
                    {!retro.completedAt && (
                      <span className="schedule-week-retro-draft">
                        {t("retroDraft")}
                      </span>
                    )}
                    <span className="schedule-week-retro-title">
                      {retro.document.next ||
                        retro.document.learned ||
                        retro.document.did ||
                        t("retroDailyFallback")}
                    </span>
                    <RetroHoverPopup retro={retro} tasks={tasks} />
                  </button>
                ))}
                {items.map((s) => {
                  const c = scheduleColor(s, subscriptions, colorContext);
                  return (
                    <button
                      key={`${s.id}-${iso}`}
                      type="button"
                      className="schedule-week-allday-event"
                      style={{ "--event-color": c } as CSSProperties}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(s);
                      }}
                    >
                      {s.title || "(untitled)"}
                      <ScheduleEventHoverPopup
                        schedule={s}
                        subscriptions={subscriptions}
                      />
                    </button>
                  );
                })}
                {retros.length === 0 && (
                  <button
                    type="button"
                    className="schedule-week-retro-add"
                    title={t("addDailyRetro")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDailyRetro(iso);
                    }}
                  >
                    {t("addDailyRetroLong")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 三段目: 時間グリッド */}
      <div className="schedule-week-scroller-body">
        <div
          className="schedule-week-scroller-hours"
          onMouseDown={handleHoursMouseDown}
        >
          {HOURS.map((h) => {
            const subTicks = getSubTickMinutes(hourHeight);
            return (
              <div
                key={h}
                className="schedule-week-hour-label"
                style={{ height: hourHeight }}
              >
                {pad2(h)}:00
                {subTicks.map((m) => (
                  <span
                    key={m}
                    className="schedule-week-hour-label-tick"
                    style={{ top: (m / 60) * hourHeight }}
                  >
                    :{pad2(m)}
                  </span>
                ))}
              </div>
            );
          })}
          {(() => {
            const min = nowDate.getHours() * 60 + nowDate.getMinutes();
            return (
              <div
                className="schedule-week-now-time"
                style={{ top: (min / 60) * hourHeight }}
              >
                {formatHHMM(min)}
              </div>
            );
          })()}
        </div>
        <div
          className="schedule-week-scroller-day-cols"
          style={daysGridStyle}
        >
          {dayList.map((d) => {
          const iso = formatLocalDate(d);
          const off = isDayOff(d);
          const events = timedByDay.get(iso) ?? [];
          const isSelectingThisCol = selecting && selecting.dayIso === iso;
          let selBox: { top: number; height: number; label: string } | null = null;
          if (isSelectingThisCol && selecting) {
            const s = Math.min(selecting.anchorMin, selecting.currentMin);
            const e = Math.max(selecting.anchorMin, selecting.currentMin);
            const visibleEnd = e === s ? s + DEFAULT_DRAG_DURATION_MIN : e;
            selBox = {
              top: (s / 60) * hourHeight,
              height: Math.max(8, ((visibleEnd - s) / 60) * hourHeight),
              label: `${formatHHMM(s)} – ${formatHHMM(visibleEnd)}`,
            };
          }
          return (
            <div
              key={`tg-${iso}`}
              ref={(el) => {
                if (el) dayColMapRef.current.set(iso, el);
                else dayColMapRef.current.delete(iso);
              }}
              className={`schedule-week-day-col${off ? " is-off" : ""}`}
              onMouseDown={(e) => handleColMouseDown(e, iso)}
            >
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="schedule-week-hour-cell"
                  style={{ height: hourHeight }}
                />
              ))}
              {events.map(({ schedule, topPx, heightPx, startMin, endMin, leftPct, widthPct, isContStart, isContEnd }) => {
                const isResizingThis = resizing?.scheduleId === schedule.id;
                let displayTop = topPx;
                let displayHeight = heightPx;
                let topLabel = formatHHMM(startMin);
                let bottomLabel = formatHHMM(endMin);
                if (isResizingThis && resizing) {
                  const range = computeResizedRange(resizing);
                  displayTop = (range.startMin / 60) * hourHeight;
                  displayHeight = Math.max(
                    8,
                    ((range.endMin - range.startMin) / 60) * hourHeight,
                  );
                  topLabel = formatHHMM(range.startMin);
                  bottomLabel = formatHHMM(range.endMin);
                }
                const isVirtualActive = schedule.id.startsWith("virtual-active-");
                const canResizeBase = schedule.source === "manual" && !isVirtualActive;
                const canResizeTop = canResizeBase && !isContStart;
                const canResizeBottom = canResizeBase && !isContEnd;
                const eventColor = scheduleColor(schedule, subscriptions, colorContext);
                return (
                  <button
                    key={`${schedule.id}-${iso}`}
                    type="button"
                    className={`schedule-week-event${isResizingThis ? " is-resizing" : ""}${isVirtualActive ? " is-active-virtual" : ""}${isContStart ? " is-cont-start" : ""}${isContEnd ? " is-cont-end" : ""}`}
                    style={{
                      top: displayTop,
                      height: displayHeight,
                      left: `calc(${leftPct * 100}% + 2px)`,
                      width: `calc(${widthPct * 100}% - 4px)`,
                      "--event-color": eventColor,
                    } as CSSProperties}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (didResizeRef.current) {
                        didResizeRef.current = false;
                        return;
                      }
                      if (isVirtualActive) return;
                      onEventClick(schedule);
                    }}
                  >
                    {canResizeTop && (
                      <div
                        className="schedule-week-event-resize schedule-week-event-resize--top"
                        onMouseDown={(e) =>
                          handleResizeStart(e, schedule, iso, "start")
                        }
                        onMouseEnter={(e) =>
                          setHover({
                            scheduleId: schedule.id,
                            edge: "start",
                            time: topLabel,
                            x: e.clientX,
                            y: e.clientY,
                          })
                        }
                        onMouseMove={(e) =>
                          setHover((prev) =>
                            prev &&
                            prev.scheduleId === schedule.id &&
                            prev.edge === "start"
                              ? { ...prev, x: e.clientX, y: e.clientY }
                              : prev,
                          )
                        }
                        onMouseLeave={() => {
                          if (resizingRef.current?.scheduleId === schedule.id)
                            return;
                          setHover((prev) =>
                            prev &&
                            prev.scheduleId === schedule.id &&
                            prev.edge === "start"
                              ? null
                              : prev,
                          );
                        }}
                      />
                    )}
                    <div className="schedule-week-event-title">
                      {schedule.title || "(untitled)"}
                    </div>
                    {(!isContStart || !isContEnd) && (
                      <div className="schedule-week-event-time">
                        {!isContStart && <span>{`⏲${topLabel}`}</span>}
                        {!isContEnd && <span>{`~${bottomLabel}`}</span>}
                      </div>
                    )}
                    {canResizeBottom && (
                      <div
                        className="schedule-week-event-resize schedule-week-event-resize--bottom"
                        onMouseDown={(e) =>
                          handleResizeStart(e, schedule, iso, "end")
                        }
                        onMouseEnter={(e) =>
                          setHover({
                            scheduleId: schedule.id,
                            edge: "end",
                            time: bottomLabel,
                            x: e.clientX,
                            y: e.clientY,
                          })
                        }
                        onMouseMove={(e) =>
                          setHover((prev) =>
                            prev &&
                            prev.scheduleId === schedule.id &&
                            prev.edge === "end"
                              ? { ...prev, x: e.clientX, y: e.clientY }
                              : prev,
                          )
                        }
                        onMouseLeave={() => {
                          if (resizingRef.current?.scheduleId === schedule.id)
                            return;
                          setHover((prev) =>
                            prev &&
                            prev.scheduleId === schedule.id &&
                            prev.edge === "end"
                              ? null
                              : prev,
                          );
                        }}
                      />
                    )}
                    {!isVirtualActive && (
                      <ScheduleEventHoverPopup
                        schedule={schedule}
                        subscriptions={subscriptions}
                      />
                    )}
                  </button>
                );
              })}
              {selBox && (
                <div
                  className="schedule-week-selection"
                  style={{ top: selBox.top, height: selBox.height }}
                >
                  <span className="schedule-week-selection-label">
                    {selBox.label}
                  </span>
                </div>
              )}
            </div>
          );
        })}
        {(() => {
          const min = nowDate.getHours() * 60 + nowDate.getMinutes();
          const top = (min / 60) * hourHeight;
          const todayIso = formatLocalDate(nowDate);
          const todayIdx = dayList.findIndex(
            (d) => formatLocalDate(d) === todayIso,
          );
          return (
            <>
              {/* 全日に跨る薄い now-line (ドット無し) */}
              <div
                className="schedule-week-now-line schedule-week-now-line--faint"
                style={{ top, left: 0, right: 0 }}
              />
              {/* 今日の column のみ強調 + ドット */}
              {todayIdx >= 0 && (
                <div
                  className="schedule-week-now-line"
                  style={{
                    top,
                    left: todayIdx * dayWidth,
                    width: dayWidth,
                  }}
                >
                  <div className="schedule-week-now-dot" />
                </div>
              )}
            </>
          );
        })()}
        </div>
      </div>

      {hover && (
        <div
          className="schedule-hover-label"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          {hover.time}
        </div>
      )}
      {isZooming && <div className="schedule-zoom-cursor-mask" />}
    </div>
  );
}
