// 保存文字列は "YYYY-MM-DDTHH:mm:ss" 形式 (Z なし) で、
// client 側は `new Date(str)` でローカル時刻として parse する。
// そのためサーバーもローカル時刻で組み立てる必要がある (UTC 化すると時差分ずれる)。

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatLocalIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function nowLocalIso(): string {
  return formatLocalIso(new Date());
}
