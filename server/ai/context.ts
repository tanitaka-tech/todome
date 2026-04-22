import type {
  Goal,
  KanbanTask,
  LifeActivity,
  LifeLog,
  Quota,
  QuotaLog,
  UserProfile,
} from "../types.ts";

export function buildProfileContext(profile: UserProfile): string {
  const lines: string[] = [];
  if (profile.currentState) {
    lines.push("=== ユーザーについて ===");
    lines.push(`現在の状態: ${profile.currentState}`);
  }

  const bw = profile.balanceWheel ?? [];
  if (bw.length) {
    lines.push("\nバランスホイール（各領域の現在の充実度 1-10）:");
    for (const cat of bw) {
      const icon = cat.icon ? `${cat.icon} ` : "";
      if (typeof cat.score === "number") {
        lines.push(`  - ${icon}${cat.name}: ${Math.trunc(cat.score)}/10`);
      } else {
        lines.push(`  - ${icon}${cat.name}`);
      }
    }
  }

  const principles = (profile.actionPrinciples ?? [])
    .map((p) => p.text)
    .filter((t): t is string => Boolean(t));
  if (principles.length) {
    lines.push("\n心がけたい行動指針:");
    for (const p of principles) lines.push(`  - ${p}`);
  }

  const wants = (profile.wantToDo ?? [])
    .map((w) => w.text)
    .filter((t): t is string => Boolean(t));
  if (wants.length) {
    lines.push("\nやりたいこと:");
    for (const w of wants) lines.push(`  - ${w}`);
  }

  return lines.join("\n");
}

export function buildBoardContext(tasks: KanbanTask[], goals: Goal[]): string {
  const goalMap = new Map(goals.map((g) => [g.id, g]));
  const cols: Record<string, KanbanTask[]> = { todo: [], in_progress: [], done: [] };
  for (const t of tasks) {
    (cols[t.column] ??= []).push(t);
  }
  const lines: string[] = ["=== 現在のカンバンボード ==="];
  const labels: Record<string, string> = {
    todo: "TODO",
    in_progress: "進行中",
    done: "完了",
  };
  for (const colKey of ["todo", "in_progress", "done"] as const) {
    lines.push(`\n【${labels[colKey]}】`);
    for (const t of cols[colKey] ?? []) {
      const memoNote = t.memo ? `  メモ: ${t.memo}` : "";
      const goalNote = t.goalId && goalMap.has(t.goalId)
        ? `  目標: ${goalMap.get(t.goalId)!.name}`
        : "";
      lines.push(`  - ${t.title}${memoNote}${goalNote}`);
    }
  }

  lines.push("\n=== 目標一覧 ===");
  if (goals.length) {
    for (const g of goals) {
      const status = g.achieved ? " [達成済み]" : "";
      lines.push(`\n  目標名: ${g.name}${status}  (id: ${g.id})`);
      if (g.deadline) lines.push(`    期日: ${g.deadline}`);
      if (g.achieved && g.achievedAt) lines.push(`    達成日: ${g.achievedAt.slice(0, 10)}`);
      if (g.memo) lines.push(`    メモ: ${g.memo}`);
      if (g.repository) lines.push(`    リポジトリ: ${g.repository}`);
      for (const kpi of g.kpis ?? []) {
        const unitSuffix = kpi.unit === "percent" ? "%" : "";
        const target = kpi.targetValue || 0;
        const current = kpi.currentValue || 0;
        const pct = target ? Math.min(100, (current / target) * 100) : 0;
        lines.push(
          `    KPI: ${kpi.name} ${current}${unitSuffix} / ${target}${unitSuffix} (${pct.toFixed(0)}%)`
        );
      }
    }
  } else {
    lines.push("  (なし)");
  }
  return lines.join("\n");
}

export interface TimelineContextInput {
  nowMs: number;
  rangeStartMs: number;
  rangeEndMs: number;
  tasks: KanbanTask[];
  lifeActivities: LifeActivity[];
  lifeLogs: LifeLog[];
  quotas: Quota[];
  quotaLogs: QuotaLog[];
}

interface TimelineEntry {
  startMs: number;
  endMs: number;
  kind: "task" | "life" | "quota";
  label: string;
  active: boolean;
}

function formatHhMm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatMinutes(seconds: number): string {
  const min = Math.max(0, Math.floor(seconds / 60));
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

function overlaps(start: number, end: number, rangeStart: number, rangeEnd: number): boolean {
  return end > rangeStart && start < rangeEnd;
}

export function buildTimelineContext(input: TimelineContextInput): string {
  const {
    nowMs,
    rangeStartMs,
    rangeEndMs,
    tasks,
    lifeActivities,
    lifeLogs,
    quotas,
    quotaLogs,
  } = input;

  const entries: TimelineEntry[] = [];

  for (const task of tasks) {
    for (const log of task.timeLogs ?? []) {
      const s = Date.parse(log.start);
      const e = Date.parse(log.end);
      if (Number.isNaN(s) || Number.isNaN(e)) continue;
      if (!overlaps(s, e, rangeStartMs, rangeEndMs)) continue;
      entries.push({
        startMs: Math.max(s, rangeStartMs),
        endMs: Math.min(e, rangeEndMs),
        kind: "task",
        label: task.title,
        active: false,
      });
    }
    if (task.timerStartedAt) {
      const s = Date.parse(task.timerStartedAt);
      if (!Number.isNaN(s) && overlaps(s, nowMs, rangeStartMs, rangeEndMs)) {
        entries.push({
          startMs: Math.max(s, rangeStartMs),
          endMs: Math.min(nowMs, rangeEndMs),
          kind: "task",
          label: task.title,
          active: true,
        });
      }
    }
  }

  const activityMap = new Map(lifeActivities.map((a) => [a.id, a]));
  for (const log of lifeLogs) {
    const s = Date.parse(log.startedAt);
    const e = log.endedAt ? Date.parse(log.endedAt) : nowMs;
    if (Number.isNaN(s) || Number.isNaN(e)) continue;
    if (!overlaps(s, e, rangeStartMs, rangeEndMs)) continue;
    const activity = activityMap.get(log.activityId);
    const label = activity ? `${activity.icon} ${activity.name}` : log.activityId;
    entries.push({
      startMs: Math.max(s, rangeStartMs),
      endMs: Math.min(e, rangeEndMs),
      kind: "life",
      label,
      active: !log.endedAt,
    });
  }

  const quotaMap = new Map(quotas.map((q) => [q.id, q]));
  for (const log of quotaLogs) {
    const s = Date.parse(log.startedAt);
    const e = log.endedAt ? Date.parse(log.endedAt) : nowMs;
    if (Number.isNaN(s) || Number.isNaN(e)) continue;
    if (!overlaps(s, e, rangeStartMs, rangeEndMs)) continue;
    const quota = quotaMap.get(log.quotaId);
    const label = quota ? `${quota.icon} ${quota.name}` : log.quotaId;
    entries.push({
      startMs: Math.max(s, rangeStartMs),
      endMs: Math.min(e, rangeEndMs),
      kind: "quota",
      label,
      active: !log.endedAt,
    });
  }

  entries.sort((a, b) => a.startMs - b.startMs);

  const kindLabels: Record<TimelineEntry["kind"], string> = {
    task: "タスク",
    life: "ライフログ",
    quota: "ノルマ",
  };

  const lines: string[] = ["=== 今日のタイムスケジュール ==="];
  lines.push(`現在時刻: ${formatHhMm(nowMs)}`);

  if (entries.length === 0) {
    lines.push("  (今日はまだ計測されていません)");
  } else {
    for (const entry of entries) {
      const range = `${formatHhMm(entry.startMs)}–${formatHhMm(entry.endMs)}`;
      const durSec = Math.max(0, Math.floor((entry.endMs - entry.startMs) / 1000));
      const activeMark = entry.active ? " [計測中]" : "";
      lines.push(
        `  - [${kindLabels[entry.kind]}] ${range} (${formatMinutes(durSec)}) ${entry.label}${activeMark}`
      );
    }
  }

  const activeQuotas = quotas.filter((q) => !q.archived);
  if (activeQuotas.length) {
    const doneByQuota = new Map<string, number>();
    for (const log of quotaLogs) {
      const s = Date.parse(log.startedAt);
      const e = log.endedAt ? Date.parse(log.endedAt) : nowMs;
      if (Number.isNaN(s) || Number.isNaN(e)) continue;
      const ss = Math.max(s, rangeStartMs);
      const ee = Math.min(e, rangeEndMs);
      if (ee <= ss) continue;
      doneByQuota.set(log.quotaId, (doneByQuota.get(log.quotaId) ?? 0) + (ee - ss) / 1000);
    }
    lines.push("\n【ノルマ達成状況 (今日)】");
    for (const quota of activeQuotas) {
      const doneSec = doneByQuota.get(quota.id) ?? 0;
      const targetSec = quota.targetMinutes * 60;
      const achieved = targetSec > 0 && doneSec >= targetSec ? " ✓達成" : "";
      lines.push(
        `  - ${quota.icon} ${quota.name}: ${formatMinutes(doneSec)} / ${quota.targetMinutes}分${achieved}`
      );
    }
  }

  return lines.join("\n");
}
