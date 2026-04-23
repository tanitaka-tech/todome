---
paths: client/src/**/*.tsx,client/src/**/*.ts
purpose: フロントエンド実装時のルール
---

# フロントエンドルール

## 状態管理

- **グローバルストアは使わない**。`App.tsx` が全状態を保持し、子コンポーネントに props で流す方針。Redux/Zustand/Context は導入しない。
- **WebSocket 経由の同期が正**。サーバーから `*_sync` イベントを受けた時点で React 側の状態を上書きする。楽観的更新はしない。

## 型

- `client/src/types.ts` がフロント↔バックの共通型。**ここを変更したら必ず `server/` 側のペイロード形も合わせる**（逆も同様）。
- `any` は禁止。Record 型や union を使う。

## スタイリング

- CSS-in-JS は導入しない。`client/src/style.css` 1ファイルにクラスを追加する流儀。
- Tailwind・MUI・styled-components は入れない。

## 新規コンポーネント

- `client/src/components/` 直下に 1ファイル = 1コンポーネントで置く。サブディレクトリは作らない（現状15ファイル程度で十分フラット）。
- ファイル名は PascalCase.tsx、デフォルトエクスポートではなく named export。

## チェック

変更後に必ず：

```bash
cd client && npx tsc -b   # 型チェック
cd client && npm run lint # ESLint
```

UI 変更時は `./start.sh` で Vite を起こし、ブラウザで実際に触って golden path を確認してから完了報告する。
