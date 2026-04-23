# todome

Trello ライクな Kanban ボードでタスク管理しつつ、AI アシスタントがボード・目標・プロフィールを把握した上で相談に乗る Web アプリ。

## 技術スタック

- Backend: Bun 1.3+ / Hono 4.12 / WebSocket (`server/` TypeScript)
- Frontend: React 19.2 + Vite 8 + TypeScript 5.9 (`client/`)
- AI: `@anthropic-ai/claude-agent-sdk` (Sonnet)
- Data: SQLite (`bun:sqlite`, `data/` 配下・gitignore)
- Package manager: サーバー/フロントともに `bun` と `npm`

## よく使うコマンド

| 用途 | コマンド |
| --- | --- |
| 開発起動 (Vite:5173 + Bun:3002) | `./start.sh` |
| 本番起動 (build -> Bun:3002) | `./start.sh prod` |
| client 型チェック | `cd client && npx tsc -b` |
| server 型チェック | `bunx tsc --noEmit` |
| client lint | `cd client && npm run lint` |
| server unit test | `bun run test` |
| E2E (Playwright) | `./test.sh` |

## ディレクトリ

- `server/index.ts`: Bun.serve エントリポイント
- `server/config.ts` / `server/db.ts` / `server/state.ts`: 設定、DB 初期化、セッション共有状態
- `server/storage/`: SQLite I/O
- `server/ai/`: Claude Agent SDK ラッパー
- `server/github/`: gh CLI / git 連携
- `server/ws/endpoint.ts`: WebSocket handshake と dispatch loop
- `server/ws/handlers/`: `MESSAGE_HANDLERS` に登録するハンドラ群
- `client/src/components/`: UI コンポーネント群
- `client/src/hooks/useWebSocket.ts`: WebSocket 接続
- `client/src/types.ts`: フロントとサーバーで同期する型
- `docs/`: 仕様書

## 共通ルール

- 3 ステップ以上になりそうな変更は、着手前に短い実行計画を出して合意を取る。
- 完了条件は動作確認まで含む。変更内容に応じて型チェック、lint、テストを通す。UI を変えた場合は `./start.sh` を起動してブラウザで golden path を確認する。
- 推測で編集せず、`rg` やファイル読取で関連箇所を確認してから差分を作る。
- フロントとサーバーで共有する型は必ず両側を更新する。`client/src/types.ts` と `server/` 側の payload 形を片方だけ変えない。
- 過剰な抽象化や防御的コードは避ける。不要な `try/catch`、使われない引数、将来要件のためだけのフラグは追加しない。
- コメントは WHY がないと分かりづらい箇所にだけ付ける。WHAT の説明コメントは書かない。
- 破壊的操作は必ず確認する。`data/` の削除、強制 push、依存の downgrade は承認なしで行わない。
- データ処理や状態更新のバグを直したら、`bun run test` で拾える回帰テストを同時に追加する。対象データだけでなく、関係ない他データが壊れていないことも検証する。
- 応答、コミットメッセージ、PR 本文は日本語で書く。

## 作業別ルール

### Frontend (`client/`)

- グローバルストアは導入しない。`App.tsx` を起点に props で流す既存方針を保つ。
- サーバーから受ける `*_sync` を正とし、独自の楽観的更新は増やさない。
- 共有型は `client/src/types.ts` を基準にし、対応する `server/` 側の payload 形も同時にそろえる。
- CSS-in-JS、Tailwind、MUI、`styled-components` は導入しない。スタイル追加は `client/src/style.css` に寄せる。
- 新規コンポーネントは `client/src/components/` 直下、`PascalCase.tsx`、named export を基本にする。
- 詳細は `client/AGENTS.md` を参照する。

### Server (`server/`)

- 新規 WebSocket `type` を足したら、`client/src/types.ts` の `WSMessage` union と `server/ws/handlers/index.ts` の登録も同時に更新する。
- サーバーからの送信は `broadcast()` と `sendTo()` を使い、`ws.send(JSON.stringify(...))` を直接増やさない。
- SQLite パスは `getDbPath()`、書き込み後の自動同期は `scheduleAutosync()`、pull 後の再ロード前提は `wsNeedsReload` を守る。
- `ws/handlers` から `ai/*`、`storage/*`、`github/*` を呼ぶ方向はよいが、逆方向の依存は増やさない。
- データ処理、状態遷移、保存/ロード、マイグレーションを直したら回帰テストを追加し、無関係な他データが壊れていないことも検証する。
- 詳細は `server/AGENTS.md` を参照する。

## Repo Skills

- `todome-frontend-implementation`: `client/` の実装ルールを前提に、React/UI/型/CSS 変更を進める。
- `todome-server-implementation`: `server/` の実装ルールを前提に、WebSocket/AI/storage/github 変更を進める。
- `todome-type-lint-runner`: client の `tsc` と `lint` の結果を短く構造化して返す。
- `todome-e2e-runner`: `./test.sh` の結果を要約して返す。
- `todome-server-navigator`: `server/` の handler、payload、保存処理、AI 連携の場所を素早く特定する。
