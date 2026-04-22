import { useTranslation } from "react-i18next";
import { useTick } from "../hooks/useTick";
import type { Quota, QuotaLog } from "../types";
import {
  formatDuration,
  quotaIsAchieved,
  quotaLogDurationSeconds,
  quotaTodayTotalSeconds,
} from "../types";
import { WaveText } from "./WaveText";

interface Props {
  quota: Quota;
  log: QuotaLog;
  allLogs: QuotaLog[];
  dayBoundaryHour: number;
  onStop: () => void;
  onClose: () => void;
}

export function QuotaTimer({
  quota,
  log,
  allLogs,
  dayBoundaryHour,
  onStop,
  onClose,
}: Props) {
  const { t } = useTranslation("quota");
  useTick();
  const elapsed = quotaLogDurationSeconds(log);
  const todayTotal = quotaTodayTotalSeconds(quota.id, allLogs, dayBoundaryHour);
  const achieved = quotaIsAchieved(quota, todayTotal);
  const targetLabel =
    quota.targetMinutes > 0
      ? formatDuration(quota.targetMinutes * 60)
      : "";

  const cls = [
    "timer-popup",
    "timer-popup--quota",
    achieved ? "timer-popup--achieved" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      <div className="timer-popup-pulse" />
      <div className="timer-popup-body">
        <div className="timer-popup-title">
          <span className="timer-popup-lifelog-icon">{quota.icon}</span>
          <WaveText text={quota.name} />
        </div>
        <div className="timer-popup-meta">
          {achieved && (
            <span className="timer-popup-status-badge timer-popup-status-badge--success">
              ✓ {t("achieved")}
            </span>
          )}
        </div>
      </div>
      <div className="timer-popup-time">
        {formatDuration(elapsed)}
        {targetLabel && (
          <span className="timer-popup-estimate">
            {" "}
            · {formatDuration(todayTotal)}/{targetLabel}
          </span>
        )}
      </div>
      <div className="timer-popup-actions">
        <button
          className="timer-popup-btn timer-popup-btn--pause"
          onClick={onStop}
          title={t("stopNow", "停止")}
        >
          &#9632; {t("stopNow", "停止")}
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
