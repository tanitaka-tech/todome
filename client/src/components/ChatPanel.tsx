import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AskUserRequest, ChatMessage } from "../types";
import { AskUserCard } from "./AskUserCard";
import { useModalClose } from "../hooks/useModalClose";

interface Props {
  messages: ChatMessage[];
  streamText: string;
  thinkingText: string;
  askRequests: AskUserRequest[];
  waiting: boolean;
  connected: boolean;
  onSend: (text: string) => void;
  onAskSubmit: (requestId: string, answers: Record<string, string>) => void;
  onCancel: () => void;
  onClearSession: () => void;
  onClose?: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

function formatToolInput(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

export function ChatPanel({
  messages,
  streamText,
  thinkingText,
  askRequests,
  waiting,
  connected,
  onSend,
  onAskSubmit,
  onCancel,
  onClearSession,
  onClose,
  inputRef,
}: Props) {
  const { t } = useTranslation("chat");
  const [input, setInput] = useState("");
  const [toolDetail, setToolDetail] = useState<ChatMessage | null>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const toolOverlayMouseDownRef = useRef(false);
  const clearToolDetail = useCallback(() => setToolDetail(null), []);
  const { closing: toolDetailClosing, close: closeToolDetail } = useModalClose(clearToolDetail);

  const suggestions = [
    t("suggestionProfile"),
    t("suggestionGoal"),
    t("suggestionToday"),
  ];

  const handleSend = () => {
    const text = input.trim();
    if (!text || !connected) return;
    if (text === "/clear") {
      onClearSession();
      setInput("");
      return;
    }
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
        {t("title")}
        <button
          className="chat-panel-clear"
          onClick={onClearSession}
          disabled={!connected}
          title={t("clearSessionTitle")}
          aria-label={t("clearSession")}
        >
          {t("clear")}
        </button>
        {onClose && (
          <button
            className="chat-panel-close"
            onClick={onClose}
            title={t("closeAssistant")}
            aria-label={t("closeAssistant")}
          >
            &#10095;
          </button>
        )}
      </div>

      <div className="chat-flow" ref={flowRef}>
        {messages.length === 0 && !waiting && (
          <div className="chat-welcome">
            <p className="chat-welcome-text">
              {t("welcomeLine1")}<br />{t("welcomeLine2")}
            </p>
            <div className="chat-suggestions">
              {suggestions.map((s) => (
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
          if (m.role === "tool") {
            return (
              <div key={m.id} className="chat-tool-event">
                <button
                  className="chat-tool-label chat-tool-label--button"
                  onClick={() => setToolDetail(m)}
                  title={t("showDetails")}
                >
                  {m.text}
                  <span className="chat-tool-label-icon">&#9432;</span>
                </button>
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
          ref={inputRef}
          className="chat-input"
          placeholder={
            connected
              ? waiting
                ? t("inputPlaceholderResponding")
                : t("inputPlaceholderReady")
              : t("inputPlaceholderConnecting")
          }
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
        {waiting ? (
          <button
            className="chat-send chat-send--cancel"
            onClick={onCancel}
            disabled={!connected}
          >
            {t("cancel")}
          </button>
        ) : (
          <button
            className="chat-send"
            disabled={!connected || !input.trim()}
            onClick={handleSend}
          >
            {t("send")}
          </button>
        )}
      </div>

      {toolDetail && (
        <div
          className={`modal-overlay${toolDetailClosing ? " is-closing" : ""}`}
          onMouseDown={(e) => {
            toolOverlayMouseDownRef.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && toolOverlayMouseDownRef.current) {
              closeToolDetail();
            }
          }}
        >
          <div
            className="modal-content tool-detail-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <div className="modal-title">{toolDetail.toolName ?? "Tool"}</div>
                <div className="tool-detail-subtitle">{toolDetail.text}</div>
              </div>
              <button
                className="modal-close"
                onClick={closeToolDetail}
                aria-label={t("close")}
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-label">input</div>
              <pre className="tool-detail-json">
                {formatToolInput(toolDetail.toolInput)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
