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
});
