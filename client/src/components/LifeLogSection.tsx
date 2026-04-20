import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { KanbanTask, LifeActivity, LifeLog } from "../types";
import {
  formatDuration,
  isLifeLogActive,
  lifeActivityTodayTotalSeconds,
  lifeLogAlertLevel,
  lifeLogDurationSeconds,
} from "../types";
import { LifeActivityEditor } from "./LifeActivityEditor";
import { LifeActivityManager } from "./LifeActivityManager";

interface Props {
  activities: LifeActivity[];
  logs: LifeLog[];
  tasks: KanbanTask[];
  tick: number;
  send: (data: unknown) => void;
  onStopTaskTimer: (taskId: string) => void;
}

export function LifeLogSection({
  activities,
  logs,
  tasks,
  tick,
  send,
  onStopTaskTimer,
}: Props) {
  const { t } = useTranslation("lifeLog");
  const [editorActivity, setEditorActivity] = useState<
    LifeActivity | "new" | null
  >(null);
  const [showManager, setShowManager] = useState(false);

  const nowMs = useMemo(
    // eslint-disable-next-line react-hooks/purity
    () => Date.now(),
    // tick 更新ごとに Date.now() を取り直して経過時間を再計算する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick],
  );
  const visibleActivities = useMemo(
    () => activities.filter((a) => !a.archived),
    [activities],
  );
  const activeLog = useMemo(
    () => logs.find((l) => isLifeLogActive(l)) || null,
    [logs],
  );

  const runningTask = useMemo(
    () => tasks.find((t) => !!t.timerStartedAt) || null,
    [tasks],
  );

  const handleStart = (activity: LifeActivity) => {
    if (activeLog && activeLog.activityId === activity.id) {
      send({ type: "life_log_stop", log_id: activeLog.id });
      return;
    }
    if (activeLog) {
      const current = activities.find((a) => a.id === activeLog.activityId);
      const ok = window.confirm(
        t("stopConfirm", {
          name: current ? `${current.icon} ${current.name}` : "?",
          next: `${activity.icon} ${activity.name}`,
        }),
      );
      if (!ok) return;
    }
    // タスク計測中でも確認は出さない。サーバー側の排他で自動停止される。
    if (runningTask) {
      onStopTaskTimer(runningTask.id);
    }
    send({ type: "life_log_start", activity_id: activity.id });
  };

  const handleUpsert = (a: LifeActivity) => {
    send({ type: "life_activity_upsert", activity: a });
    setEditorActivity(null);
  };

  const handleDelete = (id: string) => {
    send({ type: "life_activity_delete", id });
  };

  const handleArchiveToggle = (a: LifeActivity) => {
    send({
      type: "life_activity_upsert",
      activity: { ...a, archived: !a.archived },
    });
  };

  const handleReorder = (ids: string[]) => {
    send({ type: "life_activity_reorder", ids });
  };

  return (
    <div className="life-log-section">
      <div className="life-log-header">
        <h3 className="life-log-title">{t("sectionTitle")}</h3>
        <div className="life-log-header-actions">
          <button
            className="life-log-header-btn"
            onClick={() => setEditorActivity("new")}
          >
            {t("addActivity")}
          </button>
          <button
            className="life-log-header-btn"
            onClick={() => setShowManager(true)}
          >
            {t("manage")}
          </button>
        </div>
      </div>

      {visibleActivities.length === 0 ? (
        <div className="life-log-empty">{t("noActivities")}</div>
      ) : (
        <div className="life-log-buttons">
          {visibleActivities.map((activity) => {
            const isActive =
              !!activeLog && activeLog.activityId === activity.id;
            const activeSecs = isActive
              ? lifeLogDurationSeconds(activeLog, nowMs)
              : 0;
            const todaySecs = lifeActivityTodayTotalSeconds(
              activity.id,
              logs,
              nowMs,
            );
            const alert = lifeLogAlertLevel(
              activity,
              activity.limitScope === "per_day" ? todaySecs : activeSecs,
            );
            const displaySecs = isActive ? activeSecs : todaySecs;
            const cls = [
              "life-log-btn",
              isActive ? "life-log-btn--active" : "",
              alert === "hard" ? "life-log-btn--hard" : "",
              alert === "soft" ? "life-log-btn--soft" : "",
            ]
              .filter(Boolean)
              .join(" ");
            // 設定されているアラート時間。soft を優先、未設定なら hard、どちらも 0 なら表示しない。
            const limitMin =
              activity.softLimitMinutes > 0
                ? activity.softLimitMinutes
                : activity.hardLimitMinutes > 0
                  ? activity.hardLimitMinutes
                  : 0;
            return (
              <button
                key={activity.id}
                className={cls}
                onClick={() => handleStart(activity)}
                title={activity.name}
              >
                <span className="life-log-btn-icon">{activity.icon}</span>
                <span className="life-log-btn-name">{activity.name}</span>
                <span className="life-log-btn-time">
                  {displaySecs > 0 ? formatDuration(displaySecs) : "—"}
                  {limitMin > 0 && (
                    <span className="life-log-btn-limit">
                      /{formatDuration(limitMin * 60)}
                    </span>
                  )}
                  {alert === "hard" && (
                    <span className="life-log-btn-alert">⚠</span>
                  )}
                  {alert === "soft" && (
                    <span className="life-log-btn-alert life-log-btn-alert--soft">
                      ⚠
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {editorActivity && (
        <LifeActivityEditor
          activity={editorActivity === "new" ? null : editorActivity}
          onSave={handleUpsert}
          onClose={() => setEditorActivity(null)}
        />
      )}
      {showManager && (
        <LifeActivityManager
          activities={activities}
          onEdit={(a) => {
            setShowManager(false);
            setEditorActivity(a);
          }}
          onDelete={handleDelete}
          onArchiveToggle={handleArchiveToggle}
          onReorder={handleReorder}
          onAddNew={() => {
            setShowManager(false);
            setEditorActivity("new");
          }}
          onClose={() => setShowManager(false)}
        />
      )}
    </div>
  );
}
