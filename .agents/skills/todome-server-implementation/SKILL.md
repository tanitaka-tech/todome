---
name: todome-server-implementation
description: Apply todome-specific server constraints when implementing or reviewing changes under `server/`. Use when editing Bun/Hono/WebSocket handlers, storage, AI integration, GitHub sync, timeline logic, or any server-side payload that must stay aligned with `client/src/types.ts`.
---

# Todome Server Implementation

Apply the repo-specific server rules for todome. This skill mirrors the intent of `server/AGENTS.md` and `.claude/rules/server.md`, but packages it as an explicit Codex skill.

## Core Rules

- Put new code in the matching module: `ws/handlers`, `storage`, `domain`, `ai`, `github`, or utilities. Do not collapse new behavior into oversized files.
- Keep dependencies directional: `ws/handlers` may call `ai/*`, `storage/*`, and `github/*`, but storage should not import handlers.
- When adding a new WebSocket `type`, update both `server/ws/handlers/index.ts` and the matching union in `client/src/types.ts`.
- Use `broadcast()` and `sendTo()` instead of writing raw `ws.send(JSON.stringify(...))`.
- After state changes, emit the corresponding `*_sync` event so the client fully resynchronizes.
- Use `getDbPath()` for SQLite location decisions, keep schema changes in `server/db.ts`, and preserve the `wsNeedsReload` assumptions around GitHub pull/restore.
- After persisted changes, keep GitHub sync behavior intact with `scheduleAutosync()` when the existing flow expects it.
- Keep Claude Agent SDK usage on the existing `query()`-based path and preserve the current permission model unless the task explicitly changes it.

## Testing Rules

- Put unit tests in `server/**/*.test.ts` using `bun:test`.
- If you fix data processing, storage, migration, or cross-entity state bugs, add a regression test in the same change.
- In multi-entity flows, assert not only the target behavior but also that unrelated tasks, goals, profile data, retros, life logs, or quotas stay unchanged.
- Check immutability when the code transforms arrays or objects.
- Include abnormal inputs such as broken JSON, missing keys, empty arrays, or invalid payloads when that is where the bug lives.

## Workflow

1. Start from the entrypoint closest to the change, usually a handler or storage function.
2. Trace the full path: handler -> domain/AI/storage -> response broadcast.
3. Update shared client/server types whenever the payload changes.
4. Add or update tests before wrapping up the task.
5. After changes, run the relevant checks:

```bash
bunx tsc --noEmit
cd client && npx tsc -b && npm run lint
bun run test
```

Run the full set when the change crosses boundaries or touches shared types.

## Companion Skills

- Use `todome-server-navigator` when the task first requires codebase orientation or handler tracing.
- Use `todome-e2e-runner` after UI-visible backend changes that need end-to-end confirmation.
- Use `vercel-react-best-practices` only if the server change also drives a React-side performance refactor.

## Output Expectations

- Return implementation guidance and edits in terms of actual repo modules, not generic backend advice.
- Call out any payload coupling with `client/src/types.ts`.
- Prefer narrow, maintainable changes over new abstraction layers.
