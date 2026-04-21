import type { Goal, KanbanTask, UserProfile } from "../types.ts";

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
