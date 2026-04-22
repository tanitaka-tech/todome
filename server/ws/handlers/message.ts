import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { PROJECT_ROOT } from "../../config.ts";
import {
  buildBoardContext,
  buildProfileContext,
  buildTimelineContext,
} from "../../ai/context.ts";
import { buildSystemPromptAppend } from "../../ai/systemPrompt.ts";
import { processTodos } from "../../ai/processTodos.ts";
import { handleAskUserViaWS } from "../../ai/askUser.ts";
import {
  createAIClient,
  makeUserMessage,
  type AIClient,
} from "../../ai/client.ts";
import { scheduleAutosync } from "../../github/autosync.ts";
import {
  isBashCommandAllowed,
  loadAIConfig,
  resolveAIModel,
  resolveThinkingBudget,
} from "../../storage/aiConfig.ts";
import { getDayBoundaryHour } from "../../storage/appConfig.ts";
import {
  dayRangeForBoundary,
  todayBoundaryIsoDate,
} from "../../utils/dayBoundary.ts";
import { loadGoals, saveGoals } from "../../storage/goals.ts";
import { loadTasks, saveTasks } from "../../storage/kanban.ts";
import {
  loadLifeActivities,
  loadTodayLifeLogs,
} from "../../storage/life.ts";
import { loadProfile, saveProfile } from "../../storage/profile.ts";
import { loadQuotas, loadTodayQuotaLogs } from "../../storage/quota.ts";
import type { AppWebSocket, SessionState } from "../../state.ts";
import { sendTo } from "../broadcast.ts";
import type { Handler } from "../dispatch.ts";

function buildOptions(ws: AppWebSocket, promptAppend: string): Options {
  const cfg = loadAIConfig();
  const { model, betas } = resolveAIModel(cfg);
  return {
    model,
    betas,
    cwd: PROJECT_ROOT,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: promptAppend,
    },
    includePartialMessages: true,
    permissionMode: "acceptEdits",
    allowedTools: cfg.allowedTools,
    maxThinkingTokens: resolveThinkingBudget(cfg),
    canUseTool: async (toolName, toolInput) => {
      if (toolName === "AskUserQuestion") {
        return await handleAskUserViaWS(ws, toolInput);
      }
      if (toolName === "Bash") {
        const command = toolInput.command;
        if (!isBashCommandAllowed(command, cfg.allowGhApi)) {
          return {
            behavior: "deny",
            message:
              "この Bash コマンドは allowlist に含まれていません: " +
              JSON.stringify(command),
          };
        }
      }
      return { behavior: "allow", updatedInput: toolInput };
    },
  };
}

function handleTodoWrite(
  ws: AppWebSocket,
  session: SessionState,
  todos: unknown
): void {
  session.kanbanTasks = loadTasks();
  session.goals = loadGoals();
  session.profile = loadProfile();
  const currentProfile = session.profile;
  const { tasks, goals, profile } = processTodos(
    todos,
    session.kanbanTasks,
    session.goals,
    currentProfile
  );
  session.kanbanTasks = tasks;
  session.goals = goals;
  saveTasks(session.kanbanTasks);
  saveGoals(session.goals);
  const profileChanged = JSON.stringify(profile) !== JSON.stringify(currentProfile);
  if (profileChanged) {
    session.profile = profile;
    saveProfile(session.profile);
  }
  scheduleAutosync();
  sendTo(ws, { type: "kanban_sync", tasks: session.kanbanTasks });
  sendTo(ws, { type: "goal_sync", goals: session.goals });
  if (profileChanged) {
    sendTo(ws, { type: "profile_sync", profile: session.profile });
  }
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  thinking?: string;
}

export const message: Handler = async (ws, session, data) => {
  const userText = String(data.message ?? "");
  const boardCtx = buildBoardContext(session.kanbanTasks, session.goals);
  const profileCtx = buildProfileContext(session.profile);

  const boundaryHour = getDayBoundaryHour();
  const todayIso = todayBoundaryIsoDate(boundaryHour);
  const { startIso, endIso } = dayRangeForBoundary(todayIso, boundaryHour);
  const timelineCtx = buildTimelineContext({
    nowMs: Date.now(),
    rangeStartMs: Date.parse(startIso),
    rangeEndMs: Date.parse(endIso),
    tasks: session.kanbanTasks,
    lifeActivities: loadLifeActivities(),
    lifeLogs: loadTodayLifeLogs(todayIso),
    quotas: loadQuotas(),
    quotaLogs: loadTodayQuotaLogs(todayIso),
  });

  if (!session.client) {
    const promptAppend = buildSystemPromptAppend(
      todayIso,
      profileCtx,
      boardCtx,
      timelineCtx,
    );
    session.client = createAIClient(buildOptions(ws, promptAppend));
  }
  const client = session.client as AIClient;

  const fullMsg = `${userText}\n\n---\n${profileCtx}\n\n${boardCtx}\n\n${timelineCtx}`;
  client.queue.push(makeUserMessage(fullMsg, client.sessionId));

  session.cancelRequested = false;
  let resultSent = false;
  let interruptRequested = false;

  // 手動イテレーションで Query ジェネレータを閉じずにターン単位で抜ける。
  // for-await-of は break/return 時に iterator.return() を呼んでしまい、
  // streaming input mode の Query が使い回せなくなる。
  try {
    while (true) {
      if (session.cancelRequested && !interruptRequested) {
        interruptRequested = true;
        try {
          await client.query.interrupt();
        } catch {
          // ignore
        }
      }
      const next = await client.query.next();
      if (next.done) break;
      const msg = next.value;
      if (msg.type === "stream_event") {
        const ev = msg.event as { type?: string; delta?: Record<string, unknown> };
        if (ev.type === "content_block_delta") {
          const delta = ev.delta ?? {};
          if (delta.type === "text_delta" && typeof delta.text === "string") {
            sendTo(ws, { type: "stream_delta", text: delta.text });
          } else if (
            delta.type === "thinking_delta" &&
            typeof delta.thinking === "string"
          ) {
            sendTo(ws, { type: "thinking_delta", text: delta.thinking });
          }
        }
      } else if (msg.type === "assistant") {
        const blocks = (msg.message.content ?? []) as ContentBlock[];
        const textParts: string[] = [];
        for (const block of blocks) {
          if (block.type === "text" && typeof block.text === "string") {
            textParts.push(block.text);
          } else if (block.type === "tool_use") {
            sendTo(ws, {
              type: "tool_use",
              name: block.name ?? "",
              input: block.input,
            });
            if (block.name === "TodoWrite") {
              const todos = (block.input as { todos?: unknown } | undefined)?.todos;
              handleTodoWrite(ws, session, todos);
            }
          }
        }
        if (textParts.length) {
          sendTo(ws, {
            type: "assistant",
            text: textParts.join(""),
            toolCalls: [],
          });
        }
      } else if (msg.type === "result") {
        resultSent = true;
        const resultText =
          msg.subtype === "success" ? msg.result : "(エラーが発生しました)";
        sendTo(ws, {
          type: "result",
          result: resultText,
          cost: msg.total_cost_usd ?? 0,
          turns: msg.num_turns ?? 0,
          sessionId: msg.session_id ?? "",
        });
        return;
      }
    }
  } catch (err) {
    console.error("response error:", err);
  } finally {
    if (!resultSent) {
      sendTo(ws, {
        type: "result",
        result: "(中断されました)",
        cost: 0,
        turns: 0,
        sessionId: "",
      });
    }
  }
};
