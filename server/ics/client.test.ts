import { afterEach, describe, expect, it } from "bun:test";
import { fetchEvents } from "./client.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

type FetchStub = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => ReturnType<typeof fetch>;

function stubFetch(fn: FetchStub): void {
  globalThis.fetch = fn as unknown as typeof fetch;
}

const RANGE_START = Date.parse("2026-01-01T00:00:00Z");
const RANGE_END = Date.parse("2026-12-31T00:00:00Z");

function fetchTestEvents(url: string) {
  return fetchEvents({
    url,
    rangeStartMs: RANGE_START,
    rangeEndMs: RANGE_END,
    tzid: "Asia/Tokyo",
  });
}

describe("ICS fetchEvents", () => {
  it("webcal URL を https に変換して予定を展開する", async () => {
    let requestedUrl = "";
    let acceptHeader = "";
    stubFetch(async (input, init) => {
      requestedUrl = String(input);
      const headers = init?.headers as Record<string, string> | undefined;
      acceptHeader = headers?.Accept ?? "";
      const ics = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:public-001",
        "SUMMARY:Public Event",
        "DESCRIPTION:From public ICS",
        "LOCATION:Online",
        "DTSTART:20260420T010000Z",
        "DTEND:20260420T020000Z",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");
      return new Response(ics, { status: 200 });
    });

    const result = await fetchTestEvents("webcal://calendar.example/basic.ics");

    expect(requestedUrl).toBe("https://calendar.example/basic.ics");
    expect(acceptHeader).toContain("text/calendar");
    expect(result.ok).toBe(true);
    expect(result.schedules).toHaveLength(1);
    expect(result.schedules[0]).toMatchObject({
      externalUid: "public-001",
      title: "Public Event",
      description: "From public ICS",
      location: "Online",
      start: "2026-04-20T10:00:00",
      end: "2026-04-20T11:00:00",
      objectUrl: "",
      etag: "",
    });
  });

  it("HTTP エラーを失敗として返す", async () => {
    stubFetch(async () => new Response("nope", {
      status: 503,
      statusText: "Service Unavailable",
    }));

    const result = await fetchTestEvents("https://calendar.example/down.ics");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("503 Service Unavailable");
    expect(result.schedules).toEqual([]);
  });

  it("http(s) と webcal 以外の URL は取得しない", async () => {
    let called = false;
    stubFetch(async () => {
      called = true;
      return new Response("");
    });

    const result = await fetchTestEvents("file:///tmp/calendar.ics");

    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("http(s) または webcal");
  });
});
