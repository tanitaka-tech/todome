import { loadAppConfig, saveAppConfig } from "../../storage/appConfig.ts";
import { loadTodayLifeLogs } from "../../storage/life.ts";
import {
  computeAllQuotaStreaks,
  loadAllQuotaLogs,
  loadQuotas,
  loadTodayQuotaLogs,
} from "../../storage/quota.ts";
import { broadcast } from "../broadcast.ts";
import type { Handler } from "../dispatch.ts";

export const appConfigUpdate: Handler = async (_ws, _session, data) => {
  const prev = loadAppConfig();
  const normalized = saveAppConfig(data.config ?? {});
  broadcast({ type: "app_config_sync", config: normalized });
  if (prev.dayBoundaryHour !== normalized.dayBoundaryHour) {
    broadcast({ type: "life_log_sync", logs: loadTodayLifeLogs() });
    broadcast({ type: "quota_log_sync", logs: loadTodayQuotaLogs() });
    broadcast({
      type: "quota_streak_sync",
      streaks: computeAllQuotaStreaks(loadQuotas(), loadAllQuotaLogs()),
    });
  }
};
