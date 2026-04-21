import {
  query,
  type Options,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { PushableAsyncIterable } from "./messageStream.ts";

export interface AIClient {
  query: Query;
  queue: PushableAsyncIterable<SDKUserMessage>;
  abort: AbortController;
  sessionId: string;
  close: () => Promise<void>;
}

export function createAIClient(options: Options): AIClient {
  const queue = new PushableAsyncIterable<SDKUserMessage>();
  const abort = new AbortController();
  const q = query({
    prompt: queue,
    options: { ...options, abortController: abort },
  });
  const sessionId = "";
  return {
    query: q,
    queue,
    abort,
    sessionId,
    close: async () => {
      try {
        abort.abort();
      } catch {
        // ignore
      }
      queue.close();
    },
  };
}

export function makeUserMessage(text: string, sessionId: string): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
    session_id: sessionId,
  };
}
