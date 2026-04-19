# todome

TrelloライクなKanbanボードでタスクを管理しながら、AIエージェントに相談してタスクの更新や新たなタスクの提案を受けられるWebアプリです。

| Kanban形式でのタスク管理 | タスク管理をAIにお任せ | AIと一緒に振り返り |
|:---:|:---:|:---:|
| ![Kanban形式でのタスク管理](docs/manual/assets/animations/celebration.webp) | ![タスク管理をAIにお任せ](docs/manual/assets/animations/chat-ai.webp) | ![AIと一緒に振り返り](docs/manual/assets/animations/retro-ai.webp) |

## 画面説明書

ゲーム画面風の画面説明書を `docs/manual/` に配置しています。GitHub Pages で公開します。

- 公開 URL: https://tanitaka-tech.github.io/todome/manual/
- 更新手順: [docs/manual/README.md](docs/manual/README.md) を参照
- ローカル表示: `cd docs && python3 -m http.server 8765` → `http://127.0.0.1:8765/manual/`

## 特徴

- **Kanbanボード** — TODO / 進行中 / 完了の3カラム、ドラッグ&ドロップ
- **AIアシスタント** — Claude がボードと目標を把握した上でアドバイス・タスク操作
- **目標管理** — 目標名・メモ・KPI(複数)・期日を設定し、タスクと紐付け
- **作業時間計測** — タスクごとに再生/一時停止、見積もり対比表示、完了時刻の記録
- **統計ダッシュボード** — 目標別作業時間の円グラフ、日/月/年の推移棒グラフ
- **プロフィール定義** — 現在の状態、バランスホイール、行動指針、やりたいことをAIコンテキストに反映

## 技術スタック

| レイヤー | 技術 |
|---|---|
| フロントエンド | React 19 + Vite + TypeScript |
| バックエンド | Python / FastAPI + WebSocket |
| AI | Claude Agent SDK (Sonnet) |
| 通信 | WebSocket リアルタイム双方向 |

## セットアップ

### 前提条件

- **Node.js** 18+
- **Python** 3.11+
- **[uv](https://docs.astral.sh/uv/)** (Python パッケージマネージャー)
- **Anthropic API Key** もしくは `claude login` でログイン済みの環境
- **[gh CLI](https://cli.github.com/)** (任意 — GitHub 同期機能を使う場合)

### 1. リポジトリをクローン

```bash
git clone https://github.com/<your-org>/todome.git
cd todome
```

### 2. 環境変数を設定

プロジェクトルートに `.env` を作成し、Anthropic API Key を設定します。

```bash
cat > .env <<'EOF'
ANTHROPIC_API_KEY=sk-ant-...
EOF
```

### 3. 依存関係をインストール

```bash
# Python (uv が pyproject.toml を自動解決)
uv sync

# フロントエンド
cd client
npm install
cd ..
```

## 起動方法

### ワンコマンド起動 (推奨)

```bash
./start.sh          # 開発モード (Vite + uvicorn --reload を並列起動)
./start.sh prod     # 本番モード (client をビルドして uvicorn のみ起動)
```

- 開発モードはブラウザで **http://localhost:5173**、本番モードは **http://localhost:3002** でアクセスします。
- Ctrl+C で両方のプロセスが停止します。
- `client/node_modules` が無ければ初回に `npm install` が自動実行されます。

### 手動で起動する場合

<details>
<summary>開発モード (ターミナル2つ)</summary>

```bash
# ターミナル 1: フロントエンド (HMR)
cd client && npm run dev
```

```bash
# ターミナル 2: バックエンド (ホットリロード)
uv run uvicorn server:app --host 0.0.0.0 --port 3002 --reload
```
</details>

<details>
<summary>本番モード (サーバー1つ)</summary>

```bash
cd client && npm run build && cd ..
uv run uvicorn server:app --host 0.0.0.0 --port 3002
```
</details>

## 使い方

### Kanban ボード

| 操作 | 方法 |
|---|---|
| タスク追加 | カラムの **+** ボタン → タスク名・優先度を入力 |
| 移動 | カードをドラッグ&ドロップ |
| 詳細編集 | カードをクリック → メモ・見積もり時間・目標を編集 |
| 優先度変更 | カード左上のバッジ (低/中/高) をクリック |
| 削除 | カードホバー → **×** ボタン |

### 作業時間計測

| 操作 | 方法 |
|---|---|
| 計測開始 | カードの **▶** ボタン (同時に計測できるのは1タスクのみ) |
| 一時停止 | ポップアップの **一時停止** ボタン |
| 再開 | ポップアップの **再開** ボタン |
| 完了 | ポップアップの **完了** ボタン (タスクを完了カラムに移動 + 計測終了) |

計測中・一時停止中は画面下部にフローティングポップアップが表示されます。

### AI アシスタント

チャットパネルから AI に話しかけると、ボード・目標・プロフィールの状態を踏まえてアドバイスします。

```
「今日やるべきタスクを提案して」
「タスクの優先度を見直して」
「Q3の売上目標を追加して。KPIは月間売上1000万円」
「プロダクトリリースの目標を作って、関連タスクも洗い出して」
```

AI はタスクの追加・更新・目標の作成を直接実行できます。

### 目標管理

トップバーの **目標管理** タブから、目標の作成・編集・削除ができます。

- **目標名** / **メモ** / **KPI** (複数) / **期日**
- タスク詳細モーダルからタスクと目標を紐付け

### 統計

トップバーの **統計** タブで作業時間を可視化します。

- **サマリー** — 合計作業時間・完了タスク数・全タスク数
- **円グラフ** — 目標別の作業時間割合
- **棒グラフ** — 日別/月別/年別の作業時間推移 (目標ごとに積み上げ)

### プロフィール (自分について)

トップバーの **自分について** タブで、AI のコンテキストとなる自分の情報を定義します。

- **現在の自分の状態** — 自由記述テキスト
- **バランスホイール** — 趣味・人間関係・健康・仕事・ファイナンスなどカテゴリ別に理想の状態を定義
- **行動指針** — 心がけたい行動指針のリスト
- **やりたいこと** — やりたいことのリスト

## ファイル構成

```
todome/
├── server.py               # FastAPI + WebSocket バックエンド
├── github_sync.py           # gh CLI / git ラッパー (GitHub 同期)
├── pyproject.toml           # Python 依存関係
├── .gitignore
├── README.md
├── data/                    # SQLite DB・GitHub 同期状態 (gitignore)
└── client/
    ├── package.json         # フロントエンド依存関係
    ├── index.html           # HTML エントリポイント
    ├── vite.config.ts       # Vite 設定
    ├── tsconfig*.json       # TypeScript 設定
    ├── public/
    │   └── favicon.svg
    └── src/
        ├── main.tsx         # React マウントポイント
        ├── types.ts         # 型定義
        ├── style.css        # スタイリング
        ├── hooks/
        │   └── useWebSocket.ts
        └── components/
            ├── App.tsx             # ルートコンポーネント (状態管理・タイマー)
            ├── KanbanBoard.tsx     # Kanban ボード (D&D・タイマー)
            ├── ChatPanel.tsx       # AI チャットパネル
            ├── AskUserCard.tsx     # AI 質問カード
            ├── TaskDetailModal.tsx  # タスク詳細モーダル
            ├── GoalPanel.tsx       # 目標管理パネル
            ├── StatsPanel.tsx      # 統計ダッシュボード
            └── ProfilePanel.tsx    # プロフィール編集
```

## アーキテクチャ

```
ブラウザ (React)                        サーバー (FastAPI)
┌──────────────────┐                   ┌──────────────────┐
│  KanbanBoard     │──kanban_*────→    │                  │
│  GoalPanel       │──goal_*──────→    │  状態管理         │
│  ProfilePanel    │──profile_*───→    │  (タスク/目標/    │
│                  │←─*_sync──────     │   プロフィール)   │
├──────────────────┤                   │                  │
│  ChatPanel       │──message─────→    │  Claude Agent SDK │
│                  │──ask_response─→   │  - TodoWrite     │
│                  │←─stream_delta─    │  - AskUser       │
│                  │←─assistant────    │  - GOAL_ADD/UPDATE│
│                  │←─kanban_sync──    │                  │
│                  │←─goal_sync────    │                  │
└──────────────────┘                   └──────────────────┘
```

## ライセンス

MIT
