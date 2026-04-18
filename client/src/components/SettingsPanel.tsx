import { useMemo, useState } from "react";
import type { ThemeName } from "../theme";
import type { GitHubStatus, RepoInfo } from "../types";

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
}

const THEMES: {
  id: ThemeName;
  name: string;
  sub: string;
  sidebar: string;
  surface: string;
  accent: string;
  fg: string;
  line: string;
  muted: string;
}[] = [
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
];

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
}: Props) {
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
              <div className="theme-switch">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    className={`theme-option ${
                      theme === t.id ? "theme-option--active" : ""
                    }`}
                    onClick={() => setTheme(t.id)}
                    type="button"
                  >
                    <div
                      className="theme-preview"
                      style={{ borderColor: t.line }}
                    >
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
                ))}
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
