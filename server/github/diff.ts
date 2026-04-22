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
  LifeActivity,
  LifeLog,
  Quota,
  QuotaLog,
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
  lifeActivities: DiffCounts;
  lifeLogs: DiffCounts;
  quotas: DiffCounts;
  quotaLogs: DiffCounts;
  profileChanged: boolean;
}

interface DiffDetails {
  tasks: DiffSection;
  goals: DiffSection;
  retros: DiffSection;
  lifeActivities: DiffSection;
  lifeLogs: DiffSection;
  quotas: DiffSection;
  quotaLogs: DiffSection;
  profileChanged: boolean;
}

interface DiffResult {
  summary: DiffSummary;
  details: DiffDetails;
}

export interface EntitySnapshot {
  tasks: KanbanTask[];
  goals: Goal[];
  retros: Retrospective[];
  lifeActivities: LifeActivity[];
  lifeLogs: LifeLog[];
  quotas: Quota[];
  quotaLogs: QuotaLog[];
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
    lifeActivities: counts(details.lifeActivities),
    lifeLogs: counts(details.lifeLogs),
    quotas: counts(details.quotas),
    quotaLogs: counts(details.quotaLogs),
    profileChanged: details.profileChanged,
  };
}

function tableExists(db: Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
  return row !== null && row !== undefined;
}

function loadEntitiesFromDb(dbPath: string, isSnapshot: boolean): EntitySnapshot {
  // readonly + WAL journal モードの DB を -wal/-shm 無しで開こうとすると
  // SQLITE_CANTOPEN になる (git show で抽出した snapshot には wal/shm が付かない)。
  // snapshot は immutable=1 を付けて「変更されない」と明示することで付随ファイルを
  // 要求させない。本番 DB (現在も書き込み中) には付けないこと: 付けると writer の
  // 更新が読めなくなる。
  const dbArg = isSnapshot ? `file:${dbPath}?immutable=1` : dbPath;
  const db = new Database(dbArg, { readonly: true });
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

    let lifeActivities: LifeActivity[] = [];
    if (tableExists(db, "life_activities")) {
      const rows = db
        .prepare("SELECT data FROM life_activities ORDER BY sort_order")
        .all() as { data: string }[];
      lifeActivities = rows.map((r) => JSON.parse(r.data) as LifeActivity);
    }

    const lifeLogs: LifeLog[] = [];
    if (tableExists(db, "life_logs")) {
      const rows = db
        .prepare("SELECT * FROM life_logs ORDER BY started_at ASC")
        .all() as {
        id: string;
        activity_id: string;
        started_at: string;
        ended_at: string | null;
        memo: string | null;
        alert_triggered: string | null;
      }[];
      for (const r of rows) {
        lifeLogs.push({
          id: r.id,
          activityId: r.activity_id,
          startedAt: r.started_at,
          endedAt: r.ended_at ?? "",
          memo: r.memo ?? "",
          alertTriggered: (r.alert_triggered ?? "") as LifeLog["alertTriggered"],
        });
      }
    }

    let quotas: Quota[] = [];
    if (tableExists(db, "quotas")) {
      const rows = db
        .prepare("SELECT data FROM quotas ORDER BY sort_order")
        .all() as { data: string }[];
      quotas = rows.map((r) => JSON.parse(r.data) as Quota);
    }

    const quotaLogs: QuotaLog[] = [];
    if (tableExists(db, "quota_logs")) {
      const rows = db
        .prepare("SELECT * FROM quota_logs ORDER BY started_at ASC")
        .all() as {
        id: string;
        quota_id: string;
        started_at: string;
        ended_at: string | null;
        memo: string | null;
      }[];
      for (const r of rows) {
        quotaLogs.push({
          id: r.id,
          quotaId: r.quota_id,
          startedAt: r.started_at,
          endedAt: r.ended_at ?? "",
          memo: r.memo ?? "",
        });
      }
    }

    return { tasks, goals, retros, lifeActivities, lifeLogs, quotas, quotaLogs, profile };
  } finally {
    db.close();
  }
}

function pickLogLabel(
  log: { startedAt: string; endedAt: string },
  ownerName: string | undefined,
  fallback: string,
): string {
  const start = log.startedAt ? log.startedAt.slice(0, 16).replace("T", " ") : "";
  if (ownerName && start) return `${ownerName} ${start}`;
  if (ownerName) return ownerName;
  if (start) return start;
  return fallback;
}

function diffLogsById<T extends { id: string; startedAt: string; endedAt: string }>(
  current: T[],
  target: T[],
  ownerKey: keyof T,
  ownerNames: Map<string, string>,
): DiffSection {
  const byCurrent = new Map<string, T>();
  for (const e of current) if (e.id) byCurrent.set(e.id, e);
  const byTarget = new Map<string, T>();
  for (const e of target) if (e.id) byTarget.set(e.id, e);

  const added: LabeledId[] = [];
  const removed: LabeledId[] = [];
  const modified: LabeledId[] = [];

  for (const [tid, tval] of byTarget) {
    if (!byCurrent.has(tid)) {
      const ownerId = String(tval[ownerKey] ?? "");
      added.push({
        id: tid,
        label: pickLogLabel(tval, ownerNames.get(ownerId), tid),
      });
    }
  }
  for (const [cid, cval] of byCurrent) {
    if (!byTarget.has(cid)) {
      const ownerId = String(cval[ownerKey] ?? "");
      removed.push({
        id: cid,
        label: pickLogLabel(cval, ownerNames.get(ownerId), cid),
      });
    }
  }
  for (const [tid, tval] of byTarget) {
    const cval = byCurrent.get(tid);
    if (!cval) continue;
    if (JSON.stringify(cval) !== JSON.stringify(tval)) {
      const ownerId = String(tval[ownerKey] ?? "");
      modified.push({
        id: tid,
        label: pickLogLabel(tval, ownerNames.get(ownerId), tid),
      });
    }
  }
  return { added, removed, modified };
}

function buildOwnerNameMap<T extends { id: string; name: string }>(
  current: T[],
  target: T[],
): Map<string, string> {
  const map = new Map<string, string>();
  // target を優先しつつ current の名前でも補完 (restore 後に失われるものにも対応できるよう両方)
  for (const e of current) if (e.id) map.set(e.id, e.name);
  for (const e of target) if (e.id) map.set(e.id, e.name);
  return map;
}

export async function computeCommitDiff(
  commitHash: string
): Promise<DiffResult> {
  const currentDb = getDbPath();
  if (!existsSync(currentDb)) {
    throw new GitHubSyncError("ローカル DB が見つかりません");
  }

  // target は commit hash で一意に決まる (git commit は immutable) のでキャッシュしてよい。
  // 一方 current は DB 書き込みで常に変わるため、差分結果そのものをキャッシュすると
  // push 直後の「差分ゼロ」が居座って以降の編集が UI に反映されなくなる。
  const cache = githubState.diffCache;
  let target = cache.get(commitHash) as EntitySnapshot | undefined;
  if (!target) {
    const tmp = mkdtempSync(join(tmpdir(), "todome-diff-"));
    try {
      const targetDb = join(tmp, `${commitHash}.db`);
      await extractDbAtCommit(REPO_DIR, commitHash, targetDb);
      target = loadEntitiesFromDb(targetDb, true);
      cache.set(commitHash, target);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  const current = loadEntitiesFromDb(currentDb, false);
  const activityNames = buildOwnerNameMap(
    current.lifeActivities,
    target.lifeActivities,
  );
  const quotaNames = buildOwnerNameMap(current.quotas, target.quotas);
  const details: DiffDetails = {
    tasks: diffEntitiesById(current.tasks, target.tasks, ["title"]),
    goals: diffEntitiesById(current.goals, target.goals, ["name"]),
    retros: diffEntitiesById(current.retros, target.retros, [
      "periodEnd",
      "type",
    ]),
    lifeActivities: diffEntitiesById(
      current.lifeActivities,
      target.lifeActivities,
      ["name"],
    ),
    lifeLogs: diffLogsById(
      current.lifeLogs,
      target.lifeLogs,
      "activityId",
      activityNames,
    ),
    quotas: diffEntitiesById(current.quotas, target.quotas, ["name"]),
    quotaLogs: diffLogsById(
      current.quotaLogs,
      target.quotaLogs,
      "quotaId",
      quotaNames,
    ),
    profileChanged:
      JSON.stringify(current.profile) !== JSON.stringify(target.profile),
  };
  return { summary: summarize(details), details };
}
