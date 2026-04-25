import { createHash, randomBytes } from "node:crypto";
import { PORT } from "../config.ts";

/**
 * Google OAuth 2.0 (Loopback Redirect Flow + PKCE) の補助関数群。
 *
 * 認可リクエスト → コールバックの間の state / code_verifier はメモリにだけ保持する。
 * プロセス再起動で吹き飛んでも、ユーザーは再度「接続」を押すだけなので問題ない。
 */

const AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "openid",
  "email",
  "profile",
].join(" ");

interface PendingAuthorize {
  state: string;
  codeVerifier: string;
  clientId: string;
  createdAt: number;
}

const PENDING_TTL_MS = 10 * 60 * 1000; // 認可は 10 分以内に完了する想定
const pending = new Map<string, PendingAuthorize>();

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function generateCodeVerifier(): string {
  return base64UrlEncode(randomBytes(32));
}

function deriveCodeChallenge(verifier: string): string {
  return base64UrlEncode(createHash("sha256").update(verifier).digest());
}

function purgeExpired(): void {
  const now = Date.now();
  for (const [state, p] of pending.entries()) {
    if (now - p.createdAt > PENDING_TTL_MS) pending.delete(state);
  }
}

export function buildRedirectUri(): string {
  // Bun サーバが Hono で処理するコールバック URL。Google Cloud Console で登録する URI と完全一致が必要。
  return `http://localhost:${PORT}/google/oauth/callback`;
}

export function startAuthorize(clientId: string): {
  url: string;
  state: string;
} {
  purgeExpired();
  const state = base64UrlEncode(randomBytes(24));
  const codeVerifier = generateCodeVerifier();
  pending.set(state, {
    state,
    codeVerifier,
    clientId,
    createdAt: Date.now(),
  });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: buildRedirectUri(),
    response_type: "code",
    scope: SCOPES,
    state,
    code_challenge: deriveCodeChallenge(codeVerifier),
    code_challenge_method: "S256",
    access_type: "offline", // refresh_token を貰うために必須
    prompt: "consent", // 既に同意済みでも refresh_token を確実に再発行
  });
  return { url: `${AUTHORIZE_ENDPOINT}?${params.toString()}`, state };
}

/** state を消費して保存中の verifier / clientId を返す。state ミスマッチや期限切れは null。 */
export function consumePending(
  state: string,
): { codeVerifier: string; clientId: string } | null {
  purgeExpired();
  const entry = pending.get(state);
  if (!entry) return null;
  pending.delete(state);
  return { codeVerifier: entry.codeVerifier, clientId: entry.clientId };
}

/** テスト用: 全 pending を消す。 */
export function clearPendingForTest(): void {
  pending.clear();
}
