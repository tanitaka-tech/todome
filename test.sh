#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

cd client && npm run build
cd ../e2e && npm ci
rm -rf data-e2e test-results playwright-report
npx playwright install chromium
npx playwright test "$@"
