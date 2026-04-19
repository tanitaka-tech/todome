import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AskQuestion } from "../types";

interface Props {
  requestId: string;
  questions: AskQuestion[];
  onSubmit: (requestId: string, answers: Record<string, string>) => void;
}

export function AskUserCard({ requestId, questions, onSubmit }: Props) {
  const { t } = useTranslation("chat");
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [freeInputs, setFreeInputs] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const toggleOption = (
    question: string,
    label: string,
    multiSelect?: boolean,
  ) => {
    setSelections((prev) => {
      const current = prev[question] || [];
      if (multiSelect) {
        return {
          ...prev,
          [question]: current.includes(label)
            ? current.filter((l) => l !== label)
            : [...current, label],
        };
      }
      return {
        ...prev,
        [question]: current.includes(label) ? [] : [label],
      };
    });
  };

  const handleSubmit = () => {
    const answers: Record<string, string> = {};
    for (const q of questions) {
      const free = freeInputs[q.question]?.trim();
      if (free) {
        answers[q.question] = free;
      } else {
        answers[q.question] = (selections[q.question] || []).join(", ");
      }
    }
    setSubmitted(true);
    onSubmit(requestId, answers);
  };

  return (
    <div className={`ask-card ${submitted ? "ask-card--submitted" : ""}`}>
      <div className="ask-card-header">
        {submitted ? t("answered") : t("askHeader")}
      </div>

      {questions.map((q) => (
        <div key={q.question} className="ask-section">
          {q.header && (
            <div className="ask-section-label">{q.header}</div>
          )}
          <div className="ask-question-text">{q.question}</div>
          {q.options && (
            <div className="ask-chips">
              {q.options.map((opt) => (
                <button
                  key={opt.label}
                  className={`ask-chip ${
                    (selections[q.question] || []).includes(opt.label)
                      ? "ask-chip--selected"
                      : ""
                  }`}
                  disabled={submitted}
                  onClick={() =>
                    toggleOption(q.question, opt.label, q.multiSelect)
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          {!q.options && (
            <input
              className="ask-free-input"
              placeholder={t("freeInputPlaceholder")}
              disabled={submitted}
              value={freeInputs[q.question] || ""}
              onChange={(e) =>
                setFreeInputs((p) => ({
                  ...p,
                  [q.question]: e.target.value,
                }))
              }
            />
          )}
        </div>
      ))}

      <div className="ask-footer">
        <button
          className="ask-submit"
          disabled={submitted}
          onClick={handleSubmit}
        >
          {submitted ? t("submitted") : t("submitAnswers")}
        </button>
      </div>
    </div>
  );
}
