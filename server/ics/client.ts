import { parseAndExpand, type FetchedSchedulePart } from "../caldav/client.ts";

interface FetchEventsArgs {
  url: string;
  rangeStartMs: number;
  rangeEndMs: number;
  tzid: string;
}

export interface FetchIcsResult {
  ok: boolean;
  error: string;
  schedules: FetchedSchedulePart[];
}

function normalizeIcsUrl(raw: string): string {
  const url = raw.trim();
  if (url.toLowerCase().startsWith("webcal://")) {
    return `https://${url.slice("webcal://".length)}`;
  }
  return url;
}

function schedulePartsFromIcs(
  ics: string,
  opts: Pick<FetchEventsArgs, "rangeStartMs" | "rangeEndMs" | "tzid">,
): FetchedSchedulePart[] {
  const expanded = parseAndExpand([ics], {
    tzid: opts.tzid,
    rangeStartMs: opts.rangeStartMs,
    rangeEndMs: opts.rangeEndMs,
  });
  return expanded.map((e) => ({
    externalUid: e.recurrenceId ? `${e.uid}::${e.recurrenceId}` : e.uid,
    title: e.summary,
    description: e.description,
    location: e.location,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    rrule: e.rrule,
    recurrenceId: e.recurrenceId,
    objectUrl: "",
    etag: "",
  }));
}

export async function fetchEvents(
  opts: FetchEventsArgs,
): Promise<FetchIcsResult> {
  const url = normalizeIcsUrl(opts.url);
  if (!url) {
    return { ok: false, error: "ICS URL が空です", schedules: [] };
  }
  if (!/^https?:\/\//i.test(url)) {
    return {
      ok: false,
      error: "ICS URL は http(s) または webcal で始まる必要があります",
      schedules: [],
    };
  }

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "text/calendar, application/ics, text/plain;q=0.9, */*;q=0.1",
      },
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `ICS の取得に失敗しました (${res.status} ${res.statusText})`,
        schedules: [],
      };
    }
    const text = await res.text();
    return {
      ok: true,
      error: "",
      schedules: schedulePartsFromIcs(text, opts),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      schedules: [],
    };
  }
}
