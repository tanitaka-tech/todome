"""gh CLI / git subprocess ラッパー。

全関数 blocking。呼び出し側で asyncio.to_thread 経由で使う。
トークンはディスクに保存せず、各 network op 毎に取得してプロセス環境経由で git に渡す。
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any


class GitHubSyncError(Exception):
    pass


def _run(
    cmd: list[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    check: bool = True,
) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            env=env,
            check=check,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as e:
        msg = (e.stderr or e.stdout or str(e)).strip()
        raise GitHubSyncError(f"{cmd[0]} {cmd[1] if len(cmd) > 1 else ''} 失敗: {msg}") from e
    except FileNotFoundError as e:
        raise GitHubSyncError(f"コマンドが見つかりません: {cmd[0]}") from e


# --- gh 関連 ---

def gh_auth_status() -> dict[str, Any]:
    """gh の認証状態を返す。"""
    try:
        proc = _run(["gh", "api", "user", "--jq", ".login"])
        username = proc.stdout.strip()
        return {"ok": True, "username": username, "error": None}
    except GitHubSyncError as e:
        return {"ok": False, "username": None, "error": str(e)}


def _get_token() -> str:
    proc = _run(["gh", "auth", "token"])
    token = proc.stdout.strip()
    if not token:
        raise GitHubSyncError("gh auth token が空です")
    return token


def _get_user_meta() -> dict[str, str]:
    """login / email を取得。email が public でない場合は noreply アドレスにフォールバック。"""
    proc = _run(["gh", "api", "user"])
    data = json.loads(proc.stdout)
    login = data.get("login", "")
    email = data.get("email")
    if not email:
        uid = data.get("id", 0)
        email = f"{uid}+{login}@users.noreply.github.com"
    return {"login": login, "email": email, "name": data.get("name") or login}


def gh_list_repos() -> list[dict[str, Any]]:
    proc = _run(
        [
            "gh",
            "repo",
            "list",
            "--json",
            "name,owner,isPrivate,updatedAt,url,nameWithOwner",
            "--limit",
            "200",
        ]
    )
    return json.loads(proc.stdout)


def gh_repo_has_db(owner: str, name: str, path: str = "todome.db") -> bool:
    """repo に todome.db が既に存在するか確認。"""
    proc = _run(
        ["gh", "api", f"/repos/{owner}/{name}/contents/{path}", "--silent"],
        check=False,
    )
    return proc.returncode == 0


def gh_repo_exists(owner: str, name: str) -> bool:
    proc = _run(["gh", "api", f"/repos/{owner}/{name}", "--silent"], check=False)
    return proc.returncode == 0


def gh_create_repo(name: str, private: bool = True) -> dict[str, str]:
    """新規 repo を作成し、{owner, name, url} を返す。"""
    visibility = "--private" if private else "--public"
    proc = _run(["gh", "repo", "create", name, visibility, "--clone=false"])
    # `gh repo create` の stdout は 'https://github.com/{owner}/{name}' のような URL。
    url = proc.stdout.strip().splitlines()[-1].strip()
    # フォールバック: 既にある場合もあるので現在の username から解決
    if "github.com/" not in url:
        meta = _get_user_meta()
        url = f"https://github.com/{meta['login']}/{name}"
    # owner / name を URL から抜き出す
    parts = url.rstrip("/").split("/")
    owner = parts[-2]
    repo_name = parts[-1]
    if repo_name.endswith(".git"):
        repo_name = repo_name[:-4]
    return {"owner": owner, "name": repo_name, "url": url}


# --- git 関連 ---

def _git_env() -> dict[str, str]:
    return {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",
    }


def _auth_args() -> list[str]:
    # グローバルの credential helper (osxkeychain 等) を一旦クリアしてから、
    # gh の credential helper を付ける。`.git/config` には残らない。
    return [
        "-c",
        "credential.helper=",
        "-c",
        "credential.helper=!gh auth git-credential",
    ]


def repo_https_url(owner: str, name: str) -> str:
    return f"https://github.com/{owner}/{name}.git"


def git_clone(owner: str, name: str, dest: Path, token: str | None = None) -> None:
    if dest.exists():
        shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = repo_https_url(owner, name)
    _run(
        ["git", *_auth_args(), "clone", url, str(dest)],
        env=_git_env(),
    )


def ensure_git_identity(dest: Path) -> None:
    meta = _get_user_meta()
    _run(["git", "-C", str(dest), "config", "user.email", meta["email"]], env=_git_env())
    _run(["git", "-C", str(dest), "config", "user.name", meta["name"]], env=_git_env())


def git_pull(dest: Path, token: str | None = None) -> None:
    """rebase + autostash で pull。conflict 時は abort してエラー送出。"""
    try:
        _run(
            [
                "git",
                "-C",
                str(dest),
                *_auth_args(),
                "pull",
                "--rebase",
                "--autostash",
            ],
            env=_git_env(),
        )
    except GitHubSyncError:
        # conflict の場合 rebase を abort
        _run(
            ["git", "-C", str(dest), "rebase", "--abort"],
            env=_git_env(),
            check=False,
        )
        raise


def git_has_changes(dest: Path) -> bool:
    proc = _run(
        ["git", "-C", str(dest), "status", "--porcelain"],
        env=_git_env(),
    )
    return bool(proc.stdout.strip())


def git_add_commit_push(
    dest: Path,
    message: str,
    token: str | None = None,
    paths: list[str] | None = None,
) -> bool:
    """stage → commit → push。変更なしなら False を返し push もしない。"""
    add_paths = paths or ["todome.db", ".gitattributes"]
    # 存在しないファイルの add は無視したいので --all を使う手もあるが、
    # 意図しない artefact を含めないため個別に add する。
    for p in add_paths:
        if (dest / p).exists():
            _run(["git", "-C", str(dest), "add", p], env=_git_env())
    if not git_has_changes(dest):
        return False
    _run(
        ["git", "-C", str(dest), "commit", "-m", message],
        env=_git_env(),
    )
    _run(
        ["git", "-C", str(dest), *_auth_args(), "push"],
        env=_git_env(),
    )
    return True


def write_gitattributes(dest: Path) -> None:
    """binary 指定を書き込む (初回 clone 時用)。"""
    path = dest / ".gitattributes"
    content = "todome.db binary\n"
    if path.exists() and path.read_text() == content:
        return
    path.write_text(content)
