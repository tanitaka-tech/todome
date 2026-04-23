---
name: todome-e2e-runner
description: Run todome end-to-end tests via `./test.sh` and return a short pass/fail summary instead of the full Playwright log. Use when validating UI flows, checking whether E2E passes, or condensing build/test failures into a small report.
---

# Todome E2E Runner

Run the repo's end-to-end test entrypoint and summarize the outcome tersely.

## Command

- `./test.sh`

Use a generous timeout because this script builds the app, installs E2E dependencies, installs Playwright browsers if needed, and then runs the tests.

## Output Rules

- If everything passes, reply with one line: `✅ E2E: all passed (N tests, XXs)`
- If the build step fails, stop there and return:
  - `🛑 build failed (テスト未実行)`
  - then 5-10 relevant error lines only
- If tests run and some fail, return:
  - passed/failed counts
  - each failed test name
  - failure location
  - the failing step or assertion
  - only 3-5 relevant log lines per failure
- Do not include the full Playwright progress log.
- Do not rerun failing tests unless explicitly asked.
- Do not speculate about the cause beyond what the captured output shows.

## Notes

- Treat environment/setup failures separately from test failures.
- Mention sandbox or browser-install blockers plainly if they happen.
