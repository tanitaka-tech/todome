import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDb, resetDbCache } from "../db.ts";
import {
  deleteManualSchedule,
  deleteSchedulesBySubscription,
  loadManualSchedules,
  loadSchedules,
  normalizeSchedule,
  replaceSubscriptionSchedules,
  upsertManualSchedule,
} from "./schedule.ts";
import type { Schedule } from "../types.ts";

function makeManual(partial: Partial<Schedule> & Pick<Schedule, "id" | "title">): Schedule {
  return normalizeSchedule({
    source: "manual",
    subscriptionId: "",
    externalUid: "",
    description: "",
    location: "",
    start: "2026-04-25T09:00:00",
    end: "2026-04-25T10:00:00",
    allDay: false,
    rrule: "",
    recurrenceId: "",
    createdAt: "2026-04-25T08:00:00",
    updatedAt: "2026-04-25T08:00:00",
    ...partial,
  });
}

function makeSubscriptionEvent(
  partial: Partial<Schedule> & Pick<Schedule, "id" | "title" | "subscriptionId">,
): Schedule {
  return normalizeSchedule({
    source: "subscription",
    externalUid: partial.id,
    description: "",
    location: "",
    start: "2026-04-25T09:00:00",
    end: "2026-04-25T10:00:00",
    allDay: false,
    rrule: "",
    recurrenceId: "",
    createdAt: "2026-04-25T08:00:00",
    updatedAt: "2026-04-25T08:00:00",
    ...partial,
  });
}

beforeEach(() => {
  resetDbCache();
  const db = getDb();
  db.exec("DELETE FROM schedules");
  db.exec("DELETE FROM calendar_subscriptions");
});

afterEach(() => {
  resetDbCache();
});

describe("manual schedule CRUD", () => {
  it("inserts and lists a manual schedule", () => {
    const s = makeManual({ id: "m1", title: "Meeting" });
    upsertManualSchedule(s);
    const all = loadSchedules();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe("m1");
    expect(all[0]?.title).toBe("Meeting");
    expect(all[0]?.source).toBe("manual");
  });

  it("updates a manual schedule's content while preserving identity", () => {
    upsertManualSchedule(makeManual({ id: "m1", title: "Old" }));
    upsertManualSchedule(makeManual({ id: "m1", title: "New", start: "2026-04-26T09:00:00", end: "2026-04-26T10:00:00" }));
    const all = loadManualSchedules();
    expect(all).toHaveLength(1);
    expect(all[0]?.title).toBe("New");
    expect(all[0]?.start).toBe("2026-04-26T09:00:00");
  });

  it("deletes only the requested manual schedule", () => {
    upsertManualSchedule(makeManual({ id: "m1", title: "A" }));
    upsertManualSchedule(makeManual({ id: "m2", title: "B" }));
    deleteManualSchedule("m1");
    const all = loadManualSchedules();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe("m2");
  });

  it("rejects non-manual source on upsertManualSchedule", () => {
    expect(() =>
      upsertManualSchedule(
        makeSubscriptionEvent({ id: "x1", title: "X", subscriptionId: "subA" }),
      ),
    ).toThrow();
  });
});

describe("subscription replacement isolation", () => {
  it("replaceSubscriptionSchedules('A', ...) does NOT touch subscription B's events", () => {
    const subA1 = makeSubscriptionEvent({ id: "a-1", title: "A1", subscriptionId: "subA" });
    const subA2 = makeSubscriptionEvent({ id: "a-2", title: "A2", subscriptionId: "subA" });
    const subB1 = makeSubscriptionEvent({ id: "b-1", title: "B1", subscriptionId: "subB" });
    const subB2 = makeSubscriptionEvent({ id: "b-2", title: "B2", subscriptionId: "subB" });

    replaceSubscriptionSchedules("subA", [subA1, subA2]);
    replaceSubscriptionSchedules("subB", [subB1, subB2]);

    const newSubA = makeSubscriptionEvent({
      id: "a-new",
      title: "A new",
      subscriptionId: "subA",
    });
    replaceSubscriptionSchedules("subA", [newSubA]);

    const all = loadSchedules();
    const aIds = all.filter((s) => s.subscriptionId === "subA").map((s) => s.id).sort();
    const bIds = all.filter((s) => s.subscriptionId === "subB").map((s) => s.id).sort();
    expect(aIds).toEqual(["a-new"]);
    expect(bIds).toEqual(["b-1", "b-2"]);
  });

  it("manual schedules survive a subscription purge", () => {
    upsertManualSchedule(makeManual({ id: "m1", title: "Keep me" }));
    const subEvent = makeSubscriptionEvent({
      id: "s1",
      title: "Subbed",
      subscriptionId: "subA",
    });
    replaceSubscriptionSchedules("subA", [subEvent]);

    deleteSchedulesBySubscription("subA");

    const all = loadSchedules();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe("m1");
    expect(all[0]?.source).toBe("manual");
  });

  it("manual schedules survive replaceSubscriptionSchedules with empty array", () => {
    upsertManualSchedule(makeManual({ id: "m1", title: "Manual" }));
    const subEvent = makeSubscriptionEvent({
      id: "s1",
      title: "Subbed",
      subscriptionId: "subA",
    });
    replaceSubscriptionSchedules("subA", [subEvent]);

    replaceSubscriptionSchedules("subA", []);

    const all = loadSchedules();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe("m1");
  });

  it("rejects mismatched subscriptionId in replaceSubscriptionSchedules", () => {
    const wrong = makeSubscriptionEvent({
      id: "x",
      title: "X",
      subscriptionId: "subB",
    });
    expect(() => replaceSubscriptionSchedules("subA", [wrong])).toThrow();
  });
});

describe("loadSchedules robustness", () => {
  it("skips rows with corrupt JSON without dropping valid rows", () => {
    upsertManualSchedule(makeManual({ id: "m1", title: "Good" }));
    const db = getDb();
    db.prepare(
      "INSERT INTO schedules (id, sort_order, source, subscription_id, external_uid, start_at, end_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("bad", 99, "manual", "", "", "2026-04-25T00:00:00", "2026-04-25T01:00:00", "{not json");

    const all = loadSchedules();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe("m1");
  });
});
