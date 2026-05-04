import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { CALDAV_CONFIG_PATH } from "../config.ts";
import type { CalDAVConfig } from "../types.ts";
import {
  clearCalDAVConfig,
  isCalDAVConnected,
  loadCalDAVConfig,
  normalizeCalDAVConfig,
  resetCalDAVConfigCache,
  saveCalDAVConfig,
} from "./caldav.ts";

beforeEach(() => {
  resetCalDAVConfigCache();
  if (existsSync(CALDAV_CONFIG_PATH)) unlinkSync(CALDAV_CONFIG_PATH);
});

afterEach(() => {
  resetCalDAVConfigCache();
});

afterAll(() => {
  resetCalDAVConfigCache();
  if (existsSync(CALDAV_CONFIG_PATH)) unlinkSync(CALDAV_CONFIG_PATH);
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeCalDAVConfig（純粋関数）
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeCalDAVConfig — 正規化", () => {
  it("null / undefined / プリミティブ は空オブジェクトに正規化される", () => {
    expect(normalizeCalDAVConfig(null)).toEqual({});
    expect(normalizeCalDAVConfig(undefined)).toEqual({});
    expect(normalizeCalDAVConfig(42)).toEqual({});
    expect(normalizeCalDAVConfig("string")).toEqual({});
  });

  it("文字列フィールドはそのまま通る", () => {
    const result = normalizeCalDAVConfig({
      appleId: "me@icloud.com",
      appPassword: "abcd-efgh-ijkl-mnop",
      connectedAt: "2026-01-01T00:00:00",
      writeTargetCalendarUrl: "https://example.com/cal/",
      writeTargetCalendarName: "Work",
      writeTargetCalendarColor: "#ff0000",
    });
    expect(result.appleId).toBe("me@icloud.com");
    expect(result.appPassword).toBe("abcd-efgh-ijkl-mnop");
    expect(result.connectedAt).toBe("2026-01-01T00:00:00");
    expect(result.writeTargetCalendarUrl).toBe("https://example.com/cal/");
    expect(result.writeTargetCalendarName).toBe("Work");
    expect(result.writeTargetCalendarColor).toBe("#ff0000");
  });

  it("非文字列の appleId / appPassword は破棄され isCalDAVConnected が誤判定しない", () => {
    // 旧実装は as キャストのみで、{ appleId: 1, appPassword: 1 } が truthy なので
    // 接続済みと誤判定していた。normalize で文字列以外を捨てることで防ぐ。
    const result = normalizeCalDAVConfig({ appleId: 1, appPassword: 1 });
    expect(result.appleId).toBeUndefined();
    expect(result.appPassword).toBeUndefined();
  });

  it("空文字列フィールドは undefined に落とす", () => {
    const result = normalizeCalDAVConfig({ appleId: "", appPassword: "" });
    expect(result.appleId).toBeUndefined();
    expect(result.appPassword).toBeUndefined();
  });

  it("余分なキーは無視される", () => {
    const result = normalizeCalDAVConfig({
      appleId: "me@icloud.com",
      foo: "bar",
    });
    expect(result.appleId).toBe("me@icloud.com");
    expect("foo" in result).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// load / save / clear のラウンドトリップ
// ─────────────────────────────────────────────────────────────────────────────

describe("loadCalDAVConfig / saveCalDAVConfig — 永続化", () => {
  it("ファイルが無ければ空オブジェクトを返す", () => {
    expect(loadCalDAVConfig()).toEqual({});
    expect(isCalDAVConnected()).toBe(false);
  });

  it("save → reset → load で値を復元できる", () => {
    saveCalDAVConfig({
      appleId: "me@icloud.com",
      appPassword: "secret",
      connectedAt: "2026-01-01T00:00:00",
    });
    resetCalDAVConfigCache();
    const loaded = loadCalDAVConfig();
    expect(loaded.appleId).toBe("me@icloud.com");
    expect(loaded.appPassword).toBe("secret");
    expect(loaded.connectedAt).toBe("2026-01-01T00:00:00");
    expect(isCalDAVConnected()).toBe(true);
  });

  it("壊れた JSON は空オブジェクトにフォールバックする", () => {
    writeFileSync(CALDAV_CONFIG_PATH, "{ not valid json");
    resetCalDAVConfigCache();
    expect(loadCalDAVConfig()).toEqual({});
    expect(isCalDAVConnected()).toBe(false);
  });

  it("clearCalDAVConfig は state とファイルの両方を消す", () => {
    saveCalDAVConfig({ appleId: "me@icloud.com", appPassword: "secret" });
    expect(existsSync(CALDAV_CONFIG_PATH)).toBe(true);
    clearCalDAVConfig();
    expect(existsSync(CALDAV_CONFIG_PATH)).toBe(false);
    expect(loadCalDAVConfig()).toEqual({});
    expect(isCalDAVConnected()).toBe(false);
  });

  it("save 経由でも非文字列値は捨てられる", () => {
    // ランタイムで信頼できない値が混入した場合 (壊れた JSON 由来など) に備えて
    // saveCalDAVConfig は normalize を経由するため、unknown 経由で渡す。
    saveCalDAVConfig({ appleId: 1, appPassword: 1 } as unknown as CalDAVConfig);
    resetCalDAVConfigCache();
    expect(loadCalDAVConfig()).toEqual({});
  });
});
