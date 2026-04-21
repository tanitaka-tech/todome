import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_DIR, getDbPath } from "../config.ts";
import { githubState } from "../state.ts";
import { DEFAULT_PROFILE } from "../storage/profile.ts";
import type {
  Goal,
  KanbanTask,
  Retrospective,
  RetroType,
  UserProfile,
} from "../types.ts";
import { extractDbAtCommit, GitHubSyncError } from "./cli.ts";

interface LabeledId {
  id: string;
  label: string;
}

interface DiffSection {
  added: LabeledId[];
  removed: LabeledId[];
  modified: LabeledId[];
}

interface DiffCounts {
  added: number;
  removed: number;
  modified: number;
}

interface DiffSummary {
  tasks: DiffCounts;
  goals: DiffCounts;
  retros: DiffCounts;
  profileChanged: boolean;
}

interface DiffDetails {
  tasks: DiffSection;
  goals: DiffSection;
  retros: DiffSection;
  profileChanged: boolean;
}

interface DiffResult {
  summary: DiffSummary;
  details: DiffDetails;
}

interface EntitySnapshot {
  tasks: KanbanTask[];
  goals: Goal[];
  retros: Retrospective[];
  profile: UserProfile;
}

function pickLabel(
  entity: Record<string, unknown>,
  labelKeys: readonly string[],
  fallback: string
): string {
  for (const k of labelKeys) {
    const val = entity[k];
    if (typeof val === "string" && val.trim()) return val.trim();
    if (typeof val === "number" && val) return String(val);
  }
  return fallback;
}

function diffEntitiesById<T extends { id: string }>(
  current: T[],
  target: T[],
  labelKeys: readonly string[]
): DiffSection {
  const byCurrent = new Map<string, T>();
  for (const e of current) {
    if (e.id) byCurrent.set(e.id, e);
  }
  const byTarget = new Map<string, T>();
  for (const e of target) {
    if (e.id) byTarget.set(e.id, e);
  }

  const added: LabeledId[] = [];
  const removed: LabeledId[] = [];
  const modified: LabeledId[] = [];

  for (const [tid, tval] of byTarget) {
    if (!byCurrent.has(tid)) {
      added.push({
        id: tid,
        label: pickLabel(tval as unknown as Record<string, unknown>, labelKeys, tid),
      });
    }
  }
  for (const [cid, cval] of byCurrent) {
    if (!byTarget.has(cid)) {
      removed.push({
        id: cid,
        label: pickLabel(cval as unknown as Record<string, unknown>, labelKeys, cid),
      });
    }
  }
  for (const [tid, tval] of byTarget) {
    const cval = byCurrent.get(tid);
    if (!cval) continue;
    if (JSON.stringify(cval) !== JSON.stringify(tval)) {
      modified.push({
        id: tid,
        label: pickLabel(tval as unknown as Record<string, unknown>, labelKeys, tid),
      });
    }
  }
  return { added, removed, modified };
}

function summarize(details: DiffDetails): DiffSummary {
  const counts = (s: DiffSection): DiffCounts => ({
    added: s.added.length,
    removed: s.removed.length,
    modified: s.modified.length,
  });
  return {
    tasks: counts(details.tasks),
    goals: counts(details.goals),
    retros: counts(details.retros),
    profileChanged: details.profileChanged,
  };
}

function tableExists(db: Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
  return row !== null && row !== undefined;
}

function loadEntitiesFromDb(dbPath: string): EntitySnapshot {
  const db = new Database(dbPath, { readonly: true });
  try {
    const tasks: KanbanTask[] = [];
    if (tableExists(db, "kanban_tasks")) {
      const rows = db
        .prepare("SELECT data FROM kanban_tasks ORDER BY sort_order")
        .all() as { data: string }[];
      for (const r of rows) {
        const t = JSON.parse(r.data) as KanbanTask & { kpiId?: string; kpiContributed?: boolean };
        t.kpiId ??= "";
        t.kpiContributed = Boolean(t.kpiContributed);
        tasks.push(t);
      }
    }

    let goals: Goal[] = [];
    if (tableExists(db, "goals")) {
      const rows = db
        .prepare("SELECT data FROM goals ORDER BY sort_order")
        .all() as { data: string }[];
      goals = rows.map((r) => JSON.parse(r.data) as Goal);
    }

    let profile: UserProfile = { ...DEFAULT_PROFILE };
    if (tableExists(db, "profile")) {
      const row = db
        .prepare("SELECT data FROM profile WHERE id = 1")
        .get() as { data: string } | undefined;
      if (row) profile = JSON.parse(row.data) as UserProfile;
    }

    const retros: Retrospective[] = [];
    if (tableExists(db, "retrospectives")) {
      const rows = db
        .prepare("SELECT * FROM retrospectives ORDER BY created_at DESC")
        .all() as {
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
      }[];
      for (const r of rows) {
        retros.push({
          id: r.id,
          type: r.type as RetroType,
          periodStart: r.period_start,
          periodEnd: r.period_end,
          document: JSON.parse(r.document),
          messages: JSON.parse(r.messages),
          aiComment: r.ai_comment ?? "",
          completedAt: r.completed_at ?? "",
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        });
      }
    }

    return { tasks, goals, retros, profile };
  } finally {
    db.close();
  }
}

export async function computeCommitDiff(
  commitHash: string
): Promise<DiffResult> {
  const cache = githubState.diffCache;
  const cached = cache.get(commitHash) as DiffResult | undefined;
  if (cached) return cached;

  const currentDb = getDbPath();
  if (!existsSync(currentDb)) {
    throw new GitHubSyncError("ローカル DB が見つかりません");
  }

  const tmp = mkdtempSync(join(tmpdir(), "todome-diff-"));
  try {
    const targetDb = join(tmp, `${commitHash}.db`);
    await extractDbAtCommit(REPO_DIR, commitHash, targetDb);
    const current = loadEntitiesFromDb(currentDb);
    const target = loadEntitiesFromDb(targetDb);
    const details: DiffDetails = {
      tasks: diffEntitiesById(current.tasks, target.tasks, ["title"]),
      goals: diffEntitiesById(current.goals, target.goals, ["name"]),
      retros: diffEntitiesById(current.retros, target.retros, [
        "periodEnd",
        "type",
      ]),
      profileChanged:
        JSON.stringify(current.profile) !== JSON.stringify(target.profile),
    };
    const result: DiffResult = { summary: summarize(details), details };
    cache.set(commitHash, result);
    return result;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
