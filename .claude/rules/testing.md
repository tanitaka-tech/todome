---
paths: tests/**/*.py,server.py,github_sync.py
purpose: Python テスト作業時のルール
---

# テストルール (Python)

## 方針

- **pytest を使う**。unittest スタイルのクラスは OK だが、assert は素の `assert` 文で書く（`self.assertEqual` は使わない）。
- **純粋関数のみテスト対象**。WebSocket ハンドラ・Claude Agent SDK 呼び出し・DB I/O はテストしない（統合範囲のため）。
- **DB には触れない**。`server.py` import 時に `init_db()` が走るが、これは冪等。テスト内で `_db()` / `load_*` / `save_*` を呼ばない。
- **外部コマンド禁止**。`subprocess` / `gh` / `git` を叩く関数（`github_sync.py` 側）はテスト対象外。

## 追加方針

- 新規の純粋関数（バリデーション・変換・計算）を `server.py` に足したら必ず `tests/test_server_helpers.py` に対応テストを追加する。
- 日付が絡む関数は必ず `today` 引数を受け取れる形にして、テストで固定日付を渡す（現在日時に依存させない）。
- 1関数あたり「正常系 + 境界値 + 異常系」の3パターンを最低ラインにする。
- テスト名は `test_<動詞>_<条件>` の英語snake_case。中身の期待値コメントは日本語可。

## 実行

```bash
uv run pytest -q              # 全テスト
uv run pytest tests/test_server_helpers.py::TestShortId -v   # 特定クラスだけ
```

## やらないこと

- カバレッジの数値目標は置かない（肥大化を招く）。
- モックは使わない。モックしたくなった時点で「テスト対象を純粋関数に切り出す」方を選ぶ。
- フィクスチャは最小限。共通データは各テストクラス内のヘルパーメソッドで十分。
