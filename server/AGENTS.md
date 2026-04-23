# Server Rules

`server/` 配下を編集するときの追加ルール。

## 構造

新規コードは責務に合う場所へ入れる。

- `server/index.ts`: `Bun.serve` / Hono の組み立て、静的配信、`/ws` の upgrade
- `server/config.ts`: 環境変数とパス定数
- `server/db.ts`: SQLite 初期化とスキーママイグレーション
- `server/state.ts`: `SessionState` と共有グローバル
- `server/storage/`: `bun:sqlite` を直接使う I/O
- `server/ai/`: Claude Agent SDK ラッパー
- `server/github/`: gh/git 連携
- `server/ws/endpoint.ts`: `open` / `message` / `close` の dispatch ループ
- `server/ws/handlers/`: メッセージ種別ごとのハンドラ
- `server/types.ts` / `server/utils/`: 型とユーティリティ

`ws/handlers` から `ai/*`、`storage/*`、`github/*` を呼ぶ方向はよいが、逆方向の依存は作らない。

## WebSocket メッセージ

- メッセージは `{"type":"xxx", ...}` の JSON。新規 `type` を追加したら `client/src/types.ts` の `WSMessage` union にも追加する。
- サーバーからの送信は `broadcast()` と `sendTo()` を使う。`ws.send(JSON.stringify(...))` を直接増やさない。
- 状態変更後は対応する `*_sync` イベントをブロードキャストする。
- 新規 `type` を追加したら `server/ws/handlers/index.ts` の登録も更新する。

## DB

- SQLite パスは `getDbPath()` 経由で取得する。
- スキーマ変更時は `initDb()` の `CREATE TABLE IF NOT EXISTS` と必要な migration を更新する。
- 書き込み後は `scheduleAutosync()` を呼び、GitHub 自動同期の流れを壊さない。
- GitHub pull 後の再ロード要件があるので、`wsNeedsReload` 周りの前提を崩さない。

## Claude Agent SDK

- `@anthropic-ai/claude-agent-sdk` の `query()` を使う既存方針を保つ。
- tool permission は既存実装どおり即時許可の流れを崩さない。
- `.ts` 編集で `bun --watch` が再起動する前提があるため、監視対象や配置を変えるときは `start.sh` への影響も確認する。

## テスト

- 単体テストは `bun:test` を使い、`server/**/*.test.ts` に置く。
- データ処理、状態遷移、保存/ロード、マイグレーション、AI 応答の変換層を直したら、必ず回帰テストを足す。
- タスク、目標、プロフィール、振り返りなど複数データ型をまたぐ処理では、対象データだけでなく無関係な他データが変更されていないことも明示的に assert する。
- 入力オブジェクトや配列の非破壊性もテストする。
- 壊れた JSON、存在しないキー、空配列、非配列入力などの異常系で既存データが温存されることも確認する。
- テストデータは `makeTask`、`makeGoal`、`makeProfile` のようなファクトリ関数で短く組み立てる。

## チェック

変更後は必要に応じてこれを通す。

```bash
bunx tsc --noEmit
cd client && npx tsc -b && npm run lint
bun run test
```
