# スマホからアクセスする

PC で起動した todome に、自分のスマホからアクセスする手順です。用途に応じて以下の3つから選びます。

| 方法 | 接続範囲 | 必要なもの | 向いているケース |
|---|---|---|---|
| [A. 同一LAN](#a-同一-lan-内でアクセス最も手軽) | 自宅 Wi-Fi 等の同一ネットワーク内のみ | なし(設定変更のみ) | 自宅でしか使わない |
| [B. Tailscale](#b-tailscale-を使う外出先からも安全にアクセス) | 自分の全端末(外出先からも可) | Tailscale アカウント | モバイル回線からも使いたい |
| [C. cloudflared](#c-cloudflared-で一時的に公開) | 一時的な共有 URL | Cloudflare アカウント | 他人に見せる、デモする |

---

## A. 同一 LAN 内でアクセス(最も手軽)

PC とスマホが**同じ Wi-Fi に接続している**ときに使えます。

### 1. 本番モードで起動

```bash
./start.sh prod
```

> 開発モード(`./start.sh`)は Vite dev server が `localhost` のみで待ち受けるためスマホからは使えません。本番モードでは Bun サーバーが `client/dist` を配信するので、ポート 3002 一本でアクセスできます。
> どうしても dev モードで使いたい場合は [client/vite.config.ts](../client/vite.config.ts) に `server: { host: true }` を追加してください。

### 2. PC の LAN IP を確認

```bash
ipconfig getifaddr en0   # Wi-Fi
# もしくは
ipconfig getifaddr en1   # 有線 LAN
```

`192.168.x.x` などが表示されます。

### 3. スマホからアクセス

```
http://<PC の LAN IP>:3002
```

例: `http://192.168.1.42:3002`

### つまずきポイント

- **macOS のファイアウォール** — システム設定 → ネットワーク → ファイアウォール で Bun の受信接続を許可
- **ゲスト Wi-Fi / 公衆 Wi-Fi** — 端末分離(クライアントアイソレーション)が有効だと同一LANでも通信できません
- **VPN** — PC かスマホが VPN に繋がっていると LAN IP では届きません

---

## B. Tailscale を使う(外出先からも安全にアクセス)

外出中(モバイル回線)からも、自宅の PC が起動していれば接続できます。Tailscale が自分専用のプライベートネットワーク(tailnet)を作り、その中だけで通信します。**インターネットには公開されません**。

### なぜ Tailscale か

- ルーターのポート開放やドメイン取得が不要
- 端末間で WireGuard による end-to-end 暗号化
- 自分の端末同士だけが見える

### 1. PC に Tailscale をインストール

Mac の場合、以下のいずれか。

- **Mac App Store**(推奨): https://apps.apple.com/app/tailscale/id1475387142
- **Homebrew**: `brew install --cask tailscale`

インストール後に起動し、Google などでサインイン。

### 2. スマホに Tailscale をインストール

- iOS: App Store で「Tailscale」
- Android: Google Play で「Tailscale」

**PC と同じアカウント**でサインイン。

### 3. PC のサーバーを本番モードで起動

```bash
./start.sh prod
```

### 4. PC の Tailscale IP を確認

メニューバーの Tailscale アイコンをクリックすると、自分のマシン名と IP が表示されます。**`100.x.x.x` 形式の IPv4** をメモしてください。

> CLI 派なら、Mac App Store 版は次でシンボリックリンクを張ると `tailscale` コマンドが使えます。
> ```bash
> sudo ln -sf /Applications/Tailscale.app/Contents/MacOS/Tailscale /usr/local/bin/tailscale
> tailscale ip -4
> ```

### 5. スマホのブラウザでアクセス

```
http://<PC の Tailscale IPv4>:3002
```

例: `http://100.64.1.23:3002`

### MagicDNS を有効化(マシン名でアクセス)

[Tailscale admin → DNS](https://login.tailscale.com/admin/dns) で MagicDNS を有効にすると、IP を覚えずにマシン名で接続できます。

```
http://<マシン名>:3002
```

例: `http://masayas-mac:3002`

### セキュリティ上の注意

- **Tailscale アカウントの 2FA を必ず有効化** — アカウントが乗っ取られると tailnet 全体に影響します
- **不要になった端末は admin panel から revoke** する
- **`tailscale funnel` は使わない** — これはインターネット公開機能です。自分用途では不要

---

## C. cloudflared で一時的に公開

「一時的に他人に見せたい」「外出先のスマホで一回だけ使いたい」場合に向く方法です。Cloudflare がランダムな HTTPS URL を発行してくれます。

> ⚠️ **インターネットに公開されます**。todome は認証機能を持たないため、URL を知っている人は誰でも閲覧・操作できます。短時間の利用に留めてください。

### 1. cloudflared をインストール

```bash
brew install cloudflared
```

### 2. PC のサーバーを本番モードで起動

```bash
./start.sh prod
```

### 3. トンネルを開く

別ターミナルで:

```bash
cloudflared tunnel --url http://localhost:3002
```

数秒後に `https://<ランダム文字列>.trycloudflare.com` という URL が表示されます。スマホでそのURLを開けばアクセスできます。

ターミナルを閉じれば URL は無効になります。

---

## 共通のホーム画面追加

スマホのブラウザでアクセス後、共有メニューから「ホーム画面に追加」しておくと、ネイティブアプリのように起動できます。

---

## 共通のトラブルシューティング

### `address already in use` でサーバーが起動しない

過去の Bun サーバープロセスがポート 3002 を掴んでいます。

```bash
lsof -nP -iTCP:3002 -sTCP:LISTEN  # PID を確認
kill <PID>                         # 終了させる
```

### IPv6 アドレスでアクセスしたい

ブラウザで IPv6 を使うときは角括弧で囲みます:

```
http://[fd7a:115c:a1e0::xxxx]:3002
```

ただし現状のサーバーは [server/index.ts](../server/index.ts) で `hostname: "0.0.0.0"` を指定しているため **IPv4 でしか待ち受けません**。IPv6 でも待ち受けたい場合は `hostname` を `::` に変更してください (macOS では IPv4/IPv6 両対応になります)。
