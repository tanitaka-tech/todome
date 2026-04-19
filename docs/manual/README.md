# todome 画面説明書

`docs/manual/` は todome の画面説明書(静的サイト)。GitHub Pages で公開する。

## 構成

```
docs/manual/
├── index.html                 トップ(目次 + ヒーロー + ハイライト3本)
├── pages/
│   ├── overview.html
│   ├── board.html
│   ├── goal.html
│   ├── retrospective.html
│   ├── stats.html
│   ├── profile.html
│   └── settings.html
└── assets/
    ├── css/manual.css         サイト共通CSS (モノトーン基調)
    ├── js/manual.js           サイドバー開閉・active制御
    ├── screenshots/*.png      Playwright で自動生成(コミット対象)
    └── animations/*.webp      Playwright で自動生成(コミット対象)
```

## スクリーンショットの更新方法

Playwright で todome 本体を起動し、デモデータを投入→各画面を撮影する。

```bash
cd e2e
npm install            # 初回のみ
npx playwright install # 初回のみ
npm run capture        # client ビルド → data-manual/ 初期化 → スクショ生成
```

生成物は `docs/manual/assets/screenshots/*.png`。git にコミットして push する。

内部構成:

- `e2e/playwright.manual.config.ts` — 専用ポート(3112)と隔離 DB(`data-manual/`)でサーバーを起動する Playwright config
- `e2e/manual/capture.spec.ts` — 画面遷移 → `page.screenshot()` 本体
- `e2e/manual/seed.ts` — タスク / 目標 / プロフィールの UI 経由投入

## アニメーション(ハイライト)の更新方法

トップページ上部の 3 本の Animated WebP(タスク完了時の褒めトースト / AI にタスク追加を依頼 / AI が振り返りを生成)は、専用の Playwright スペックで撮影 → `img2webp` で合成している。AI 応答は `window.WebSocket` をスタブ化した上で合成メッセージを注入する決定的なデモで、`ANTHROPIC_API_KEY` は不要。

```bash
brew install webp           # 初回のみ (img2webp を用意)
cd e2e
npm run animate             # ビルド → フレーム撮影 → WebP 合成
```

生成物は `docs/manual/assets/animations/{celebration,chat-ai,retro-ai}.webp`。git にコミットして push する。

内部構成:

- `e2e/manual/ws-harness.js` — `window.WebSocket` を丸ごとラップし、`window.__wsInject()` から合成 WS メッセージを注入できるようにする Playwright init script
- `e2e/manual/animations.spec.ts` — 3 シナリオを再現しつつ 10fps でフレーム連写
- `e2e/manual/frames-to-webp.js` — `animation-frames/<name>/` を `img2webp` で Animated WebP に合成
- `e2e/animation-frames/` — 中間 PNG フレーム置き場 (gitignore)

## GitHub Pages の公開設定

リポジトリの **Settings → Pages** で次を設定する (初回のみ)。

- **Source**: Deploy from a branch
- **Branch**: `master` / `/docs`

`docs/manual/` 直下の `index.html` が公開 URL のルートになる。

公開 URL: `https://tanitaka-tech.github.io/todome/manual/`

## ローカルでのプレビュー

```bash
cd docs
python3 -m http.server 8765
# http://127.0.0.1:8765/manual/ を開く
```

## 追加・変更時のポイント

- **サイドバー構造はページ間で同じ HTML を複製**している(静的サイトで生成器を入れない方針)。新しいページを追加する場合は、全ページの `<aside class="sidebar">` に同時に追記すること
- **スクショ差分**: UI を変更したときは `npm run capture` を走らせて該当スクショを更新する
- **デザイン規約**: 共通 CSS `manual.css` を変更する場合は全ページのレイアウト崩れに注意 (特に `.hero-shot` の縦横比)
