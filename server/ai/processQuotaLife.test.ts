import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDb, resetDbCache } from "../db.ts";
import { githubState } from "../state.ts";
import type { LifeActivity, Quota } from "../types.ts";
import {
  loadAllLifeLogs,
  saveLifeActivities,
  startLifeLog,
} from "../storage/life.ts";
import {
  loadAllQuotaLogs,
  saveQuotas,
  startQuotaLog,
} from "../storage/quota.ts";
import { processQuotaLifeActions } from "./processQuotaLife.ts";

function makeQuota(partial: Partial<Quota> & Pick<Quota, "id" | "name">): Quota {
  return {
    icon: "Q",
    targetMinutes: 30,
    archived: false,
    createdAt: "2026-08-12T00:00:00",
    ...partial,
  };
}

function makeActivity(
  partial: Partial<LifeActivity> & Pick<LifeActivity, "id" | "name">
): LifeActivity {
  return {
    icon: "A",
    category: "other",
    softLimitMinutes: 0,
    hardLimitMinutes: 0,
    limitScope: "per_session",
    archived: false,
    ...partial,
  };
}

beforeEach(() => {
  resetDbCache();
  const db = getDb();
  db.exec("DELETE FROM life_activities");
  db.exec("DELETE FROM life_logs");
  db.exec("DELETE FROM quotas");
  db.exec("DELETE FROM quota_logs");
  githubState.diffCache.clear();
});

afterEach(() => {
  resetDbCache();
});

describe("processQuotaLifeActions — timer start boundaries", () => {
  it("存在しないquotaIdの開始指示は既存のアクティブログを止めない", () => {
    saveQuotas([makeQuota({ id: "q1", name: "掃除" })]);
    const active = startQuotaLog("q1");

    const result = processQuotaLifeActions([
      { content: "QUOTA_LOG_START:missing-quota" },
    ]);

    expect(result.quotaLogStarted).toBeNull();
    expect(result.quotaLogStopped).toBe(false);
    expect(result.todayQuotaLogs).toBeNull();
    const logs = loadAllQuotaLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.id).toBe(active.id);
    expect(logs[0]?.quotaId).toBe("q1");
    expect(logs[0]?.endedAt).toBe("");
  });

  it("archived quotaの開始指示は既存のアクティブログを止めない", () => {
    saveQuotas([
      makeQuota({ id: "q1", name: "掃除" }),
      makeQuota({ id: "q2", name: "古いノルマ", archived: true }),
    ]);
    const active = startQuotaLog("q1");

    const result = processQuotaLifeActions([{ content: "QUOTA_LOG_START:q2" }]);

    expect(result.quotaLogStarted).toBeNull();
    const logs = loadAllQuotaLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.id).toBe(active.id);
    expect(logs[0]?.endedAt).toBe("");
  });

  it("存在しないactivityIdやarchived activityの開始指示は既存のアクティブログを止めない", () => {
    saveLifeActivities([
      makeActivity({ id: "a1", name: "食事" }),
      makeActivity({ id: "a2", name: "古い活動", archived: true }),
    ]);
    const active = startLifeLog("a1");

    const missingResult = processQuotaLifeActions([
      { content: "LIFE_LOG_START:missing-activity" },
    ]);
    const archivedResult = processQuotaLifeActions([
      { content: "LIFE_LOG_START:a2" },
    ]);

    expect(missingResult.lifeLogStarted).toBeNull();
    expect(archivedResult.lifeLogStarted).toBeNull();
    const logs = loadAllLifeLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.id).toBe(active.id);
    expect(logs[0]?.activityId).toBe("a1");
    expect(logs[0]?.endedAt).toBe("");
  });

  it("有効な未archive IDなら従来どおり新しいログを開始する", () => {
    saveQuotas([
      makeQuota({ id: "q1", name: "掃除" }),
      makeQuota({ id: "q2", name: "運動" }),
    ]);
    const active = startQuotaLog("q1");

    const result = processQuotaLifeActions([{ content: "QUOTA_LOG_START:q2" }]);

    expect(result.quotaLogStarted?.quotaId).toBe("q2");
    const logs = loadAllQuotaLogs();
    expect(logs).toHaveLength(2);
    expect(logs.find((log) => log.id === active.id)?.endedAt).not.toBe("");
    expect(logs.find((log) => log.quotaId === "q2")?.endedAt).toBe("");
  });
});
