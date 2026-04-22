import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatDate, formatDateTime } from "../i18n/format";
import type {
  CommitDiffDetails,
  CommitDiffEntry,
  GitCommit,
  GitHubStatus,
  LabeledId,
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

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function formatRelative(iso: string | null, t: TFn): string {
  if (!iso) return t("notSynced");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return t("dash");
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return t("justNow");
  const min = Math.floor(sec / 60);
  if (min < 60) return t("minutesAgo", { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("hoursAgo", { count: hr });
  const day = Math.floor(hr / 24);
  if (day < 7) return t("daysAgo", { count: day });
  return formatDate(d);
}

function formatFull(iso: string | null, t: TFn): string {
  if (!iso) return t("notSynced");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatDateTime(d);
}

function hasAnyChangeInDetails(details: CommitDiffDetails): boolean {
  const sections = [
    details.tasks,
    details.goals,
    details.retros,
    details.lifeActivities,
    details.lifeLogs,
    details.quotas,
    details.quotaLogs,
  ];
  for (const s of sections) {
    if (s.added.length || s.removed.length || s.modified.length) return true;
  }
  return details.profileChanged;
}

type ChangeKind = "added" | "removed" | "modified";

const KIND_LABEL_KEY: Record<ChangeKind, string> = {
  added: "kindAdded",
  removed: "kindRemoved",
  modified: "kindModified",
};

const KIND_CLASS: Record<ChangeKind, string> = {
  added: "sidebar-github-commit-tip-added",
  removed: "sidebar-github-commit-tip-removed",
  modified: "sidebar-github-commit-tip-modified",
};

function renderSection(
  title: string,
  section: { added: LabeledId[]; removed: LabeledId[]; modified: LabeledId[] },
  t: TFn,
) {
  const kinds: ChangeKind[] = ["added", "removed", "modified"];
  const items: { kind: ChangeKind; entry: LabeledId }[] = [];
  for (const kind of kinds) {
    for (const entry of section[kind]) {
      items.push({ kind, entry });
    }
  }
  if (items.length === 0) return null;
  return (
    <div className="sidebar-github-commit-tip-section">
      <div className="sidebar-github-commit-tip-section-title">{title}</div>
      {items.map(({ kind, entry }) => (
        <div
          key={`${kind}-${entry.id}`}
          className="sidebar-github-commit-tip-item"
        >
          <span className={KIND_CLASS[kind]}>{t(KIND_LABEL_KEY[kind])}</span>
          <span className="sidebar-github-commit-tip-item-label" title={entry.label}>
            {entry.label}
          </span>
        </div>
      ))}
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
  const { t } = useTranslation("github");
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
  const label = status.syncing
    ? t("syncing")
    : formatRelative(status.lastSyncAt, t);
  const title = status.syncing
    ? t("syncingEllipsis")
    : t("lastSync", { date: formatFull(status.lastSyncAt, t) });

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
    const ok = window.confirm(t("restoreConfirm", { hash: commit.shortHash }));
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
            <span className="sidebar-github-spinner" aria-label={t("ariaSyncing")}>
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
          {needsSync && (
            <span className="sidebar-github-badge" aria-label={t("ariaNeedsSync")} />
          )}
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

          <div className="sidebar-github-history-title">{t("historyTitle")}</div>
          <div className="sidebar-github-commits">
            {commits.length === 0 ? (
              <div className="sidebar-github-commits-empty">
                {status.syncing ? t("commitsLoading") : t("commitsEmpty")}
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
                    {formatRelative(commit.date, t)}
                  </span>
                  <span className="sidebar-github-commit-msg">
                    {commit.message}
                  </span>
                </button>
              ))
            )}
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
            {t("syncPush")}
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
            {t("pull")}
          </button>

          <div className="sidebar-github-popup-foot">
            {status.syncing
              ? t("syncingEllipsis")
              : t("lastSync", { date: formatFull(status.lastSyncAt, t) })}
          </div>

          {hoveredHash && (
            <div
              className="sidebar-github-commit-tip"
              style={{ bottom: anchor.bottom, left: anchor.left + 320 }}
            >
              {!hoveredDiff ? (
                <div className="sidebar-github-commit-tip-loading">
                  {t("diffLoading")}
                </div>
              ) : hoveredDiff.error ? (
                <div className="sidebar-github-commit-tip-error">
                  {hoveredDiff.error}
                </div>
              ) : hoveredDiff.details && hasAnyChangeInDetails(hoveredDiff.details) ? (
                <>
                  <div className="sidebar-github-commit-tip-head">
                    {t("restoreHead")}
                  </div>
                  {renderSection(t("sectionTasks"), hoveredDiff.details.tasks, t)}
                  {renderSection(t("sectionGoals"), hoveredDiff.details.goals, t)}
                  {renderSection(t("sectionRetros"), hoveredDiff.details.retros, t)}
                  {renderSection(
                    t("sectionLifeActivities"),
                    hoveredDiff.details.lifeActivities,
                    t,
                  )}
                  {renderSection(
                    t("sectionLifeLogs"),
                    hoveredDiff.details.lifeLogs,
                    t,
                  )}
                  {renderSection(t("sectionQuotas"), hoveredDiff.details.quotas, t)}
                  {renderSection(
                    t("sectionQuotaLogs"),
                    hoveredDiff.details.quotaLogs,
                    t,
                  )}
                  {hoveredDiff.details.profileChanged && (
                    <div className="sidebar-github-commit-tip-section">
                      <div className="sidebar-github-commit-tip-section-title">
                        {t("sectionProfile")}
                      </div>
                      <div className="sidebar-github-commit-tip-item">
                        <span className="sidebar-github-commit-tip-modified">
                          {t("kindModified")}
                        </span>
                        <span className="sidebar-github-commit-tip-item-label">
                          {t("profileChangedLabel")}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="sidebar-github-commit-tip-nochange">
                  {t("noChange")}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
