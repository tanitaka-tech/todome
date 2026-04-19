import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  KanbanTask,
  RetroMessage,
  Retrospective,
} from "../types";
import { RetroDocumentView } from "./RetroDocument";

interface Props {
  retro: Retrospective;
  tasks: KanbanTask[];
  typeLabel: string;
  streamText: string;
  waiting: boolean;
  onSend: (text: string) => void;
  onComplete: () => void;
  onClose: () => void;
}

export function RetroSession({
  retro,
  tasks,
  typeLabel,
  streamText,
  waiting,
  onSend,
  onComplete,
  onClose,
}: Props) {
  const [input, setInput] = useState("");
  const flowRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);

  useEffect(() => {
    flowRef.current?.scrollTo({
      top: flowRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [retro.messages, streamText, waiting]);

  const handleSend = () => {
    const t = input.trim();
    if (!t || waiting) return;
    onSend(t);
    setInput("");
  };

  const isCompleted = !!retro.completedAt;

  return (
    <div className="retro-session">
      <div className="retro-session-head">
        <button
          className="retro-session-back"
          onClick={onClose}
          title="一覧に戻る"
          aria-label="一覧に戻る"
        >
          &lsaquo; 一覧に戻る
        </button>
        <div className="retro-session-head-title">
          <span className="retro-session-head-type">{typeLabel}</span>
          <span className="retro-session-head-period">
            {retro.periodStart} 〜 {retro.periodEnd}
          </span>
        </div>
        <div className="retro-session-head-actions">
          {!isCompleted && (
            <button
              className="btn btn--primary retro-complete-btn"
              onClick={onComplete}
              disabled={waiting}
              title="完了"
            >
              完了
            </button>
          )}
        </div>
      </div>

      <div className="retro-session-body">
        <div className="retro-chat-pane">
          <div className="retro-chat-flow" ref={flowRef}>
            {retro.messages.map((m: RetroMessage, idx) => (
              <div
                key={idx}
                className={`retro-chat-msg retro-chat-msg--${m.role}`}
              >
                <div
                  className={`retro-chat-bubble retro-chat-bubble--${m.role}`}
                >
                  {m.role === "assistant" ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {m.text}
                    </ReactMarkdown>
                  ) : (
                    m.text
                  )}
                </div>
              </div>
            ))}

            {streamText && (
              <div className="retro-chat-msg retro-chat-msg--assistant">
                <div className="retro-chat-bubble retro-chat-bubble--assistant">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {streamText}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {waiting && !streamText && (
              <div className="retro-chat-spinner">
                <div className="spinner-dots">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>

          {!isCompleted ? (
            <div className="retro-chat-dock">
              <textarea
                className="retro-chat-input"
                placeholder={waiting ? "AIが応答中..." : "回答を入力..."}
                value={input}
                disabled={waiting}
                rows={2}
                onChange={(e) => setInput(e.target.value)}
                onCompositionStart={() => {
                  composing.current = true;
                }}
                onCompositionEnd={() => {
                  composing.current = false;
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !composing.current
                  ) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <button
                className="retro-chat-send"
                disabled={waiting || !input.trim()}
                onClick={handleSend}
              >
                送信
              </button>
            </div>
          ) : (
            <div className="retro-chat-dock retro-chat-dock--completed">
              この振り返りは完了済みです。
            </div>
          )}
        </div>

        <div className="retro-doc-pane">
          <RetroDocumentView
            document={retro.document}
            tasks={tasks}
            aiComment={retro.aiComment}
            periodStart={retro.periodStart}
            periodEnd={retro.periodEnd}
            typeLabel={typeLabel}
          />
        </div>
      </div>
    </div>
  );
}
