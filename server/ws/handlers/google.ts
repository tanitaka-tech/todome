import {
  exchangeCodeForToken,
  fetchUserEmail,
  listCalendars,
  persistConnectedTokens,
} from "../../google/client.ts";
import {
  buildRedirectUri,
  consumePending,
  startAuthorize,
} from "../../google/oauth.ts";
import {
  clearGoogleConfig,
  getGoogleAccount,
  hasGoogleCredentials,
  isGoogleConnected,
  loadGoogleConfig,
  removeGoogleAccount,
  saveGoogleAccount,
  saveGoogleConfig,
  setActiveGoogleAccount,
} from "../../storage/google.ts";
import {
  deleteSubscriptionAndSchedules,
  loadSubscriptions,
} from "../../storage/subscription.ts";
import type { GoogleStatus } from "../../types.ts";
import { broadcast, sendTo } from "../broadcast.ts";
import type { Handler } from "../dispatch.ts";
import { broadcastSubscriptionsAndSchedules } from "./subscription.ts";

export function buildGoogleStatus(lastError = ""): GoogleStatus {
  const cfg = loadGoogleConfig();
  const active = getGoogleAccount(cfg.activeAccountId);
  return {
    connected: isGoogleConnected(),
    hasCredentials: hasGoogleCredentials(),
    accountEmail: active?.accountEmail ?? "",
    connectedAt: active?.connectedAt ?? "",
    lastError,
    writeTargetCalendarId: active?.writeTargetCalendarId ?? "",
    writeTargetCalendarName: active?.writeTargetCalendarName ?? "",
    writeTargetCalendarColor: active?.writeTargetCalendarColor ?? "",
    activeAccountId: active?.id ?? "",
    accounts: (cfg.accounts ?? []).map((account) => ({
      id: account.id,
      accountEmail: account.accountEmail,
      connectedAt: account.connectedAt ?? "",
      writeTargetCalendarId: account.writeTargetCalendarId ?? "",
      writeTargetCalendarName: account.writeTargetCalendarName ?? "",
      writeTargetCalendarColor: account.writeTargetCalendarColor ?? "",
    })),
    redirectUri: buildRedirectUri(),
  };
}

export const googleStatusRequest: Handler = async (ws) => {
  sendTo(ws, { type: "google_status", status: buildGoogleStatus() });
};

export const googleSetCredentials: Handler = async (_ws, _session, data) => {
  const clientId = String(data.clientId ?? "").trim();
  const clientSecret = String(data.clientSecret ?? "").trim();
  if (!clientId || !clientSecret) {
    broadcast({
      type: "google_status",
      status: buildGoogleStatus(
        "Client ID と Client Secret を入力してください",
      ),
    });
    return;
  }
  const cfg = loadGoogleConfig();
  saveGoogleConfig({
    ...cfg,
    clientId,
    clientSecret,
  });
  broadcast({ type: "google_status", status: buildGoogleStatus() });
};

export const googleConnectStart: Handler = async (ws) => {
  const cfg = loadGoogleConfig();
  if (!cfg.clientId || !cfg.clientSecret) {
    sendTo(ws, {
      type: "google_status",
      status: buildGoogleStatus(
        "Client ID / Client Secret が未保存です。先に保存してください",
      ),
    });
    return;
  }
  const { url } = startAuthorize(cfg.clientId);
  sendTo(ws, { type: "google_authorize_url", url });
};

export const googleSetActiveAccount: Handler = async (_ws, _session, data) => {
  const accountId = String(data.accountId ?? "").trim();
  if (!accountId) return;
  setActiveGoogleAccount(accountId);
  broadcast({ type: "google_status", status: buildGoogleStatus() });
};

export const googleDisconnect: Handler = async (_ws, _session, data) => {
  const accountId = String(data.accountId ?? "").trim();
  const activeAccountId = loadGoogleConfig().activeAccountId ?? "";
  const subs = loadSubscriptions().filter(
    (s) =>
      s.provider === "google" &&
      (!accountId ||
        s.googleAccountId === accountId ||
        (!s.googleAccountId && accountId === activeAccountId)),
  );
  for (const s of subs) deleteSubscriptionAndSchedules(s.id);
  if (accountId) removeGoogleAccount(accountId);
  else clearGoogleConfig();
  broadcast({ type: "google_status", status: buildGoogleStatus() });
  broadcastSubscriptionsAndSchedules();
};

export const googleListCalendars: Handler = async (ws, _session, data) => {
  if (!isGoogleConnected()) {
    sendTo(ws, {
      type: "google_calendars",
      calendars: [],
      error: "Google に未接続です",
    });
    return;
  }
  const accountId = String(data.accountId ?? "").trim() || undefined;
  const result = await listCalendars(accountId);
  if (!result.ok) {
    sendTo(ws, {
      type: "google_calendars",
      calendars: [],
      error: result.error,
    });
    return;
  }
  sendTo(ws, {
    type: "google_calendars",
    calendars: result.calendars,
    error: "",
  });
};

export const googleSetWriteTarget: Handler = async (_ws, _session, data) => {
  const accountId =
    String(data.accountId ?? "").trim() || loadGoogleConfig().activeAccountId || "";
  const id = String(data.calendarId ?? "").trim();
  const name = String(data.calendarName ?? "").trim();
  const color = String(data.calendarColor ?? "").trim();
  const account = getGoogleAccount(accountId);
  if (!account) return;
  saveGoogleAccount({
    ...account,
    writeTargetCalendarId: id,
    writeTargetCalendarName: name,
    writeTargetCalendarColor: color,
  });
  broadcast({ type: "google_status", status: buildGoogleStatus() });
};

/**
 * Hono ルート (`/google/oauth/callback`) から呼び出される。
 * code → token 交換 → email 取得 → 永続化 → 全クライアントに google_status を broadcast。
 *
 * 戻り値はコールバックページ用の HTML 用テキスト。
 */
export async function handleOAuthCallback(query: {
  code: string | null;
  state: string | null;
  error: string | null;
}): Promise<{ ok: boolean; message: string }> {
  if (query.error) {
    broadcast({
      type: "google_status",
      status: buildGoogleStatus(`認可がキャンセルされました: ${query.error}`),
    });
    return { ok: false, message: `認可がキャンセルされました: ${query.error}` };
  }
  if (!query.code || !query.state) {
    return { ok: false, message: "code または state がありません" };
  }
  const pending = consumePending(query.state);
  if (!pending) {
    return {
      ok: false,
      message: "state が一致しないか、認可が期限切れです（10分以内に完了してください）",
    };
  }
  const cfg = loadGoogleConfig();
  if (!cfg.clientSecret || cfg.clientId !== pending.clientId) {
    return {
      ok: false,
      message: "認証情報が変更されているため接続できません。再度「接続」を押してください",
    };
  }
  const tokenResult = await exchangeCodeForToken({
    clientId: pending.clientId,
    clientSecret: cfg.clientSecret,
    code: query.code,
    codeVerifier: pending.codeVerifier,
  });
  if (!tokenResult.ok) {
    broadcast({
      type: "google_status",
      status: buildGoogleStatus(tokenResult.error),
    });
    return { ok: false, message: tokenResult.error };
  }
  if (!tokenResult.token.refresh_token) {
    // refresh_token が貰えなかった = 過去に同じ client_id で同意済みかつ
    // prompt=consent が無視された等のレアケース。Google Cloud Console で旧トークンを破棄するよう促す。
    broadcast({
      type: "google_status",
      status: buildGoogleStatus(
        "refresh_token が取得できませんでした。Google アカウントの「サードパーティのアクセス」から既存のアクセスを削除して再試行してください",
      ),
    });
    return {
      ok: false,
      message: "refresh_token が取得できませんでした",
    };
  }
  const email = await fetchUserEmail(tokenResult.token.access_token);
  persistConnectedTokens({
    clientId: pending.clientId,
    clientSecret: cfg.clientSecret,
    token: tokenResult.token,
    email,
  });
  broadcast({ type: "google_status", status: buildGoogleStatus() });
  return { ok: true, message: "接続しました。このタブを閉じて todome に戻ってください。" };
}
