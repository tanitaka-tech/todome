import type { Goal, KanbanTask, RetroDocument, RetroType, Retrospective, UserProfile } from "../types.ts";
import { buildProfileContext } from "./context.ts";

export const RETRO_TYPES: readonly RetroType[] = ["daily", "weekly", "monthly", "yearly"];
export const RETRO_TYPE_LABEL: Record<RetroType, string> = {
  daily: "日次振り返り",
  weekly: "週次振り返り",
  monthly: "月次振り返り",
  yearly: "年次振り返り",
};

export const RETRO_DOC_TAG_OPEN = "<retrodoc>";
export const RETRO_DOC_TAG_CLOSE = "</retrodoc>";

export const RETRO_DOC_TEXT_KEYS = ["did", "learned", "next"] as const;
export const RETRO_DOC_TIME_KEYS = ["wakeUpTime", "bedtime"] as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function computeRetroPeriod(
  retroType: RetroType,
  today?: Date
): { start: string; end: string } {
  const d = today ? new Date(today) : new Date();
  d.setHours(0, 0, 0, 0);
  if (retroType === "daily") {
    return { start: isoDate(d), end: isoDate(d) };
  }
  if (retroType === "weekly") {
    const dow = d.getDay();
    const offsetFromMonday = (dow + 6) % 7;
    const start = new Date(d);
    start.setDate(d.getDate() - offsetFromMonday);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start: isoDate(start), end: isoDate(end) };
  }
  if (retroType === "monthly") {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { start: isoDate(start), end: isoDate(end) };
  }
  if (retroType === "yearly") {
    return {
      start: `${d.getFullYear()}-01-01`,
      end: `${d.getFullYear()}-12-31`,
    };
  }
  return { start: isoDate(d), end: isoDate(d) };
}

export function completedTaskIdsInPeriod(
  tasks: KanbanTask[],
  periodStart: string,
  periodEnd: string
): string[] {
  const startDt = new Date(`${periodStart}T00:00:00`);
  const endDt = new Date(`${periodEnd}T23:59:59`);
  if (Number.isNaN(startDt.getTime()) || Number.isNaN(endDt.getTime())) return [];
  const result: string[] = [];
  for (const t of tasks) {
    if (t.column !== "done") continue;
    const completedAt = t.completedAt;
    if (!completedAt) continue;
    const cleaned = completedAt.replace("Z", "").slice(0, 19);
    const cdt = new Date(cleaned);
    if (Number.isNaN(cdt.getTime())) continue;
    if (cdt >= startDt && cdt <= endDt) result.push(t.id);
  }
  return result;
}

export function stripRetrodocBlock(
  text: string
): { cleaned: string; parsed: Record<string, unknown> | null } {
  const start = text.indexOf(RETRO_DOC_TAG_OPEN);
  if (start === -1) return { cleaned: text, parsed: null };
  const end = text.indexOf(RETRO_DOC_TAG_CLOSE, start);
  if (end === -1) return { cleaned: text, parsed: null };
  const payload = text.slice(start + RETRO_DOC_TAG_OPEN.length, end).trim();
  const cleaned = (text.slice(0, start) + text.slice(end + RETRO_DOC_TAG_CLOSE.length)).trim();
  try {
    const parsed = JSON.parse(payload);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { cleaned, parsed: parsed as Record<string, unknown> };
    }
    return { cleaned, parsed: null };
  } catch {
    return { cleaned, parsed: null };
  }
}

export function isValidHHMM(value: unknown): boolean {
  if (typeof value !== "string" || value.length !== 5 || value[2] !== ":") return false;
  const h = Number(value.slice(0, 2));
  const m = Number(value.slice(3, 5));
  if (!Number.isInteger(h) || !Number.isInteger(m)) return false;
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function mergeRetroDocument(
  current: RetroDocument,
  updates: Record<string, unknown>
): RetroDocument {
  const merged: RetroDocument = { ...current };
  for (const key of RETRO_DOC_TEXT_KEYS) {
    const val = updates[key];
    if (typeof val === "string") merged[key] = val.trim();
  }
  const rating = updates.dayRating;
  if (typeof rating === "number") {
    const iv = Math.trunc(rating);
    if (iv >= 0 && iv <= 10) merged.dayRating = iv;
  }
  for (const key of RETRO_DOC_TIME_KEYS) {
    if (!(key in updates)) continue;
    const val = updates[key];
    if (typeof val !== "string") continue;
    const stripped = val.trim();
    if (stripped === "" || isValidHHMM(stripped)) merged[key] = stripped;
  }
  return merged;
}

export function retroDoneTasksContext(
  tasks: KanbanTask[],
  periodStart: string,
  periodEnd: string,
  goals: Goal[]
): string {
  const taskIds = completedTaskIdsInPeriod(tasks, periodStart, periodEnd);
  if (!taskIds.length) return "(この期間中に完了したタスクはありません)";
  const goalMap = new Map(goals.map((g) => [g.id, g]));
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const lines: string[] = [];
  for (const tid of taskIds) {
    const t = taskMap.get(tid);
    if (!t) continue;
    const goalNote = t.goalId && goalMap.has(t.goalId)
      ? ` (目標: ${goalMap.get(t.goalId)!.name})`
      : "";
    const memo = t.memo ? ` — メモ: ${t.memo}` : "";
    lines.push(`- ${t.title}${goalNote}${memo}`);
  }
  return lines.length ? lines.join("\n") : "(タスク情報なし)";
}

export function buildRetroSystemPrompt(
  retro: Retrospective,
  tasks: KanbanTask[],
  goals: Goal[],
  profile: UserProfile
): string {
  const profileCtx = buildProfileContext(profile);
  const doneCtx = retroDoneTasksContext(tasks, retro.periodStart, retro.periodEnd, goals);
  const doc = retro.document;
  const typeLabel = RETRO_TYPE_LABEL[retro.type] ?? "振り返り";
  const isDaily = retro.type === "daily";

  const docSnapshot: Record<string, unknown> = {
    did: doc.did ?? "",
    learned: doc.learned ?? "",
    next: doc.next ?? "",
  };
  if (isDaily) {
    docSnapshot.dayRating = Number(doc.dayRating) || 0;
    docSnapshot.wakeUpTime = doc.wakeUpTime ?? "";
    docSnapshot.bedtime = doc.bedtime ?? "";
  }
  const currentDocJson = JSON.stringify(docSnapshot);

  let ratingSection = "";
  let ratingFormatHint = "";
  let retrodocExample = '<retrodoc>{"did":"...","learned":"...","next":"..."}</retrodoc>';
  let openingHint = "- 冒頭メッセージでは簡単に挨拶し、まずこの期間にやったこと・印象的だった出来事を尋ねる";
  if (isDaily) {
    ratingSection =
      "4. 今日の評価 (dayRating): 今日を 1〜10 の整数で自己評価する (1=最悪, 10=最高)。未評価は 0。\n" +
      '5. 起床時間 (wakeUpTime) / 就寝時間 (bedtime): 今日の起床・就寝時刻を "HH:MM" (24時間) で記録する。未設定は ""。\n';
    ratingFormatHint =
      '- dayRating は整数値 (1〜10, 未評価なら 0) を数値で入れる\n' +
      '- wakeUpTime / bedtime は "HH:MM" の文字列。未設定は "" のまま返す\n';
    retrodocExample =
      '<retrodoc>{"did":"...","learned":"...","next":"...","dayRating":0,"wakeUpTime":"","bedtime":""}</retrodoc>';
    openingHint =
      '- 冒頭メッセージでは簡単に挨拶し、まず今日やったこと・印象的だった出来事を尋ねる。対話の中で自然に「今日を 1〜10 で評価すると？」「起きた時間と寝る予定の時間は？」も確認する';
  }

  return `あなたはユーザーの${typeLabel}を伴走するコーチAIです。
対象期間: ${retro.periodStart} 〜 ${retro.periodEnd}

## 役割
ユーザーに温かく寄り添い、下記の観点を順番に深掘りしながら振り返りを構造化してください (YWT形式)。
1. やったこと (did): 期間内に実際にやったこと・起きた出来事・達成したこと
2. わかったこと (learned): そこから得られた気づき・学び・うまくいった/いかなかった原因
3. 次やること (next): 次の期間で取り組むアクション (やる / 辞める の両方を含めて良い)
${ratingSection}
## 対話の進め方
- 一度に1〜2個の質問だけに絞る
- ユーザーの回答を受け、該当セクションのドキュメントを更新する
- 全観点がある程度埋まったら、「いつでも完了ボタンを押して終了できます」とユーザーに伝える
${openingHint}

## 応答フォーマット (厳守)
毎回の応答の最後に、必ず以下のタグでドキュメントの最新状態を返すこと:
${retrodocExample}

- 値は Markdown 箇条書き (- ...) 推奨。空欄の場合は "" のまま返す
${ratingFormatHint}- 既存の内容を削らず、必要に応じて追記・整理する
- ユーザーの発言を勝手に広げすぎず、事実ベースで要約する

## 現時点のドキュメント
${currentDocJson}

## 期間内の達成タスク
${doneCtx}

${profileCtx}
`;
}

export function retroWelcomeText(
  retroType: RetroType,
  periodStart: string,
  periodEnd: string
): string {
  const label = RETRO_TYPE_LABEL[retroType] ?? "振り返り";
  return `${label}をはじめましょう (${periodStart} 〜 ${periodEnd})。\n\nまずは、この期間で実際にやったことや印象に残った出来事を教えてください。`;
}

export function buildRetroTranscript(
  retro: Retrospective,
  newUserMsg: string | null
): string {
  const parts: string[] = [];
  for (const m of retro.messages) {
    const role = m.role === "assistant" ? "assistant" : "user";
    parts.push(`[${role}]\n${m.text ?? ""}`);
  }
  if (newUserMsg !== null) parts.push(`[user]\n${newUserMsg}`);
  return parts.join("\n\n");
}
