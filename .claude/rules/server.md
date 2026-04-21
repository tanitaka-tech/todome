---
paths: server/**/*.ts
purpose: サーバー/WebSocket/Claude Agent ハンドラ変更時のルール
---

# サーバールール

## 構造

サーバーは `server/` 以下に責務ごとに分かれている。新規コードは合う場所に入れる。

- `server/index.ts` — `Bun.serve` / Hono の組み立て、静的配信と `/ws` の upgrade
- `server/config.ts` — 環境変数・パス定数 (`PROJECT_ROOT` / `PORT` / `DATA_DIR` など)
- `server/db.ts` — SQLite 初期化 (`initDb`) とスキーママイグレーション
- `server/state.ts` — `SessionState` 型と共有グローバル (`activeSockets` / `pendingApprovals` / `githubState` / `wsNeedsReload`)
- `server/storage/` — `bun:sqlite` 直叩きの I/O (kanban / goals / profile / retro / github)
- `server/ai/` — Claude Agent SDK ラッパー (Kanban AI, Retro AI)
- `server/github/` — `cli.ts` (gh/git spawn) + `diff.ts` + `sync.ts` + `autosync.ts`
- `server/ws/endpoint.ts` — `open` / `message` / `close` の dispatch ループ
- `server/ws/handlers/` — 種別ごとに分割したハンドラ。`handlers/index.ts` で `MESSAGE_HANDLERS` に登録する
- `server/types.ts` / `server/utils/` — 型とユーティリティ (`shortId` 等)

`ws/handlers` → `ai/*` / `storage/*` / `github/*` の依存は OK。逆方向（storage が handler を import）は禁止。

## WebSocket メッセージ

- メッセージは `{"type": "xxx", ...}` 形式の JSON。**新規 `type` を足したら `client/src/types.ts` の `WSMessage` union にも追加する**。
- サーバー→クライアントのブロードキャストは `broadcast()`、特定 WS 向けは `sendTo()` を使う（`server/ws/broadcast.ts`）。直接 `ws.send(JSON.stringify(...))` を書かない。
- 状態変更後は必ず対応する `*_sync` イベントをブロードキャストする（Kanban / Goal / Profile / Retro / GitHub）。
- 新規 `type` を追加したら `server/ws/handlers/index.ts` の `registerAllHandlers()` にも登録する。

## DB

- SQLite パスは `getDbPath()` 経由で取得する。GitHub sync 有効時は repo 配下に切り替わる。
- スキーマ変更時は `initDb()` の `CREATE TABLE IF NOT EXISTS` を更新し、既存行のマイグレーションが必要なら `migrate*()` を追加して `load*()` で呼ぶ。
- 書き込み後は `scheduleAutosync()` を呼んで GitHub 自動同期をスケジュールする（linked 時のみ）。
- GitHub pull で DB ファイルが入れ替わる可能性があるため、`wsNeedsReload` で次の message 受信時にセッション内キャッシュを再ロードする。

## Claude Agent SDK

- `@anthropic-ai/claude-agent-sdk` の `query()` を使う。Kanban AI は streaming input mode、Retro AI は one-shot。
- tool_use の permission は `{ behavior: "allow" }` を即返す（都度プロンプトしない）。
- AI が任意の `.ts` を編集すると `bun --watch` が再起動するため、`start.sh` は `server/` 配下のみ監視する。新規サーバー領域が増えたらここを確認する。

## チェック

```bash
bunx tsc --noEmit
cd client && npx tsc -b && npm run lint
```
