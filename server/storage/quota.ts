import { getDb } from "../db.ts";
import { shortId } from "../utils/shortId.ts";
import { nowLocalIso as nowIso } from "../utils/time.ts";
import type { Quota, QuotaLog, QuotaStreak } from "../types.ts";

const DEFAULT_QUOTAS: Omit<Quota, "id" | "archived" | "createdAt">[] = [
  { name: "掃除", icon: "🧹", targetMinutes: 15 },
  { name: "運動", icon: "🏃", targetMinutes: 30 },
  { name: "料理", icon: "🍳", targetMinutes: 30 },
];

export function normalizeQuota(raw: Partial<Quota> & Record<string, unknown>): Quota {
  const target = Math.max(0, Math.trunc(Number(raw.targetMinutes) || 0));
  const name = String(raw.name ?? "").trim() || "未命名ノルマ";
  const icon = String(raw.icon ?? "").trim() || "🎯";
  const createdAt = String(raw.createdAt ?? "") || nowIso();
  return {
    id: raw.id || shortId(),
    name,
    icon,
    targetMinutes: target,
    archived: Boolean(raw.archived),
    createdAt,
  };
}

interface QuotaRow {
  data: string;
}

export function loadQuotas(): Quota[] {
  const rows = getDb()
    .prepare("SELECT data FROM quotas ORDER BY sort_order")
    .all() as QuotaRow[];
  if (rows.length === 0) {
    const defaults = DEFAULT_QUOTAS.map((q) => normalizeQuota(q));
    saveQuotas(defaults);
    return defaults;
  }
  return rows.map((r) => normalizeQuota(JSON.parse(r.data)));
}

export function saveQuotas(quotas: Quota[]): void {
  const db = getDb();
  const del = db.prepare("DELETE FROM quotas");
  const ins = db.prepare("INSERT INTO quotas (id, sort_order, data) VALUES (?, ?, ?)");
  const tx = db.transaction((items: Quota[]) => {
    del.run();
    items.forEach((q, i) => ins.run(q.id, i, JSON.stringify(q)));
  });
  tx(quotas);
}

interface LogRow {
  id: string;
  quota_id: string;
  started_at: string;
  ended_at: string | null;
  memo: string | null;
}

function logRowToDict(row: LogRow): QuotaLog {
  return {
    id: row.id,
    quotaId: row.quota_id,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? "",
    memo: row.memo ?? "",
  };
}

function todayIsoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function loadTodayQuotaLogs(todayIso?: string): QuotaLog[] {
  const day = todayIso ?? todayIsoDate();
  const rows = getDb()
    .prepare(
      "SELECT * FROM quota_logs WHERE substr(started_at, 1, 10) = ? ORDER BY started_at ASC"
    )
    .all(day) as LogRow[];
  return rows.map(logRowToDict);
}

export function loadAllQuotaLogs(): QuotaLog[] {
  const rows = getDb()
    .prepare("SELECT * FROM quota_logs ORDER BY started_at ASC")
    .all() as LogRow[];
  return rows.map(logRowToDict);
}

export function loadQuotaLogsInRange(startIso: string, endIso: string): QuotaLog[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM quota_logs " +
        "WHERE started_at < ? AND (ended_at = '' OR ended_at > ?) " +
        "ORDER BY started_at ASC"
    )
    .all(endIso, startIso) as LogRow[];
  return rows.map(logRowToDict);
}

export function stopActiveQuotaLogIfAny(): string {
  const now = nowIso();
  const db = getDb();
  const row = db
    .prepare("SELECT id FROM quota_logs WHERE ended_at = '' LIMIT 1")
    .get() as { id: string } | undefined;
  if (!row) return "";
  db.prepare("UPDATE quota_logs SET ended_at = ? WHERE ended_at = ''").run(now);
  return row.id;
}

export function startQuotaLog(quotaId: string): QuotaLog {
  const now = nowIso();
  const db = getDb();
  db.prepare("UPDATE quota_logs SET ended_at = ? WHERE ended_at = ''").run(now);
  const id = shortId();
  db.prepare(
    "INSERT INTO quota_logs (id, quota_id, started_at) VALUES (?, ?, ?)"
  ).run(id, quotaId, now);
  const row = db.prepare("SELECT * FROM quota_logs WHERE id = ?").get(id) as LogRow;
  return logRowToDict(row);
}

export function stopQuotaLog(logId: string, memo?: string): QuotaLog | null {
  const now = nowIso();
  const db = getDb();
  if (memo === undefined) {
    db.prepare(
      "UPDATE quota_logs SET ended_at = ? WHERE id = ? AND ended_at = ''"
    ).run(now, logId);
  } else {
    db.prepare(
      "UPDATE quota_logs SET ended_at = ?, memo = ? WHERE id = ? AND ended_at = ''"
    ).run(now, memo, logId);
  }
  const row = db.prepare("SELECT * FROM quota_logs WHERE id = ?").get(logId) as
    | LogRow
    | undefined;
  return row ? logRowToDict(row) : null;
}

function parseIsoLocal(iso: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function computeQuotaDayTotals(
  logs: QuotaLog[],
  now: Date = new Date()
): Record<string, Record<string, number>> {
  const totals: Record<string, Record<string, number>> = {};
  for (const log of logs) {
    const qid = log.quotaId;
    const start = parseIsoLocal(log.startedAt);
    if (!qid || !start) continue;
    const end = log.endedAt ? parseIsoLocal(log.endedAt) ?? now : now;
    if (end.getTime() <= start.getTime()) continue;
    let cursor = start;
    while (cursor < end) {
      const dayEnd = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate() + 1,
        0,
        0,
        0,
        0
      );
      const segEnd = dayEnd < end ? dayEnd : end;
      const seconds = Math.floor((segEnd.getTime() - cursor.getTime()) / 1000);
      if (seconds > 0) {
        const key = ymd(cursor);
        (totals[qid] ??= {})[key] = (totals[qid]![key] ?? 0) + seconds;
      }
      cursor = segEnd;
    }
  }
  return totals;
}

export function computeQuotaStreak(
  dayTotals: Record<string, number>,
  targetSeconds: number,
  todayIso: string
): { current: number; best: number; lastAchievedDate: string } {
  if (targetSeconds <= 0) return { current: 0, best: 0, lastAchievedDate: "" };
  const achieved = Object.entries(dayTotals)
    .filter(([, s]) => s >= targetSeconds)
    .map(([d]) => d)
    .sort();
  if (achieved.length === 0) return { current: 0, best: 0, lastAchievedDate: "" };

  let best = 1;
  let run = 1;
  for (let i = 1; i < achieved.length; i++) {
    const prev = new Date(`${achieved[i - 1]}T00:00:00`);
    const cur = new Date(`${achieved[i]}T00:00:00`);
    const diff = Math.round((cur.getTime() - prev.getTime()) / 86400000);
    if (diff === 1) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 1;
    }
  }
  const last = achieved[achieved.length - 1]!;
  const today = new Date(`${todayIso}T00:00:00`);
  const lastDate = new Date(`${last}T00:00:00`);
  if (Number.isNaN(today.getTime()) || Number.isNaN(lastDate.getTime())) {
    return { current: 0, best, lastAchievedDate: last };
  }
  const gap = Math.round((today.getTime() - lastDate.getTime()) / 86400000);
  if (gap > 1) return { current: 0, best, lastAchievedDate: last };

  let current = 1;
  let cursor = lastDate;
  for (let i = achieved.length - 2; i >= 0; i--) {
    const prev = new Date(`${achieved[i]}T00:00:00`);
    const diff = Math.round((cursor.getTime() - prev.getTime()) / 86400000);
    if (diff === 1) {
      current += 1;
      cursor = prev;
    } else {
      break;
    }
  }
  return { current, best: Math.max(best, current), lastAchievedDate: last };
}

export function computeAllQuotaStreaks(
  quotas: Quota[],
  logs: QuotaLog[],
  todayIso?: string
): QuotaStreak[] {
  const today = todayIso ?? todayIsoDate();
  const totals = computeQuotaDayTotals(logs);
  return quotas.map((q) => {
    const target = Math.max(0, Math.trunc(q.targetMinutes)) * 60;
    const s = computeQuotaStreak(totals[q.id] ?? {}, target, today);
    return {
      quotaId: q.id,
      current: s.current,
      best: s.best,
      lastAchievedDate: s.lastAchievedDate,
    };
  });
}
