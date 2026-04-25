import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { GOOGLE_CONFIG_PATH } from "../config.ts";
import type { GoogleAccount, GoogleConfig } from "../types.ts";

// Google OAuth credentials は CalDAV と同様に data/google_config.json に平文で保管する。
// data/ 全体が gitignore + ローカル限定なので、暗号化は行わない（README に明記）。

let cache: GoogleConfig | null = null;

function accountIdFromEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  return trimmed || "google-account";
}

function normalizeAccount(raw: Partial<GoogleAccount>): GoogleAccount | null {
  const accountEmail = String(raw.accountEmail ?? "").trim();
  const id = String(raw.id ?? "").trim() || accountIdFromEmail(accountEmail);
  if (!id) return null;
  return {
    id,
    accountEmail,
    refreshToken: raw.refreshToken ? String(raw.refreshToken) : "",
    accessToken: raw.accessToken ? String(raw.accessToken) : "",
    accessTokenExpiresAt: raw.accessTokenExpiresAt
      ? String(raw.accessTokenExpiresAt)
      : "",
    connectedAt: raw.connectedAt ? String(raw.connectedAt) : "",
    writeTargetCalendarId: raw.writeTargetCalendarId
      ? String(raw.writeTargetCalendarId)
      : "",
    writeTargetCalendarName: raw.writeTargetCalendarName
      ? String(raw.writeTargetCalendarName)
      : "",
    writeTargetCalendarColor: raw.writeTargetCalendarColor
      ? String(raw.writeTargetCalendarColor)
      : "",
  };
}

export function normalizeGoogleConfig(raw: GoogleConfig): GoogleConfig {
  const accounts: GoogleAccount[] = [];
  for (const account of raw.accounts ?? []) {
    const normalized = normalizeAccount(account);
    if (normalized && !accounts.some((a) => a.id === normalized.id)) {
      accounts.push(normalized);
    }
  }

  if (raw.refreshToken && !Array.isArray(raw.accounts)) {
    const legacy = normalizeAccount({
      id: raw.accountEmail || "google-account",
      accountEmail: raw.accountEmail ?? "",
      refreshToken: raw.refreshToken,
      accessToken: raw.accessToken,
      accessTokenExpiresAt: raw.accessTokenExpiresAt,
      connectedAt: raw.connectedAt,
      writeTargetCalendarId: raw.writeTargetCalendarId,
      writeTargetCalendarName: raw.writeTargetCalendarName,
      writeTargetCalendarColor: raw.writeTargetCalendarColor,
    });
    if (legacy) accounts.push(legacy);
  }

  const activeAccountId = accounts.some((a) => a.id === raw.activeAccountId)
    ? String(raw.activeAccountId)
    : accounts[0]?.id ?? "";
  const active = accounts.find((a) => a.id === activeAccountId);

  return {
    clientId: raw.clientId ? String(raw.clientId) : "",
    clientSecret: raw.clientSecret ? String(raw.clientSecret) : "",
    accounts,
    activeAccountId,
    refreshToken: active?.refreshToken ?? "",
    accessToken: active?.accessToken ?? "",
    accessTokenExpiresAt: active?.accessTokenExpiresAt ?? "",
    accountEmail: active?.accountEmail ?? "",
    connectedAt: active?.connectedAt ?? "",
    writeTargetCalendarId: active?.writeTargetCalendarId ?? "",
    writeTargetCalendarName: active?.writeTargetCalendarName ?? "",
    writeTargetCalendarColor: active?.writeTargetCalendarColor ?? "",
  };
}

export function loadGoogleConfig(): GoogleConfig {
  if (cache !== null) return cache;
  if (!existsSync(GOOGLE_CONFIG_PATH)) {
    cache = normalizeGoogleConfig({});
    return cache;
  }
  try {
    cache = normalizeGoogleConfig(
      JSON.parse(readFileSync(GOOGLE_CONFIG_PATH, "utf8")) as GoogleConfig,
    );
  } catch {
    cache = normalizeGoogleConfig({});
  }
  return cache;
}

export function saveGoogleConfig(cfg: GoogleConfig): void {
  cache = normalizeGoogleConfig(cfg);
  writeFileSync(GOOGLE_CONFIG_PATH, JSON.stringify(cache, null, 2));
}

export function clearGoogleConfig(): void {
  cache = normalizeGoogleConfig({});
  if (existsSync(GOOGLE_CONFIG_PATH)) unlinkSync(GOOGLE_CONFIG_PATH);
}

export function isGoogleConnected(): boolean {
  const cfg = loadGoogleConfig();
  return Boolean(cfg.clientId && cfg.clientSecret && cfg.accounts?.some((a) => a.refreshToken));
}

export function getGoogleAccount(accountId?: string): GoogleAccount | null {
  const cfg = loadGoogleConfig();
  const id = accountId || cfg.activeAccountId || "";
  return cfg.accounts?.find((a) => a.id === id) ?? null;
}

export function isGoogleAccountConnected(accountId?: string): boolean {
  const cfg = loadGoogleConfig();
  const account = getGoogleAccount(accountId);
  return Boolean(cfg.clientId && cfg.clientSecret && account?.refreshToken);
}

/** client_id / client_secret は接続前に保存する場合があるので接続状態とは別判定。 */
export function hasGoogleCredentials(): boolean {
  const cfg = loadGoogleConfig();
  return Boolean(cfg.clientId && cfg.clientSecret);
}

export function saveGoogleAccount(account: GoogleAccount): void {
  const cfg = loadGoogleConfig();
  const accounts = [...(cfg.accounts ?? [])];
  const idx = accounts.findIndex((a) => a.id === account.id);
  if (idx >= 0) accounts[idx] = account;
  else accounts.push(account);
  saveGoogleConfig({
    ...cfg,
    accounts,
    activeAccountId: account.id,
  });
}

export function setActiveGoogleAccount(accountId: string): void {
  const cfg = loadGoogleConfig();
  if (!cfg.accounts?.some((a) => a.id === accountId)) return;
  saveGoogleConfig({ ...cfg, activeAccountId: accountId });
}

export function removeGoogleAccount(accountId: string): void {
  const cfg = loadGoogleConfig();
  const accounts = (cfg.accounts ?? []).filter((a) => a.id !== accountId);
  saveGoogleConfig({
    ...cfg,
    accounts,
    activeAccountId:
      cfg.activeAccountId === accountId ? accounts[0]?.id ?? "" : cfg.activeAccountId,
  });
}
