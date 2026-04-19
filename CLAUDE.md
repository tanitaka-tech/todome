# todome

TrelloライクなKanbanボードでタスク管理しつつ、Claude Agent SDK ベースのAIアシスタントがボード・目標・プロフィールを把握した上で相談に乗るWebアプリ。

## 技術スタック

- **Backend**: Python 3.11+ / FastAPI / WebSocket / uvicorn (`server.py` 1ファイル集約)
- **Frontend**: React 19.2 + Vite 8 + TypeScript 5.9 (`client/`)
- **AI**: claude-agent-sdk (Sonnet) — ツール連携で Kanban/Goal を直接操作
- **データ**: SQLite (`data/` 配下・gitignore)
- **パッケージ**: Python は `uv`、Frontend は `npm`

## コマンド

| 用途 | コマンド |
|---|---|
| 開発起動 (Vite:5173 + uvicorn:3002) | `./start.sh` |
| 本番起動 (build → uvicorn:3002) | `./start.sh prod` |
| 型チェック | `cd client && npx tsc -b` |
| Lint | `cd client && npm run lint` |
| Python構文チェック | `uv run python -c "import ast; ast.parse(open('server.py').read())"` |
| Pythonテスト | `uv run pytest -q` |

## ディレクトリ

- `server.py` — FastAPI + WebSocket + Claude Agent ハンドラ（巨大・ここが中心）
- `github_sync.py` — gh CLI / git ラッパー
- `client/src/components/` — UI (App / KanbanBoard / ChatPanel / GoalPanel / StatsPanel / ProfilePanel / RetroPanel 等)
- `client/src/hooks/useWebSocket.ts` — WebSocket接続
- `client/src/types.ts` — 型定義（サーバーと同期必須）
- `docs/` — 仕様書（data-model / retrospective-mode-spec）

## 行動原則

- **3ステップ以上の変更は Plan モード必須**。見積もりを先に出し、承認後に着手する。
- **動作確認までが完了**。型チェック・lintのパスを確認し、UI変更時はブラウザ起動して触ってから完了報告する。
- **コード確認してから編集**。推測で書かず、関連箇所を `Read` / `Grep` してから差分を出す。
- **フロント↔バックの型は必ず両側を更新**。`client/src/types.ts` と `server.py` のペイロード形は片方だけ変更しない。
- **過剰な抽象化・防御的コードは禁止**。不要な try/except、使われない引数、将来の仮想要件のためのフラグは足さない。
- **コメントは WHY のみ**。`start.sh` の reload-exclude のような非自明な制約のみ残し、WHAT は書かない。
- **破壊的操作は必ず確認**。`data/` の削除、強制push、依存の downgrade は承認なしで行わない。
- **日本語で応答**。コミットメッセージ・PR・応答はすべて日本語。

## 条件付きルール

作業内容に応じて以下を参照する（全量をここに展開しない）。

- テスト作業 (`tests/**/*.py` を触るとき): [.claude/rules/testing.md](.claude/rules/testing.md)
- フロント実装 (`client/src/**/*.tsx`): [.claude/rules/frontend.md](.claude/rules/frontend.md)
- WebSocket/サーバー (`server.py` の handler 変更): [.claude/rules/server.md](.claude/rules/server.md)
