"""GitHub sync (push / pull / link / restore / diff) のロジック。

server.py の DB 層・broadcast・config I/O は `core` 経由で参照する。
"""

import asyncio
import datetime
import json
import shutil
import sqlite3
import tempfile
from pathlib import Path
from typing import Any

import github_sync
import server as core
from server_state import (
    GoalData,
    KanbanTask,
    ProfileData,
    RetrospectiveData,
    active_sockets,
    github_state,
    _ws_needs_reload,
)


DEBOUNCE_SEC = 20


# --- GitHub diff helpers ---


def _pick_label(entity: dict[str, Any], label_keys: tuple[str, ...], fallback: str) -> str:
    for k in label_keys:
        val = entity.get(k)
        if isinstance(val, str) and val.strip():
            return val.strip()
        if isinstance(val, (int, float)) and val:
            return str(val)
    return fallback


def _diff_entities_by_id(
    current: list[dict[str, Any]],
    target: list[dict[str, Any]],
    id_key: str,
    label_keys: tuple[str, ...],
) -> dict[str, list[dict[str, str]]]:
    """current (HEAD) が target (過去コミット) に戻ったら何が増減/変更されるかを返す。

    added   : target にあって current に無い (= 復元すると復活する)
    removed : current にあって target に無い (= 復元すると消える)
    modified: 両方にあるが内容が異なる
    """
    by_current = {e.get(id_key): e for e in current if e.get(id_key)}
    by_target = {e.get(id_key): e for e in target if e.get(id_key)}

    added: list[dict[str, str]] = []
    removed: list[dict[str, str]] = []
    modified: list[dict[str, str]] = []

    for tid, tval in by_target.items():
        if tid not in by_current:
            added.append({"id": tid, "label": _pick_label(tval, label_keys, tid)})
    for cid, cval in by_current.items():
        if cid not in by_target:
            removed.append({"id": cid, "label": _pick_label(cval, label_keys, cid)})
    for tid, tval in by_target.items():
        cval = by_current.get(tid)
        if cval is None:
            continue
        if cval != tval:
            modified.append({"id": tid, "label": _pick_label(tval, label_keys, tid)})

    return {"added": added, "removed": removed, "modified": modified}


def _diff_profile(current: dict[str, Any], target: dict[str, Any]) -> bool:
    return current != target


def _summarize_diff(details: dict[str, Any]) -> dict[str, Any]:
    def counts(section: dict[str, list[Any]]) -> dict[str, int]:
        return {
            "added": len(section.get("added", [])),
            "removed": len(section.get("removed", [])),
            "modified": len(section.get("modified", [])),
        }

    return {
        "tasks": counts(details.get("tasks", {})),
        "goals": counts(details.get("goals", {})),
        "retros": counts(details.get("retros", {})),
        "profileChanged": bool(details.get("profileChanged", False)),
    }


def _load_entities_from_db(db_path: Path) -> dict[str, Any]:
    """任意の sqlite ファイルから tasks/goals/retros/profile を読み出す。

    スキーマが無い/部分的にしか無いコミットの DB でも空配列で返す (KeyError を出さない)。
    """
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        def _table_exists(name: str) -> bool:
            row = cur.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                (name,),
            ).fetchone()
            return row is not None

        tasks: list[KanbanTask] = []
        if _table_exists("kanban_tasks"):
            rows = cur.execute(
                "SELECT data FROM kanban_tasks ORDER BY sort_order"
            ).fetchall()
            for r in rows:
                t = json.loads(r["data"])
                t.setdefault("kpiId", "")
                t["kpiContributed"] = bool(t.get("kpiContributed", False))
                tasks.append(t)

        goals: list[GoalData] = []
        if _table_exists("goals"):
            rows = cur.execute(
                "SELECT data FROM goals ORDER BY sort_order"
            ).fetchall()
            goals = [json.loads(r["data"]) for r in rows]

        profile: ProfileData = dict(core.DEFAULT_PROFILE)
        if _table_exists("profile"):
            row = cur.execute("SELECT data FROM profile WHERE id = 1").fetchone()
            if row is not None:
                profile = json.loads(row["data"])

        retros: list[RetrospectiveData] = []
        if _table_exists("retrospectives"):
            rows = cur.execute(
                "SELECT * FROM retrospectives ORDER BY created_at DESC"
            ).fetchall()
            retros = [core._retro_row_to_dict(r) for r in rows]

    return {"tasks": tasks, "goals": goals, "retros": retros, "profile": profile}


# --- GitHub sync state ---


async def _build_github_status() -> dict[str, Any]:
    cfg = core._load_github_config()
    auth = await asyncio.to_thread(github_sync.gh_auth_status)
    return {
        "type": "github_status",
        "status": {
            "authUser": auth.get("username"),
            "authOk": bool(auth.get("ok")),
            "authError": auth.get("error"),
            "linked": bool(cfg.get("linked")),
            "owner": cfg.get("owner"),
            "repo": cfg.get("repo"),
            "autoSync": bool(cfg.get("autoSync", True)),
            "syncing": github_state["syncing"],
            "lastSyncAt": github_state["lastSyncAt"] or cfg.get("lastSyncAt"),
            "lastError": github_state["lastError"],
            "pendingSync": bool(github_state.get("pendingSync", False)),
        },
    }


async def _broadcast_github_status() -> None:
    await core.broadcast(await _build_github_status())


def _get_sync_lock() -> asyncio.Lock:
    lock = github_state["sync_lock"]
    if lock is None:
        lock = asyncio.Lock()
        github_state["sync_lock"] = lock
    return lock


def schedule_autosync() -> None:
    cfg = core._load_github_config()
    if not cfg.get("linked"):
        return
    if not github_state.get("pendingSync"):
        github_state["pendingSync"] = True
        asyncio.create_task(_broadcast_github_status())
    if not cfg.get("autoSync", True):
        return
    t: asyncio.Task | None = github_state.get("debounce_task")
    if t and not t.done():
        t.cancel()
    github_state["debounce_task"] = asyncio.create_task(_autosync_after_delay())


async def _autosync_after_delay() -> None:
    try:
        await asyncio.sleep(DEBOUNCE_SEC)
    except asyncio.CancelledError:
        return
    await _do_push("auto sync")


def _wal_checkpoint() -> None:
    """push 直前に WAL をマージ (サイズが 0 かつ journal_mode が delete の場合は no-op)。"""
    try:
        with core._db() as conn:
            conn.execute("PRAGMA wal_checkpoint(FULL)")
    except sqlite3.Error:
        pass


async def _do_push(message: str) -> None:
    cfg = core._load_github_config()
    if not cfg.get("linked"):
        return
    async with _get_sync_lock():
        github_state["syncing"] = True
        github_state["lastError"] = None
        await core.broadcast(await _build_github_status())
        try:
            await asyncio.to_thread(_wal_checkpoint)
            now_iso = datetime.datetime.now().isoformat(timespec="seconds")
            commit_msg = f"todome {message}: {now_iso}"
            pushed = await asyncio.to_thread(
                github_sync.git_add_commit_push, core.REPO_DIR, commit_msg
            )
            if pushed:
                github_state["lastSyncAt"] = now_iso
                cfg["lastSyncAt"] = now_iso
                core._save_github_config(cfg)
            github_state["pendingSync"] = False
        except github_sync.GitHubSyncError as e:
            github_state["lastError"] = str(e)
        except Exception as e:
            github_state["lastError"] = f"unexpected: {e}"
        finally:
            github_state["syncing"] = False
            await core.broadcast(await _build_github_status())


async def _do_pull() -> None:
    cfg = core._load_github_config()
    if not cfg.get("linked"):
        return
    async with _get_sync_lock():
        github_state["syncing"] = True
        github_state["lastError"] = None
        await core.broadcast(await _build_github_status())
        try:
            await asyncio.to_thread(github_sync.git_pull, core.REPO_DIR)
            core.init_db()
            github_state["diff_cache"] = {}
            await _broadcast_db_state()
            github_state["lastSyncAt"] = datetime.datetime.now().isoformat(
                timespec="seconds"
            )
            cfg["lastSyncAt"] = github_state["lastSyncAt"]
            core._save_github_config(cfg)
        except github_sync.GitHubSyncError as e:
            github_state["lastError"] = str(e)
        except Exception as e:
            github_state["lastError"] = f"unexpected: {e}"
        finally:
            github_state["syncing"] = False
            await core.broadcast(await _build_github_status())


async def _broadcast_db_state() -> None:
    """現在の DB からロードして全クライアントへ同期 push。

    DB が外部要因 (git pull/restore/link/unlink) で差し替わったタイミングで呼ばれるため、
    各 WS 接続のローカルキャッシュも次のループ頭で再ロードさせるフラグを立てる。
    """
    tasks = core.load_tasks()
    goals = core.load_goals()
    profile = core.load_profile()
    retros = core.load_retros()
    activities = core.load_life_activities()
    life_logs = core.load_today_life_logs()
    quotas = core.load_quotas()
    quota_logs = core.load_today_quota_logs()
    all_quota_logs = core.load_all_quota_logs()
    for ws in active_sockets:
        _ws_needs_reload[ws] = True
    await core.broadcast({"type": "kanban_sync", "tasks": tasks})
    await core.broadcast({"type": "goal_sync", "goals": goals})
    await core.broadcast({"type": "profile_sync", "profile": profile})
    await core.broadcast({"type": "retro_list_sync", "retros": retros})
    await core.broadcast({"type": "life_activity_sync", "activities": activities})
    await core.broadcast({"type": "life_log_sync", "logs": life_logs})
    await core.broadcast({"type": "quota_sync", "quotas": quotas})
    await core.broadcast({"type": "quota_log_sync", "logs": quota_logs})
    await core.broadcast(
        {
            "type": "quota_streak_sync",
            "streaks": core.compute_all_quota_streaks(quotas, all_quota_logs),
        }
    )


async def _do_link(
    owner: str | None,
    name: str,
    create: bool,
    private: bool,
) -> None:
    async with _get_sync_lock():
        github_state["syncing"] = True
        github_state["lastError"] = None
        await core.broadcast(await _build_github_status())
        try:
            auth = await asyncio.to_thread(github_sync.gh_auth_status)
            if not auth.get("ok"):
                raise github_sync.GitHubSyncError(
                    auth.get("error") or "gh 認証が必要です"
                )

            if create:
                created = await asyncio.to_thread(
                    github_sync.gh_create_repo, name, private
                )
                owner = created["owner"]
                name = created["name"]
            if not owner:
                owner = auth["username"]

            remote_has_db = await asyncio.to_thread(
                github_sync.gh_repo_has_db, owner, name
            )

            if core.REPO_DIR.exists():
                await asyncio.to_thread(shutil.rmtree, core.REPO_DIR)

            await asyncio.to_thread(
                github_sync.git_clone, owner, name, core.REPO_DIR
            )
            await asyncio.to_thread(github_sync.ensure_git_identity, core.REPO_DIR)
            await asyncio.to_thread(github_sync.write_gitattributes, core.REPO_DIR)

            cloned_db = core.REPO_DIR / "todome.db"
            if not remote_has_db and not cloned_db.exists():
                # ローカル DB を初回 push 用にコピー
                if core.DEFAULT_DB.exists():
                    await asyncio.to_thread(shutil.copy2, core.DEFAULT_DB, cloned_db)
                else:
                    # 空の DB を作る: get_db_path 経由で新しい path を使うため config を先に書く
                    core._save_github_config(
                        {
                            "linked": True,
                            "owner": owner,
                            "repo": name,
                            "autoSync": True,
                            "lastSyncAt": None,
                        }
                    )
                    core.init_db()

            # config 確定 (上で既に書いていれば上書き)
            core._save_github_config(
                {
                    "linked": True,
                    "owner": owner,
                    "repo": name,
                    "autoSync": True,
                    "lastSyncAt": core._load_github_config().get("lastSyncAt"),
                }
            )

            # スキーマを念のため確認
            core.init_db()

            if not remote_has_db:
                # 初回 push (todome.db と .gitattributes)
                now_iso = datetime.datetime.now().isoformat(timespec="seconds")
                commit_msg = f"todome initial sync: {now_iso}"
                pushed = await asyncio.to_thread(
                    github_sync.git_add_commit_push, core.REPO_DIR, commit_msg
                )
                if pushed:
                    github_state["lastSyncAt"] = now_iso
                    cfg = core._load_github_config()
                    cfg["lastSyncAt"] = now_iso
                    core._save_github_config(cfg)

            await _broadcast_db_state()
        except github_sync.GitHubSyncError as e:
            github_state["lastError"] = str(e)
        except Exception as e:
            github_state["lastError"] = f"unexpected: {e}"
        finally:
            github_state["syncing"] = False
            await core.broadcast(await _build_github_status())


def _compute_commit_diff(commit_hash: str) -> dict[str, Any]:
    """現在の DB と commit_hash 時点の DB を比較して {summary, details} を返す。

    結果は github_state['diff_cache'] にキャッシュする。
    """
    cache: dict[str, Any] = github_state["diff_cache"]
    if commit_hash in cache:
        return cache[commit_hash]

    current_db = core.get_db_path()
    if not current_db.exists():
        raise github_sync.GitHubSyncError("ローカル DB が見つかりません")

    with tempfile.TemporaryDirectory() as tmp:
        target_db = Path(tmp) / f"{commit_hash}.db"
        github_sync.extract_db_at_commit(core.REPO_DIR, commit_hash, target_db)
        current = _load_entities_from_db(current_db)
        target = _load_entities_from_db(target_db)

    details = {
        "tasks": _diff_entities_by_id(
            current["tasks"], target["tasks"], "id", ("title",)
        ),
        "goals": _diff_entities_by_id(
            current["goals"], target["goals"], "id", ("name",)
        ),
        "retros": _diff_entities_by_id(
            current["retros"], target["retros"], "id", ("periodEnd", "type")
        ),
        "profileChanged": _diff_profile(current["profile"], target["profile"]),
    }
    result = {"summary": _summarize_diff(details), "details": details}
    cache[commit_hash] = result
    return result


async def _do_restore(commit_hash: str) -> None:
    cfg = core._load_github_config()
    if not cfg.get("linked"):
        return
    async with _get_sync_lock():
        github_state["syncing"] = True
        github_state["lastError"] = None
        await core.broadcast(await _build_github_status())
        try:
            await asyncio.to_thread(_wal_checkpoint)
            short = commit_hash[:7]
            now_iso = datetime.datetime.now().isoformat(timespec="seconds")
            commit_msg = f"todome restore to {short}: {now_iso}"
            pushed = await asyncio.to_thread(
                github_sync.restore_db_to_commit, core.REPO_DIR, commit_hash, commit_msg
            )
            core.init_db()
            github_state["diff_cache"] = {}
            await _broadcast_db_state()
            if pushed:
                github_state["lastSyncAt"] = now_iso
                cfg["lastSyncAt"] = now_iso
                core._save_github_config(cfg)
            github_state["pendingSync"] = False
        except github_sync.GitHubSyncError as e:
            github_state["lastError"] = str(e)
        except Exception as e:
            github_state["lastError"] = f"unexpected: {e}"
        finally:
            github_state["syncing"] = False
            await core.broadcast(await _build_github_status())


async def _do_unlink() -> None:
    async with _get_sync_lock():
        github_state["syncing"] = True
        github_state["lastError"] = None
        await core.broadcast(await _build_github_status())
        try:
            t: asyncio.Task | None = github_state.get("debounce_task")
            if t and not t.done():
                t.cancel()
            github_state["debounce_task"] = None

            core._clear_github_config()
            if core.REPO_DIR.exists():
                await asyncio.to_thread(shutil.rmtree, core.REPO_DIR)
            core.init_db()
            github_state["diff_cache"] = {}
            await _broadcast_db_state()
        except Exception as e:
            github_state["lastError"] = f"unexpected: {e}"
        finally:
            github_state["syncing"] = False
            await core.broadcast(await _build_github_status())
