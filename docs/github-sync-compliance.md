# GitHub 同期機能と利用規約について

todome の GitHub 同期機能 (`server/github/*.ts`) が GitHub の利用規約・[Acceptable Use Policies (AUP)](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies) に準拠しているかを整理したドキュメントです。

> **注記**: 本書は法的助言ではなく、todome 開発者が公開ドキュメントを参照して整理した現状認識です。最終的な判断は各自で GitHub の公式規約を確認してください。

## 前提: この機能が何をしているか

- ユーザー自身の `gh` CLI 認証トークンで、ユーザー自身の private repo に `todome.db` (SQLite バイナリ) を `git add → commit → push` する
- トークンは todome サーバーがディスクに保存しない。`gh auth token` で毎回取り直し、プロセス環境変数経由で `git` に渡す
- push のトリガは DB 書き込みごとに debounce された `scheduleAutosync()`
- 履歴から任意コミット時点の DB を復元する機能あり (`restoreDbToCommit()`)

つまり GitHub 側から見ると **「ユーザー A が自分の PC で git/gh を使って自分の repo に push している」** 以上の情報はなく、VS Code や SourceTree からの操作と区別がつきません。

## GitHub AUP の該当しうる条項

以下は AUP 本文から関連しうる部分を抜粋したものです。

### Section 4 — Spam and Inauthentic Activity

> automated excessive bulk activity and coordinated inauthentic activity, such as spamming
>
> using our servers for any form of excessive automated bulk activity
>
> to place undue burden on our servers through automated means

→ **自動化された過剰な一括操作**を禁止。todome の autosync が極端な高頻度 (秒単位で push し続ける等) になった場合に抵触しうる。

### Section 9 — Bandwidth and Infrastructure

> If we determine your bandwidth usage to be significantly excessive in relation to other users of similar features, we reserve the right to suspend your Account

→ 帯域を著しく超過した場合にアカウント停止の可能性あり。大容量ファイルについては GitHub の [About large files on GitHub](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github) を参照。

### AUP に **明記されていない** もの

以下は一般論として語られることが多いですが、現行の AUP 本文には直接の条文として載っていません:

- 「repository を backup / storage service として使うな」
- 「repository を CDN として使うな」

todome の利用可否を論じる際は、明文化された Section 4 / Section 9 を基準に考えるのが正確です。

## 利用形態ごとの評価

### ✅ 個人が自分のマシンで動かす (想定されるデフォルトの使い方)

- push は debounce 済みで、1 回の書き込みごとに即座に push するわけではない
- private repo に自分の `todome.db` を入れるだけ。他人のデータは扱わない
- トークン・容量・API quota はすべてユーザー自身のもの

→ **Section 4 / 9 いずれにも抵触しない**。通常のソフトウェア開発ワークフローと変わりません。

### ✅ OSS として配布し、各ユーザーが自分で fork / clone して動かす

- 各ユーザーが自分の `gh` 認証で、自分の repo に push する
- todome というツールの存在自体は GitHub のインフラに負荷を与えない
- 「1 つの App が大量ユーザーの代理で API を叩く」構造ではない

→ **個人利用と同じ扱い**。追加のリスクは発生しない。

### ⚠️ 中央サーバー型の SaaS としてホストする場合

以下のような構成は AUP 違反に近づくため、本プロジェクトは非推奨としています:

- todome.com のようなホスト型サービスを立て、運営サーバーが代理で push する
- OAuth App で大量ユーザーのトークンを集中管理し、中央から GitHub API を叩く
- ユーザー数・書き込み頻度に比例して API リクエストが増える構造

→ Section 4 の "excessive automated bulk activity" に接近する。この形態で運用する場合は GitHub ではなく自前 / 専用ストレージ (S3, Supabase 等) への切り替えを推奨します。

## 運用上の注意

個人利用の範囲でも、以下を守ることで安全側に倒せます:

- **autosync の頻度**: 書き込みごとの即時 push ではなく debounce する ([server/github/autosync.ts](../server/github/autosync.ts) の `scheduleAutosync()` がこれを担当)
- **DB サイズ**: `todome.db` が肥大化してリポジトリが数 GB 規模になったら、履歴を `git filter-repo` で truncate するか、別ストレージへの移行を検討
- **push 失敗時**: [server/github/cli.ts](../server/github/cli.ts) の retry ロジックが無限リトライしないことを確認 (現状は 1 回のみ rebase+retry)

## まとめ

- todome のデフォルトの使い方 (個人が自分のマシンで動かし、自分の repo に同期) は **AUP 上問題なし**
- OSS として配布し、各ユーザーが自分で動かす形態も **同じく問題なし**
- 中央サーバー型 SaaS として他人のデータを扱う形に拡張する場合のみ、専用ストレージへの移行を推奨
