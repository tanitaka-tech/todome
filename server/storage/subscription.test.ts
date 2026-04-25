import { describe, expect, test } from "bun:test";
import { normalizeSubscription } from "./subscription.ts";

describe("normalizeSubscription provider isolation", () => {
  test("provider=ics: caldavCalendarId / googleCalendarId default to empty", () => {
    const s = normalizeSubscription({
      id: "s1",
      name: "Public iCal",
      url: "https://example.com/foo.ics",
    });
    expect(s.provider).toBe("ics");
    expect(s.caldavCalendarId).toBe("");
    expect(s.googleCalendarId).toBe("");
    expect(s.googleAccountId).toBe("");
  });

  test("provider=caldav preserves caldavCalendarId without leaking google fields", () => {
    const s = normalizeSubscription({
      id: "s1",
      name: "Home",
      url: "https://p123-caldav.icloud.com/.../home/",
      provider: "caldav",
      caldavCalendarId: "Home (123)",
    });
    expect(s.provider).toBe("caldav");
    expect(s.caldavCalendarId).toBe("Home (123)");
    expect(s.googleCalendarId).toBe("");
  });

  test("provider=google preserves googleCalendarId without leaking caldav fields", () => {
    const s = normalizeSubscription({
      id: "s2",
      name: "Work",
      url: "google:work@example.com",
      provider: "google",
      googleCalendarId: "work@example.com",
      googleAccountId: "me@example.com",
    });
    expect(s.provider).toBe("google");
    expect(s.googleCalendarId).toBe("work@example.com");
    expect(s.googleAccountId).toBe("me@example.com");
    expect(s.caldavCalendarId).toBe("");
  });

  test("a payload with both provider fields keeps both values (no cross-clobber)", () => {
    const s = normalizeSubscription({
      id: "s3",
      name: "X",
      url: "u",
      provider: "google",
      caldavCalendarId: "leftover-from-old-shape",
      googleCalendarId: "primary",
    });
    expect(s.provider).toBe("google");
    expect(s.googleCalendarId).toBe("primary");
    // 既存の caldav フィールドが入っていても、normalize は黙って保持する。
    // （データ移行の隙間で同一レコードに両方混ざっても破壊しないことの保証）
    expect(s.caldavCalendarId).toBe("leftover-from-old-shape");
  });

  test("unknown provider string falls back to ics", () => {
    const s = normalizeSubscription({
      id: "s4",
      name: "Y",
      url: "u",
      // @ts-expect-error: 未知プロバイダの fallback テスト
      provider: "outlook",
    });
    expect(s.provider).toBe("ics");
  });
});
