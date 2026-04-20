import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  AIModel,
  AskUserRequest,
  ChatMessage,
  ThinkingEffort,
} from "../types";
import { AI_MODELS, AI_MODEL_LABELS, THINKING_EFFORTS } from "../types";
import { AskUserCard } from "./AskUserCard";
import { useModalClose } from "../hooks/useModalClose";

interface Props {
  messages: ChatMessage[];
  streamText: string;
  thinkingText: string;
  askRequests: AskUserRequest[];
  waiting: boolean;
  connected: boolean;
  model: AIModel;
  onModelChange: (model: AIModel) => void;
  thinkingEffort: ThinkingEffort;
  onThinkingEffortChange: (effort: ThinkingEffort) => void;
  onSend: (text: string) => void;
  onAskSubmit: (requestId: string, answers: Record<string, string>) => void;
  onCancel: () => void;
  onClearSession: () => void;
  onClose?: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

const EFFORT_LABEL_KEYS: Record<ThinkingEffort, string> = {
  low: "effortLow",
  medium: "effortMedium",
  high: "effortHigh",
  veryHigh: "effortVeryHigh",
  max: "effortMax",
};

const EFFORT_DESC_KEYS: Record<ThinkingEffort, string> = {
  low: "effortLowDesc",
  medium: "effortMediumDesc",
  high: "effortHighDesc",
  veryHigh: "effortVeryHighDesc",
  max: "effortMaxDesc",
};

const MODEL_DESC_KEYS: Record<AIModel, string> = {
  "claude-opus-4-7": "modelOpus47Desc",
  "claude-opus-4-7-1m": "modelOpus471mDesc",
  "claude-sonnet-4-6": "modelSonnet46Desc",
  "claude-haiku-4-5": "modelHaiku45Desc",
};

type RenderItem =
  | { kind: "message"; msg: ChatMessage }
  | { kind: "toolGroup"; id: string; tools: ChatMessage[] };

function buildRenderItems(messages: ChatMessage[]): RenderItem[] {
  const items: RenderItem[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      const last = items[items.length - 1];
      if (last && last.kind === "toolGroup") {
        last.tools.push(m);
      } else {
        items.push({ kind: "toolGroup", id: `tg-${m.id}`, tools: [m] });
      }
    } else {
      items.push({ kind: "message", msg: m });
    }
  }
  return items;
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
  model,
  onModelChange,
  thinkingEffort,
  onThinkingEffortChange,
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
  const [expandedToolGroups, setExpandedToolGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [hoveredDescKey, setHoveredDescKey] = useState<string | null>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const toolOverlayMouseDownRef = useRef(false);
  const clearToolDetail = useCallback(() => setToolDetail(null), []);
  const { closing: toolDetailClosing, close: closeToolDetail } = useModalClose(clearToolDetail);

  const renderItems = useMemo(() => buildRenderItems(messages), [messages]);

  const toggleToolGroup = useCallback((groupId: string) => {
    setExpandedToolGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const closeModelMenu = useCallback(() => {
    setModelMenuOpen(false);
    setHoveredDescKey(null);
  }, []);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const handlePointer = (e: MouseEvent) => {
      if (!modelMenuRef.current) return;
      if (!modelMenuRef.current.contains(e.target as Node)) {
        closeModelMenu();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModelMenu();
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [modelMenuOpen, closeModelMenu]);

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

        {renderItems.map((item) => {
          if (item.kind === "toolGroup") {
            const expanded = expandedToolGroups.has(item.id);
            const count = item.tools.length;
            const last = item.tools[item.tools.length - 1];
            return (
              <div key={item.id} className="chat-tool-group">
                <button
                  className={`chat-tool-group-header${expanded ? " is-expanded" : ""}`}
                  onClick={() => toggleToolGroup(item.id)}
                  title={expanded ? t("toolGroupCollapse") : t("toolGroupExpand")}
                  aria-expanded={expanded}
                >
                  <span className="chat-tool-group-caret" aria-hidden="true">
                    &#9656;
                  </span>
                  <span className="chat-tool-group-summary">
                    {t("toolGroupSummary", { count })}
                  </span>
                  {!expanded && (
                    <span className="chat-tool-group-preview">
                      {last.text}
                    </span>
                  )}
                </button>
                {expanded && (
                  <div className="chat-tool-group-list">
                    {item.tools.map((tm) => (
                      <div key={tm.id} className="chat-tool-event">
                        <button
                          className="chat-tool-label chat-tool-label--button"
                          onClick={() => setToolDetail(tm)}
                          title={t("showDetails")}
                        >
                          {tm.text}
                          <span className="chat-tool-label-icon">&#9432;</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          const m = item.msg;
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
        <div className="chat-input-row">
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
        <div className="chat-input-toolbar">
          <div
            className="chat-model-popover-wrap"
            ref={modelMenuRef}
          >
            <button
              type="button"
              className={`chat-model-trigger${modelMenuOpen ? " is-open" : ""}`}
              disabled={!connected || waiting}
              onClick={() => setModelMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={modelMenuOpen}
              title={t("modelChangeTitle")}
            >
              <span className="chat-model-trigger-name">
                {AI_MODEL_LABELS[model]}
              </span>
              <span className="chat-model-trigger-sep">·</span>
              <span className="chat-model-trigger-effort">
                {t(EFFORT_LABEL_KEYS[thinkingEffort])}
              </span>
              <span className="chat-model-trigger-caret" aria-hidden="true">
                &#9662;
              </span>
            </button>
            {modelMenuOpen && (
              <div className="chat-model-popover" role="menu">
                <div className="chat-model-popover-section">
                  <div className="chat-model-popover-header">
                    {t("modelLabel")}
                  </div>
                  {AI_MODELS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="menuitemradio"
                      aria-checked={model === m}
                      className={`chat-model-popover-item${model === m ? " is-selected" : ""}`}
                      onMouseEnter={() => setHoveredDescKey(MODEL_DESC_KEYS[m])}
                      onFocus={() => setHoveredDescKey(MODEL_DESC_KEYS[m])}
                      onMouseLeave={() => setHoveredDescKey(null)}
                      onBlur={() => setHoveredDescKey(null)}
                      onClick={() => {
                        onModelChange(m);
                        closeModelMenu();
                      }}
                    >
                      <span className="chat-model-popover-item-label">
                        {AI_MODEL_LABELS[m]}
                      </span>
                      {model === m && (
                        <span
                          className="chat-model-popover-item-check"
                          aria-hidden="true"
                        >
                          &#10003;
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="chat-model-popover-divider" />
                <div className="chat-model-popover-section">
                  <div className="chat-model-popover-header">
                    {t("effortLabel")}
                  </div>
                  {THINKING_EFFORTS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      role="menuitemradio"
                      aria-checked={thinkingEffort === e}
                      className={`chat-model-popover-item${thinkingEffort === e ? " is-selected" : ""}`}
                      onMouseEnter={() => setHoveredDescKey(EFFORT_DESC_KEYS[e])}
                      onFocus={() => setHoveredDescKey(EFFORT_DESC_KEYS[e])}
                      onMouseLeave={() => setHoveredDescKey(null)}
                      onBlur={() => setHoveredDescKey(null)}
                      onClick={() => {
                        onThinkingEffortChange(e);
                        closeModelMenu();
                      }}
                    >
                      <span className="chat-model-popover-item-label">
                        {t(EFFORT_LABEL_KEYS[e])}
                      </span>
                      {thinkingEffort === e && (
                        <span
                          className="chat-model-popover-item-check"
                          aria-hidden="true"
                        >
                          &#10003;
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                {hoveredDescKey && (
                  <div className="chat-model-popover-tooltip" role="tooltip">
                    {t(hoveredDescKey)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
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
