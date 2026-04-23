# Frontend Rules

`client/` 配下を編集するときの追加ルール。

## 状態管理

- グローバルストアは導入しない。`App.tsx` を起点に props で流す既存方針を保つ。
- WebSocket 経由の同期を正とする。サーバーから `*_sync` を受けた時点で React 側の状態を上書きし、独自の楽観的更新は増やさない。

## 型

- `client/src/types.ts` はフロントとサーバーで共有する型の基準。変更したら対応する `server/` 側の payload 形も同時に合わせる。
- `any` は使わない。`Record`、union、既存の型定義を優先する。

## スタイリング

- CSS-in-JS は導入しない。スタイル追加は `client/src/style.css` に寄せる。
- Tailwind、MUI、`styled-components` は導入しない。

## コンポーネント構成

- 新規コンポーネントは `client/src/components/` 直下に置く。原則として 1 ファイル = 1 コンポーネント、サブディレクトリは増やさない。
- ファイル名は `PascalCase.tsx` を使い、default export ではなく named export を使う。

## チェック

変更後は最低限これを通す。

```bash
cd client && npx tsc -b
cd client && npm run lint
```

UI を変えた場合は `./start.sh` を起動し、ブラウザで実際に触って golden path を確認してから完了にする。
