#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-dev}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [ ! -d "client/node_modules" ]; then
  echo "==> installing client dependencies"
  (cd client && npm install)
fi

if [ ! -d "node_modules" ]; then
  echo "==> installing server dependencies"
  bun install
fi

case "$MODE" in
  dev)
    echo "==> starting dev servers (Vite :5173 / Bun :3002)"
    pids=()
    cleanup() {
      trap - INT TERM EXIT
      for pid in "${pids[@]}"; do
        kill "$pid" 2>/dev/null || true
      done
      wait 2>/dev/null || true
    }
    trap cleanup INT TERM EXIT

    (cd client && npm run dev) &
    pids+=($!)

    # AI アシスタントが任意の .ts を編集すると bun --watch が再起動して
    # WebSocket セッションと SDK サブプロセスが落ちるので、server/ 配下だけ監視する。
    bun --watch server/index.ts &
    pids+=($!)

    while :; do
      for pid in "${pids[@]}"; do
        if ! kill -0 "$pid" 2>/dev/null; then
          break 2
        fi
      done
      sleep 1
    done
    ;;

  prod)
    echo "==> building client"
    (cd client && npm run build)
    echo "==> starting Bun :3002"
    exec bun server/index.ts
    ;;

  *)
    echo "usage: $0 [dev|prod]" >&2
    exit 1
    ;;
esac
