import { useRef, useState } from "react";
import type { GitHubStatus } from "../types";

interface Props {
  status: GitHubStatus;
  tick: number;
  onSyncNow: () => void;
  onPullNow: () => void;
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

export function GitHubSyncTab({ status, tick, onSyncNow, onPullNow }: Props) {
  void tick;
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ bottom: number; left: number } | null>(
    null,
  );
  const tabRef = useRef<HTMLButtonElement | null>(null);
  const closeTimer = useRef<number | null>(null);
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
          <div className="sidebar-github-popup-foot">
            {status.syncing
              ? "同期中…"
              : `最終同期: ${formatFull(status.lastSyncAt)}`}
          </div>
        </div>
      )}
    </div>
  );
}
