---
name: todome-frontend-implementation
description: Apply todome-specific frontend constraints when implementing or reviewing changes under `client/`. Use when editing React/Vite TypeScript UI files, client-side WebSocket state handling, shared client/server types in `client/src/types.ts`, or CSS in `client/src/style.css`.
---

# Todome Frontend Implementation

Apply the repo-specific frontend rules for todome. This skill mirrors the intent of `client/AGENTS.md` and `.claude/rules/frontend.md`, but packages it as an explicit Codex skill.

## Core Rules

- Keep state in the existing `App.tsx`-centered flow. Do not introduce Redux, Zustand, or new global context stores.
- Treat server `*_sync` messages as the source of truth. Avoid adding optimistic state paths unless the repo already uses them for that case.
- When a payload or WebSocket shape changes, update both `client/src/types.ts` and the matching `server/` payload usage together.
- Do not use `any`. Prefer existing types, unions, and `Record` shapes.
- Put styling in `client/src/style.css`. Do not introduce CSS-in-JS, Tailwind, MUI, or `styled-components`.
- Add new components under `client/src/components/` as `PascalCase.tsx` files with named exports.

## Workflow

1. Read the relevant component, hook, type definitions, and matching server handler before editing.
2. If the change touches messages or payloads, trace the matching server path and update both sides together.
3. Reuse existing UI and state patterns instead of adding new abstractions.
4. If styles change, extend `client/src/style.css` rather than scattering styles across files.
5. After changes, run:

```bash
cd client && npx tsc -b
cd client && npm run lint
```

6. If the UI changed, start the app and verify the main interaction path in the browser before considering the task done.

## Companion Skills

- Use `todome-type-lint-runner` when you mainly need a compact report from frontend `tsc` and lint.
- Use `vercel-react-best-practices` when the change involves React performance or rendering behavior.
- Use `vercel-composition-patterns` when the component API is drifting toward boolean-prop sprawl.
- Use `vercel-react-view-transitions` only when the task explicitly involves view transitions or state-change animation.

## Output Expectations

- Keep recommendations and edits concrete and repo-specific.
- Prefer small diffs that preserve the existing visual language and data flow.
- Mention any server-side companion updates if the frontend change cannot stand alone.
