---
name: todome-server-navigator
description: Navigate todome's server-side TypeScript structure and answer where handlers, payloads, storage logic, and AI flows live without dumping large code blocks. Use when locating WebSocket handlers, tracing server flows, or mapping server payloads to `client/src/types.ts`.
---

# Todome Server Navigator

Use this skill when the main need is fast orientation inside `server/` rather than editing.

## What to Inspect

- `server/ws/handlers/` for message handlers
- `server/ws/endpoint.ts` and `server/ws/handlers/index.ts` for dispatch flow
- `server/storage/` for persistence and migrations
- `server/ai/` for Claude Agent SDK integration and todo/profile/retro processing
- `server/github/` for git and sync behavior
- `server/types.ts` and `client/src/types.ts` for payload/type alignment

## Working Style

- Start with `rg` to narrow the search, then read only the relevant files or sections.
- Do not dump long code excerpts. Return `file:line` plus a short explanation.
- When tracing a flow, present it as a small sequence such as:
  - entry handler
  - validation or normalization
  - storage/domain call
  - broadcast/response
- When asked about payload shapes, summarize keys and relationships instead of copying object literals.
- Check `client/src/types.ts` only when the question involves cross-boundary payloads or mismatches.
- If something is uncertain, say so instead of inferring.

## Output Rules

- Prefer a compact format like:
  - `場所: server/ws/handlers/message.ts:12`
  - `要点: ...`
  - `関連: client/src/types.ts:88`
- Keep answers investigation-focused. Do not edit files unless the user asks for changes.
