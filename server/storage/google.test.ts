import { describe, expect, test } from "bun:test";
import { normalizeGoogleConfig } from "./google.ts";

describe("normalizeGoogleConfig multi-account migration", () => {
  test("legacy single-account token is exposed as one account", () => {
    const cfg = normalizeGoogleConfig({
      clientId: "cid",
      clientSecret: "secret",
      accountEmail: "me@example.com",
      refreshToken: "refresh-1",
      writeTargetCalendarId: "primary",
    });

    expect(cfg.accounts).toHaveLength(1);
    expect(cfg.activeAccountId).toBe("me@example.com");
    expect(cfg.accounts?.[0]?.refreshToken).toBe("refresh-1");
    expect(cfg.writeTargetCalendarId).toBe("primary");
  });

  test("explicit empty accounts is not rehydrated from legacy active fields", () => {
    const cfg = normalizeGoogleConfig({
      clientId: "cid",
      clientSecret: "secret",
      refreshToken: "old-active-token",
      accounts: [],
      activeAccountId: "",
    });

    expect(cfg.accounts).toEqual([]);
    expect(cfg.activeAccountId).toBe("");
    expect(cfg.refreshToken).toBe("");
  });

  test("non-object config falls back to an empty normalized config", () => {
    const cfg = normalizeGoogleConfig("not-an-object");

    expect(cfg.clientId).toBe("");
    expect(cfg.clientSecret).toBe("");
    expect(cfg.accounts).toEqual([]);
    expect(cfg.activeAccountId).toBe("");
    expect(cfg.refreshToken).toBe("");
  });

  test("non-array accounts does not create synthetic accounts", () => {
    const cfg = normalizeGoogleConfig({
      clientId: "cid",
      clientSecret: "secret",
      accounts: "not-array",
      activeAccountId: "google-account",
    });

    expect(cfg.accounts).toEqual([]);
    expect(cfg.activeAccountId).toBe("");
  });

  test("malformed account entries are skipped while valid accounts survive", () => {
    const cfg = normalizeGoogleConfig({
      clientId: " cid ",
      clientSecret: " secret ",
      accounts: [
        "not-object",
        {},
        {
          id: " work ",
          accountEmail: " work@example.com ",
          refreshToken: " refresh-1 ",
          writeTargetCalendarName: " Work ",
        },
      ],
      activeAccountId: "work",
    });

    expect(cfg.clientId).toBe("cid");
    expect(cfg.clientSecret).toBe("secret");
    expect(cfg.accounts).toHaveLength(1);
    expect(cfg.accounts?.[0]).toMatchObject({
      id: "work",
      accountEmail: "work@example.com",
      refreshToken: "refresh-1",
      writeTargetCalendarName: "Work",
    });
    expect(cfg.activeAccountId).toBe("work");
    expect(cfg.refreshToken).toBe("refresh-1");
  });
});
