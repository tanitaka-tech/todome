# todome のデータ保持まとめ

## 保持場所の全体像

| 場所 | 内容 | 永続化 |
|---|---|---|
| **ローカル SQLite DB (`data/todome.db`)** | タスク・目標・プロフィール | ✅ ファイル永続化 |
| **サーバーメモリ (WebSocket セッションごと)** | 上記 DB のインメモリキャッシュ・`ClaudeSDKClient` | ❌ 切断で破棄 (DB から再ロード) |
| **ブラウザ `localStorage`** | テーマ設定 (`todome.theme`) のみ | ✅ |
| **ブラウザ React state** | UI 表示用コピー・チャット履歴・タイマー tick 等 | ❌ リロードで消失 |

`data/` は `.gitignore` に追加されている。接続時に `server/ws/initialState.ts` が DB からロードし `kanban_sync` / `goal_sync` / `profile_sync` などで初期同期する。各種ミューテーション後は `server/storage/*.ts` の `save*()` で書き戻す。

### SQLite スキーマ (`server/db.ts` の `initDb()`)
```sql
kanban_tasks (id TEXT PRIMARY KEY, sort_order INTEGER, data TEXT)  -- data は JSON
goals        (id TEXT PRIMARY KEY, sort_order INTEGER, data TEXT)
profile      (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT)
retrospectives (...)
life_activities (...)
life_logs (...)
quotas (...)
quota_logs (...)
schedules (id TEXT PRIMARY KEY, sort_order INTEGER, source TEXT, subscription_id TEXT, external_uid TEXT, start_at TEXT, end_at TEXT, data TEXT)
calendar_subscriptions (id TEXT PRIMARY KEY, sort_order INTEGER, data TEXT)
```
ネストしたフィールド (`kpis`, `timeLogs`, `balanceWheel` など) は `data` 列内で JSON 保持。

### 設定ファイル (`data/` 直下、いずれも平文 JSON)

| ファイル | 内容 |
|---|---|
| `github_config.json` | GitHub 同期先 owner/repo / autoSync / lastSyncAt |
| `ai_config.json` | AI ツール許可リスト + モデル設定 |
| `app_config.json` | `dayBoundaryHour` などのアプリ設定 |
| `caldav_config.json` | iCloud (CalDAV) 接続情報 — `appleId` / `appPassword` / `connectedAt`。**App用パスワードを平文で保管**するため、`data/` の権限管理に注意。切断時に削除される。 |

## データ構造

### 1. KanbanTask (`client/src/types.ts:42`)
```
id, title, description
column: "todo" | "in_progress" | "done"
priority: "low" | "medium" | "high"
memo, goalId          // 目標への紐付け
estimatedMinutes      // 見積もり(分)
timeSpent             // 累計秒数
timerStartedAt        // 計測中なら ISO時刻
completedAt           // 完了時刻
timeLogs[]            // {start, end, duration}
```

### 2. Goal (`client/src/types.ts:26`)
```
id, name, memo, deadline
achieved, achievedAt
kpis: KPI[]   // {id, name, unit: "number"|"percent", targetValue, currentValue}
```
全 KPI が `currentValue >= targetValue` になると `syncGoalAchievement()` (`server/domain/goal.ts`) が `achieved` を自動更新する。

### 3. UserProfile (`client/src/types.ts:74`)
```
currentState           // 現在の状態 (テキスト)
balanceWheel[]         // {id, name, score, icon}
actionPrinciples[]     // {id, text}[]
wantToDo[]             // {id, text}[]
timezone               // IANA TZ ("" ならサーバ/ブラウザの環境TZ)
```

### 4. Schedule / CalendarSubscription (`client/src/types.ts:533` 付近)
```
Schedule:
  id, source: "manual" | "subscription"
  subscriptionId, externalUid     // subscription 由来の場合のみ
  title, description, location
  start, end                      // ローカル ISO "YYYY-MM-DDTHH:mm:ss" (Zなし)
  allDay, color, rrule, recurrenceId

CalendarSubscription:
  id, name, url, color, enabled
  provider: "ics" | "caldav"
  caldavCalendarId                // provider=caldav のとき表示用
  status: "idle"|"fetching"|"ok"|"error", lastFetchedAt, lastError, eventCount
```

`source="subscription"` の Schedule は `subscriptionRefresh` ハンドラが `replaceSubscriptionSchedules()` で **全置換** する（差分更新ではない）。CalDAV の RRULE / EXDATE / RECURRENCE-ID は `server/caldav/client.ts` の `parseAndExpand()` で **過去90日 〜 未来365日** の範囲に展開される。

### 5. Chat / AI 関連 (クライアントのみ)
`ChatMessage`, `AskUserRequest`, ストリーミング中の `streamText` / `thinkingText` — React state のみ。

## データ更新フロー

1. **直接操作**: クライアント → WS で `kanban_add/edit/delete/move`, `goal_add/edit/delete`, `profile_update` 送信 → サーバー state 更新 → `*_sync` で全量返却。
2. **AI 経由**: ユーザー発話 → サーバーが `buildBoardContext()` + `buildProfileContext()` + `buildTimelineContext()` をプロンプトに付与 → Claude が `TodoWrite` を呼ぶ → `processTodos()` (`server/ai/processTodos.ts`) が
   - `GOAL_ADD:{json}` → 目標追加
   - `GOAL_UPDATE:name:{json}` → 目標更新
   - `[HIGH]/[MEDIUM]/[LOW]` 接頭辞付きテキスト → カンバンタスクへ変換
   - ライフログ / ノルマ系アクションは `processQuotaLifeActions()` (`server/ai/processQuotaLife.ts`) が反映
3. クライアントは `kanban_sync` / `goal_sync` / `profile_sync` を受けて state 置換。

## 注意点

- **単一ストア**: 認証/ユーザー分離なし。全 WebSocket 接続が同じ `data/todome.db` を共有する想定 (シングルユーザー)。
- **並行書き込み注意**: 複数クライアントが同時にミューテーションすると、各接続のインメモリキャッシュが独立しているため、後勝ちで上書きされる可能性がある。
- テーマのみ `localStorage` に保存 (`client/src/theme.ts:7`)。
