---
name: todome-type-lint-runner
description: Run todome frontend typecheck and lint, then return only a compact structured summary. Use when the task is to confirm `cd client && npx tsc -b` and `cd client && npm run lint`, or when noisy TypeScript/ESLint output should be condensed into file-focused results.
---

# Todome Type/Lint Runner

Run the frontend checks and compress the result so the main thread does not get flooded with raw logs.

## Commands

- `cd client && npx tsc -b`
- `cd client && npm run lint`

Prefer running them in parallel when possible.

## Output Rules

- If both pass, reply with exactly:
  - `✅ tsc: clean`
  - `✅ lint: clean`
- If either fails, group findings by file and summarize each item as `L<line> <code>: <short message>`.
- Put the likely root cause first when one upstream type error is obviously creating many downstream errors.
- Count warnings separately from errors. Detail errors first; warnings can stay summarized.
- Do not paste full raw `tsc` or ESLint output.
- Do not suggest fixes unless explicitly asked. This skill is for execution and summarization.

## Notes

- This skill is frontend-only. Server checks and unit tests belong elsewhere.
- If sandbox or dependency issues block the commands, report that clearly instead of guessing.
