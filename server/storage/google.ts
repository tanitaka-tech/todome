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

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

function stringField(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function normalizeAccount(raw: unknown): GoogleAccount | null {
  const record = asRecord(raw);
  if (!record) return null;
  const accountEmail = stringField(record.accountEmail);
  const refreshToken = stringField(record.refreshToken);
  const accessToken = stringField(record.accessToken);
  const accessTokenExpiresAt = stringField(record.accessTokenExpiresAt);
  const connectedAt = stringField(record.connectedAt);
  const writeTargetCalendarId = stringField(record.writeTargetCalendarId);
  const writeTargetCalendarName = stringField(record.writeTargetCalendarName);
  const writeTargetCalendarColor = stringField(record.writeTargetCalendarColor);
  const hasKnownField = [
    record.id,
    accountEmail,
    refreshToken,
    accessToken,
    accessTokenExpiresAt,
    connectedAt,
    writeTargetCalendarId,
    writeTargetCalendarName,
    writeTargetCalendarColor,
  ].some((v) => typeof v === "string" && v.trim());
  if (!hasKnownField) return null;
  const id = stringField(record.id) || accountIdFromEmail(accountEmail);
  if (!id) return null;
  return {
    id,
    accountEmail,
    refreshToken,
    accessToken,
    accessTokenExpiresAt,
    connectedAt,
    writeTargetCalendarId,
    writeTargetCalendarName,
    writeTargetCalendarColor,
  };
}

export function normalizeGoogleConfig(raw: unknown): GoogleConfig {
  const cfg = asRecord(raw);
  if (!cfg) {
    return {
      clientId: "",
      clientSecret: "",
      accounts: [],
      activeAccountId: "",
      refreshToken: "",
      accessToken: "",
      accessTokenExpiresAt: "",
      accountEmail: "",
      connectedAt: "",
      writeTargetCalendarId: "",
      writeTargetCalendarName: "",
      writeTargetCalendarColor: "",
    };
  }
  const accounts: GoogleAccount[] = [];
  if (Array.isArray(cfg.accounts)) {
    for (const account of cfg.accounts) {
      const normalized = normalizeAccount(account);
      if (normalized && !accounts.some((a) => a.id === normalized.id)) {
        accounts.push(normalized);
      }
    }
  }

  const legacyRefreshToken = stringField(cfg.refreshToken);
  if (legacyRefreshToken && !Array.isArray(cfg.accounts)) {
    const legacy = normalizeAccount({
      id: stringField(cfg.accountEmail) || "google-account",
      accountEmail: cfg.accountEmail,
      refreshToken: legacyRefreshToken,
      accessToken: cfg.accessToken,
      accessTokenExpiresAt: cfg.accessTokenExpiresAt,
      connectedAt: cfg.connectedAt,
      writeTargetCalendarId: cfg.writeTargetCalendarId,
      writeTargetCalendarName: cfg.writeTargetCalendarName,
      writeTargetCalendarColor: cfg.writeTargetCalendarColor,
    });
    if (legacy) accounts.push(legacy);
  }

  const activeAccountIdRaw = stringField(cfg.activeAccountId);
  const activeAccountId = accounts.some((a) => a.id === activeAccountIdRaw)
    ? activeAccountIdRaw
    : accounts[0]?.id ?? "";
  const active = accounts.find((a) => a.id === activeAccountId);

  return {
    clientId: stringField(cfg.clientId),
    clientSecret: stringField(cfg.clientSecret),
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
    cache = normalizeGoogleConfig(JSON.parse(readFileSync(GOOGLE_CONFIG_PATH, "utf8")));
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
