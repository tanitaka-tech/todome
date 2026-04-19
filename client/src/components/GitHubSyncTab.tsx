import { useEffect, useRef, useState } from "react";
import type {
  CommitDiffEntry,
  CommitDiffSummary,
  GitCommit,
  GitHubStatus,
} from "../types";

interface Props {
  status: GitHubStatus;
  tick: number;
  commits: GitCommit[];
  commitDiffs: Record<string, CommitDiffEntry>;
  onSyncNow: () => void;
  onPullNow: () => void;
  onListCommits: () => void;
  onRequestCommitDiff: (hash: string) => void;
  onRestoreCommit: (hash: string) => void;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "未同期";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "たった今";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}日前`;
  return d.toLocaleDateString();
}

function formatFull(iso: string | null): string {
  if (!iso) return "未同期";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function hasAnyChange(summary: CommitDiffSummary): boolean {
  const s = summary;
  return (
    s.tasks.added + s.tasks.removed + s.tasks.modified +
      s.goals.added + s.goals.removed + s.goals.modified +
      s.retros.added + s.retros.removed + s.retros.modified >
      0 || s.profileChanged
  );
}

function renderCounts(
  label: string,
  c: { added: number; removed: number; modified: number },
) {
  if (c.added + c.removed + c.modified === 0) return null;
  return (
    <div className="sidebar-github-commit-tip-row">
      <span className="sidebar-github-commit-tip-label">{label}</span>
      {c.added > 0 && (
        <span className="sidebar-github-commit-tip-added">+{c.added}</span>
      )}
      {c.removed > 0 && (
        <span className="sidebar-github-commit-tip-removed">-{c.removed}</span>
      )}
      {c.modified > 0 && (
        <span className="sidebar-github-commit-tip-modified">~{c.modified}</span>
      )}
    </div>
  );
}

export function GitHubSyncTab({
  status,
  tick,
  commits,
  commitDiffs,
  onSyncNow,
  onPullNow,
  onListCommits,
  onRequestCommitDiff,
  onRestoreCommit,
}: Props) {
  void tick;
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ bottom: number; left: number } | null>(
    null,
  );
  const [hoveredHash, setHoveredHash] = useState<string | null>(null);
  const tabRef = useRef<HTMLButtonElement | null>(null);
  const closeTimer = useRef<number | null>(null);
  const requestedDiffs = useRef<Set<string>>(new Set());
  const needsSync = status.pendingSync && !status.syncing;
  const label = status.syncing ? "同期中" : formatRelative(status.lastSyncAt);
  const title = status.syncing
    ? "同期中…"
    : `最終同期: ${formatFull(status.lastSyncAt)}`;

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setHoveredHash(null);
      closeTimer.current = null;
    }, 150);
  };

  const handleEnter = () => {
    cancelClose();
    if (tabRef.current) {
      const r = tabRef.current.getBoundingClientRect();
      setAnchor({
        bottom: window.innerHeight - r.bottom,
        left: r.right + 6,
      });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (open) {
      onListCommits();
      requestedDiffs.current.clear();
    }
  }, [open, onListCommits]);

  const handleCommitEnter = (hash: string) => {
    setHoveredHash(hash);
    if (!commitDiffs[hash] && !requestedDiffs.current.has(hash)) {
      requestedDiffs.current.add(hash);
      onRequestCommitDiff(hash);
    }
  };

  const handleCommitClick = (commit: GitCommit) => {
    const ok = window.confirm(
      `この時点 (${commit.shortHash}) の状態にデータを復元します。\n現在の状態は「restore」コミットとして上書きされます (履歴は GitHub 上に残ります)。\nよろしいですか?`,
    );
    if (ok) {
      onRestoreCommit(commit.hash);
      setOpen(false);
      setHoveredHash(null);
    }
  };

  const hoveredDiff = hoveredHash ? commitDiffs[hoveredHash] : undefined;

  return (
    <div
      className="sidebar-github"
      onMouseEnter={handleEnter}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={tabRef}
        className="sidebar-github-tab"
        type="button"
        title={title}
      >
        <span className="sidebar-github-icon">
          {status.syncing ? (
            <span className="sidebar-github-spinner" aria-label="同期中">
              <span />
              <span />
              <span />
            </span>
          ) : (
            <svg
              viewBox="0 0 16 16"
              width="18"
              height="18"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
          )}
          {needsSync && <span className="sidebar-github-badge" aria-label="要同期" />}
        </span>
        <span className="sidebar-github-label">{label}</span>
      </button>
      {open && anchor && (
        <div
          className="sidebar-github-popup"
          role="menu"
          style={{ bottom: anchor.bottom, left: anchor.left }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="sidebar-github-popup-header">
            {status.owner}/{status.repo}
          </div>
          <button
            type="button"
            className="sidebar-github-popup-btn"
            onClick={() => {
              onSyncNow();
              setOpen(false);
            }}
            disabled={status.syncing}
          >
            ⇅ 同期 (Push)
          </button>
          <button
            type="button"
            className="sidebar-github-popup-btn"
            onClick={() => {
              onPullNow();
              setOpen(false);
            }}
            disabled={status.syncing}
          >
            ↓ Pull
          </button>

          <div className="sidebar-github-history-title">履歴から復元</div>
          <div className="sidebar-github-commits">
            {commits.length === 0 ? (
              <div className="sidebar-github-commits-empty">
                {status.syncing ? "取得中…" : "履歴がありません"}
              </div>
            ) : (
              commits.map((commit) => (
                <button
                  key={commit.hash}
                  type="button"
                  className="sidebar-github-commit"
                  onMouseEnter={() => handleCommitEnter(commit.hash)}
                  onMouseLeave={() => setHoveredHash((p) => (p === commit.hash ? null : p))}
                  onClick={() => handleCommitClick(commit)}
                  disabled={status.syncing}
                  title={commit.message}
                >
                  <span className="sidebar-github-commit-hash">
                    {commit.shortHash}
                  </span>
                  <span className="sidebar-github-commit-date">
                    {formatRelative(commit.date)}
                  </span>
                  <span className="sidebar-github-commit-msg">
                    {commit.message}
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="sidebar-github-popup-foot">
            {status.syncing
              ? "同期中…"
              : `最終同期: ${formatFull(status.lastSyncAt)}`}
          </div>

          {hoveredHash && (
            <div
              className="sidebar-github-commit-tip"
              style={{ bottom: anchor.bottom, left: anchor.left + 320 }}
            >
              {!hoveredDiff ? (
                <div className="sidebar-github-commit-tip-loading">
                  差分を計算中…
                </div>
              ) : hoveredDiff.error ? (
                <div className="sidebar-github-commit-tip-error">
                  {hoveredDiff.error}
                </div>
              ) : hoveredDiff.summary && hasAnyChange(hoveredDiff.summary) ? (
                <>
                  <div className="sidebar-github-commit-tip-head">
                    復元した場合の変更
                  </div>
                  {renderCounts("タスク", hoveredDiff.summary.tasks)}
                  {renderCounts("ゴール", hoveredDiff.summary.goals)}
                  {renderCounts("振り返り", hoveredDiff.summary.retros)}
                  {hoveredDiff.summary.profileChanged && (
                    <div className="sidebar-github-commit-tip-row">
                      <span className="sidebar-github-commit-tip-label">
                        プロフィール
                      </span>
                      <span className="sidebar-github-commit-tip-modified">
                        変更あり
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="sidebar-github-commit-tip-nochange">
                  現在と同じ内容です
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
