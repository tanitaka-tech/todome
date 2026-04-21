import { formatLocalIso } from "./time.ts";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayBoundaryIsoDate(
  boundaryHour: number,
  now: Date = new Date(),
): string {
  const d = new Date(now);
  if (d.getHours() < boundaryHour) d.setDate(d.getDate() - 1);
  return ymd(d);
}

export interface BoundaryRange {
  startIso: string;
  endIso: string;
}

export function dayRangeForBoundary(
  dateIso: string,
  boundaryHour: number,
): BoundaryRange {
  const parts = dateIso.split("-").map((v) => parseInt(v, 10));
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const start = new Date(y, m - 1, d, boundaryHour, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: formatLocalIso(start), endIso: formatLocalIso(end) };
}

export function dayKeyFromIsoWithBoundary(
  iso: string,
  boundaryHour: number,
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getHours() < boundaryHour) d.setDate(d.getDate() - 1);
  return ymd(d);
}

export function nextBoundaryAfter(d: Date, boundaryHour: number): Date {
  const next = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    boundaryHour,
    0,
    0,
    0,
  );
  if (next.getTime() <= d.getTime()) next.setDate(next.getDate() + 1);
  return next;
}
