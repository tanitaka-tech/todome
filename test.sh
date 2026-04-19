#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

cd client && npm run build
cd ../e2e && npm install
npx playwright install chromium
npx playwright test "$@"
