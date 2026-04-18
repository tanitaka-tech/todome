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

    uv run uvicorn server:app --host 0.0.0.0 --port 3002 --reload &
    pids+=($!)

    wait -n "${pids[@]}"
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
