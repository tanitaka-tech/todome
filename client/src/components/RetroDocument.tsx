import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { KanbanTask, RetroDocument as RetroDocumentT, RetroType } from "../types";

type DocFieldKey = "did" | "learned" | "next";
type EditableKey = DocFieldKey | "aiComment";

interface Props {
  document: RetroDocumentT;
  retroType: RetroType;
  tasks: KanbanTask[];
  aiComment?: string;
  periodStart: string;
  periodEnd: string;
  typeLabel: string;
  onEditField?: (key: EditableKey, value: string) => void;
  onEditDayRating?: (value: number) => void;
}

const SECTIONS: {
  key: DocFieldKey;
  label: string;
  placeholder: string;
}[] = [
  {
    key: "did",
    label: "やったこと",
    placeholder: "期間内に実際にやったこと・起きた出来事。",
  },
  {
    key: "learned",
    label: "わかったこと",
    placeholder: "気づき・学び・うまくいった / いかなかった原因。",
  },
  {
    key: "next",
    label: "次やること",
    placeholder: "次の期間で取り組むアクション (やる / 辞める)。",
  },
];

function EditableMarkdownSection({
  value,
  placeholder,
  onSave,
}: {
  value: string;
  placeholder: string;
  onSave?: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  const taRef = useRef<HTMLTextAreaElement>(null);

  if (value !== lastValue) {
    setLastValue(value);
    if (!editing) setDraft(value);
  }

  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus();
      const len = taRef.current.value.length;
      taRef.current.setSelectionRange(len, len);
    }
  }, [editing]);

  const startEdit = () => {
    setDraft(value);
    setEditing(true);
  };
  const cancel = () => setEditing(false);
  const save = () => {
    setEditing(false);
    if (draft !== value) onSave?.(draft);
  };

  if (editing) {
    return (
      <div className="retro-doc-edit">
        <textarea
          ref={taRef}
          className="retro-doc-edit-textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            } else if (
              (e.metaKey || e.ctrlKey) &&
              e.key === "Enter"
            ) {
              e.preventDefault();
              save();
            }
          }}
          rows={Math.max(4, draft.split("\n").length + 1)}
        />
        <div className="retro-doc-edit-actions">
          <button className="btn" onClick={cancel}>
            キャンセル
          </button>
          <button className="btn btn--primary" onClick={save}>
            保存
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`retro-doc-view${onSave ? " retro-doc-view--editable" : ""}`}
      onClick={onSave ? startEdit : undefined}
      role={onSave ? "button" : undefined}
      tabIndex={onSave ? 0 : undefined}
      onKeyDown={(e) => {
        if (!onSave) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          startEdit();
        }
      }}
      title={onSave ? "クリックして編集" : undefined}
    >
      {value ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
      ) : (
        <div className="retro-doc-placeholder">{placeholder}</div>
      )}
    </div>
  );
}

function DayRatingSlider({
  value,
  onChange,
}: {
  value: number;
  onChange?: (v: number) => void;
}) {
  const readonly = !onChange;
  const rated = value > 0;
  const sliderValue = rated ? value : 5;
  return (
    <div className="retro-rating">
      <div className="retro-rating-row">
        <span className="retro-rating-end">1</span>
        <input
          type="range"
          className="retro-rating-slider"
          min={1}
          max={10}
          step={1}
          value={sliderValue}
          disabled={readonly}
          onChange={(e) => onChange?.(Number(e.target.value))}
          aria-label="今日の評価"
        />
        <span className="retro-rating-end">10</span>
      </div>
      <div className="retro-rating-meta">
        <span
          className={`retro-rating-value${rated ? "" : " retro-rating-value--unset"}`}
        >
          {rated ? `${value} / 10` : "未評価"}
        </span>
        {rated && !readonly && (
          <button
            type="button"
            className="retro-rating-clear"
            onClick={() => onChange?.(0)}
          >
            クリア
          </button>
        )}
      </div>
    </div>
  );
}

export function RetroDocumentView({
  document,
  retroType,
  tasks,
  aiComment,
  periodStart,
  periodEnd,
  typeLabel,
  onEditField,
  onEditDayRating,
}: Props) {
  const completedTasks = tasks.filter((t) =>
    document.completedTasks.includes(t.id),
  );
  const isDaily = retroType === "daily";

  return (
    <div className="retro-doc">
      <div className="retro-doc-head">
        <div className="retro-doc-type">{typeLabel}</div>
        <div className="retro-doc-period">
          {periodStart} 〜 {periodEnd}
        </div>
      </div>

      {isDaily && (
        <section className="retro-doc-section">
          <h3 className="retro-doc-section-title">今日の評価</h3>
          <div className="retro-doc-section-body">
            <DayRatingSlider
              value={document.dayRating || 0}
              onChange={onEditDayRating}
            />
          </div>
        </section>
      )}

      {SECTIONS.map((s) => (
        <section key={s.key} className="retro-doc-section">
          <h3 className="retro-doc-section-title">{s.label}</h3>
          <div className="retro-doc-section-body">
            <EditableMarkdownSection
              value={document[s.key]}
              placeholder={s.placeholder}
              onSave={
                onEditField
                  ? (next) => onEditField(s.key, next)
                  : undefined
              }
            />
          </div>
        </section>
      ))}

      <section className="retro-doc-section">
        <h3 className="retro-doc-section-title">
          ✅ 達成タスク ({completedTasks.length}件)
        </h3>
        <div className="retro-doc-section-body">
          {completedTasks.length === 0 ? (
            <div className="retro-doc-placeholder">
              この期間に完了したタスクはありません。
            </div>
          ) : (
            <ul className="retro-doc-task-list">
              {completedTasks.map((t) => (
                <li key={t.id}>{t.title}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {(aiComment || onEditField) && (
        <section className="retro-doc-section retro-doc-section--ai">
          <h3 className="retro-doc-section-title">AI からのコメント</h3>
          <div className="retro-doc-section-body">
            <EditableMarkdownSection
              value={aiComment || ""}
              placeholder="AI からのコメントはまだありません。"
              onSave={
                onEditField
                  ? (next) => onEditField("aiComment", next)
                  : undefined
              }
            />
          </div>
        </section>
      )}
    </div>
  );
}
