#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# Playwright の webServer は `bun server/index.ts` を実行するため、
# 新規 clone 直後でも server deps が無いと起動失敗する。start.sh と同じ予防策。
if [ ! -d "node_modules" ]; then
  echo "==> installing server dependencies"
  bun install
fi

cd client && npm run build
cd ../e2e && npm install
npx playwright install chromium
npx playwright test "$@"
