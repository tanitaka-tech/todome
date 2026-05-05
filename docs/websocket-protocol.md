# WebSocket メッセージプロトコル

todome のクライアント↔サーバー通信は単一の WebSocket (`/ws`) で行います。
すべてのメッセージは `{"type": "...", ...}` 形式の JSON で、`type` を見て分岐します。

このドキュメントは、現状サポートされている全メッセージ種別を機能別にまとめたリファレンスです。
**実装の正は以下の 2 ファイル**:

- 入力 (client → server): [`server/ws/handlers/index.ts`](../server/ws/handlers/index.ts) の `registerAllHandlers()`
- 出力 (server → client): [`client/src/types.ts`](../client/src/types.ts) の `WSMessage` union

ここに記載されている内容と齟齬が出た場合はソースを優先してください。

---

## 設計の前提

- **状態の正はサーバー**。クライアントは楽観的更新を行わず、サーバーからの `*_sync` を受け取って状態を上書きする (`.claude/rules/frontend.md`)。
- **書き込み後は対応する `*_sync` をブロードキャスト**。Kanban / Goal / Profile / Retro / GitHub などすべて同じ流儀 (`.claude/rules/server.md`)。
- **broadcast / sendTo を必ず経由する**。`ws.send(JSON.stringify(...))` を直接書かない (`server/ws/broadcast.ts`)。

---

## Client → Server (入力)

ハンドラ実装は `server/ws/handlers/<feature>.ts`。
登録は `registerAllHandlers()` で集中管理しています。

### Kanban (タスク)

| type | 概要 |
|---|---|
| `kanban_add` | タスク追加 |
| `kanban_edit` | タスク編集 |
| `kanban_delete` | タスク削除 |
| `kanban_move` | カラム間移動 (TODO / 進行中 / 完了) |
| `kanban_reorder` | 同一カラム内の並び替え |

### Goal (目標)

| type | 概要 |
|---|---|
| `goal_add` | 目標追加 |
| `goal_edit` | 目標編集 (KPI・期日含む) |
| `goal_delete` | 目標削除 |

### Profile / セッション

| type | 概要 |
|---|---|
| `profile_update` | プロフィール (現状・バランスホイール・行動指針・やりたいこと) の更新 |
| `clear_session` | AI セッションのクリア |

### AI / アプリ設定

| type | 概要 |
|---|---|
| `ai_config_update` | AI ツール許可リスト・モデル設定の更新 |
| `app_config_update` | 日の境界時刻などのアプリ設定の更新 |

### Life (生活ログ)

| type | 概要 |
|---|---|
| `life_activity_upsert` | 生活アクティビティの追加/更新 |
| `life_activity_archive` | アーカイブ |
| `life_activity_delete` | 削除 |
| `life_activity_reorder` | 並び替え |
| `life_log_start` | ログ開始 |
| `life_log_stop` | ログ停止 |
| `life_log_delete` | ログ削除 |
| `life_log_range_request` | 期間指定のログ取得リクエスト |

### Quota (定量目標)

| type | 概要 |
|---|---|
| `quota_upsert` | Quota の追加/更新 |
| `quota_delete` | 削除 |
| `quota_reorder` | 並び替え |
| `quota_log_start` | Quota ログ開始 |
| `quota_log_stop` | Quota ログ停止 |
| `quota_log_range_request` | 期間指定のログ取得リクエスト |

### Retrospective (振り返り)

| type | 概要 |
|---|---|
| `retro_list` | 振り返り一覧の取得 |
| `retro_discard_draft` | ドラフト破棄 |
| `retro_delete` | 振り返り削除 |
| `retro_start` | 振り返りセッション開始 |
| `retro_message` | 振り返り中のユーザー発話 |
| `retro_complete` | セッション完了 |
| `retro_reopen` | 完了済みセッションの再オープン |
| `retro_edit_document` | ドキュメント直接編集 |
| `retro_close_session` | セッションクローズ |

### GitHub 連携

| type | 概要 |
|---|---|
| `github_status_request` | 現在の連携状態取得 |
| `github_list_repos` | 紐付け候補リポジトリ一覧 |
| `github_link` | リポジトリ紐付け |
| `github_unlink` | 紐付け解除 |
| `github_sync_now` | 即時 push |
| `github_pull_now` | 即時 pull |
| `github_set_auto_sync` | 自動同期の ON/OFF |
| `github_list_commits` | コミット履歴 |
| `github_commit_diff` | 差分取得 |
| `github_restore_commit` | 指定コミットへの復元 |

### Schedule / Subscription

| type | 概要 |
|---|---|
| `schedule_add` | 予定追加 |
| `schedule_edit` | 予定編集 |
| `schedule_delete` | 予定削除 |
| `subscription_add` | 外部カレンダー購読追加 |
| `subscription_edit` | 購読編集 |
| `subscription_delete` | 購読削除 |
| `subscription_refresh` | 再取得 |

### CalDAV (iCloud)

| type | 概要 |
|---|---|
| `caldav_status_request` | 接続状態取得 |
| `caldav_connect` | Apple ID + App用パスワードで接続 |
| `caldav_disconnect` | 接続解除 (認証情報を削除) |
| `caldav_list_calendars` | 利用可能カレンダー列挙 |
| `caldav_set_write_target` | 書き込み先カレンダー設定 |

### Google Calendar

| type | 概要 |
|---|---|
| `google_status_request` | 接続状態取得 |
| `google_set_credentials` | OAuth クライアント情報設定 |
| `google_connect_start` | OAuth 認可開始 |
| `google_disconnect` | 接続解除 |
| `google_set_active_account` | アクティブアカウント切り替え |
| `google_list_calendars` | カレンダー列挙 |
| `google_set_write_target` | 書き込み先カレンダー設定 |

### AI チャット

| type | 概要 |
|---|---|
| `message` | ユーザーから AI への発話 (Kanban AI / Streaming) |

---

## Server → Client (出力)

`WSMessage` union (`client/src/types.ts`) の全 variant。
`*_sync` はサーバー側で状態が変わったときに必ず broadcast されます。

### エラー / 共通

| type | ペイロード | 概要 |
|---|---|---|
| `error` | `scope`, `message`, `requestType?` | パースエラー / 未知 type / ハンドラ例外 / 初期状態取得失敗 |

`scope` の値: `"parse" \| "unknown_type" \| "handler" \| "initial_state"`

### AI チャットストリーム

| type | 概要 |
|---|---|
| `stream_delta` | アシスタント本文のデルタ |
| `thinking_delta` | thinking のデルタ |
| `assistant` | アシスタントの完了ターン (toolCalls 含む) |
| `tool_use` | ツール呼び出し通知 |
| `ask_user` | AskUser ツールでの質問 |
| `session_cleared` | セッションクリア完了 |
| `result` | ターン終了サマリ (cost / turns / sessionId) |

### 状態同期 (sync)

| type | 概要 |
|---|---|
| `kanban_sync` | タスク全件 |
| `goal_sync` | 目標全件 |
| `profile_sync` | プロフィール |
| `ai_config_sync` | AI 設定 |
| `app_config_sync` | アプリ設定 |
| `life_activity_sync` / `life_log_sync` | 生活アクティビティ / ログ |
| `life_log_started` / `life_log_stopped` | ログ開始/停止イベント |
| `life_log_range_sync` | 期間指定取得結果 |
| `quota_sync` / `quota_log_sync` | Quota / ログ |
| `quota_log_started` / `quota_log_stopped` | ログ開始/停止イベント |
| `quota_streak_sync` | ストリーク情報 |
| `quota_log_range_sync` | 期間指定取得結果 |
| `schedule_sync` | スケジュール全件 |
| `subscription_sync` | 購読全件 |

### Retrospective

| type | 概要 |
|---|---|
| `retro_list_sync` | 振り返り一覧 |
| `retro_sync` | 単一振り返り更新 |
| `retro_doc_update` | ドキュメント更新 |
| `retro_stream_delta` / `retro_thinking_delta` | 振り返り AI ストリーム |
| `retro_assistant` | 振り返り AI のターン |
| `retro_completed` | 完了通知 |
| `retro_session_closed` | セッションクローズ |
| `retro_session_waiting` | AI 応答待ちフラグ |
| `retro_error` | 振り返り処理エラー |

### GitHub

| type | 概要 |
|---|---|
| `github_status` | 連携状態 |
| `github_repo_list` | リポジトリ候補 |
| `github_commit_list` | コミット履歴 |
| `github_commit_diff_result` | 差分結果 (失敗時は `error` フィールドが入る) |

### CalDAV / Google

| type | 概要 |
|---|---|
| `caldav_status` | 接続状態 |
| `caldav_calendars` | カレンダー列挙結果 (失敗時は `error` フィールド) |
| `google_status` | 接続状態 |
| `google_calendars` | カレンダー列挙結果 (失敗時は `error` フィールド) |
| `google_authorize_url` | OAuth 認可 URL |

---

## 新規 type を追加する手順

`.claude/rules/server.md` の運用ルールを 1 箇所にまとめると以下のチェックリストになります。

1. **ハンドラを追加**: `server/ws/handlers/<feature>.ts` に async 関数を実装
2. **登録**: `server/ws/handlers/index.ts` の `registerAllHandlers()` に `registerHandler("<type>", ...)` を追加
3. **出力型を追加**: state を変えたら `*_sync` ブロードキャストを追加し、`client/src/types.ts` の `WSMessage` union にも variant を追加
4. **broadcast / sendTo を使う**: 直接 `ws.send` しない (`server/ws/broadcast.ts`)
5. **DB を変えたなら autosync**: 書き込み後に `scheduleAutosync()` を呼ぶ (linked 時のみ実効)
6. **テスト**: データ処理・状態遷移ロジックには `server/**/*.test.ts` で回帰テストを追加 (関係ない他データが変更されないことも assert する)
7. **このドキュメントを更新**: 上記の表に追記

## 参考

- [`server/ws/handlers/index.ts`](../server/ws/handlers/index.ts) — 全 client → server ハンドラの登録
- [`client/src/types.ts`](../client/src/types.ts) — `WSMessage` union と関連データ型
- [`server/ws/broadcast.ts`](../server/ws/broadcast.ts) — `broadcast()` / `sendTo()`
- [`server/ws/endpoint.ts`](../server/ws/endpoint.ts) — handshake と dispatch loop
- [`.claude/rules/server.md`](../.claude/rules/server.md) — サーバー側の運用ルール
- [`.claude/rules/frontend.md`](../.claude/rules/frontend.md) — フロント側の運用ルール
