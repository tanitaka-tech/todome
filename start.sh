#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-dev}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [ ! -d "client/node_modules" ]; then
  echo "==> installing client dependencies"
  (cd client && npm install)
fi

case "$MODE" in
  dev)
    echo "==> starting dev servers (Vite :5173 / uvicorn :3002)"
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

    # AI アシスタントが任意の .py を作成/編集すると
    # uvicorn の既定 '*.py' ウォッチで再起動し、
    # SDK サブプロセスと WebSocket が落ちてチャットが「止まる」ので、
    # サーバー側の .py に限定してウォッチする。
    uv run uvicorn server:app --host 0.0.0.0 --port 3002 \
      --reload \
      --reload-exclude '*.py' \
      --reload-include 'server.py' \
      --reload-include 'server_ws.py' \
      --reload-include 'server_state.py' \
      --reload-include 'server_retro.py' \
      --reload-include 'server_github.py' \
      --reload-include 'github_sync.py' &
    pids+=($!)

    # macOS デフォルトの bash 3.2 は `wait -n` 未対応なのでポーリングで代替
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
    echo "==> starting uvicorn :3002"
    exec uv run uvicorn server:app --host 0.0.0.0 --port 3002
    ;;

  *)
    echo "usage: $0 [dev|prod]" >&2
    exit 1
    ;;
esac
