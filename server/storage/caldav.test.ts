// 本テストは config モジュールを動的 import する前に TODOME_DATA_DIR を temp dir に
// 差し替えて、開発環境の data/ を絶対に触らないようにする。
import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), "todome-caldav-test-"));
process.env.TODOME_DATA_DIR = TEST_DATA_DIR;

const config = await import("../config.ts");
const caldav = await import("./caldav.ts");

const {
  CALDAV_CONFIG_FILENAME,
  CALDAV_CONFIG_PATH,
  GITHUB_CONFIG_PATH,
  REPO_DIR,
  loadGitHubConfig,
  saveGitHubConfig,
} = config;
const {
  clearCalDAVConfig,
  isCalDAVConnected,
  loadCalDAVConfig,
  resetCalDAVCache,
  saveCalDAVConfig,
} = caldav;

const REPO_CALDAV_PATH = join(REPO_DIR, CALDAV_CONFIG_FILENAME);

function unlinkIfExists(p: string): void {
  if (existsSync(p)) unlinkSync(p);
}

afterAll(() => {
  rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  resetCalDAVCache();
  unlinkIfExists(GITHUB_CONFIG_PATH);
  unlinkIfExists(CALDAV_CONFIG_PATH);
  unlinkIfExists(REPO_CALDAV_PATH);
  if (existsSync(REPO_DIR)) rmSync(REPO_DIR, { recursive: true, force: true });
  saveGitHubConfig({});
  unlinkIfExists(GITHUB_CONFIG_PATH);
});

afterEach(() => {
  resetCalDAVCache();
});

function setLinked(linked: boolean): void {
  saveGitHubConfig({ linked, owner: "test", repo: "test" });
  if (linked) mkdirSync(REPO_DIR, { recursive: true });
  expect(loadGitHubConfig().linked).toBe(linked);
}

const SAMPLE = {
  appleId: "user@example.com",
  appPassword: "test-pass-aaaa",
  connectedAt: "2026-05-05T00:00:00Z",
  writeTargetCalendarUrl: "https://caldav.icloud.com/test/",
  writeTargetCalendarName: "todome",
  writeTargetCalendarColor: "#83d754",
};

describe("CalDAV config storage", () => {
  it("ファイルが無ければ空の config を返す", () => {
    expect(loadCalDAVConfig()).toEqual({});
    expect(isCalDAVConnected()).toBe(false);
  });

  it("未連携時は data/caldav_config.json に保存する", () => {
    setLinked(false);
    saveCalDAVConfig(SAMPLE);
    expect(existsSync(CALDAV_CONFIG_PATH)).toBe(true);
    expect(existsSync(REPO_CALDAV_PATH)).toBe(false);
    resetCalDAVCache();
    expect(loadCalDAVConfig()).toEqual(SAMPLE);
    expect(isCalDAVConnected()).toBe(true);
  });

  it("連携時は data/repo/caldav_config.json に保存し、メイン data/ 直下には書かない", () => {
    setLinked(true);
    saveCalDAVConfig(SAMPLE);
    expect(existsSync(REPO_CALDAV_PATH)).toBe(true);
    expect(existsSync(CALDAV_CONFIG_PATH)).toBe(false);
    resetCalDAVCache();
    expect(loadCalDAVConfig()).toEqual(SAMPLE);
  });

  it("連携時に旧 data/caldav_config.json があれば repo 側へ移行し、旧ファイルを削除する", () => {
    writeFileSync(CALDAV_CONFIG_PATH, JSON.stringify(SAMPLE, null, 2));
    expect(existsSync(CALDAV_CONFIG_PATH)).toBe(true);
    expect(existsSync(REPO_CALDAV_PATH)).toBe(false);

    setLinked(true);
    resetCalDAVCache();

    const cfg = loadCalDAVConfig();
    expect(cfg).toEqual(SAMPLE);
    expect(existsSync(REPO_CALDAV_PATH)).toBe(true);
    expect(existsSync(CALDAV_CONFIG_PATH)).toBe(false);
  });

  it("連携状態で保存後、旧 data/caldav_config.json が残っていれば自動で掃除する", () => {
    setLinked(true);
    writeFileSync(CALDAV_CONFIG_PATH, JSON.stringify({ appleId: "stale" }, null, 2));
    saveCalDAVConfig(SAMPLE);
    expect(existsSync(CALDAV_CONFIG_PATH)).toBe(false);
    expect(existsSync(REPO_CALDAV_PATH)).toBe(true);
  });

  it("clearCalDAVConfig は新旧両方のファイルを削除する", () => {
    setLinked(true);
    writeFileSync(CALDAV_CONFIG_PATH, JSON.stringify(SAMPLE, null, 2));
    writeFileSync(REPO_CALDAV_PATH, JSON.stringify(SAMPLE, null, 2));
    clearCalDAVConfig();
    expect(existsSync(CALDAV_CONFIG_PATH)).toBe(false);
    expect(existsSync(REPO_CALDAV_PATH)).toBe(false);
    expect(loadCalDAVConfig()).toEqual({});
  });

  it("壊れた JSON は空 config として扱う", () => {
    setLinked(false);
    writeFileSync(CALDAV_CONFIG_PATH, "{ broken json");
    expect(loadCalDAVConfig()).toEqual({});
  });

  it("GitHub config 等、関係ないファイルには触らない", () => {
    setLinked(true);
    const githubBefore = readFileSync(GITHUB_CONFIG_PATH, "utf8");
    saveCalDAVConfig(SAMPLE);
    const githubAfter = readFileSync(GITHUB_CONFIG_PATH, "utf8");
    expect(githubAfter).toBe(githubBefore);
  });
});
