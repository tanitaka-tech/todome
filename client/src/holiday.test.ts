import { describe, expect, it } from "vitest";
import { getHolidayName, isDayOff } from "./holiday";

describe("isDayOff / getHolidayName", () => {
  it("平日は休みではない", () => {
    const d = new Date(2026, 3, 27); // 2026-04-27 月
    expect(isDayOff(d)).toBe(false);
    expect(getHolidayName(d)).toBeUndefined();
  });

  it("土曜は休み", () => {
    const d = new Date(2026, 3, 25); // 2026-04-25 土
    expect(isDayOff(d)).toBe(true);
  });

  it("日曜は休み", () => {
    const d = new Date(2026, 3, 26); // 2026-04-26 日
    expect(isDayOff(d)).toBe(true);
  });

  it("平日の祝日は休みで祝日名を返す", () => {
    const d = new Date(2026, 4, 4); // 2026-05-04 月 みどりの日
    expect(isDayOff(d)).toBe(true);
    expect(getHolidayName(d)).toBe("みどりの日");
  });

  it("振替休日も休み", () => {
    const d = new Date(2026, 4, 6); // 2026-05-06 水 こどもの日 振替休日
    expect(isDayOff(d)).toBe(true);
    expect(getHolidayName(d)).toBe("こどもの日 振替休日");
  });

  it("土曜と祝日が重なる日も祝日名を返す", () => {
    const d = new Date(2025, 4, 3); // 2025-05-03 土 憲法記念日
    expect(isDayOff(d)).toBe(true);
    expect(getHolidayName(d)).toBe("憲法記念日");
  });
});
