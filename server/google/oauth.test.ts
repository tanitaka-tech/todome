import { afterEach, describe, expect, test } from "bun:test";
import {
  buildRedirectUri,
  clearPendingForTest,
  consumePending,
  startAuthorize,
} from "./oauth.ts";

afterEach(() => {
  clearPendingForTest();
});

describe("startAuthorize", () => {
  test("returns a Google authorize URL with required params", () => {
    const { url, state } = startAuthorize("client-abc.apps.googleusercontent.com");
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(u.searchParams.get("client_id")).toBe(
      "client-abc.apps.googleusercontent.com",
    );
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toBeTruthy();
    expect(u.searchParams.get("state")).toBe(state);
    expect(u.searchParams.get("redirect_uri")).toBe(buildRedirectUri());
    // 必須スコープが入っていること
    const scope = u.searchParams.get("scope") ?? "";
    expect(scope).toContain("calendar");
    expect(scope).toContain("email");
  });

  test("two consecutive calls produce different state values", () => {
    const a = startAuthorize("c1");
    const b = startAuthorize("c2");
    expect(a.state).not.toBe(b.state);
  });
});

describe("consumePending", () => {
  test("returns the verifier and clientId on first match", () => {
    const { state } = startAuthorize("client-xyz");
    const got = consumePending(state);
    expect(got).not.toBeNull();
    expect(got?.clientId).toBe("client-xyz");
    expect(typeof got?.codeVerifier).toBe("string");
    expect(got?.codeVerifier.length).toBeGreaterThan(0);
  });

  test("consume is single-use (second call returns null)", () => {
    const { state } = startAuthorize("client-once");
    expect(consumePending(state)).not.toBeNull();
    expect(consumePending(state)).toBeNull();
  });

  test("returns null for unknown state (CSRF / mismatch)", () => {
    expect(consumePending("definitely-not-issued")).toBeNull();
  });

  test("does not affect another pending state when one is consumed", () => {
    const a = startAuthorize("client-a");
    const b = startAuthorize("client-b");
    consumePending(a.state);
    const got = consumePending(b.state);
    expect(got?.clientId).toBe("client-b");
  });
});
