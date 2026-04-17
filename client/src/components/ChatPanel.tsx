import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AskUserRequest, ChatMessage } from "../types";
import { AskUserCard } from "./AskUserCard";

interface Props {
  messages: ChatMessage[];
  streamText: string;
  thinkingText: string;
  askRequests: AskUserRequest[];
  waiting: boolean;
  connected: boolean;
  onSend: (text: string) => void;
  onAskSubmit: (requestId: string, answers: Record<string, string>) => void;
}

const TOOL_PREFIX = "\x00tool:";

const SUGGESTIONS = [
  "今日やるべきタスクを提案して",
  "タスクの優先度を見直して",
  "このプロジェクトに足りないタスクは？",
];

export function ChatPanel({
  messages,
  streamText,
  thinkingText,
  askRequests,
  waiting,
  connected,
  onSend,
  onAskSubmit,
}: Props) {
  const [input, setInput] = useState("");
  const flowRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);

  const handleSend = () => {
    const text = input.trim();
    if (!text || !connected) return;
    onSend(text);
    setInput("");
  };

  useEffect(() => {
    flowRef.current?.scrollTo({
      top: flowRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streamText, thinkingText, askRequests]);

  const thinkingPreview = thinkingText
    ? thinkingText.replace(/\n/g, " ").trim()
    : "";

  return (
    <div className="chat-panel">
      <div className="chat-panel-header">
        <span className="chat-panel-icon">&#10038;</span>
        AI アシスタント
      </div>

      <div className="chat-flow" ref={flowRef}>
        {messages.length === 0 && !waiting && (
          <div className="chat-welcome">
            <p className="chat-welcome-text">
              AIエージェントに相談しながら<br />タスクを管理しましょう
            </p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className="chat-suggestion"
                  onClick={() => onSend(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => {
          if (m.text.startsWith(TOOL_PREFIX)) {
            return (
              <div key={m.id} className="chat-tool-event">
                <span className="chat-tool-label">
                  {m.text.slice(TOOL_PREFIX.length)}
                </span>
              </div>
            );
          }
          if (m.role === "system") {
            return (
              <div key={m.id} className="chat-system">{m.text}</div>
            );
          }
          if (m.role === "user") {
            return (
              <div key={m.id} className="chat-msg chat-msg-user">
                <div className="chat-msg-bubble chat-msg-bubble-user">
                  {m.text}
                </div>
              </div>
            );
          }
          return (
            <div key={m.id} className="chat-msg chat-msg-assistant">
              <div className="chat-msg-bubble chat-msg-bubble-assistant">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {m.text}
                </ReactMarkdown>
              </div>
            </div>
          );
        })}

        {askRequests.map((req) => (
          <div key={req.requestId} className="chat-msg chat-msg-assistant">
            <AskUserCard
              requestId={req.requestId}
              questions={req.questions}
              onSubmit={onAskSubmit}
            />
          </div>
        ))}

        {streamText && (
          <div className="chat-msg chat-msg-assistant">
            <div className="chat-msg-bubble chat-msg-bubble-assistant">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {streamText}
              </ReactMarkdown>
            </div>
          </div>
        )}

        {waiting && !streamText && askRequests.length === 0 && (
          <div className="chat-spinner">
            <div className="spinner-dots">
              <span /><span /><span />
            </div>
            {thinkingPreview && (
              <span className="spinner-thinking">
                {thinkingPreview.length > 60
                  ? thinkingPreview.slice(0, 60) + "…"
                  : thinkingPreview}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="chat-input-dock">
        <input
          className="chat-input"
          placeholder={connected ? "AIに相談..." : "接続中..."}
          value={input}
          disabled={!connected || waiting}
          onChange={(e) => setInput(e.target.value)}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !composing.current) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button
          className="chat-send"
          disabled={!connected || waiting || !input.trim()}
          onClick={handleSend}
        >
          送信
        </button>
      </div>
    </div>
  );
}
