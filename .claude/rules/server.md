---
paths: server.py,server_ws.py,server_retro.py,server_github.py,server_state.py,github_sync.py
purpose: サーバー/WebSocket/Claude Agent ハンドラ変更時のルール
---

# サーバールール

## 構造

サーバーは5ファイル構成。責務で分かれているので新規コードは合う方に入れる。

- `server.py` — FastAPI app、DB I/O、純粋ヘルパ (goal/task/quota/life_log/retrospective の storage、context builder、共通定数)。セクションコメント `# --- SQLite storage ---` など論理区切りを維持する
- `server_ws.py` — WebSocket endpoint と `MESSAGE_HANDLERS` dispatch。新しい WS メッセージ種別を足すときはここ
- `server_retro.py` — 振り返り (retrospective) の AI 呼び出し・プロンプト組み立て・関連純粋ヘルパ
- `server_github.py` — GitHub sync (push/pull/link/restore/diff)、autosync debounce、commit diff 計算。新しい sync 系ロジックはここ
- `server_state.py` — 型エイリアス (`KanbanTask` / `GoalData` / `ProfileData` / `RetrospectiveData`) と `SessionState` dataclass、グローバル共有状態 (`active_sockets` / `pending_approvals` / `github_state` / `_ws_needs_reload`)

`server_ws.py` / `server_retro.py` / `server_github.py` は `import server as core` パターンで `server.py` の関数を呼ぶ。逆方向 (server.py → 各サブモジュール) の依存は避ける。`server.py` は末尾で `from server_ws import websocket_endpoint` を遅延 import し、`server_github` のシンボルは末尾の `from server_github import ...` で再エクスポートして後方互換を保つ (`core._do_push` / テストの `from server import _pick_label` など)。

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
uv run python -c "import ast; [ast.parse(open(f).read()) for f in ['server.py','server_ws.py','server_retro.py','server_state.py']]"
uv run pytest -q
```
