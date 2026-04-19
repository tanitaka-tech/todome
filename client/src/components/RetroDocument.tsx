import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { KanbanTask, RetroDocument as RetroDocumentT } from "../types";

interface Props {
  document: RetroDocumentT;
  tasks: KanbanTask[];
  aiComment?: string;
  periodStart: string;
  periodEnd: string;
  typeLabel: string;
}

const SECTIONS: {
  key: keyof Omit<RetroDocumentT, "completedTasks">;
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

export function RetroDocumentView({
  document,
  tasks,
  aiComment,
  periodStart,
  periodEnd,
  typeLabel,
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
            {document[s.key] ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {document[s.key]}
              </ReactMarkdown>
            ) : (
              <div className="retro-doc-placeholder">{s.placeholder}</div>
            )}
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

      {aiComment && (
        <section className="retro-doc-section retro-doc-section--ai">
          <h3 className="retro-doc-section-title">AI からのコメント</h3>
          <div className="retro-doc-section-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {aiComment}
            </ReactMarkdown>
          </div>
        </section>
      )}
    </div>
  );
}
