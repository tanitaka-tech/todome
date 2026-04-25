import { describe, expect, test } from "bun:test";
import { buildVEventIcs, localIsoToUtcMs, parseAndExpand } from "./client.ts";
import type { Schedule } from "../types.ts";

function makeSchedule(partial: Partial<Schedule> = {}): Schedule {
  return {
    id: "evt-1",
    source: "manual",
    subscriptionId: "",
    externalUid: "",
    title: "Title",
    description: "",
    location: "",
    start: "2026-04-25T10:00:00",
    end: "2026-04-25T11:00:00",
    allDay: false,
    color: "",
    rrule: "",
    recurrenceId: "",
    createdAt: "2026-04-25T09:00:00",
    updatedAt: "2026-04-25T09:00:00",
    caldavObjectUrl: "",
    caldavEtag: "",
    ...partial,
  };
}

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

  test("IcsBlock を渡すと objectUrl/etag が各 occurrence に伝播する", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:url-prop-001",
      "SUMMARY:Has URL",
      "DTSTART:20260420T010000Z",
      "DTEND:20260420T020000Z",
      "RRULE:FREQ=DAILY;COUNT=2",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseAndExpand(
      [
        {
          data: ics,
          objectUrl: "https://caldav.example/cal/uid-001.ics",
          etag: '"abc123"',
        },
      ],
      {
        tzid: TZ,
        rangeStartMs: PAST,
        rangeEndMs: FUTURE,
      },
    );
    expect(events.length).toBe(2);
    for (const e of events) {
      expect(e.objectUrl).toBe("https://caldav.example/cal/uid-001.ics");
      expect(e.etag).toBe('"abc123"');
    }
  });

  test("string[] を渡すと objectUrl/etag は空文字になる (後方互換)", () => {
    const ics =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:legacy\r\nSUMMARY:Legacy\r\nDTSTART:20260420T010000Z\r\nDTEND:20260420T020000Z\r\nEND:VEVENT\r\nEND:VCALENDAR";
    const events = parseAndExpand([ics], {
      tzid: TZ,
      rangeStartMs: PAST,
      rangeEndMs: FUTURE,
    });
    expect(events.length).toBe(1);
    expect(events[0]!.objectUrl).toBe("");
    expect(events[0]!.etag).toBe("");
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

  test("localIsoToUtcMs は Asia/Tokyo を 9 時間引く", () => {
    // 2026-04-25T10:00:00 (JST) = 2026-04-25T01:00:00Z
    const ms = localIsoToUtcMs("2026-04-25T10:00:00", "Asia/Tokyo");
    expect(new Date(ms).toISOString()).toBe("2026-04-25T01:00:00.000Z");
  });

  test("localIsoToUtcMs は America/Los_Angeles (DST下) を 7 時間足す", () => {
    // 2026-04-25 は PDT (UTC-7)
    const ms = localIsoToUtcMs("2026-04-25T10:00:00", "America/Los_Angeles");
    expect(new Date(ms).toISOString()).toBe("2026-04-25T17:00:00.000Z");
  });

  test("buildVEventIcs: 時刻イベントは UTC に変換した DTSTART/DTEND を出す", () => {
    const ics = buildVEventIcs(
      makeSchedule({
        title: "Meeting",
        description: "agenda\nsecond line",
        location: "Tokyo",
      }),
      "Asia/Tokyo",
      "uid-001@todome",
    );
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:uid-001@todome");
    expect(ics).toContain("DTSTART:20260425T010000Z");
    expect(ics).toContain("DTEND:20260425T020000Z");
    expect(ics).toContain("SUMMARY:Meeting");
    // 改行は \n にエスケープされる
    expect(ics).toContain("DESCRIPTION:agenda\\nsecond line");
    expect(ics).toContain("LOCATION:Tokyo");
    expect(ics).toContain("END:VEVENT");
    // 改行は CRLF
    expect(ics).toContain("\r\n");
  });

  test("buildVEventIcs: 全日イベントは VALUE=DATE で DTEND は exclusive 化", () => {
    const ics = buildVEventIcs(
      makeSchedule({
        allDay: true,
        // todome は inclusive で end を持つ → ICS では翌日に
        start: "2026-04-25T00:00:00",
        end: "2026-04-25T00:00:00",
        title: "Holiday",
      }),
      "Asia/Tokyo",
      "uid-allday@todome",
    );
    expect(ics).toContain("DTSTART;VALUE=DATE:20260425");
    expect(ics).toContain("DTEND;VALUE=DATE:20260426");
  });

  test("buildVEventIcs: 文字列のセミコロン/カンマ/バックスラッシュをエスケープ", () => {
    const ics = buildVEventIcs(
      makeSchedule({ title: "a,b;c\\d", description: "" }),
      "Asia/Tokyo",
      "uid-esc",
    );
    expect(ics).toContain("SUMMARY:a\\,b\\;c\\\\d");
  });

  test("buildVEventIcs: ラウンドトリップで parseAndExpand が同じ時刻に戻せる", () => {
    const ics = buildVEventIcs(
      makeSchedule({
        title: "Round",
        start: "2026-04-25T10:00:00",
        end: "2026-04-25T11:00:00",
      }),
      "Asia/Tokyo",
      "uid-rt",
    );
    const events = parseAndExpand([ics], {
      tzid: "Asia/Tokyo",
      rangeStartMs: Date.parse("2026-01-01T00:00:00Z"),
      rangeEndMs: Date.parse("2027-01-01T00:00:00Z"),
    });
    expect(events.length).toBe(1);
    expect(events[0]!.start).toBe("2026-04-25T10:00:00");
    expect(events[0]!.end).toBe("2026-04-25T11:00:00");
    expect(events[0]!.summary).toBe("Round");
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
