import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  KanbanTask,
  Quota,
  QuotaLog,
  QuotaStreak,
} from "../types";
import {
  formatDuration,
  isQuotaLogActive,
  quotaIsAchieved,
  quotaTodayTotalSeconds,
  streakRank,
} from "../types";
import { QuotaEditor } from "./QuotaEditor";
import { QuotaManager } from "./QuotaManager";

interface Props {
  quotas: Quota[];
  logs: QuotaLog[];
  streaks: QuotaStreak[];
  tasks: KanbanTask[];
  tick: number;
  send: (data: unknown) => void;
  onStopTaskTimer: (taskId: string) => void;
  dayBoundaryHour: number;
}

const CONFETTI_COLORS = [
  "#f97316",
  "#facc15",
  "#22d3ee",
  "#a855f7",
  "#ef4444",
  "#10b981",
  "#ec4899",
  "#3b82f6",
];

function Confetti() {
  return (
    <div className="quota-confetti" aria-hidden>
      {Array.from({ length: 18 }).map((_, i) => (
        <span
          key={i}
          className="quota-confetti-piece"
          style={{
            ["--c" as string]: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            ["--dx" as string]: `${(i - 9) * 6}px`,
            ["--delay" as string]: `${(i % 6) * 60}ms`,
          }}
        />
      ))}
      <span className="quota-confetti-label">🎉</span>
    </div>
  );
}

export function QuotaSection({
  quotas,
  logs,
  streaks,
  tasks,
  tick,
  send,
  onStopTaskTimer,
  dayBoundaryHour,
}: Props) {
  const { t } = useTranslation("quota");
  const [editorQuota, setEditorQuota] = useState<Quota | "new" | null>(null);
  const [showManager, setShowManager] = useState(false);
  const [celebrating, setCelebrating] = useState<Record<string, number>>({});
  const prevAchievedRef = useRef<Set<string>>(new Set());

  const nowMs = useMemo(
    // eslint-disable-next-line react-hooks/purity
    () => Date.now(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick],
  );
  const visibleQuotas = useMemo(
    () => quotas.filter((q) => !q.archived),
    [quotas],
  );
  const activeLog = useMemo(
    () => logs.find((l) => isQuotaLogActive(l)) || null,
    [logs],
  );
  const runningTask = useMemo(
    () => tasks.find((t) => !!t.timerStartedAt) || null,
    [tasks],
  );

  const streakMap = useMemo(() => {
    const m = new Map<string, QuotaStreak>();
    for (const s of streaks) m.set(s.quotaId, s);
    return m;
  }, [streaks]);

  // 達成瞬間検知（前回未達 → 今回達成）。
  // props (logs) 変化をトリガーにワンショットのお祝い演出を起動するため、
  // setState を effect 内で呼ぶ（React コンパイラの cascading-render ヒューリスティックは
  // 今回のユースケースでは安全：setTimeout でクリーンアップされ、タイミングも限定的）。
  useEffect(() => {
    const nowAchieved = new Set<string>();
    for (const q of visibleQuotas) {
      const secs = quotaTodayTotalSeconds(q.id, logs, dayBoundaryHour, nowMs);
      if (quotaIsAchieved(q, secs)) nowAchieved.add(q.id);
    }
    const newly: string[] = [];
    for (const id of nowAchieved) {
      if (!prevAchievedRef.current.has(id)) newly.push(id);
    }
    prevAchievedRef.current = nowAchieved;
    if (newly.length === 0) return;
    const ts = Date.now();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCelebrating((prev) => {
      const next = { ...prev };
      for (const id of newly) next[id] = ts;
      return next;
    });
    const timers = newly.map((id) =>
      window.setTimeout(() => {
        setCelebrating((prev) => {
          if (prev[id] !== ts) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }, 2600),
    );
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, [visibleQuotas, logs, nowMs, dayBoundaryHour]);

  const handleStart = (quota: Quota) => {
    if (activeLog && activeLog.quotaId === quota.id) {
      send({ type: "quota_log_stop", log_id: activeLog.id });
      return;
    }
    const next = `${quota.icon} ${quota.name}`;
    if (activeLog) {
      const current = quotas.find((q) => q.id === activeLog.quotaId);
      const ok = window.confirm(
        t("stopConfirm", {
          name: current ? `${current.icon} ${current.name}` : "?",
          next,
        }),
      );
      if (!ok) return;
    }
    if (runningTask) {
      onStopTaskTimer(runningTask.id);
    }
    send({ type: "quota_log_start", quota_id: quota.id });
  };

  const handleUpsert = (q: Quota) => {
    send({ type: "quota_upsert", quota: q });
    setEditorQuota(null);
  };

  const handleDelete = (id: string) => {
    send({ type: "quota_delete", id });
  };

  const handleArchiveToggle = (q: Quota) => {
    send({
      type: "quota_upsert",
      quota: { ...q, archived: !q.archived },
    });
  };

  const handleReorder = (ids: string[]) => {
    send({ type: "quota_reorder", ids });
  };

  return (
    <div className="quota-section">
      <div className="life-log-header">
        <h3 className="life-log-title">{t("sectionTitle")}</h3>
        <div className="life-log-header-actions">
          <button
            className="life-log-header-btn"
            onClick={() => setEditorQuota("new")}
          >
            {t("addQuota")}
          </button>
          <button
            className="life-log-header-btn"
            onClick={() => setShowManager(true)}
          >
            {t("manage")}
          </button>
        </div>
      </div>

      {visibleQuotas.length === 0 ? (
        <div className="life-log-empty">{t("noQuotas")}</div>
      ) : (
        <div className="quota-cards">
          {visibleQuotas.map((quota) => {
            const isActive = !!activeLog && activeLog.quotaId === quota.id;
            const todaySecs = quotaTodayTotalSeconds(
              quota.id,
              logs,
              dayBoundaryHour,
              nowMs,
            );
            const achieved = quotaIsAchieved(quota, todaySecs);
            const streak = streakMap.get(quota.id);
            const rank = streakRank(streak?.current ?? 0);
            const targetSec = quota.targetMinutes * 60;
            const progress =
              targetSec > 0
                ? Math.min(1, todaySecs / targetSec)
                : 0;
            const cls = [
              "quota-card",
              `quota-card--rank${rank}`,
              isActive ? "quota-card--active" : "",
              achieved ? "quota-card--achieved" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={quota.id}
                className={cls}
                onClick={() => handleStart(quota)}
                title={quota.name}
              >
                {celebrating[quota.id] && <Confetti />}
                <div className="quota-card-head">
                  <span className="quota-card-icon">{quota.icon}</span>
                  <span className="quota-card-name">{quota.name}</span>
                  {achieved && (
                    <span className="quota-card-check" aria-label={t("achieved")}>
                      ✓
                    </span>
                  )}
                </div>
                <div className="quota-card-time">
                  {isActive && (
                    <span className="quota-card-active-dot">●</span>
                  )}
                  <span className="quota-card-total">
                    {formatDuration(todaySecs)}
                  </span>
                  {quota.targetMinutes > 0 && (
                    <span className="quota-card-target">
                      / {formatDuration(targetSec)}
                    </span>
                  )}
                </div>
                {quota.targetMinutes > 0 && (
                  <div
                    className="quota-card-progress"
                    style={{ ["--p" as string]: `${progress * 100}%` }}
                  >
                    <div className="quota-card-progress-fill" />
                  </div>
                )}
                <div className={`quota-card-streak quota-card-streak--rank${rank}`}>
                  {streak && streak.current > 0 ? (
                    <>
                      <span className="quota-card-streak-fire">
                        {rank >= 4
                          ? "🌟"
                          : rank >= 3
                            ? "💥"
                            : rank >= 2
                              ? "🔥"
                              : "✨"}
                      </span>
                      <span className="quota-card-streak-text">
                        {t("streakDays", { count: streak.current })}
                      </span>
                      {streak.best > streak.current && (
                        <span className="quota-card-streak-best">
                          ({t("bestDays", { count: streak.best })})
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="quota-card-streak-idle">—</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {editorQuota && (
        <QuotaEditor
          quota={editorQuota === "new" ? null : editorQuota}
          onSave={handleUpsert}
          onClose={() => setEditorQuota(null)}
        />
      )}
      {showManager && (
        <QuotaManager
          quotas={quotas}
          onEdit={(q) => {
            setShowManager(false);
            setEditorQuota(q);
          }}
          onDelete={handleDelete}
          onArchiveToggle={handleArchiveToggle}
          onReorder={handleReorder}
          onAddNew={() => {
            setShowManager(false);
            setEditorQuota("new");
          }}
          onClose={() => setShowManager(false)}
        />
      )}
    </div>
  );
}
