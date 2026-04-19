import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { KanbanTask, RetroDocument as RetroDocumentT } from "../types";

type DocFieldKey = "findings" | "improvements" | "idealState" | "actions";
type EditableKey = DocFieldKey | "aiComment";

interface Props {
  document: RetroDocumentT;
  tasks: KanbanTask[];
  aiComment?: string;
  periodStart: string;
  periodEnd: string;
  typeLabel: string;
  onEditField?: (key: EditableKey, value: string) => void;
}

const SECTIONS: {
  key: DocFieldKey;
  label: string;
  placeholder: string;
}[] = [
  {
    key: "findings",
    label: "気づいたこと",
    placeholder: "AI との対話を通じて、期間内の出来事や感じたことが整理されます。",
  },
  {
    key: "improvements",
    label: "改善点",
    placeholder: "気づきから派生する具体的な改善アクション。",
  },
  {
    key: "idealState",
    label: "次のどうなっていたら最高か？",
    placeholder: "理想の状態・ゴールイメージ。",
  },
  {
    key: "actions",
    label: "そのためにやること・辞めること",
    placeholder: "やること / 辞めること。",
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
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

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

export function RetroDocumentView({
  document,
  tasks,
  aiComment,
  periodStart,
  periodEnd,
  typeLabel,
  onEditField,
}: Props) {
  const completedTasks = tasks.filter((t) =>
    document.completedTasks.includes(t.id),
  );

  return (
    <div className="retro-doc">
      <div className="retro-doc-head">
        <div className="retro-doc-type">{typeLabel}</div>
        <div className="retro-doc-period">
          {periodStart} 〜 {periodEnd}
        </div>
      </div>

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
