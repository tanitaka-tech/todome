# todome

TrelloライクなKanbanボードでタスク管理しつつ、Claude Agent SDK ベースのAIアシスタントがボード・目標・プロフィールを把握した上で相談に乗るWebアプリ。

## 技術スタック

- **Backend**: Bun 1.3+ / Hono 4.12 / WebSocket (`server/` TypeScript)
- **Frontend**: React 19.2 + Vite 8 + TypeScript 5.9 (`client/`)
- **AI**: @anthropic-ai/claude-agent-sdk (Sonnet) — ツール連携で Kanban/Goal を直接操作
- **データ**: SQLite (`bun:sqlite`、`data/` 配下・gitignore)
- **パッケージ**: サーバー/フロントとも `bun` と `npm`

## コマンド

| 用途 | コマンド |
|---|---|
| 開発起動 (Vite:5173 + Bun:3002) | `./start.sh` |
| 本番起動 (build → Bun:3002) | `./start.sh prod` |
| 型チェック (client) | `cd client && npx tsc -b` |
| 型チェック (server) | `bunx tsc --noEmit` |
| Lint | `cd client && npm run lint` |
| Unit test (server) | `bun run test` (bun:test, `server/**/*.test.ts`) |
| E2E (Playwright) | `./test.sh` (build → e2e deps → playwright install → test) |

## ディレクトリ

- `server/index.ts` — Bun.serve エントリポイント (Hono + WebSocket)
- `server/config.ts` / `server/db.ts` / `server/state.ts` — 設定・DB初期化・セッション/共有状態
- `server/storage/` — SQLite I/O (kanban / goals / profile / retro / github)
- `server/ai/` — Claude Agent SDK ラッパー (kanban AI, retro AI)
- `server/github/` — gh CLI / git 連携 (cli / sync / diff / autosync)
- `server/ws/endpoint.ts` — WebSocket handshake と dispatch loop
- `server/ws/handlers/` — `MESSAGE_HANDLERS` に登録するハンドラ群
- `client/src/components/` — UI (App / KanbanBoard / ChatPanel / GoalPanel / StatsPanel / ProfilePanel / RetroPanel 等)
- `client/src/hooks/useWebSocket.ts` — WebSocket接続
- `client/src/types.ts` — 型定義（サーバーと同期必須）
- `docs/` — 仕様書（data-model / retrospective-mode-spec）

## 行動原則

- **3ステップ以上の変更は Plan モード必須**。見積もりを先に出し、承認後に着手する。
- **動作確認までが完了**。型チェック・lintのパスを確認し、UI変更時はブラウザ起動して触ってから完了報告する。
- **コード確認してから編集**。推測で書かず、関連箇所を `Read` / `Grep` してから差分を出す。
- **フロント↔バックの型は必ず両側を更新**。`client/src/types.ts` と `server/` 側のペイロード形は片方だけ変更しない。
- **過剰な抽象化・防御的コードは禁止**。不要な try/catch、使われない引数、将来の仮想要件のためのフラグは足さない。
- **コメントは WHY のみ**。`start.sh` の reload-exclude のような非自明な制約のみ残し、WHAT は書かない。
- **破壊的操作は必ず確認**。`data/` の削除、強制push、依存の downgrade は承認なしで行わない。
- **データ処理のバグ修正は回帰テスト必須**。タスク/目標/プロフィール/振り返り等のデータ変換・永続化・クロスデータ更新でバグが出たら、`bun run test` で拾える単体テストを同時に足す。対象データの挙動だけでなく、関係ない他のデータが影響を受けないことも assert する。詳細は [.claude/rules/server.md](.claude/rules/server.md) の「テスト」節。
- **日本語で応答**。コミットメッセージ・PR・応答はすべて日本語。

## 条件付きルール

作業内容に応じて以下を参照する（全量をここに展開しない）。

- フロント実装 (`client/src/**/*.tsx`): [.claude/rules/frontend.md](.claude/rules/frontend.md)
- WebSocket/サーバー (`server/**/*.ts` の handler 変更): [.claude/rules/server.md](.claude/rules/server.md)
