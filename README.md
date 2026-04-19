# todome

日本語 | [English](README_EN.md)

- **Kanbanボード** — TODO / 進行中 / 完了の3カラム、ドラッグ&ドロップ
- **AIアシスタント** — Claude がボードと目標を把握した上でアドバイス・タスク操作
- **目標管理** — 目標名・メモ・KPI(複数)・期日を設定し、タスクと紐付け
- **作業時間計測** — タスクごとに再生/一時停止、見積もり対比表示、完了時刻の記録
- **統計ダッシュボード** — 目標別作業時間の円グラフ、日/月/年の推移棒グラフ
- **プロフィール定義** — 現在の状態、バランスホイール、行動指針、やりたいことをAIコンテキストに反映
- **GitHub連携** — 端末間でのデータを共有 & 目標にリポジトリを紐付けてAIコンテキストに反映 ([利用規約との関係](docs/github-sync-compliance.md))

| Kanban形式でのタスク管理 | タスク管理をAIにお任せ | AIと一緒に振り返り | テーマを切り替えて気分を変える | Gitによる履歴管理 |
|:---:|:---:|:---:|:---:|:---:|
| ![Kanban形式でのタスク管理](docs/manual/assets/animations/celebration.webp) | ![タスク管理をAIにお任せ](docs/manual/assets/animations/chat-ai.webp) | ![AIと一緒に振り返り](docs/manual/assets/animations/retro-ai.webp) | ![テーマを切り替えて気分を変える](docs/manual/assets/animations/theme-switch.webp) | ![Gitによる履歴管理](docs/manual/assets/animations/git-history.webp) |

## コンセプト

todome は完成したアプリでありながら、**ユーザーがForkして、自分専用のマネジメント環境として育てていくアプリ**としても設計されています。
ぜひお手元の環境で自分好みに調整してみてください。

- 自前のAIエージェントで独自機能を追加
- 自分の使い勝手に合わせて画面や挙動を自由に書き換え

### ストア配布しない理由

簡単なアプリならAIですぐに作れる時代では、「ストアでアプリを探す」よりも「自分で作ったほうが早い」という場面も珍しくありません。それほど、自分の要望に100%合致するアプリを見つけるのは難しくなっています。

今後AI製アプリがストアに溢れていくと、ユーザーは目的のアプリを探すこと自体に疲れてしまい、やがて個人開発アプリはユーザーから選ばれなくなっていくのではないか——私はそう考えています。

そこで行き着いたのは、「ユーザーはストアで欲しいアプリを探し続けるよりも、自分で欲しいアプリを作れたほうが幸せなのではないか」という発想です。それに自分だけがチート釣り竿を持った状態でユーザーに魚を売り捌くのは、どこかフェアではないと感じます。ユーザーにも同じ釣り竿を渡したうえで、「自分で作ったものより、このアプリのほうが質が良いから使いたい」と言ってもらえるのが理想です。

todome は、各ユーザーが自分のローカル環境で理想の形に育てていけるアプリとして設計しています。アプリを開発プラットフォームとして公開することで「自分のアプリを作る楽しさ」を体験していただく——それが todome のコンセプトです。

## 画面説明書

画面説明書を `docs/manual/` に配置しています。

- 公開 URL: https://tanitaka-tech.github.io/todome/manual/
- 更新手順: [docs/manual/README.md](docs/manual/README.md) を参照
- ローカル表示: `cd docs && python3 -m http.server 8765` → `http://127.0.0.1:8765/manual/`

## セットアップ

### 前提条件

- **Node.js** 18+
- **Python** 3.11+
- **[uv](https://docs.astral.sh/uv/)** (Python パッケージマネージャー)
- 契約済みのClaudeCode と **Anthropic API Key** もしくは `claude login` でログイン済みの環境
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

## 使用例

- **スマホからアクセスする** — PC で起動した todome をスマホのブラウザから開く方法(同一LAN / Tailscale / cloudflared)。詳細は [docs/smartphone-access.md](docs/smartphone-access.md) を参照。

## 技術スタック

| レイヤー | 技術 |
|---|---|
| フロントエンド | React 19 + Vite + TypeScript |
| バックエンド | Python / FastAPI + WebSocket |
| AI | Claude Agent SDK (Sonnet) |
| 通信 | WebSocket リアルタイム双方向 |

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

## Special Thanks

開発にあたって参考にさせていただいた資料は [docs/special-thanks.md](docs/special-thanks.md) に記載しています。

## ライセンス

MIT
