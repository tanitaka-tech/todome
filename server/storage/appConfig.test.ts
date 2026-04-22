// NOTE: Bun は ES モジュールの import を巻き上げるため、この .test.ts の top-level で
// TODOME_DATA_DIR を設定しても config.ts の DATA_DIR は import 時点で解決済み。したがって
// APP_CONFIG_PATH は実データパスを指すため、テスト開始時に元の内容を退避し、終了時に
// 復元する。既存データを巻き込まない防御策。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { APP_CONFIG_PATH } from "../config.ts";
import {
  getDayBoundaryHour,
  loadAppConfig,
  normalizeAppConfig,
  resetAppConfigCache,
  saveAppConfig,
} from "./appConfig.ts";

let originalContent: string | null = null;

beforeAll(() => {
  originalContent = existsSync(APP_CONFIG_PATH)
    ? readFileSync(APP_CONFIG_PATH, "utf8")
    : null;
});

beforeEach(() => {
  resetAppConfigCache();
  if (existsSync(APP_CONFIG_PATH)) unlinkSync(APP_CONFIG_PATH);
});

afterEach(() => {
  resetAppConfigCache();
});

afterAll(() => {
  resetAppConfigCache();
  if (originalContent !== null) {
    writeFileSync(APP_CONFIG_PATH, originalContent);
  } else if (existsSync(APP_CONFIG_PATH)) {
    unlinkSync(APP_CONFIG_PATH);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeAppConfig（純粋関数・境界値テスト）
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeAppConfig — 正規化 (純粋関数)", () => {
  it("null / undefined はデフォルト (4時) に正規化される", () => {
    expect(normalizeAppConfig(null)).toEqual({ dayBoundaryHour: 4 });
    expect(normalizeAppConfig(undefined)).toEqual({ dayBoundaryHour: 4 });
  });

  it("プリミティブ値はデフォルトに正規化される", () => {
    expect(normalizeAppConfig(42)).toEqual({ dayBoundaryHour: 4 });
    expect(normalizeAppConfig("string")).toEqual({ dayBoundaryHour: 4 });
  });

  it("dayBoundaryHour が 0〜23 の整数ならそのまま通す", () => {
    expect(normalizeAppConfig({ dayBoundaryHour: 0 }).dayBoundaryHour).toBe(0);
    expect(normalizeAppConfig({ dayBoundaryHour: 12 }).dayBoundaryHour).toBe(12);
    expect(normalizeAppConfig({ dayBoundaryHour: 23 }).dayBoundaryHour).toBe(23);
  });

  it("範囲外の dayBoundaryHour はデフォルトに丸められる", () => {
    expect(normalizeAppConfig({ dayBoundaryHour: -1 }).dayBoundaryHour).toBe(4);
    expect(normalizeAppConfig({ dayBoundaryHour: 24 }).dayBoundaryHour).toBe(4);
    expect(normalizeAppConfig({ dayBoundaryHour: 100 }).dayBoundaryHour).toBe(4);
  });

  it("非整数の dayBoundaryHour はデフォルトに丸められる", () => {
    expect(normalizeAppConfig({ dayBoundaryHour: 3.5 }).dayBoundaryHour).toBe(4);
    expect(normalizeAppConfig({ dayBoundaryHour: "abc" }).dayBoundaryHour).toBe(4);
    expect(normalizeAppConfig({ dayBoundaryHour: NaN }).dayBoundaryHour).toBe(4);
    expect(normalizeAppConfig({ dayBoundaryHour: undefined }).dayBoundaryHour).toBe(4);
  });

  it("整数に変換可能な文字列は Number(raw) 経由で通過する (現仕様)", () => {
    // clampBoundaryHour は Number(raw) で強制変換するため "5" → 5 として受理される。
    // 将来より厳格にしたい場合はこの仕様テストを書き換える。
    expect(normalizeAppConfig({ dayBoundaryHour: "5" }).dayBoundaryHour).toBe(5);
  });

  it("余分なキーは無視される", () => {
    const result = normalizeAppConfig({ dayBoundaryHour: 6, extra: "ignored" });
    expect(result).toEqual({ dayBoundaryHour: 6 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// loadAppConfig / saveAppConfig — ラウンドトリップ
// ─────────────────────────────────────────────────────────────────────────────

describe("loadAppConfig / saveAppConfig — 永続化", () => {
  it("設定ファイルがない場合はデフォルトを返す", () => {
    const cfg = loadAppConfig();
    expect(cfg).toEqual({ dayBoundaryHour: 4 });
  });

  it("保存した値を復元できる", () => {
    saveAppConfig({ dayBoundaryHour: 7 });
    resetAppConfigCache();
    expect(loadAppConfig()).toEqual({ dayBoundaryHour: 7 });
  });

  it("既存値を部分的に上書きできる", () => {
    saveAppConfig({ dayBoundaryHour: 2 });
    saveAppConfig({ dayBoundaryHour: 5 });
    expect(loadAppConfig().dayBoundaryHour).toBe(5);
  });

  it("partial が dayBoundaryHour を持たなければ既存値を保持する", () => {
    saveAppConfig({ dayBoundaryHour: 8 });
    const result = saveAppConfig({ otherField: "value" });
    expect(result.dayBoundaryHour).toBe(8);
  });

  it("partial に非オブジェクトを渡しても既存値を保持する", () => {
    saveAppConfig({ dayBoundaryHour: 10 });
    const result = saveAppConfig(null);
    expect(result.dayBoundaryHour).toBe(10);
  });

  it("範囲外値で保存するとデフォルトに丸められて永続化される", () => {
    saveAppConfig({ dayBoundaryHour: 99 });
    resetAppConfigCache();
    expect(loadAppConfig().dayBoundaryHour).toBe(4);
  });

  it("壊れた JSON ファイルはデフォルト値にフォールバックする", () => {
    writeFileSync(APP_CONFIG_PATH, "{ not valid json");
    resetAppConfigCache();
    expect(loadAppConfig()).toEqual({ dayBoundaryHour: 4 });
  });

  it("getDayBoundaryHour は現在のキャッシュ値を返す", () => {
    saveAppConfig({ dayBoundaryHour: 6 });
    expect(getDayBoundaryHour()).toBe(6);
  });
});
