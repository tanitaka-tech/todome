import { describe, expect, test } from "bun:test";
import { parseAndExpand } from "./client.ts";

const TZ = "Asia/Tokyo";
const PAST = Date.parse("2026-01-01T00:00:00Z");
const FUTURE = Date.parse("2026-12-31T00:00:00Z");

function expand(ics: string) {
  return parseAndExpand([ics], {
    tzid: TZ,
    rangeStartMs: PAST,
    rangeEndMs: FUTURE,
    maxOccurrences: 50,
  });
}

describe("parseAndExpand", () => {
  test("単発 VEVENT を 1 件として展開する", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//test//EN",
      "BEGIN:VEVENT",
      "UID:single-001",
      "SUMMARY:Single Event",
      "DTSTART:20260420T010000Z",
      "DTEND:20260420T020000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = expand(ics);
    expect(events.length).toBe(1);
    const e = events[0]!;
    expect(e.uid).toBe("single-001");
    expect(e.summary).toBe("Single Event");
    expect(e.rrule).toBe("");
    expect(e.allDay).toBe(false);
  });

  test("RRULE COUNT=3 は 3 件に展開される", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//test//EN",
      "BEGIN:VEVENT",
      "UID:weekly-001",
      "SUMMARY:Weekly",
      "DTSTART:20260406T020000Z",
      "DTEND:20260406T030000Z",
      "RRULE:FREQ=WEEKLY;COUNT=3",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = expand(ics);
    expect(events.length).toBe(3);
    for (const e of events) {
      expect(e.uid).toBe("weekly-001");
      expect(e.summary).toBe("Weekly");
      expect(e.rrule).toContain("FREQ=WEEKLY");
    }
    // start 文字列はローカル ISO のフォーマット (Zなし)
    for (const e of events) {
      expect(e.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    }
  });

  test("RECURRENCE-ID で 1 回分の例外がタイトル変更される", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//test//EN",
      "BEGIN:VEVENT",
      "UID:weekly-002",
      "SUMMARY:Original",
      "DTSTART:20260406T030000Z",
      "DTEND:20260406T040000Z",
      "RRULE:FREQ=WEEKLY;COUNT=3",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:weekly-002",
      "RECURRENCE-ID:20260413T030000Z",
      "SUMMARY:Modified Once",
      "DTSTART:20260413T050000Z",
      "DTEND:20260413T060000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = expand(ics);
    expect(events.length).toBe(3);
    const modified = events.find((e) => e.summary === "Modified Once");
    expect(modified).toBeDefined();
    expect(modified?.recurrenceId).not.toBe("");
  });

  test("EXDATE で 1 回スキップされる", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//test//EN",
      "BEGIN:VEVENT",
      "UID:exdate-001",
      "SUMMARY:Skipper",
      "DTSTART:20260406T040000Z",
      "DTEND:20260406T050000Z",
      "RRULE:FREQ=WEEKLY;COUNT=3",
      "EXDATE:20260413T040000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = expand(ics);
    expect(events.length).toBe(2);
  });

  test("壊れたブロックは無視され、健全なブロックは返る", () => {
    const broken = "NOT VALID ICS DATA";
    const valid = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:valid-001",
      "SUMMARY:Valid",
      "DTSTART:20260420T010000Z",
      "DTEND:20260420T020000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseAndExpand([broken, valid], {
      tzid: TZ,
      rangeStartMs: PAST,
      rangeEndMs: FUTURE,
    });
    expect(events.length).toBe(1);
    expect(events[0]!.uid).toBe("valid-001");
  });

  test("範囲外の RRULE 展開は捨てられる", () => {
    // 2026 範囲を見ているのに 2024 起点で COUNT=3 → 全部範囲外
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:past-001",
      "SUMMARY:Past",
      "DTSTART:20240101T000000Z",
      "DTEND:20240101T010000Z",
      "RRULE:FREQ=DAILY;COUNT=3",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = expand(ics);
    expect(events.length).toBe(0);
  });

  test("全日イベント (DATE) は allDay=true になる", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:allday-001",
      "SUMMARY:Holiday",
      "DTSTART;VALUE=DATE:20260420",
      "DTEND;VALUE=DATE:20260421",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = expand(ics);
    expect(events.length).toBe(1);
    const e = events[0]!;
    expect(e.allDay).toBe(true);
    expect(e.start).toBe("2026-04-20T00:00:00");
    // DTEND は exclusive なので 1 日引いて inclusive にする
    expect(e.end).toBe("2026-04-20T00:00:00");
  });
});
