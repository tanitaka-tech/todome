import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  KanbanTask,
  LifeActivity,
  LifeLog,
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
  lifeActivities: LifeActivity[];
  lifeLogsForPeriod: LifeLog[];
  dayBoundaryHour: number;
  onSend: (text: string) => void;
  onComplete: () => void;
  onReopen: () => void;
  onClose: () => void;
  onEditField: (
    retroId: string,
    key: "did" | "learned" | "next" | "aiComment",
    value: string,
  ) => void;
  onEditDayRating: (retroId: string, value: number) => void;
  onEditSleep: (
    retroId: string,
    key: "wakeUpTime" | "bedtime",
    value: string,
  ) => void;
}

export function RetroSession({
  retro,
  tasks,
  typeLabel,
  streamText,
  waiting,
  lifeActivities,
  lifeLogsForPeriod,
  dayBoundaryHour,
  onSend,
  onComplete,
  onReopen,
  onClose,
  onEditField,
  onEditDayRating,
  onEditSleep,
}: Props) {
  const { t } = useTranslation("retro");
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
          title={t("sessionBack")}
          aria-label={t("sessionBack")}
        >
          &lsaquo; {t("sessionBack")}
        </button>
        <div className="retro-session-head-title">
          <span className="retro-session-head-type">{typeLabel}</span>
          <span className="retro-session-head-period">
            {retro.periodStart} 〜 {retro.periodEnd}
          </span>
        </div>
        <div className="retro-session-head-actions">
          {isCompleted ? (
            <button
              className="btn retro-complete-btn"
              onClick={onReopen}
              disabled={waiting}
              title={t("sessionReopenTitle")}
            >
              {t("sessionReopen")}
            </button>
          ) : (
            <button
              className="btn btn--primary retro-complete-btn"
              onClick={onComplete}
              disabled={waiting}
              title={t("sessionCompleteTitle")}
            >
              {t("sessionComplete")}
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
                placeholder={
                  waiting
                    ? t("sessionInputWaiting")
                    : t("sessionInputPlaceholder")
                }
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
                    (e.metaKey || e.ctrlKey) &&
                    !composing.current
                  ) {
                    e.preventDefault();
                    if (!waiting && !isCompleted) onComplete();
                    return;
                  }
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
                {t("sessionSend")}
              </button>
            </div>
          ) : (
            <div className="retro-chat-dock retro-chat-dock--completed">
              {t("sessionCompletedNote")}
            </div>
          )}
        </div>

        <div className="retro-doc-pane">
          <RetroDocumentView
            document={retro.document}
            retroType={retro.type}
            tasks={tasks}
            aiComment={retro.aiComment}
            periodStart={retro.periodStart}
            periodEnd={retro.periodEnd}
            typeLabel={typeLabel}
            lifeActivities={lifeActivities}
            lifeLogsForPeriod={lifeLogsForPeriod}
            dayBoundaryHour={dayBoundaryHour}
            onEditField={(key, value) => onEditField(retro.id, key, value)}
            onEditDayRating={(v) => onEditDayRating(retro.id, v)}
            onEditSleep={(key, value) => onEditSleep(retro.id, key, value)}
          />
        </div>
      </div>
    </div>
  );
}
