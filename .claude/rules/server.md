---
paths: server.py,github_sync.py
purpose: サーバー/WebSocket/Claude Agent ハンドラ変更時のルール
---

# サーバールール

## 構造

- `server.py` は意図的に単一ファイル。分割はしない（Claude が全体把握しやすい粒度で止める）。
- セクションコメント `# --- Types ---` / `# --- SQLite storage ---` で論理区切り。新規関数は適切なセクションに挿入する。

## WebSocket メッセージ

- メッセージは `{"type": "xxx", ...}` 形式の JSON。**新規 `type` を足したら `client/src/types.ts` の `WSMessage` union にも追加する**。
- サーバー→クライアントのブロードキャストは `broadcast()`、特定 WS 向けは `send_to()` を使う。直接 `ws.send_json` を呼ばない。
- 状態変更後は必ず対応する `*_sync` イベントをブロードキャストする（Kanban / Goal / Profile / Retro）。

## DB

- SQLite ファイルは `get_db_path()` 経由で取得する。`DEFAULT_DB` を直参照しない（GitHub sync 有効時は repo 配下に切り替わる）。
- スキーマ変更時は `init_db()` の `CREATE TABLE IF NOT EXISTS` を更新し、既存行のマイグレーションが必要なら `_migrate_*` 関数を追加して `load_*` で呼ぶ。
- 書き込み後は `schedule_autosync()` を呼んで GitHub 自動同期をスケジュールする（linked 時のみ）。

## Claude Agent SDK

- `ClaudeSDKClient` は WebSocket 接続ごとに 1インスタンス。使い回さない。
- tool_use の permission は `PermissionResultAllow` を即返す（都度プロンプトしない）。
- 外部ファイル (`.py` / `.ts`) を AI が書き換えても uvicorn が再起動しないよう `start.sh` の `--reload-include` を限定している。新規サーバーファイルを足したらここも更新する。

## テスト

- 純粋関数を足したら [.claude/rules/testing.md](testing.md) に従い `tests/test_server_helpers.py` にテストを追加する。
- ハンドラ本体（`websocket_endpoint` / `_do_push` 等）は I/O 依存のためテストしない。ロジックが増えたら純粋関数に切り出してテスト。

## チェック

```bash
uv run python -c "import ast; ast.parse(open('server.py').read())"
uv run pytest -q
```
