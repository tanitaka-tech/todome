# タイムボックス機能 仕様書

## 概要

カンバン上のタスク（目標紐付き）とは別に、**食事・風呂・睡眠・遊び・SNS** などの日常的な活動をワンタップで計測できる機能。上限時間を超えたら **アラート** で気づきを促す。

目的:
- 目標に直結しない時間（休息・娯楽・ルーティン）を可視化する
- 「気づいたら遊び3時間」のような時間消費を早めに検知する
- バランスホイール（健康・趣味 等）の改善に活用する

---

## 画面レイアウト

カンバンボード（`KanbanBoard`）の **TODO / 進行中 / 完了** の3カラムとは別に、
ボード上部または下部に **独立した「タイムボックス」セクション** を設ける。

```
┌─────────────────── KanbanBoard ──────────────────────────────────┐
│  ┌── TODO ──┐ ┌── 進行中 ──┐ ┌── 完了 ──┐                        │
│  │ ...      │ │  ...       │ │  ...     │                        │
│  └──────────┘ └────────────┘ └──────────┘                        │
│                                                                    │
│  ─── タイムボックス ──────────────────────── [＋項目追加]  [⚙編集]  │
│  ┌──────┬──────┬──────┬──────┬──────┐                            │
│  │🍚 食事│🛁 風呂│🎮 遊び│📱SNS │📺動画│                            │
│  │ 45m  │ 30m  │ 60m  │ 30m  │ 60m  │   ← ボタン＋soft上限         │
│  └──────┴──────┴──────┴──────┴──────┘                            │
│  今日の合計: 食事 45m / 遊び 2h12m ⚠ / SNS 35m ...                │
└────────────────────────────────────────────────────────────────────┘
```

- 各ボタンはタップで計測開始／再タップで停止（既存のタスク計測ポップアップ機構を流用）
- 計測中はボタンがハイライト＋経過時間表示
- セクション右上の「＋項目追加」「⚙編集」からユーザーが自由にプリセットを追加・編集・削除
- 下部に「今日の合計」を活動ごとに並べる
- 上限超過したものは `⚠` で警告表示

---

## データモデル

### life_activities （プリセット定義）

| カラム | 型 | 説明 |
|---|---|---|
| id | TEXT (uuid) | PK |
| name | TEXT | 表示名（例: "食事"） |
| icon | TEXT | 絵文字（例: "🍚"） |
| category | TEXT | "rest" / "play" / "routine" / "other" |
| soft_limit_minutes | INT NULL | 黄色警告を出す閾値（NULL=無効） |
| hard_limit_minutes | INT NULL | ブラウザ通知＋AI介入を出す閾値（NULL=無効） |
| limit_scope | TEXT | "per_session" / "per_day" （この時間の扱い） |
| sort_order | INT | 表示順 |
| created_at | TEXT (ISO) | |
| archived | BOOL | true ならUIに出さないが履歴は残す |

**プリセットはすべてユーザー定義**。アプリ初期状態では、初回起動時に以下のサンプルを投入しておく（ユーザーは自由に編集・削除可能）:

| name | icon | category | soft | hard | scope |
|---|---|---|---|---|---|
| 食事 | 🍚 | routine | 45 | 90 | per_session |
| 風呂 | 🛁 | routine | 30 | 60 | per_session |
| 遊び | 🎮 | play | 60 | 180 | per_day |
| SNS | 📱 | play | 30 | 90 | per_day |
| 動画視聴 | 📺 | play | 60 | 180 | per_day |
| 仮眠 | 💤 | rest | 20 | 45 | per_session |

※ 睡眠計測は対象外（振り返りモードの睡眠欄で別途記録）。
※ `soft_limit_minutes` / `hard_limit_minutes` はユーザーが各項目ごとに自由に設定でき、NULLを許容（アラート無しで運用可能）。

### life_logs （計測ログ）

| カラム | 型 | 説明 |
|---|---|---|
| id | TEXT (uuid) | PK |
| activity_id | TEXT | FK → life_activities.id |
| started_at | TEXT (ISO) | 開始時刻 |
| ended_at | TEXT (ISO) NULL | 停止時刻。NULL=計測中 |
| memo | TEXT NULL | 任意メモ |
| alert_triggered | TEXT NULL | "soft" / "hard" / NULL（どのアラートまで発報したか） |

- `ended_at IS NULL` のレコードは「今計測中」。プロセス再起動しても継続状態を復元できる
- タスク計測と同様、1つの `activity_id` につき同時に1つだけ active
- **タスク計測とタイムボックス計測は全体として排他**（詳細は下記「計測の排他制御」参照）

---

## 計測の排他制御

**タスク計測とタイムボックス計測はシステム全体で同時に1つだけアクティブ**。
「食事しながら作業」のような二重計測は許可しない。

| 現在の状態 | タイムボックス開始をタップ | タスク計測開始をタップ |
|---|---|---|
| 何も計測中でない | そのまま開始 | そのまま開始 |
| 他のタイムボックス計測中 | **確認ダイアログ** →「現在の◯◯を停止して△△を開始しますか？」 | 同左 |
| タスク計測中 | **確認ダイアログ** →「計測中のタスク「◯◯」を停止して△△を開始しますか？」 | 同左 |

- 実装: サーバー側 `server/ws/handlers/life.ts` の `lifeLogStart()` がタスク計測を停止し、`server/ws/handlers/kanban.ts` のタイマー開始経路がライフログ/ノルマ計測を停止する
- フロントは開始操作前にモーダルで確認し、「停止して切替」選択で連続リクエスト（stop → start）を送る

---

## 計測フロー

1. ユーザーがプリセットボタンをタップ
2. `life_logs` に `started_at=now, ended_at=NULL` で INSERT
3. フロントは1秒ごとに経過時間を更新、WebSocket で他タブにも同期
4. 経過が `soft_limit_minutes` を超えたら
   - ボタンを黄色点滅
   - `alert_triggered='soft'` に更新
   - AIチャットに「〇〇を◯分続けています。そろそろ区切りませんか？」を1回だけ投げる
5. 経過が `hard_limit_minutes` を超えたら
   - ブラウザ通知（Notification API、要許可）
   - `alert_triggered='hard'` に更新
   - AIチャットに「◯時間を超えました。一度休憩/切り替えを強く推奨します」
6. ユーザーが再タップで停止 → `ended_at=now` を更新

### `per_day` スコープの扱い

- 例: 遊びの hard_limit=180m は「1回あたり」ではなく「その日の合計180m超で発報」
- セッション終了時や計測開始時に当日合計を計算し、閾値を超えていればアラート

---

## WebSocket ペイロード

### クライアント → サーバー

```jsonc
// 計測開始
{"type":"life_log_start","payload":{"activity_id":"xxx"}}

// 計測停止
{"type":"life_log_stop","payload":{"log_id":"yyy","memo":"..."}}

// プリセット追加/更新/アーカイブ
{"type":"life_activity_upsert","payload":{"id":"...","name":"...","icon":"...",...}}
{"type":"life_activity_archive","payload":{"id":"..."}}
```

### サーバー → クライアント

```jsonc
// 初期ロード（既存の state イベントに含める）
{
  "life_activities": [ ... ],
  "life_logs_today": [ ... ],   // 当日分のみ
  "life_log_active": { ... } | null   // 計測中のログ（あれば）
}

// イベント
{"type":"life_log_started","payload":{...}}
{"type":"life_log_stopped","payload":{...}}
{"type":"life_log_alert","payload":{"log_id":"...","level":"soft"|"hard"}}
```

---

## UI コンポーネント設計

- `client/src/components/LifeLogSection.tsx` — プリセット一覧＋当日合計（`KanbanBoard` 内で3カラムの下にレンダリング）
- `client/src/components/LifeLogTimer.tsx` — 計測中ポップアップ（既存の TaskTimer を参考に）
- `client/src/components/LifeActivityEditor.tsx` — プリセット追加/編集モーダル（名称・アイコン・カテゴリ・soft/hard上限時間・scopeを設定）
- `client/src/components/LifeActivityManager.tsx` — 「⚙編集」ボタンから開く一覧管理モーダル（並び替え・アーカイブ・削除）
- `client/src/hooks/useLifeLog.ts` — WebSocket 経由の状態管理
- `client/src/types.ts` — `LifeActivity` / `LifeLog` 型追加

配置: `client/src/components/KanbanBoard.tsx` 内でカラム群の下に `LifeLogSection` をレンダリング。

---

## アラート実装

### ソフトアラート（soft_limit 超過）

- 画面内: ボタンを黄色点滅、ヘッダーに `⚠` バッジ
- AIチャット: 通常メッセージとして投稿（既存の `chat_message` イベントを利用）
- 1つのログにつき1回のみ（`alert_triggered='soft'` で制御）

### ハードアラート（hard_limit 超過）

- **ブラウザ通知**: `Notification.requestPermission()` を初回に要求。バックグラウンドタブでも発報
- AIチャット: 強めの文面で投稿
- 1つのログにつき1回のみ（`alert_triggered='hard'`）

### アラート判定タイミング

- フロント: 1秒毎の経過時間更新で閾値をチェック
- サーバー: 定期タスク（例: 30秒おき）で `ended_at IS NULL` のログをスキャンし、閾値超過したらイベント発火
  - → ブラウザ閉じてても通知が届くようにするため

---

## 振り返りモード連携

- 日次/週次の振り返りドキュメントに「タイムボックスサマリー」セクションを自動生成
  ```
  ## タイムボックス（今日）
  - 食事 45m × 3回
  - 風呂 25m ✅
  - 遊び 2h30m ⚠ (上限1h)
  - SNS 40m ⚠ (上限30m)
  ```
- AI が振り返り対話で「遊びが上限を超えた日が多いですね。何が引き金になっていますか？」のような質問を投げられるよう、タイムボックス集計を context に入れる

---

## 統計パネル連携

- `StatsPanel` に「タイムボックス」タブを追加
- 週/月単位の活動時間グラフ（棒グラフ or 積み上げ）
- カテゴリ別集計（rest/play/routine）
- 上限超過日数の割合

---

## 実装ステップ

行動指針「小さく始める」に沿い、3段階で。

### Step 1: 基本計測（MVP）
- [ ] DB マイグレーション（`life_activities` / `life_logs` テーブル追加＋初期プリセット投入）
- [ ] `server/ws/handlers/life.ts` に `life_log_start` / `life_log_stop` ハンドラ
- [ ] `client/src/types.ts` に型追加
- [ ] `LifeLogPanel` 実装（ボタン群＋計測中表示）
- [ ] WebSocket で状態同期・リロード復元
- [ ] 当日合計の表示
- [ ] プリセット追加/編集/アーカイブUI

### Step 2: アラート
- [ ] soft_limit / hard_limit の閾値判定（フロント・サーバー両方）
- [ ] ボタン黄色点滅・ヘッダーバッジ
- [ ] ブラウザ通知（Notification API）
- [ ] AIチャットへの自動投稿
- [ ] `per_day` スコープの集計ロジック

### Step 3: 振り返り・統計連携
- [ ] 振り返りドキュメントにタイムボックスサマリー自動生成
- [ ] `StatsPanel` に「タイムボックス」タブ
- [ ] AI context にタイムボックス集計を投入

---

## Git同期

タイムボックス関連のデータは既存の `server/github/` 同期フローの対象に含める。

- `life_activities` テーブル: プリセット定義。全件同期
- `life_logs` テーブル: 計測ログ。全件同期
  - ※ 行数が増え続けるため、将来的に古いログのアーカイブ圧縮を検討

既存のSQLite同期フローに乗せる（別ファイル化は不要）。

---

## 決定事項（ユーザー確認済み）

- ✅ タスク計測との二重計測は **許可しない**（全体排他）
- ✅ 睡眠計測は **対象外**（振り返りモードの睡眠欄で別記録）
- ✅ タイムボックスも **Git同期対象**
- ✅ 計測項目はユーザーが **独自定義可能**。アラート時間も各項目ごとに設定可能
- ✅ 計測UIはカンバンボード内の **独立セクション** として表示

## 残る未決事項

- **モバイル対応**: スマホからワンタップ計測できるようUIを縦並びに切り替える（`docs/smartphone-access.md` 参照）
- **履歴の保持期間**: `life_logs` の古いレコードを圧縮・アーカイブする方針（MVPでは全保持）

---

## 参考
- 既存のタスク計測実装: `server/ws/handlers/kanban.ts` と `server/domain/kanban.ts`
- 既存の計測ポップアップ: `client/src/components/` の TaskTimer 系
- 振り返りモード: `docs/retrospective-mode-spec.md`
