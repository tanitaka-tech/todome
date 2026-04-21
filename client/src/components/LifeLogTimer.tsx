import { useTranslation } from "react-i18next";
import type { LifeActivity, LifeLog } from "../types";
import {
  formatDuration,
  lifeLogAlertLevel,
  lifeLogDurationSeconds,
} from "../types";
import { WaveText } from "./WaveText";

interface Props {
  activity: LifeActivity;
  log: LifeLog;
  tick: number;
  onStop: () => void;
  onClose: () => void;
}

export function LifeLogTimer({ activity, log, tick: _tick, onStop, onClose }: Props) {
  const { t } = useTranslation("lifeLog");
  const elapsed = lifeLogDurationSeconds(log);
  const alert = lifeLogAlertLevel(activity, elapsed);
  const limitLabel =
    activity.softLimitMinutes > 0
      ? formatDuration(activity.softLimitMinutes * 60)
      : activity.hardLimitMinutes > 0
        ? formatDuration(activity.hardLimitMinutes * 60)
        : "";

  const cls = [
    "timer-popup",
    "timer-popup--lifelog",
    alert === "hard" ? "timer-popup--hard" : "",
    alert === "soft" ? "timer-popup--soft" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      <div className="timer-popup-pulse" />
      <div className="timer-popup-body">
        <div className="timer-popup-title">
          <span className="timer-popup-lifelog-icon">{activity.icon}</span>
          <WaveText text={activity.name} />
        </div>
        <div className="timer-popup-meta">
          {alert === "hard" && (
            <span className="timer-popup-status-badge timer-popup-status-badge--danger">
              ⚠ {t("overLimit")}
            </span>
          )}
          {alert === "soft" && (
            <span className="timer-popup-status-badge timer-popup-status-badge--warn">
              ⚠
            </span>
          )}
        </div>
      </div>
      <div className="timer-popup-time">
        {formatDuration(elapsed)}
        {limitLabel && (
          <span className="timer-popup-estimate">/{limitLabel}</span>
        )}
      </div>
      <div className="timer-popup-actions">
        <button
          className="timer-popup-btn timer-popup-btn--pause"
          onClick={onStop}
          title={t("stopNow")}
        >
          &#9632; {t("stopNow")}
        </button>
        <button
          className="timer-popup-close"
          onClick={onClose}
          title={t("close")}
        >
          &times;
        </button>
      </div>
    </div>
  );
}
