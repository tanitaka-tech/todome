import { useMemo, useState } from "react";
import type { ThemeName } from "../theme";
import type { AIToolConfig, GitHubStatus, RepoInfo } from "../types";

interface Props {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  githubStatus: GitHubStatus | null;
  githubRepos: RepoInfo[];
  onRequestRepoList: () => void;
  onLinkRepo: (args: {
    owner?: string;
    name: string;
    create: boolean;
    private: boolean;
  }) => void;
  onUnlink: () => void;
  onSyncNow: () => void;
  onPullNow: () => void;
  onToggleAutoSync: (value: boolean) => void;
  aiConfig: AIToolConfig;
  onUpdateAIConfig: (config: AIToolConfig) => void;
}

interface AIToolDef {
  id: string;
  label: string;
  desc: string;
  warning?: string;
}

const AI_TOOL_CATALOG: AIToolDef[] = [
  {
    id: "TodoWrite",
    label: "TodoWrite",
    desc: "タスクの追加/更新、目標の追加/更新 (GOAL_ADD / GOAL_UPDATE)。",
    warning: "これをオフにするとAIからタスクや目標を操作できなくなります。",
  },
  {
    id: "Bash",
    label: "Bash",
    desc: "シェルコマンド実行。許可リスト(gh issue/pr/repo の読み取り系, git status/log/diff)のみ通る。",
  },
  {
    id: "Read",
    label: "Read",
    desc: "ローカルファイル読み取り。プロジェクトコードを参照して回答するときに使用。",
  },
  {
    id: "Glob",
    label: "Glob",
    desc: "ファイル名パターンによる検索。",
  },
  {
    id: "Grep",
    label: "Grep",
    desc: "ファイル内容のパターン検索。",
  },
  {
    id: "WebFetch",
    label: "WebFetch",
    desc: "指定URLの内容を取得。ドキュメント参照などに使用。",
  },
  {
    id: "WebSearch",
    label: "WebSearch",
    desc: "Web検索。最新情報を調べたいときに使用。",
  },
];

type ThemeDef = {
  id: ThemeName;
  name: string;
  sub: string;
  sidebar: string;
  surface: string;
  accent: string;
  fg: string;
  line: string;
  muted: string;
};

const DARK_THEMES_LIST: ThemeDef[] = [
  {
    id: "dark",
    name: "Dark",
    sub: "Datadog-like",
    sidebar: "#14151e",
    surface: "#1c1d2a",
    accent: "#8a5ff0",
    fg: "#e8eaf1",
    line: "#2a2c3d",
    muted: "#40435a",
  },
  {
    id: "midnight",
    name: "Midnight",
    sub: "Deep blue",
    sidebar: "#0f1424",
    surface: "#161d35",
    accent: "#4c8bf5",
    fg: "#e4ecff",
    line: "#232e52",
    muted: "#3a4680",
  },
  {
    id: "forest",
    name: "Forest",
    sub: "Pine green",
    sidebar: "#111d18",
    surface: "#1a2b23",
    accent: "#4ade80",
    fg: "#e6efe8",
    line: "#2a3d34",
    muted: "#436052",
  },
  {
    id: "sunset",
    name: "Sunset",
    sub: "Dusk pink",
    sidebar: "#1e1526",
    surface: "#2b1d36",
    accent: "#f472b6",
    fg: "#f3e8f7",
    line: "#3d2949",
    muted: "#6a4580",
  },
  {
    id: "ocean",
    name: "Ocean",
    sub: "Deep teal",
    sidebar: "#0c1d22",
    surface: "#142d36",
    accent: "#22d3ee",
    fg: "#e0f2f7",
    line: "#1f3b46",
    muted: "#395d6a",
  },
  {
    id: "slate",
    name: "Slate",
    sub: "Neutral gray",
    sidebar: "#181b20",
    surface: "#23272f",
    accent: "#94a3b8",
    fg: "#e6e8ec",
    line: "#2e333d",
    muted: "#4a515e",
  },
];

const LIGHT_THEMES_LIST: ThemeDef[] = [
  {
    id: "beige",
    name: "Beige",
    sub: "Warm classic",
    sidebar: "#ebe6de",
    surface: "#ffffff",
    accent: "#9a5b2f",
    fg: "#2c2825",
    line: "#e0dbd4",
    muted: "#b5afa6",
  },
  {
    id: "paper",
    name: "Paper",
    sub: "Clean white",
    sidebar: "#f1f1f1",
    surface: "#ffffff",
    accent: "#111827",
    fg: "#1f2937",
    line: "#e5e7eb",
    muted: "#9ca3af",
  },
  {
    id: "mint",
    name: "Mint",
    sub: "Fresh green",
    sidebar: "#e4f0e8",
    surface: "#ffffff",
    accent: "#15803d",
    fg: "#1a2e23",
    line: "#d7e6dc",
    muted: "#98b5a3",
  },
  {
    id: "rose",
    name: "Rose",
    sub: "Soft pink",
    sidebar: "#f8e4e7",
    surface: "#ffffff",
    accent: "#be185d",
    fg: "#3c1f26",
    line: "#f0d7dc",
    muted: "#c09ba3",
  },
  {
    id: "sky",
    name: "Sky",
    sub: "Airy blue",
    sidebar: "#dfebf6",
    surface: "#ffffff",
    accent: "#0369a1",
    fg: "#102030",
    line: "#d1e0ed",
    muted: "#8fa8bd",
  },
  {
    id: "sand",
    name: "Sand",
    sub: "Warm yellow",
    sidebar: "#f6ecd2",
    surface: "#ffffff",
    accent: "#a16207",
    fg: "#3b2f18",
    line: "#ece0c4",
    muted: "#b5a57c",
  },
];

function ThemeOption({
  t,
  active,
  onSelect,
}: {
  t: ThemeDef;
  active: boolean;
  onSelect: (id: ThemeName) => void;
}) {
  return (
    <button
      className={`theme-option ${active ? "theme-option--active" : ""}`}
      onClick={() => onSelect(t.id)}
      type="button"
    >
      <div className="theme-preview" style={{ borderColor: t.line }}>
        <div
          className="theme-preview-sidebar"
          style={{ background: t.sidebar }}
        />
        <div
          className="theme-preview-body"
          style={{ background: t.surface }}
        >
          <div
            className="theme-preview-line"
            style={{ background: t.fg, opacity: 0.8 }}
          />
          <div
            className="theme-preview-line theme-preview-line--short"
            style={{ background: t.muted }}
          />
          <div
            className="theme-preview-line theme-preview-line--pill"
            style={{ background: t.accent }}
          />
        </div>
      </div>
      <div className="theme-option-name">{t.name}</div>
      <div className="theme-option-sub">{t.sub}</div>
    </button>
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export function SettingsPanel({
  theme,
  setTheme,
  githubStatus,
  githubRepos,
  onRequestRepoList,
  onLinkRepo,
  onUnlink,
  onSyncNow,
  onPullNow,
  onToggleAutoSync,
  aiConfig,
  onUpdateAIConfig,
}: Props) {
  const toggleTool = (toolId: string, enabled: boolean) => {
    const current = new Set(aiConfig.allowedTools);
    if (enabled) current.add(toolId);
    else current.delete(toolId);
    // カタログ順に並べ直す
    const next = AI_TOOL_CATALOG.filter((t) => current.has(t.id)).map(
      (t) => t.id,
    );
    onUpdateAIConfig({ ...aiConfig, allowedTools: next });
  };
  const toggleGhApi = (enabled: boolean) => {
    onUpdateAIConfig({ ...aiConfig, allowGhApi: enabled });
  };
  const bashEnabled = aiConfig.allowedTools.includes("Bash");
  return (
    <div className="settings-panel">
      <div className="page-head">
        <div className="page-head-title-wrap">
          <h1 className="page-title">設定</h1>
          <div className="page-subtitle">アプリの外観と挙動を設定します</div>
        </div>
      </div>

      <div className="page-body">
        <div className="widget" style={{ maxWidth: 720 }}>
          <div className="widget-head">
            <span className="widget-title">Appearance</span>
          </div>
          <div className="widget-body">
            <div className="settings-row">
              <div>
                <div className="settings-row-label">テーマ</div>
                <div className="settings-row-desc">
                  全体の配色を切り替えます。設定はこのブラウザに保存されます。
                </div>
              </div>
              <div className="theme-groups">
                <div className="theme-group">
                  <div className="theme-group-label">ダーク</div>
                  <div className="theme-switch">
                    {DARK_THEMES_LIST.map((t) => (
                      <ThemeOption
                        key={t.id}
                        t={t}
                        active={theme === t.id}
                        onSelect={setTheme}
                      />
                    ))}
                  </div>
                </div>
                <div className="theme-group">
                  <div className="theme-group-label">ライト</div>
                  <div className="theme-switch">
                    {LIGHT_THEMES_LIST.map((t) => (
                      <ThemeOption
                        key={t.id}
                        t={t}
                        active={theme === t.id}
                        onSelect={setTheme}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="widget" style={{ maxWidth: 720 }}>
          <div className="widget-head">
            <span className="widget-title">GitHub連携</span>
          </div>
          <div className="widget-body">
            <GitHubSection
              status={githubStatus}
              repos={githubRepos}
              onRequestRepoList={onRequestRepoList}
              onLinkRepo={onLinkRepo}
              onUnlink={onUnlink}
              onSyncNow={onSyncNow}
              onPullNow={onPullNow}
              onToggleAutoSync={onToggleAutoSync}
            />
          </div>
        </div>

        <div className="widget" style={{ maxWidth: 720 }}>
          <div className="widget-head">
            <span className="widget-title">AIエージェント</span>
          </div>
          <div className="widget-body">
            <div className="settings-row-desc" style={{ marginBottom: 12 }}>
              AIアシスタントが使えるツールを選びます。変更は次のチャット送信から反映されます。
            </div>
            <div className="ai-tool-list">
              {AI_TOOL_CATALOG.map((tool) => {
                const enabled = aiConfig.allowedTools.includes(tool.id);
                return (
                  <label key={tool.id} className="ai-tool-item">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => toggleTool(tool.id, e.target.checked)}
                    />
                    <div className="ai-tool-text">
                      <div className="ai-tool-name">{tool.label}</div>
                      <div className="ai-tool-desc">{tool.desc}</div>
                      {tool.warning && (
                        <div className="ai-tool-warning">
                          ⚠ {tool.warning}
                        </div>
                      )}
                      {tool.id === "Bash" && (
                        <label
                          className="ai-tool-suboption"
                          style={{
                            opacity: bashEnabled ? 1 : 0.5,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={aiConfig.allowGhApi}
                            disabled={!bashEnabled}
                            onChange={(e) => toggleGhApi(e.target.checked)}
                          />
                          <div>
                            <div className="ai-tool-name">
                              gh api を許可
                            </div>
                            <div className="ai-tool-desc">
                              GitHub REST API への直接アクセス (gh api ...) を
                              追加で許可します。
                            </div>
                            <div className="ai-tool-warning">
                              ⚠ POST/PATCH/DELETE を含む任意の API 呼び出しが可能になります。
                            </div>
                          </div>
                        </label>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface GitHubSectionProps {
  status: GitHubStatus | null;
  repos: RepoInfo[];
  onRequestRepoList: () => void;
  onLinkRepo: Props["onLinkRepo"];
  onUnlink: () => void;
  onSyncNow: () => void;
  onPullNow: () => void;
  onToggleAutoSync: (v: boolean) => void;
}

function GitHubSection({
  status,
  repos,
  onRequestRepoList,
  onLinkRepo,
  onUnlink,
  onSyncNow,
  onPullNow,
  onToggleAutoSync,
}: GitHubSectionProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!status) {
    return <div className="settings-row-desc">読み込み中…</div>;
  }

  if (!status.authOk) {
    return (
      <div className="gh-section">
        <div className="settings-row-label">GitHub CLI 未認証</div>
        <div className="settings-row-desc">
          ターミナルで <code>gh auth login</code> を実行し、サーバを再起動してください。
        </div>
        {status.authError && (
          <div className="gh-error">{status.authError}</div>
        )}
      </div>
    );
  }

  if (!status.linked) {
    return (
      <div className="gh-section">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">GitHub 未連携</div>
            <div className="settings-row-desc">
              ログイン中: <strong>{status.authUser}</strong> — 任意のリポジトリに
              <code>todome.db</code> を保存します。
            </div>
          </div>
          <button
            className="gh-btn gh-btn--primary"
            type="button"
            onClick={() => {
              onRequestRepoList();
              setPickerOpen(true);
            }}
          >
            連携する
          </button>
        </div>
        {status.lastError && <div className="gh-error">{status.lastError}</div>}
        {pickerOpen && (
          <RepoPicker
            repos={repos}
            defaultName="todome"
            onCancel={() => setPickerOpen(false)}
            onSelect={(owner, name) => {
              onLinkRepo({ owner, name, create: false, private: true });
              setPickerOpen(false);
            }}
            onCreate={(name, isPrivate) => {
              onLinkRepo({ name, create: true, private: isPrivate });
              setPickerOpen(false);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="gh-section">
      <div className="settings-row">
        <div>
          <div className="settings-row-label">
            連携済:{" "}
            <a
              href={`https://github.com/${status.owner}/${status.repo}`}
              target="_blank"
              rel="noreferrer"
            >
              {status.owner}/{status.repo}
            </a>
          </div>
          <div className="settings-row-desc">
            {status.syncing
              ? "同期中…"
              : `最終同期: ${formatDate(status.lastSyncAt)}`}
          </div>
        </div>
        <div className="gh-actions">
          <button
            className="gh-btn"
            type="button"
            onClick={onSyncNow}
            disabled={status.syncing}
          >
            Sync now
          </button>
          <button
            className="gh-btn"
            type="button"
            onClick={onPullNow}
            disabled={status.syncing}
          >
            Pull
          </button>
          <button
            className="gh-btn gh-btn--danger"
            type="button"
            onClick={onUnlink}
            disabled={status.syncing}
          >
            解除
          </button>
        </div>
      </div>
      <div className="settings-row">
        <label className="gh-checkbox">
          <input
            type="checkbox"
            checked={status.autoSync}
            onChange={(e) => onToggleAutoSync(e.target.checked)}
          />
          <span>自動同期 (変更から20秒後に commit & push)</span>
        </label>
      </div>
      {status.lastError && <div className="gh-error">{status.lastError}</div>}
    </div>
  );
}

interface RepoPickerProps {
  repos: RepoInfo[];
  defaultName: string;
  onCancel: () => void;
  onSelect: (owner: string, name: string) => void;
  onCreate: (name: string, isPrivate: boolean) => void;
}

function RepoPicker({
  repos,
  defaultName,
  onCancel,
  onSelect,
  onCreate,
}: RepoPickerProps) {
  const [search, setSearch] = useState(defaultName);
  const [newName, setNewName] = useState(defaultName);
  const [newPrivate, setNewPrivate] = useState(true);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) =>
      r.nameWithOwner.toLowerCase().includes(q),
    );
  }, [repos, search]);

  return (
    <div className="gh-picker-overlay" onClick={onCancel}>
      <div className="gh-picker" onClick={(e) => e.stopPropagation()}>
        <div className="gh-picker-head">
          <h3>リポジトリを選択</h3>
          <button className="gh-picker-close" type="button" onClick={onCancel}>
            ×
          </button>
        </div>

        <div className="gh-picker-section">
          <label className="gh-picker-label">既存のリポジトリから選ぶ</label>
          <input
            className="gh-picker-search"
            type="text"
            placeholder="リポジトリ名で絞り込み"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="gh-repo-list">
            {filtered.length === 0 ? (
              <div className="gh-repo-empty">
                {repos.length === 0
                  ? "リストを読み込み中…"
                  : "該当するリポジトリが見つかりません"}
              </div>
            ) : (
              filtered.map((r) => (
                <button
                  key={r.nameWithOwner}
                  className="gh-repo-row"
                  type="button"
                  onClick={() => onSelect(r.owner.login, r.name)}
                >
                  <span className="gh-repo-name">{r.nameWithOwner}</span>
                  {r.isPrivate && (
                    <span className="gh-repo-badge">Private</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="gh-picker-section">
          <label className="gh-picker-label">新規リポジトリを作成</label>
          <div className="gh-picker-row">
            <input
              className="gh-picker-search"
              type="text"
              placeholder="リポジトリ名"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <label className="gh-checkbox">
              <input
                type="checkbox"
                checked={newPrivate}
                onChange={(e) => setNewPrivate(e.target.checked)}
              />
              <span>Private</span>
            </label>
            <button
              className="gh-btn gh-btn--primary"
              type="button"
              disabled={!newName.trim()}
              onClick={() => onCreate(newName.trim(), newPrivate)}
            >
              作成して連携
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
