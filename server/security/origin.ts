// WebSocket は Same-Origin Policy が効かないため、`/ws` upgrade 時に
// Origin ヘッダを検証しないと Cross-Site WebSocket Hijacking が成立する。

const DEFAULT_DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3002",
  "http://127.0.0.1:3002",
];

export function getAllowedOrigins(): string[] {
  const env = process.env.TODOME_ALLOWED_ORIGINS;
  if (!env) return DEFAULT_DEV_ORIGINS;
  const list = env
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : DEFAULT_DEV_ORIGINS;
}

export function isAllowedOrigin(
  origin: string | null | undefined,
  host: string | null | undefined,
): boolean {
  // Origin が無いリクエストは非ブラウザ（curl 等）。ブラウザ発の cross-site WS は
  // 必ず Origin を付与するため、CSRF 観点ではここを通しても問題ない。
  if (!origin) return true;

  const allowed = getAllowedOrigins();
  if (allowed.includes("*")) return true;
  if (allowed.includes(origin)) return true;

  // 自分自身のホストへの接続は同一オリジン扱いで許可する。
  // 本番運用で TODOME_ALLOWED_ORIGINS 未設定でも `http://<server-host>:3002` から
  // のアクセスがロックアウトされないように。
  if (host) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host === host) return true;
    } catch {
      return false;
    }
  }
  return false;
}
