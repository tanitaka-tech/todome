import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { PROJECT_ROOT } from "../config.ts";
import { scheduleAutosync } from "../github/autosync.ts";
import { loadAIConfig, resolveAIModel } from "../storage/aiConfig.ts";
import { saveRetro } from "../storage/retro.ts";
import type { AppWebSocket } from "../state.ts";
import type {
  Goal,
  KanbanTask,
  Retrospective,
  UserProfile,
} from "../types.ts";
import { nowLocalIso as nowIso } from "../utils/time.ts";
import { sendTo } from "../ws/broadcast.ts";
import { buildProfileContext } from "./context.ts";
import {
  RETRO_DOC_TEXT_KEYS,
  RETRO_DOC_TIME_KEYS,
  RETRO_TYPE_LABEL,
  buildRetroSystemPrompt,
  buildRetroTranscript,
  mergeRetroDocument,
  retroDoneTasksContext,
  stripRetrodocBlock,
} from "./retroPrompt.ts";

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
}

function hasContent(retro: Retrospective): boolean {
  const doc = retro.document;
  const textFilled = RETRO_DOC_TEXT_KEYS.some(
    (k) => (doc[k] ?? "").trim() !== ""
  );
  const timeFilled = RETRO_DOC_TIME_KEYS.some(
    (k) => (doc[k] ?? "").trim() !== ""
  );
  return textFilled || Boolean(doc.dayRating) || timeFilled;
}

function buildBaseOptions(systemPrompt: string): Options {
  const cfg = loadAIConfig();
  const { model, betas } = resolveAIModel(cfg);
  return {
    model,
    betas,
    cwd: PROJECT_ROOT,
    systemPrompt,
    includePartialMessages: true,
    permissionMode: "acceptEdits",
    allowedTools: [],
  };
}

// SDK サブプロセスや WS 切断で AI 応答が戻らなくなった場合でも、ハンドラが
// finally ブロックまで必ず到達するように上限時間で強制終了する。
const RETRO_QUERY_TIMEOUT_MS = 3 * 60 * 1000;

async function runRetroQuery(
  ws: AppWebSocket,
  prompt: string,
  systemPrompt: string,
  options: { streamDelta?: boolean; streamThinking?: boolean; thinkingBudget?: number } = {}
): Promise<string> {
  const { streamDelta = true, streamThinking = false, thinkingBudget } = options;
  const baseOptions = buildBaseOptions(systemPrompt);
  if (thinkingBudget !== undefined) {
    baseOptions.maxThinkingTokens = thinkingBudget;
  }
  const abort = new AbortController();
  baseOptions.abortController = abort;
  const timeoutHandle = setTimeout(() => abort.abort(), RETRO_QUERY_TIMEOUT_MS);
  const q = query({ prompt, options: baseOptions });

  const textParts: string[] = [];
  try {
    for await (const msg of q) {
      if (msg.type === "stream_event") {
        const ev = msg.event as { type?: string; delta?: Record<string, unknown> };
        if (ev.type === "content_block_delta") {
          const delta = ev.delta ?? {};
          if (
            streamDelta &&
            delta.type === "text_delta" &&
            typeof delta.text === "string"
          ) {
            sendTo(ws, { type: "retro_stream_delta", text: delta.text });
          } else if (
            streamThinking &&
            delta.type === "thinking_delta" &&
            typeof delta.thinking === "string"
          ) {
            sendTo(ws, { type: "retro_thinking_delta", text: delta.thinking });
          }
        }
      } else if (msg.type === "assistant") {
        const blocks = (msg.message.content ?? []) as ContentBlock[];
        for (const block of blocks) {
          if (block.type === "text" && typeof block.text === "string") {
            textParts.push(block.text);
          }
        }
      } else if (msg.type === "result") {
        // one-shot クエリは result 受信時点で完了。後続イベントを待たずに抜ける。
        break;
      }
    }
  } catch (err) {
    console.error("retro query error:", err);
    throw err;
  } finally {
    clearTimeout(timeoutHandle);
    try {
      await q.return(undefined);
    } catch {
      // ignore — サブプロセス終了の後処理が失敗しても応答処理は続行する
    }
  }
  return textParts.join("").trim();
}

export async function runRetroTurn(
  ws: AppWebSocket,
  retro: Retrospective,
  userMsg: string,
  tasks: KanbanTask[],
  goals: Goal[],
  profile: UserProfile
): Promise<Retrospective> {
  const systemPrompt = buildRetroSystemPrompt(retro, tasks, goals, profile);
  const transcript = buildRetroTranscript(retro, userMsg);
  const full = await runRetroQuery(ws, transcript, systemPrompt, {
    thinkingBudget: 4000,
  });
  const { cleaned: cleanedRaw, parsed } = stripRetrodocBlock(full);
  const cleaned = cleanedRaw || "（応答を生成できませんでした。もう一度試してください）";

  const nowStr = nowIso();
  const newMessages = [...retro.messages];
  newMessages.push({ role: "user", text: userMsg });
  newMessages.push({ role: "assistant", text: cleaned });
  const newDoc = parsed ? mergeRetroDocument(retro.document, parsed) : retro.document;
  const updated: Retrospective = {
    ...retro,
    messages: newMessages,
    document: newDoc,
    updatedAt: nowStr,
  };

  if (hasContent(updated)) {
    saveRetro(updated);
    scheduleAutosync();
  }

  sendTo(ws, { type: "retro_assistant", text: cleaned });
  sendTo(ws, {
    type: "retro_doc_update",
    retroId: updated.id,
    document: updated.document,
  });
  return updated;
}

export async function runRetroReopenGreeting(
  ws: AppWebSocket,
  retro: Retrospective,
  tasks: KanbanTask[],
  goals: Goal[],
  profile: UserProfile
): Promise<Retrospective> {
  const baseSystem = buildRetroSystemPrompt(retro, tasks, goals, profile);
  const systemPrompt =
    baseSystem +
    "\n\n## 会話再開モード\n" +
    "この振り返りは一度完了状態で、ユーザーが「会話を再開」を選びました。" +
    "短い「おかえりなさい」系の挨拶 (1 文) と、これまでの振り返り内容 " +
    "(やったこと/わかったこと/次やること) を踏まえて追加で深掘り・修正したい " +
    "部分を 1 つ具体的に問いかける (1〜2 文) を返してください。" +
    "<retrodoc> ブロックは含めない。";

  const full = await runRetroQuery(
    ws,
    "（会話を再開しました。挨拶と次の問いかけだけを返してください）",
    systemPrompt,
    { streamDelta: true }
  );
  const { cleaned: cleanedRaw } = stripRetrodocBlock(full);
  const cleaned =
    cleanedRaw ||
    "おかえりなさい！追加で振り返りたいことや直したい部分はありますか？";

  const newMessages = [...retro.messages, { role: "assistant" as const, text: cleaned }];
  const updated: Retrospective = {
    ...retro,
    messages: newMessages,
    updatedAt: nowIso(),
  };
  saveRetro(updated);
  scheduleAutosync();
  sendTo(ws, { type: "retro_assistant", text: cleaned });
  return updated;
}

async function generateRetroReviewText(
  ws: AppWebSocket,
  retro: Retrospective,
  tasks: KanbanTask[],
  goals: Goal[],
  profile: UserProfile
): Promise<string> {
  const profileCtx = buildProfileContext(profile);
  const doc = retro.document;
  const doneCtx = retroDoneTasksContext(tasks, retro.periodStart, retro.periodEnd, goals);
  const typeLabel = RETRO_TYPE_LABEL[retro.type] ?? "振り返り";
  const docSnapshot: Record<string, unknown> = {
    did: doc.did ?? "",
    learned: doc.learned ?? "",
    next: doc.next ?? "",
  };
  if (retro.type === "daily") {
    docSnapshot.dayRating = Number(doc.dayRating) || 0;
    docSnapshot.wakeUpTime = doc.wakeUpTime ?? "";
    docSnapshot.bedtime = doc.bedtime ?? "";
  }
  const docText = JSON.stringify(docSnapshot, null, 2);

  const systemPrompt =
    `あなたはユーザーの${typeLabel}に対して、総評コメントを書くコーチAIです。\n` +
    "以下の制約を守って、ユーザーを勇気づけ、次の一歩を後押しする短い評価コメントを日本語で返してください。\n" +
    "- 200〜350 字程度\n" +
    "- 1〜2 段落、Markdown 箇条書きは使わない\n" +
    "- 観点: ポジティブなフィードバック1点 + 次にフォーカスするとよいこと1点\n" +
    "- <retrodoc> タグは不要\n";
  const userMsg =
    `対象期間: ${retro.periodStart} 〜 ${retro.periodEnd}\n\n` +
    `## 振り返りドキュメント\n${docText}\n\n` +
    `## 期間内の達成タスク\n${doneCtx}\n\n` +
    `${profileCtx}\n\n` +
    "この振り返りに対して総評コメントを書いてください。";

  const text = await runRetroQuery(ws, userMsg, systemPrompt);
  return text || "お疲れさまでした。振り返りの積み重ねが次の一歩に繋がります。";
}

export async function finalizeRetro(
  ws: AppWebSocket,
  retro: Retrospective,
  tasks: KanbanTask[],
  goals: Goal[],
  profile: UserProfile
): Promise<Retrospective> {
  const aiComment = await generateRetroReviewText(ws, retro, tasks, goals, profile);
  const nowStr = nowIso();
  const newMessages = [...retro.messages, { role: "assistant" as const, text: aiComment }];
  const updated: Retrospective = {
    ...retro,
    messages: newMessages,
    aiComment,
    completedAt: nowStr,
    updatedAt: nowStr,
  };
  saveRetro(updated);
  scheduleAutosync();
  sendTo(ws, { type: "retro_assistant", text: aiComment });
  sendTo(ws, { type: "retro_completed", retro: updated });
  return updated;
}
