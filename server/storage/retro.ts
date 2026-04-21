import { getDb } from "../db.ts";
import type { Retrospective, RetroDocument, RetroType } from "../types.ts";

interface Row {
  id: string;
  type: string;
  period_start: string;
  period_end: string;
  document: string;
  messages: string;
  ai_comment: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function migrateRetroDocument(doc: Record<string, unknown>): RetroDocument {
  const migrated: Record<string, unknown> = { ...doc };
  migrated.did ??= "";
  migrated.learned ??= "";
  migrated.next ??= "";
  delete migrated.completedTasks;

  if (migrated.dayRating === undefined) {
    const energy = doc.energy;
    migrated.dayRating = typeof energy === "number" ? Math.trunc(energy) : 0;
  }
  delete migrated.energy;

  migrated.wakeUpTime ??= "";
  migrated.bedtime ??= "";

  const legacyKeys = ["findings", "improvements", "idealState", "actions"] as const;
  if (legacyKeys.some((k) => k in doc)) {
    const findings = String(doc.findings ?? "").trim();
    const improvements = String(doc.improvements ?? "").trim();
    const idealState = String(doc.idealState ?? "").trim();
    const actions = String(doc.actions ?? "").trim();
    if (!migrated.learned && findings) migrated.learned = findings;
    const nextParts = [improvements, idealState, actions].filter(Boolean);
    if (!migrated.next && nextParts.length) migrated.next = nextParts.join("\n\n");
    for (const k of legacyKeys) delete migrated[k];
  }
  return migrated as unknown as RetroDocument;
}

function rowToRetro(row: Row): Retrospective {
  return {
    id: row.id,
    type: row.type as RetroType,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    document: migrateRetroDocument(JSON.parse(row.document)),
    messages: JSON.parse(row.messages),
    aiComment: row.ai_comment ?? "",
    completedAt: row.completed_at ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function loadRetros(): Retrospective[] {
  const rows = getDb()
    .prepare("SELECT * FROM retrospectives ORDER BY created_at DESC")
    .all() as Row[];
  return rows.map(rowToRetro);
}

export function getRetro(retroId: string): Retrospective | null {
  const row = getDb()
    .prepare("SELECT * FROM retrospectives WHERE id = ?")
    .get(retroId) as Row | undefined;
  return row ? rowToRetro(row) : null;
}

export function getRetroDraft(retroType: RetroType): Retrospective | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM retrospectives " +
        "WHERE type = ? AND (completed_at = '' OR completed_at IS NULL) " +
        "ORDER BY updated_at DESC LIMIT 1"
    )
    .get(retroType) as Row | undefined;
  return row ? rowToRetro(row) : null;
}

export function saveRetro(retro: Retrospective): void {
  getDb()
    .prepare(
      "INSERT INTO retrospectives " +
        "(id, type, period_start, period_end, document, messages, ai_comment, completed_at, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET " +
        "  type = excluded.type, " +
        "  period_start = excluded.period_start, " +
        "  period_end = excluded.period_end, " +
        "  document = excluded.document, " +
        "  messages = excluded.messages, " +
        "  ai_comment = excluded.ai_comment, " +
        "  completed_at = excluded.completed_at, " +
        "  updated_at = excluded.updated_at"
    )
    .run(
      retro.id,
      retro.type,
      retro.periodStart,
      retro.periodEnd,
      JSON.stringify(retro.document),
      JSON.stringify(retro.messages),
      retro.aiComment ?? "",
      retro.completedAt ?? "",
      retro.createdAt,
      retro.updatedAt
    );
}

export function deleteRetroById(retroId: string): void {
  getDb().prepare("DELETE FROM retrospectives WHERE id = ?").run(retroId);
}
