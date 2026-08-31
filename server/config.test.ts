import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import {
  GITHUB_CONFIG_PATH,
  clearGitHubConfig,
  loadGitHubConfig,
  normalizeGitHubConfig,
  resetGitHubConfigCache,
  saveGitHubConfig,
} from "./config.ts";

function resetGitHubConfigFile(): void {
  resetGitHubConfigCache();
  if (existsSync(GITHUB_CONFIG_PATH)) unlinkSync(GITHUB_CONFIG_PATH);
}

beforeEach(() => {
  resetGitHubConfigFile();
});

afterEach(() => {
  resetGitHubConfigFile();
});

describe("normalizeGitHubConfig", () => {
  it("non-object input falls back to an empty config", () => {
    expect(normalizeGitHubConfig(null)).toEqual({});
    expect(normalizeGitHubConfig("bad")).toEqual({});
    expect(normalizeGitHubConfig([])).toEqual({});
  });

  it("linked is true only when owner and repo are non-empty strings", () => {
    expect(
      normalizeGitHubConfig({
        linked: true,
        owner: " tanitaka-tech ",
        repo: " todome ",
        autoSync: false,
        lastSyncAt: null,
      }),
    ).toEqual({
      linked: true,
      owner: "tanitaka-tech",
      repo: "todome",
      autoSync: false,
      lastSyncAt: null,
    });

    expect(
      normalizeGitHubConfig({ linked: true, owner: "tanitaka-tech", repo: "" }),
    ).toEqual({});
    expect(
      normalizeGitHubConfig({ linked: "true", owner: "tanitaka-tech", repo: "todome" }),
    ).toEqual({});
  });

  it("unknown keys and non-boolean autoSync are dropped", () => {
    expect(
      normalizeGitHubConfig({
        linked: true,
        owner: "me",
        repo: "todome",
        autoSync: "false",
        secret: "DO_NOT_KEEP",
      }),
    ).toEqual({ linked: true, owner: "me", repo: "todome" });
  });
});

describe("loadGitHubConfig / saveGitHubConfig", () => {
  it("broken JSON falls back to an empty config", () => {
    writeFileSync(GITHUB_CONFIG_PATH, "{ not valid json");
    resetGitHubConfigCache();

    expect(loadGitHubConfig()).toEqual({});
  });

  it("malformed saved shape is normalized on load", () => {
    writeFileSync(
      GITHUB_CONFIG_PATH,
      JSON.stringify({
        linked: "yes",
        owner: "me",
        repo: "todome",
        autoSync: "false",
        lastSyncAt: 123,
      }),
    );
    resetGitHubConfigCache();

    expect(loadGitHubConfig()).toEqual({});
  });

  it("saveGitHubConfig persists only normalized fields", () => {
    saveGitHubConfig({
      linked: true,
      owner: " me ",
      repo: " todome ",
      autoSync: false,
      lastSyncAt: "2026-08-11T08:00:00",
    });

    expect(loadGitHubConfig()).toEqual({
      linked: true,
      owner: "me",
      repo: "todome",
      autoSync: false,
      lastSyncAt: "2026-08-11T08:00:00",
    });
    expect(JSON.parse(readFileSync(GITHUB_CONFIG_PATH, "utf8"))).toEqual({
      linked: true,
      owner: "me",
      repo: "todome",
      autoSync: false,
      lastSyncAt: "2026-08-11T08:00:00",
    });
  });

  it("clearGitHubConfig clears cache and file", () => {
    saveGitHubConfig({ linked: true, owner: "me", repo: "todome" });

    clearGitHubConfig();

    expect(loadGitHubConfig()).toEqual({});
    expect(existsSync(GITHUB_CONFIG_PATH)).toBe(false);
  });
});
