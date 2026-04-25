import holidayJp from "@holiday-jp/holiday_jp";

interface HolidayEntry {
  date: string;
  name: string;
}

const holidaysMap = (
  holidayJp as unknown as { holidays: Record<string, HolidayEntry> }
).holidays;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function localKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function getHolidayName(date: Date): string | undefined {
  return holidaysMap[localKey(date)]?.name;
}

export function isDayOff(date: Date): boolean {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return true;
  return getHolidayName(date) !== undefined;
}
