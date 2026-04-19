"""todome — FastAPI + WebSocket バックエンド

起動方法:
  uv run uvicorn server:app --host 0.0.0.0 --port 3002 --reload
"""

import asyncio
import datetime
import json
import os
import re
import shutil
import sqlite3
import uuid
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    ResultMessage,
    StreamEvent,
    TextBlock,
    ThinkingBlock,
    ToolUseBlock,
)
from claude_agent_sdk.types import (
    PermissionResultAllow,
    ToolPermissionContext,
)

import github_sync

load_dotenv()
app = FastAPI()

pending_approvals: dict[str, asyncio.Future] = {}
active_sockets: set[WebSocket] = set()


# --- Types ---
KanbanTask = dict[str, Any]
GoalData = dict[str, Any]
ProfileData = dict[str, Any]  # {currentState, balanceWheel, actionPrinciples, wantToDo}

DEFAULT_PROFILE: ProfileData = {
    "currentState": "",
    "balanceWheel": [],
    "actionPrinciples": [],
    "wantToDo": [],
}

GOAL_ADD_PREFIX = "GOAL_ADD:"
GOAL_UPDATE_PREFIX = "GOAL_UPDATE:"
PROFILE_UPDATE_PREFIX = "PROFILE_UPDATE:"


# --- SQLite storage ---
_env_data_dir = os.environ.get("TODOME_DATA_DIR")
DATA_DIR = Path(_env_data_dir) if _env_data_dir else Path(__file__).parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DEFAULT_DB = DATA_DIR / "todome.db"
REPO_DIR = DATA_DIR / "repo"
CONFIG_PATH = DATA_DIR / "github_config.json"
AI_CONFIG_PATH = DATA_DIR / "ai_config.json"

# UIで切り替え可能な候補。ここに無いツール名が保存されていても無視する。
AI_TOOL_CATALOG: tuple[str, ...] = (
    "TodoWrite",
    "Bash",
    "Read",
    "Glob",
    "Grep",
    "WebFetch",
    "WebSearch",
)
AI_DEFAULT_ALLOWED_TOOLS: tuple[str, ...] = ("TodoWrite", "Bash")

_cfg_cache: dict[str, Any] | None = None
_ai_cfg_cache: dict[str, Any] | None = None


def _normalize_ai_config(cfg: Any) -> dict[str, Any]:
    """保存用 AI 設定を正規化する。未知ツール除外・重複除外・空は既定に戻す。"""
    if not isinstance(cfg, dict):
        return {"allowedTools": list(AI_DEFAULT_ALLOWED_TOOLS)}
    raw = cfg.get("allowedTools")
    if not isinstance(raw, list):
        return {"allowedTools": list(AI_DEFAULT_ALLOWED_TOOLS)}
    seen: set[str] = set()
    result: list[str] = []
    for tool in raw:
        if isinstance(tool, str) and tool in AI_TOOL_CATALOG and tool not in seen:
            result.append(tool)
            seen.add(tool)
    return {"allowedTools": result}


def load_ai_config() -> dict[str, Any]:
    global _ai_cfg_cache
    if _ai_cfg_cache is not None:
        return _ai_cfg_cache
    if AI_CONFIG_PATH.exists():
        try:
            _ai_cfg_cache = _normalize_ai_config(
                json.loads(AI_CONFIG_PATH.read_text())
            )
        except (OSError, json.JSONDecodeError):
            _ai_cfg_cache = {"allowedTools": list(AI_DEFAULT_ALLOWED_TOOLS)}
    else:
        _ai_cfg_cache = {"allowedTools": list(AI_DEFAULT_ALLOWED_TOOLS)}
    return _ai_cfg_cache


def save_ai_config(cfg: dict[str, Any]) -> dict[str, Any]:
    global _ai_cfg_cache
    normalized = _normalize_ai_config(cfg)
    _ai_cfg_cache = normalized
    AI_CONFIG_PATH.write_text(
        json.dumps(normalized, ensure_ascii=False, indent=2)
    )
    return normalized


def _load_github_config() -> dict[str, Any]:
    global _cfg_cache
    if _cfg_cache is not None:
        return _cfg_cache
    if CONFIG_PATH.exists():
        try:
            _cfg_cache = json.loads(CONFIG_PATH.read_text())
        except (OSError, json.JSONDecodeError):
            _cfg_cache = {}
    else:
        _cfg_cache = {}
    return _cfg_cache


def _save_github_config(cfg: dict[str, Any]) -> None:
    global _cfg_cache
    _cfg_cache = cfg
    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2))


def _clear_github_config() -> None:
    global _cfg_cache
    _cfg_cache = {}
    if CONFIG_PATH.exists():
        CONFIG_PATH.unlink()


def get_db_path() -> Path:
    cfg = _load_github_config()
    if cfg.get("linked") and (REPO_DIR / "todome.db").exists():
        return REPO_DIR / "todome.db"
    return DEFAULT_DB


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS kanban_tasks (
                id TEXT PRIMARY KEY,
                sort_order INTEGER NOT NULL,
                data TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS goals (
                id TEXT PRIMARY KEY,
                sort_order INTEGER NOT NULL,
                data TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS profile (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS retrospectives (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                period_start TEXT NOT NULL,
                period_end TEXT NOT NULL,
                document TEXT NOT NULL,
                messages TEXT NOT NULL,
                ai_comment TEXT NOT NULL DEFAULT '',
                completed_at TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """
        )


def load_tasks() -> list[KanbanTask]:
    with _db() as conn:
        rows = conn.execute(
            "SELECT data FROM kanban_tasks ORDER BY sort_order"
        ).fetchall()
    tasks = [json.loads(r["data"]) for r in rows]
    for t in tasks:
        t.setdefault("kpiId", "")
        t["kpiContributed"] = bool(t.get("kpiContributed", False))
    return tasks


def save_tasks(tasks: list[KanbanTask]) -> None:
    with _db() as conn:
        conn.execute("DELETE FROM kanban_tasks")
        conn.executemany(
            "INSERT INTO kanban_tasks (id, sort_order, data) VALUES (?, ?, ?)",
            [
                (t["id"], i, json.dumps(t, ensure_ascii=False))
                for i, t in enumerate(tasks)
            ],
        )


def load_goals() -> list[GoalData]:
    with _db() as conn:
        rows = conn.execute(
            "SELECT data FROM goals ORDER BY sort_order"
        ).fetchall()
    return [json.loads(r["data"]) for r in rows]


def save_goals(goals: list[GoalData]) -> None:
    with _db() as conn:
        conn.execute("DELETE FROM goals")
        conn.executemany(
            "INSERT INTO goals (id, sort_order, data) VALUES (?, ?, ?)",
            [
                (g["id"], i, json.dumps(g, ensure_ascii=False))
                for i, g in enumerate(goals)
            ],
        )


def load_profile() -> ProfileData:
    with _db() as conn:
        row = conn.execute("SELECT data FROM profile WHERE id = 1").fetchone()
    if row is None:
        return dict(DEFAULT_PROFILE)
    return json.loads(row["data"])


def save_profile(profile: ProfileData) -> None:
    with _db() as conn:
        conn.execute(
            "INSERT INTO profile (id, data) VALUES (1, ?) "
            "ON CONFLICT(id) DO UPDATE SET data = excluded.data",
            (json.dumps(profile, ensure_ascii=False),),
        )


# --- Retrospective storage ---
RetrospectiveData = dict[str, Any]


def _migrate_retro_document(doc: dict[str, Any]) -> dict[str, Any]:
    """旧スキーマを新スキーマ (did/learned/next/dayRating) にマップして返す。

    - 旧テキストキー (findings/improvements/idealState/actions) → did/learned/next に合流
      - findings → learned
      - improvements + idealState + actions → next
    - 旧数値キー energy → dayRating
    既に新スキーマを持つドキュメントはそのまま。
    """
    migrated = dict(doc)
    migrated.setdefault("did", "")
    migrated.setdefault("learned", "")
    migrated.setdefault("next", "")
    migrated.pop("completedTasks", None)

    if "dayRating" not in migrated:
        legacy_energy = doc.get("energy")
        if isinstance(legacy_energy, (int, float)):
            migrated["dayRating"] = int(legacy_energy)
        else:
            migrated["dayRating"] = 0
    migrated.pop("energy", None)

    migrated.setdefault("wakeUpTime", "")
    migrated.setdefault("bedtime", "")

    legacy_keys = ("findings", "improvements", "idealState", "actions")
    if any(k in doc for k in legacy_keys):
        findings = (doc.get("findings") or "").strip()
        improvements = (doc.get("improvements") or "").strip()
        ideal_state = (doc.get("idealState") or "").strip()
        actions = (doc.get("actions") or "").strip()
        if not migrated["learned"] and findings:
            migrated["learned"] = findings
        next_parts = [p for p in (improvements, ideal_state, actions) if p]
        if not migrated["next"] and next_parts:
            migrated["next"] = "\n\n".join(next_parts)
        for k in legacy_keys:
            migrated.pop(k, None)
    return migrated


def _retro_row_to_dict(row: sqlite3.Row) -> RetrospectiveData:
    doc = json.loads(row["document"])
    return {
        "id": row["id"],
        "type": row["type"],
        "periodStart": row["period_start"],
        "periodEnd": row["period_end"],
        "document": _migrate_retro_document(doc),
        "messages": json.loads(row["messages"]),
        "aiComment": row["ai_comment"] or "",
        "completedAt": row["completed_at"] or "",
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def load_retros() -> list[RetrospectiveData]:
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM retrospectives ORDER BY created_at DESC"
        ).fetchall()
    return [_retro_row_to_dict(r) for r in rows]


def get_retro(retro_id: str) -> RetrospectiveData | None:
    with _db() as conn:
        row = conn.execute(
            "SELECT * FROM retrospectives WHERE id = ?", (retro_id,)
        ).fetchone()
    return _retro_row_to_dict(row) if row else None


def get_retro_draft(retro_type: str) -> RetrospectiveData | None:
    """同一種別で completedAt が空 (ドラフト) の最新の振り返りを返す。"""
    with _db() as conn:
        row = conn.execute(
            "SELECT * FROM retrospectives "
            "WHERE type = ? AND (completed_at = '' OR completed_at IS NULL) "
            "ORDER BY updated_at DESC LIMIT 1",
            (retro_type,),
        ).fetchone()
    return _retro_row_to_dict(row) if row else None


def save_retro(retro: RetrospectiveData) -> None:
    with _db() as conn:
        conn.execute(
            "INSERT INTO retrospectives "
            "(id, type, period_start, period_end, document, messages, "
            " ai_comment, completed_at, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET "
            "  type = excluded.type, "
            "  period_start = excluded.period_start, "
            "  period_end = excluded.period_end, "
            "  document = excluded.document, "
            "  messages = excluded.messages, "
            "  ai_comment = excluded.ai_comment, "
            "  completed_at = excluded.completed_at, "
            "  updated_at = excluded.updated_at",
            (
                retro["id"],
                retro["type"],
                retro["periodStart"],
                retro["periodEnd"],
                json.dumps(retro["document"], ensure_ascii=False),
                json.dumps(retro["messages"], ensure_ascii=False),
                retro.get("aiComment", ""),
                retro.get("completedAt", ""),
                retro["createdAt"],
                retro["updatedAt"],
            ),
        )


def delete_retro(retro_id: str) -> None:
    with _db() as conn:
        conn.execute("DELETE FROM retrospectives WHERE id = ?", (retro_id,))


init_db()


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

        profile: ProfileData = dict(DEFAULT_PROFILE)
        if _table_exists("profile"):
            row = cur.execute("SELECT data FROM profile WHERE id = 1").fetchone()
            if row is not None:
                profile = json.loads(row["data"])

        retros: list[RetrospectiveData] = []
        if _table_exists("retrospectives"):
            rows = cur.execute(
                "SELECT * FROM retrospectives ORDER BY created_at DESC"
            ).fetchall()
            retros = [_retro_row_to_dict(r) for r in rows]

    return {"tasks": tasks, "goals": goals, "retros": retros, "profile": profile}


# --- GitHub sync state ---
DEBOUNCE_SEC = 20

github_state: dict[str, Any] = {
    "syncing": False,
    "lastSyncAt": None,
    "lastError": None,
    "pendingSync": False,
    "debounce_task": None,
    "sync_lock": None,  # lazy init inside async context
    "diff_cache": {},  # commit hash -> {summary, details}
}


async def broadcast(msg: dict[str, Any]) -> None:
    dead: list[WebSocket] = []
    for ws in list(active_sockets):
        try:
            await ws.send_json(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        active_sockets.discard(ws)


async def send_to(ws: WebSocket, msg: dict[str, Any]) -> None:
    try:
        await ws.send_json(msg)
    except Exception:
        active_sockets.discard(ws)


async def _build_github_status() -> dict[str, Any]:
    cfg = _load_github_config()
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
    await broadcast(await _build_github_status())


def _get_sync_lock() -> asyncio.Lock:
    lock = github_state["sync_lock"]
    if lock is None:
        lock = asyncio.Lock()
        github_state["sync_lock"] = lock
    return lock


def schedule_autosync() -> None:
    cfg = _load_github_config()
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
        with _db() as conn:
            conn.execute("PRAGMA wal_checkpoint(FULL)")
    except sqlite3.Error:
        pass


async def _do_push(message: str) -> None:
    cfg = _load_github_config()
    if not cfg.get("linked"):
        return
    async with _get_sync_lock():
        github_state["syncing"] = True
        github_state["lastError"] = None
        await broadcast(await _build_github_status())
        try:
            await asyncio.to_thread(_wal_checkpoint)
            now_iso = datetime.datetime.now().isoformat(timespec="seconds")
            commit_msg = f"todome {message}: {now_iso}"
            pushed = await asyncio.to_thread(
                github_sync.git_add_commit_push, REPO_DIR, commit_msg
            )
            if pushed:
                github_state["lastSyncAt"] = now_iso
                cfg["lastSyncAt"] = now_iso
                _save_github_config(cfg)
            github_state["pendingSync"] = False
        except github_sync.GitHubSyncError as e:
            github_state["lastError"] = str(e)
        except Exception as e:
            github_state["lastError"] = f"unexpected: {e}"
        finally:
            github_state["syncing"] = False
            await broadcast(await _build_github_status())


async def _do_pull() -> None:
    cfg = _load_github_config()
    if not cfg.get("linked"):
        return
    async with _get_sync_lock():
        github_state["syncing"] = True
        github_state["lastError"] = None
        await broadcast(await _build_github_status())
        try:
            await asyncio.to_thread(github_sync.git_pull, REPO_DIR)
            init_db()
            github_state["diff_cache"] = {}
            await _broadcast_db_state()
            github_state["lastSyncAt"] = datetime.datetime.now().isoformat(
                timespec="seconds"
            )
            cfg["lastSyncAt"] = github_state["lastSyncAt"]
            _save_github_config(cfg)
        except github_sync.GitHubSyncError as e:
            github_state["lastError"] = str(e)
        except Exception as e:
            github_state["lastError"] = f"unexpected: {e}"
        finally:
            github_state["syncing"] = False
            await broadcast(await _build_github_status())


async def _broadcast_db_state() -> None:
    """現在の DB からロードして全クライアントへ同期 push。"""
    tasks = load_tasks()
    goals = load_goals()
    profile = load_profile()
    retros = load_retros()
    await broadcast({"type": "kanban_sync", "tasks": tasks})
    await broadcast({"type": "goal_sync", "goals": goals})
    await broadcast({"type": "profile_sync", "profile": profile})
    await broadcast({"type": "retro_list_sync", "retros": retros})


async def _do_link(
    owner: str | None,
    name: str,
    create: bool,
    private: bool,
) -> None:
    async with _get_sync_lock():
        github_state["syncing"] = True
        github_state["lastError"] = None
        await broadcast(await _build_github_status())
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

            if REPO_DIR.exists():
                await asyncio.to_thread(shutil.rmtree, REPO_DIR)

            await asyncio.to_thread(
                github_sync.git_clone, owner, name, REPO_DIR
            )
            await asyncio.to_thread(github_sync.ensure_git_identity, REPO_DIR)
            await asyncio.to_thread(github_sync.write_gitattributes, REPO_DIR)

            cloned_db = REPO_DIR / "todome.db"
            if not remote_has_db and not cloned_db.exists():
                # ローカル DB を初回 push 用にコピー
                if DEFAULT_DB.exists():
                    await asyncio.to_thread(shutil.copy2, DEFAULT_DB, cloned_db)
                else:
                    # 空の DB を作る: get_db_path 経由で新しい path を使うため config を先に書く
                    _save_github_config(
                        {
                            "linked": True,
                            "owner": owner,
                            "repo": name,
                            "autoSync": True,
                            "lastSyncAt": None,
                        }
                    )
                    init_db()

            # config 確定 (上で既に書いていれば上書き)
            _save_github_config(
                {
                    "linked": True,
                    "owner": owner,
                    "repo": name,
                    "autoSync": True,
                    "lastSyncAt": _load_github_config().get("lastSyncAt"),
                }
            )

            # スキーマを念のため確認
            init_db()

            if not remote_has_db:
                # 初回 push (todome.db と .gitattributes)
                now_iso = datetime.datetime.now().isoformat(timespec="seconds")
                commit_msg = f"todome initial sync: {now_iso}"
                pushed = await asyncio.to_thread(
                    github_sync.git_add_commit_push, REPO_DIR, commit_msg
                )
                if pushed:
                    github_state["lastSyncAt"] = now_iso
                    cfg = _load_github_config()
                    cfg["lastSyncAt"] = now_iso
                    _save_github_config(cfg)

            await _broadcast_db_state()
        except github_sync.GitHubSyncError as e:
            github_state["lastError"] = str(e)
        except Exception as e:
            github_state["lastError"] = f"unexpected: {e}"
        finally:
            github_state["syncing"] = False
            await broadcast(await _build_github_status())


def _compute_commit_diff(commit_hash: str) -> dict[str, Any]:
    """現在の DB と commit_hash 時点の DB を比較して {summary, details} を返す。

    結果は github_state['diff_cache'] にキャッシュする。
    """
    cache: dict[str, Any] = github_state["diff_cache"]
    if commit_hash in cache:
        return cache[commit_hash]

    current_db = get_db_path()
    if not current_db.exists():
        raise github_sync.GitHubSyncError("ローカル DB が見つかりません")

    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        target_db = Path(tmp) / f"{commit_hash}.db"
        github_sync.extract_db_at_commit(REPO_DIR, commit_hash, target_db)
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
    cfg = _load_github_config()
    if not cfg.get("linked"):
        return
    async with _get_sync_lock():
        github_state["syncing"] = True
        github_state["lastError"] = None
        await broadcast(await _build_github_status())
        try:
            await asyncio.to_thread(_wal_checkpoint)
            short = commit_hash[:7]
            now_iso = datetime.datetime.now().isoformat(timespec="seconds")
            commit_msg = f"todome restore to {short}: {now_iso}"
            pushed = await asyncio.to_thread(
                github_sync.restore_db_to_commit, REPO_DIR, commit_hash, commit_msg
            )
            init_db()
            github_state["diff_cache"] = {}
            await _broadcast_db_state()
            if pushed:
                github_state["lastSyncAt"] = now_iso
                cfg["lastSyncAt"] = now_iso
                _save_github_config(cfg)
            github_state["pendingSync"] = False
        except github_sync.GitHubSyncError as e:
            github_state["lastError"] = str(e)
        except Exception as e:
            github_state["lastError"] = f"unexpected: {e}"
        finally:
            github_state["syncing"] = False
            await broadcast(await _build_github_status())


async def _do_unlink() -> None:
    async with _get_sync_lock():
        github_state["syncing"] = True
        github_state["lastError"] = None
        await broadcast(await _build_github_status())
        try:
            t: asyncio.Task | None = github_state.get("debounce_task")
            if t and not t.done():
                t.cancel()
            github_state["debounce_task"] = None

            _clear_github_config()
            if REPO_DIR.exists():
                await asyncio.to_thread(shutil.rmtree, REPO_DIR)
            init_db()
            github_state["diff_cache"] = {}
            await _broadcast_db_state()
        except Exception as e:
            github_state["lastError"] = f"unexpected: {e}"
        finally:
            github_state["syncing"] = False
            await broadcast(await _build_github_status())


def _short_id() -> str:
    return str(uuid.uuid4())[:8]


def _ensure_kpi_ids(kpis: list[dict]) -> list[dict]:
    """KPI に id とデフォルト値を付与する。"""
    for kpi in kpis:
        if not kpi.get("id"):
            kpi["id"] = _short_id()
        unit = kpi.get("unit")
        if unit not in ("number", "percent", "time"):
            kpi["unit"] = "number"
        try:
            kpi["targetValue"] = max(0, int(round(float(kpi.get("targetValue", 0) or 0))))
        except (TypeError, ValueError):
            kpi["targetValue"] = 0
        if kpi["unit"] == "percent":
            kpi["targetValue"] = 100
        try:
            kpi["currentValue"] = max(0, int(round(float(kpi.get("currentValue", 0) or 0))))
        except (TypeError, ValueError):
            kpi["currentValue"] = 0
        kpi.pop("value", None)
    return kpis


def _ensure_task_fields(task: dict) -> dict:
    """既存タスクに kpiId / kpiContributed を補完する(マイグレーション用)。"""
    task.setdefault("kpiId", "")
    task["kpiContributed"] = bool(task.get("kpiContributed", False))
    return task


_REPO_NAME_WITH_OWNER_RE = re.compile(r"^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")


def _normalize_goal_repository(goal: dict) -> dict:
    """Goal.repository を "owner/name" 形式に正規化する。
    - 空/空白/フォーマット不正は空文字にして保存から落とす。
    - 余計なスラッシュや前後空白は trim する。
    """
    raw = goal.get("repository")
    if not isinstance(raw, str):
        goal.pop("repository", None)
        return goal
    value = raw.strip()
    if value and _REPO_NAME_WITH_OWNER_RE.match(value):
        goal["repository"] = value
    else:
        goal.pop("repository", None)
    return goal


def _is_goal_all_kpis_achieved(goal: dict) -> bool:
    kpis = goal.get("kpis", [])
    if not kpis:
        return False
    for kpi in kpis:
        target = kpi.get("targetValue", 0) or 0
        current = kpi.get("currentValue", 0) or 0
        if not (target > 0 and current >= target):
            return False
    return True


def _sync_goal_achievement(goal: dict) -> dict:
    """KPI の状態から achieved フィールドを同期する。"""
    all_done = _is_goal_all_kpis_achieved(goal)
    was_achieved = bool(goal.get("achieved", False))
    if all_done and not was_achieved:
        goal["achieved"] = True
        goal["achievedAt"] = datetime.datetime.now().isoformat()
    elif not all_done and was_achieved:
        goal["achieved"] = False
        goal["achievedAt"] = ""
    return goal


def _find_time_kpi(goals: list[dict], goal_id: str, kpi_id: str) -> dict | None:
    """goal_id + kpi_id で unit=time の KPI を探す。見つからなければ None。"""
    if not goal_id or not kpi_id:
        return None
    for g in goals:
        if g.get("id") != goal_id:
            continue
        for k in g.get("kpis", []):
            if k.get("id") == kpi_id and k.get("unit") == "time":
                return k
        return None
    return None


def _apply_kpi_time_delta(
    goals: list[dict], goal_id: str, kpi_id: str, delta_seconds: int
) -> bool:
    """対象 KPI の currentValue に delta_seconds を加算し、0 未満にはクリップ。

    加算が実施されたら goals を書き換え、目標の達成状態を再同期する。
    戻り値: 実際に加算した場合 True。
    """
    kpi = _find_time_kpi(goals, goal_id, kpi_id)
    if kpi is None or delta_seconds == 0:
        return False
    kpi["currentValue"] = max(0, int(kpi.get("currentValue", 0) or 0) + int(delta_seconds))
    for g in goals:
        if g.get("id") == goal_id:
            _sync_goal_achievement(g)
            break
    return True


def _rebalance_kpi_contribution(
    task: dict, before: dict, goals: list[dict]
) -> None:
    """task の done 列 + time KPI 紐付けに応じて KPI 加算/減算を差分同期する。

    before には変更前の {goalId, kpiId, timeSpent, kpiContributed} を渡す。
    """
    if before.get("kpiContributed"):
        _apply_kpi_time_delta(
            goals,
            before.get("goalId", ""),
            before.get("kpiId", ""),
            -int(before.get("timeSpent", 0) or 0),
        )
        task["kpiContributed"] = False
    if (
        task.get("column") == "done"
        and task.get("kpiId")
        and task.get("goalId")
    ):
        added = _apply_kpi_time_delta(
            goals,
            task.get("goalId", ""),
            task.get("kpiId", ""),
            int(task.get("timeSpent", 0) or 0),
        )
        if added:
            task["kpiContributed"] = True


def apply_profile_update(
    profile: ProfileData, updates: dict[str, Any]
) -> ProfileData:
    """プロフィールの部分更新を適用した新オブジェクトを返す。

    updates に含まれるキーのみ上書きし、未指定のキーは既存値を維持する。
    対象キー: currentState(str), balanceWheel(list), actionPrinciples(list), wantToDo(list)。
    """
    allowed_list_keys = ("balanceWheel", "actionPrinciples", "wantToDo")
    new_profile: ProfileData = dict(DEFAULT_PROFILE)
    new_profile.update(profile)
    if "currentState" in updates and isinstance(updates["currentState"], str):
        new_profile["currentState"] = updates["currentState"]
    for key in allowed_list_keys:
        if key in updates and isinstance(updates[key], list):
            new_profile[key] = updates[key]
    return new_profile


def process_todos(
    todos: list[dict],
    existing_tasks: list[KanbanTask],
    existing_goals: list[GoalData],
    existing_profile: ProfileData,
) -> tuple[list[KanbanTask], list[GoalData], ProfileData]:
    """TodoWrite 出力をパースし、タスク/目標/プロフィール操作に分離する。

    content が GOAL_ADD: / GOAL_UPDATE: / PROFILE_UPDATE: で始まるエントリは
    それぞれ目標・プロフィール操作として処理し、それ以外は通常のカンバンタスクに変換する。
    """
    existing_task_map = {t["title"]: t for t in existing_tasks}
    existing_goal_map = {g["name"]: g for g in existing_goals}
    status_to_column = {
        "pending": "todo",
        "in_progress": "in_progress",
        "completed": "done",
    }

    tasks: list[KanbanTask] = []
    goals = list(existing_goals)
    profile = dict(existing_profile)

    for todo in todos:
        content = todo.get("content", "")

        # --- プロフィールの更新 ---
        if content.startswith(PROFILE_UPDATE_PREFIX):
            json_str = content[len(PROFILE_UPDATE_PREFIX) :].strip()
            try:
                updates = json.loads(json_str)
            except json.JSONDecodeError:
                continue
            if isinstance(updates, dict):
                profile = apply_profile_update(profile, updates)
            continue

        # --- 目標の追加 ---
        if content.startswith(GOAL_ADD_PREFIX):
            json_str = content[len(GOAL_ADD_PREFIX) :].strip()
            try:
                goal_data = json.loads(json_str)
            except json.JSONDecodeError:
                continue
            # 同名の目標が既にあれば更新扱い
            name = goal_data.get("name", "")
            if name and name in existing_goal_map:
                existing = existing_goal_map[name]
                for k, v in goal_data.items():
                    existing[k] = v
                existing["kpis"] = _ensure_kpi_ids(
                    existing.get("kpis", [])
                )
                _normalize_goal_repository(existing)
                _sync_goal_achievement(existing)
            else:
                new_goal: GoalData = {
                    "id": _short_id(),
                    "name": goal_data.get("name", "新しい目標"),
                    "memo": goal_data.get("memo", ""),
                    "kpis": _ensure_kpi_ids(goal_data.get("kpis", [])),
                    "deadline": goal_data.get("deadline", ""),
                    "achieved": bool(goal_data.get("achieved", False)),
                    "achievedAt": goal_data.get("achievedAt", ""),
                }
                if "repository" in goal_data:
                    new_goal["repository"] = goal_data["repository"]
                _normalize_goal_repository(new_goal)
                _sync_goal_achievement(new_goal)
                goals.append(new_goal)
                existing_goal_map[new_goal["name"]] = new_goal
            continue

        # --- 目標の更新 ---
        if content.startswith(GOAL_UPDATE_PREFIX):
            rest = content[len(GOAL_UPDATE_PREFIX) :].strip()
            colon_idx = rest.find(":")
            if colon_idx == -1:
                continue
            goal_name = rest[:colon_idx].strip()
            json_str = rest[colon_idx + 1 :].strip()
            try:
                updates = json.loads(json_str)
            except json.JSONDecodeError:
                continue
            if goal_name in existing_goal_map:
                target = existing_goal_map[goal_name]
                for k, v in updates.items():
                    target[k] = v
                target["kpis"] = _ensure_kpi_ids(target.get("kpis", []))
                _normalize_goal_repository(target)
                _sync_goal_achievement(target)
            continue

        # --- 通常タスク ---
        status = todo.get("status", "pending")
        priority = "medium"
        title = content
        for p in ("high", "medium", "low"):
            tag = f"[{p.upper()}]"
            if content.upper().startswith(tag):
                priority = p
                title = content[len(tag) :].strip()
                break

        # goalId: [GOAL:<id>] プレフィックスから抽出 ([GOAL:] は紐付け解除)。
        goal_id: str | None = None
        goal_match = re.match(r"^\[GOAL:([^\]]*)\]\s*", title)
        if goal_match:
            goal_id = goal_match.group(1).strip()
            title = title[goal_match.end() :]

        if title in existing_task_map:
            task = existing_task_map[title].copy()
            task["column"] = status_to_column.get(status, "todo")
            task["priority"] = priority
            if goal_id is not None:
                task["goalId"] = goal_id
        else:
            task = {
                "id": _short_id(),
                "title": title,
                "description": "",
                "column": status_to_column.get(status, "todo"),
                "priority": priority,
                "memo": "",
                "goalId": goal_id or "",
                "kpiId": "",
                "kpiContributed": False,
                "estimatedMinutes": 0,
                "timeSpent": 0,
                "timerStartedAt": "",
                "completedAt": "",
                "timeLogs": [],
            }
        tasks.append(task)

    return tasks, goals, profile


async def handle_ask_user_via_ws(
    ws: WebSocket, tool_input: dict[str, Any]
) -> PermissionResultAllow:
    request_id = f"ask_{id(ws)}_{asyncio.get_event_loop().time()}"
    await ws.send_json(
        {
            "type": "ask_user",
            "requestId": request_id,
            "questions": tool_input.get("questions", []),
        }
    )
    future: asyncio.Future = asyncio.get_event_loop().create_future()
    pending_approvals[request_id] = future
    try:
        response = await future
        return PermissionResultAllow(
            updated_input={
                "questions": tool_input.get("questions", []),
                "answers": response.get("answers", {}),
            }
        )
    finally:
        pending_approvals.pop(request_id, None)


def build_profile_context(profile: ProfileData) -> str:
    """プロフィール情報をテキストで返す。"""
    lines: list[str] = []
    if profile.get("currentState"):
        lines.append("=== ユーザーについて ===")
        lines.append(f"現在の状態: {profile['currentState']}")

    bw = profile.get("balanceWheel", [])
    if bw:
        lines.append("\nバランスホイール（各領域の現在の充実度 1-10）:")
        for cat in bw:
            icon = cat.get("icon") or ""
            prefix = f"{icon} " if icon else ""
            score = cat.get("score")
            if isinstance(score, (int, float)):
                lines.append(f"  - {prefix}{cat['name']}: {int(score)}/10")
            else:
                lines.append(f"  - {prefix}{cat['name']}")

    principles = [p["text"] for p in profile.get("actionPrinciples", []) if p.get("text")]
    if principles:
        lines.append("\n心がけたい行動指針:")
        for p in principles:
            lines.append(f"  - {p}")

    wants = [w["text"] for w in profile.get("wantToDo", []) if w.get("text")]
    if wants:
        lines.append("\nやりたいこと:")
        for w in wants:
            lines.append(f"  - {w}")

    return "\n".join(lines)


def build_board_context(
    tasks: list[KanbanTask], goals: list[GoalData]
) -> str:
    """現在のボード状態と目標をテキストで返す。"""
    goal_map = {g["id"]: g for g in goals}
    cols: dict[str, list[KanbanTask]] = {
        "todo": [],
        "in_progress": [],
        "done": [],
    }
    for t in tasks:
        cols.setdefault(t["column"], []).append(t)
    lines = ["=== 現在のカンバンボード ==="]
    labels = {"todo": "TODO", "in_progress": "進行中", "done": "完了"}
    for col_key in ("todo", "in_progress", "done"):
        lines.append(f"\n【{labels[col_key]}】")
        for t in cols[col_key]:
            p = f" [{t['priority'].upper()}]" if t.get("priority") else ""
            memo_note = f'  メモ: {t["memo"]}' if t.get("memo") else ""
            goal_note = ""
            if t.get("goalId") and t["goalId"] in goal_map:
                goal_note = f'  目標: {goal_map[t["goalId"]]["name"]}'
            lines.append(f"  - {t['title']}{p}{memo_note}{goal_note}")

    lines.append("\n=== 目標一覧 ===")
    if goals:
        for g in goals:
            status = " [達成済み]" if g.get("achieved") else ""
            lines.append(f"\n  目標名: {g['name']}{status}  (id: {g['id']})")
            if g.get("deadline"):
                lines.append(f"    期日: {g['deadline']}")
            if g.get("achieved") and g.get("achievedAt"):
                lines.append(f"    達成日: {g['achievedAt'][:10]}")
            if g.get("memo"):
                lines.append(f"    メモ: {g['memo']}")
            if g.get("repository"):
                lines.append(f"    リポジトリ: {g['repository']}")
            for kpi in g.get("kpis", []):
                unit_suffix = "%" if kpi.get("unit") == "percent" else ""
                target = kpi.get("targetValue", 0)
                current = kpi.get("currentValue", 0)
                pct = (
                    min(100, (current / target * 100)) if target else 0
                )
                lines.append(
                    f"    KPI: {kpi['name']} "
                    f"{current}{unit_suffix} / {target}{unit_suffix} "
                    f"({pct:.0f}%)"
                )
    else:
        lines.append("  (なし)")
    return "\n".join(lines)


# --- Retrospective helpers ---

RETRO_TYPES = ("daily", "weekly", "monthly", "yearly")


def _compute_retro_period(retro_type: str, today: datetime.date | None = None) -> tuple[str, str]:
    """振り返り種別から対象期間 (ISO date start/end) を計算。

    - daily   : 当日 0:00〜23:59 (同日)
    - weekly  : 直近の月曜〜日曜
    - monthly : 当月 1日〜月末
    - yearly  : 当年 1/1〜12/31
    """
    d = today or datetime.date.today()
    if retro_type == "daily":
        return d.isoformat(), d.isoformat()
    if retro_type == "weekly":
        # Monday = 0 〜 Sunday = 6
        start = d - datetime.timedelta(days=d.weekday())
        end = start + datetime.timedelta(days=6)
        return start.isoformat(), end.isoformat()
    if retro_type == "monthly":
        start = d.replace(day=1)
        if d.month == 12:
            next_first = datetime.date(d.year + 1, 1, 1)
        else:
            next_first = datetime.date(d.year, d.month + 1, 1)
        end = next_first - datetime.timedelta(days=1)
        return start.isoformat(), end.isoformat()
    if retro_type == "yearly":
        start = datetime.date(d.year, 1, 1)
        end = datetime.date(d.year, 12, 31)
        return start.isoformat(), end.isoformat()
    # fallback: today
    return d.isoformat(), d.isoformat()


def _completed_task_ids_in_period(
    tasks: list[KanbanTask], period_start: str, period_end: str
) -> list[str]:
    """期間内に completedAt が入ったタスクの id を返す。"""
    result: list[str] = []
    try:
        start_dt = datetime.datetime.fromisoformat(period_start + "T00:00:00")
        end_dt = datetime.datetime.fromisoformat(period_end + "T23:59:59")
    except ValueError:
        return result
    for t in tasks:
        if t.get("column") != "done":
            continue
        completed_at = t.get("completedAt") or ""
        if not completed_at:
            continue
        try:
            # タイムゾーン非依存で比較するために末尾の Z などは除去
            ca = completed_at.replace("Z", "")
            cdt = datetime.datetime.fromisoformat(ca[:19])
        except ValueError:
            continue
        if start_dt <= cdt <= end_dt:
            result.append(t["id"])
    return result


RETRO_TYPE_LABEL = {
    "daily": "日次振り返り",
    "weekly": "週次振り返り",
    "monthly": "月次振り返り",
    "yearly": "年次振り返り",
}


RETRO_DOC_TAG_OPEN = "<retrodoc>"
RETRO_DOC_TAG_CLOSE = "</retrodoc>"


def _strip_retrodoc_block(text: str) -> tuple[str, dict[str, Any] | None]:
    """アシスタント応答から <retrodoc>{...}</retrodoc> を取り除き、JSONをパースして返す。"""
    start = text.find(RETRO_DOC_TAG_OPEN)
    if start == -1:
        return text, None
    end = text.find(RETRO_DOC_TAG_CLOSE, start)
    if end == -1:
        return text, None
    payload = text[start + len(RETRO_DOC_TAG_OPEN) : end].strip()
    cleaned = (text[:start] + text[end + len(RETRO_DOC_TAG_CLOSE) :]).strip()
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError:
        return cleaned, None
    if not isinstance(parsed, dict):
        return cleaned, None
    return cleaned, parsed


RETRO_DOC_TEXT_KEYS = ("did", "learned", "next")
RETRO_DOC_TIME_KEYS = ("wakeUpTime", "bedtime")


def _is_valid_hhmm(value: str) -> bool:
    """24時間 HH:MM 形式かを判定。空文字 (未設定) は False。"""
    if not isinstance(value, str) or len(value) != 5 or value[2] != ":":
        return False
    hh, mm = value[:2], value[3:]
    if not (hh.isdigit() and mm.isdigit()):
        return False
    h, m = int(hh), int(mm)
    return 0 <= h <= 23 and 0 <= m <= 59


def _merge_retro_document(
    current: dict[str, Any], updates: dict[str, Any]
) -> dict[str, Any]:
    """AIからの更新を現在のドキュメントにマージ。想定フィールドのみ受け付ける。"""
    merged = dict(current)
    for key in RETRO_DOC_TEXT_KEYS:
        val = updates.get(key)
        if isinstance(val, str):
            merged[key] = val.strip()
    day_rating = updates.get("dayRating")
    if isinstance(day_rating, (int, float)):
        iv = int(day_rating)
        if 0 <= iv <= 10:
            merged["dayRating"] = iv
    for key in RETRO_DOC_TIME_KEYS:
        if key not in updates:
            continue
        val = updates.get(key)
        if not isinstance(val, str):
            continue
        stripped = val.strip()
        if stripped == "" or _is_valid_hhmm(stripped):
            merged[key] = stripped
    return merged


def _retro_done_tasks_context(
    tasks: list[KanbanTask],
    period_start: str,
    period_end: str,
    goals: list[GoalData],
) -> str:
    task_ids = _completed_task_ids_in_period(tasks, period_start, period_end)
    if not task_ids:
        return "(この期間中に完了したタスクはありません)"
    goal_map = {g["id"]: g for g in goals}
    task_map = {t["id"]: t for t in tasks}
    lines: list[str] = []
    for tid in task_ids:
        t = task_map.get(tid)
        if not t:
            continue
        goal_note = ""
        if t.get("goalId") and t["goalId"] in goal_map:
            goal_note = f' (目標: {goal_map[t["goalId"]]["name"]})'
        memo = f" — メモ: {t['memo']}" if t.get("memo") else ""
        lines.append(f"- {t['title']}{goal_note}{memo}")
    return "\n".join(lines) if lines else "(タスク情報なし)"


def _build_retro_system_prompt(
    retro: RetrospectiveData,
    tasks: list[KanbanTask],
    goals: list[GoalData],
    profile: ProfileData,
) -> str:
    profile_ctx = build_profile_context(profile)
    done_ctx = _retro_done_tasks_context(
        tasks, retro["periodStart"], retro["periodEnd"], goals
    )
    doc = retro["document"]
    type_label = RETRO_TYPE_LABEL.get(retro["type"], "振り返り")
    is_daily = retro["type"] == "daily"
    doc_snapshot: dict[str, Any] = {
        "did": doc.get("did", ""),
        "learned": doc.get("learned", ""),
        "next": doc.get("next", ""),
    }
    if is_daily:
        doc_snapshot["dayRating"] = int(doc.get("dayRating") or 0)
        doc_snapshot["wakeUpTime"] = doc.get("wakeUpTime", "") or ""
        doc_snapshot["bedtime"] = doc.get("bedtime", "") or ""
    current_doc_json = json.dumps(doc_snapshot, ensure_ascii=False)

    rating_section = ""
    rating_format_hint = ""
    if is_daily:
        rating_section = (
            "4. 今日の評価 (dayRating): 今日を 1〜10 の整数で自己評価する "
            "(1=最悪, 10=最高)。未評価は 0。\n"
            "5. 起床時間 (wakeUpTime) / 就寝時間 (bedtime): 今日の起床・就寝時刻を "
            '"HH:MM" (24時間) で記録する。未設定は ""。\n'
        )
        rating_format_hint = (
            '- dayRating は整数値 (1〜10, 未評価なら 0) を数値で入れる\n'
            '- wakeUpTime / bedtime は "HH:MM" の文字列。未設定は "" のまま返す\n'
        )
        retrodoc_example = (
            '<retrodoc>{{"did":"...","learned":"...","next":"...",'
            '"dayRating":0,"wakeUpTime":"","bedtime":""}}</retrodoc>'
        )
        opening_hint = (
            "- 冒頭メッセージでは簡単に挨拶し、まず今日やったこと・印象的だった出来事を尋ねる。"
            "対話の中で自然に「今日を 1〜10 で評価すると？」「起きた時間と寝る予定の時間は？」も確認する"
        )
    else:
        retrodoc_example = (
            '<retrodoc>{{"did":"...","learned":"...","next":"..."}}</retrodoc>'
        )
        opening_hint = (
            "- 冒頭メッセージでは簡単に挨拶し、まずこの期間にやったこと・印象的だった出来事を尋ねる"
        )

    return f"""\
あなたはユーザーの{type_label}を伴走するコーチAIです。
対象期間: {retro['periodStart']} 〜 {retro['periodEnd']}

## 役割
ユーザーに温かく寄り添い、下記の観点を順番に深掘りしながら振り返りを構造化してください (YWT形式)。
1. やったこと (did): 期間内に実際にやったこと・起きた出来事・達成したこと
2. わかったこと (learned): そこから得られた気づき・学び・うまくいった/いかなかった原因
3. 次やること (next): 次の期間で取り組むアクション (やる / 辞める の両方を含めて良い)
{rating_section}
## 対話の進め方
- 一度に1〜2個の質問だけに絞る
- ユーザーの回答を受け、該当セクションのドキュメントを更新する
- 全観点がある程度埋まったら、「いつでも完了ボタンを押して終了できます」とユーザーに伝える
{opening_hint}

## 応答フォーマット (厳守)
毎回の応答の最後に、必ず以下のタグでドキュメントの最新状態を返すこと:
{retrodoc_example}

- 値は Markdown 箇条書き (- ...) 推奨。空欄の場合は "" のまま返す
{rating_format_hint}- 既存の内容を削らず、必要に応じて追記・整理する
- ユーザーの発言を勝手に広げすぎず、事実ベースで要約する

## 現時点のドキュメント
{current_doc_json}

## 期間内の達成タスク
{done_ctx}

{profile_ctx}
"""


def _retro_welcome_text(retro_type: str, period_start: str, period_end: str) -> str:
    label = RETRO_TYPE_LABEL.get(retro_type, "振り返り")
    return (
        f"{label}をはじめましょう ({period_start} 〜 {period_end})。\n\n"
        "まずは、この期間で実際にやったことや印象に残った出来事を教えてください。"
    )


def _build_retro_transcript(retro: RetrospectiveData, new_user_msg: str | None) -> str:
    parts: list[str] = []
    for m in retro["messages"]:
        role = "assistant" if m.get("role") == "assistant" else "user"
        parts.append(f"[{role}]\n{m.get('text', '')}")
    if new_user_msg is not None:
        parts.append(f"[user]\n{new_user_msg}")
    return "\n\n".join(parts)


async def run_retro_turn(
    ws: WebSocket,
    retro: RetrospectiveData,
    user_msg: str,
    tasks: list[KanbanTask],
    goals: list[GoalData],
    profile: ProfileData,
) -> RetrospectiveData:
    """retro に対して AI 1 ターン実行し、更新後の retro を返す。"""
    system_prompt = _build_retro_system_prompt(retro, tasks, goals, profile)
    transcript = _build_retro_transcript(retro, user_msg)

    options = ClaudeAgentOptions(
        model="sonnet",
        cwd=str(Path(__file__).parent),
        system_prompt=system_prompt,
        include_partial_messages=True,
        permission_mode="acceptEdits",
        thinking={"type": "enabled", "budget_tokens": 4000},
        allowed_tools=[],
    )
    client = ClaudeSDKClient(options=options)
    await client.connect()
    text_parts: list[str] = []
    try:
        await client.query(transcript)
        async for msg in client.receive_response():
            if isinstance(msg, StreamEvent):
                event = msg.event
                if event.get("type") == "content_block_delta":
                    delta = event.get("delta", {})
                    if delta.get("type") == "text_delta":
                        await ws.send_json(
                            {
                                "type": "retro_stream_delta",
                                "text": delta.get("text", ""),
                            }
                        )
                    elif delta.get("type") == "thinking_delta":
                        await ws.send_json(
                            {
                                "type": "retro_thinking_delta",
                                "text": delta.get("thinking", ""),
                            }
                        )
            elif isinstance(msg, AssistantMessage):
                for block in msg.content:
                    if isinstance(block, TextBlock):
                        text_parts.append(block.text)
            elif isinstance(msg, ResultMessage):
                pass
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass

    full = "".join(text_parts).strip()
    cleaned, doc_updates = _strip_retrodoc_block(full)
    if not cleaned:
        cleaned = "（応答を生成できませんでした。もう一度試してください）"

    now_iso = datetime.datetime.now().isoformat(timespec="seconds")
    new_retro = dict(retro)
    new_messages = list(retro["messages"])
    new_messages.append({"role": "user", "text": user_msg})
    new_messages.append({"role": "assistant", "text": cleaned})
    new_retro["messages"] = new_messages
    new_retro["updatedAt"] = now_iso
    if doc_updates:
        merged = _merge_retro_document(retro["document"], doc_updates)
        new_retro["document"] = merged

    # ドキュメントが空のままの場合は DB に保存せず、ドラフト化しない。
    # (did/learned/next のいずれかに内容、または dayRating が設定されたら永続化)
    doc_for_check = new_retro["document"]
    has_content = (
        any((doc_for_check.get(k) or "").strip() for k in RETRO_DOC_TEXT_KEYS)
        or bool(doc_for_check.get("dayRating"))
        or any(
            (doc_for_check.get(k) or "").strip() for k in RETRO_DOC_TIME_KEYS
        )
    )
    if has_content:
        save_retro(new_retro)
        schedule_autosync()
    await ws.send_json({"type": "retro_assistant", "text": cleaned})
    await ws.send_json(
        {
            "type": "retro_doc_update",
            "retroId": new_retro["id"],
            "document": new_retro["document"],
        }
    )
    return new_retro


async def run_retro_reopen_greeting(
    ws: WebSocket,
    retro: RetrospectiveData,
    tasks: list[KanbanTask],
    goals: list[GoalData],
    profile: ProfileData,
) -> RetrospectiveData:
    """会話再開時に AI が短い挨拶と次の問いかけを生成し、messages に追加して返す。"""
    base_system = _build_retro_system_prompt(retro, tasks, goals, profile)
    system_prompt = (
        base_system
        + "\n\n## 会話再開モード\n"
        "この振り返りは一度完了状態で、ユーザーが「会話を再開」を選びました。"
        "短い「おかえりなさい」系の挨拶 (1 文) と、これまでの振り返り内容 "
        "(やったこと/わかったこと/次やること) を踏まえて追加で深掘り・修正したい "
        "部分を 1 つ具体的に問いかける (1〜2 文) を返してください。"
        "<retrodoc> ブロックは含めない。"
    )

    options = ClaudeAgentOptions(
        model="sonnet",
        cwd=str(Path(__file__).parent),
        system_prompt=system_prompt,
        include_partial_messages=True,
        permission_mode="acceptEdits",
        allowed_tools=[],
    )
    client = ClaudeSDKClient(options=options)
    await client.connect()
    text_parts: list[str] = []
    try:
        await client.query(
            "（会話を再開しました。挨拶と次の問いかけだけを返してください）"
        )
        async for msg in client.receive_response():
            if isinstance(msg, StreamEvent):
                event = msg.event
                if event.get("type") == "content_block_delta":
                    delta = event.get("delta", {})
                    if delta.get("type") == "text_delta":
                        await ws.send_json(
                            {
                                "type": "retro_stream_delta",
                                "text": delta.get("text", ""),
                            }
                        )
            elif isinstance(msg, AssistantMessage):
                for block in msg.content:
                    if isinstance(block, TextBlock):
                        text_parts.append(block.text)
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass

    cleaned, _ = _strip_retrodoc_block("".join(text_parts).strip())
    if not cleaned:
        cleaned = "おかえりなさい！追加で振り返りたいことや直したい部分はありますか？"

    new_retro = dict(retro)
    new_messages = list(retro["messages"])
    new_messages.append({"role": "assistant", "text": cleaned})
    new_retro["messages"] = new_messages
    new_retro["updatedAt"] = datetime.datetime.now().isoformat(timespec="seconds")
    save_retro(new_retro)
    schedule_autosync()
    await ws.send_json({"type": "retro_assistant", "text": cleaned})
    return new_retro


async def _generate_retro_review_text(
    ws: WebSocket,
    retro: RetrospectiveData,
    tasks: list[KanbanTask],
    goals: list[GoalData],
    profile: ProfileData,
) -> str:
    """振り返り用の総評コメントを Claude で生成し、ストリーミング配信する。"""
    profile_ctx = build_profile_context(profile)
    doc = retro["document"]
    done_ctx = _retro_done_tasks_context(
        tasks, retro["periodStart"], retro["periodEnd"], goals
    )
    type_label = RETRO_TYPE_LABEL.get(retro["type"], "振り返り")
    doc_snapshot: dict[str, Any] = {
        "did": doc.get("did", ""),
        "learned": doc.get("learned", ""),
        "next": doc.get("next", ""),
    }
    if retro["type"] == "daily":
        doc_snapshot["dayRating"] = int(doc.get("dayRating") or 0)
        doc_snapshot["wakeUpTime"] = doc.get("wakeUpTime", "") or ""
        doc_snapshot["bedtime"] = doc.get("bedtime", "") or ""
    doc_text = json.dumps(doc_snapshot, ensure_ascii=False, indent=2)

    system_prompt = (
        f"あなたはユーザーの{type_label}に対して、総評コメントを書くコーチAIです。\n"
        "以下の制約を守って、ユーザーを勇気づけ、次の一歩を後押しする短い評価コメントを日本語で返してください。\n"
        "- 200〜350 字程度\n"
        "- 1〜2 段落、Markdown 箇条書きは使わない\n"
        "- 観点: ポジティブなフィードバック1点 + 次にフォーカスするとよいこと1点\n"
        "- <retrodoc> タグは不要\n"
    )
    user_msg = (
        f"対象期間: {retro['periodStart']} 〜 {retro['periodEnd']}\n\n"
        f"## 振り返りドキュメント\n{doc_text}\n\n"
        f"## 期間内の達成タスク\n{done_ctx}\n\n"
        f"{profile_ctx}\n\n"
        "この振り返りに対して総評コメントを書いてください。"
    )

    options = ClaudeAgentOptions(
        model="sonnet",
        cwd=str(Path(__file__).parent),
        system_prompt=system_prompt,
        include_partial_messages=True,
        permission_mode="acceptEdits",
        allowed_tools=[],
    )
    client = ClaudeSDKClient(options=options)
    await client.connect()
    text_parts: list[str] = []
    try:
        await client.query(user_msg)
        async for msg in client.receive_response():
            if isinstance(msg, StreamEvent):
                event = msg.event
                if event.get("type") == "content_block_delta":
                    delta = event.get("delta", {})
                    if delta.get("type") == "text_delta":
                        await ws.send_json(
                            {
                                "type": "retro_stream_delta",
                                "text": delta.get("text", ""),
                            }
                        )
            elif isinstance(msg, AssistantMessage):
                for block in msg.content:
                    if isinstance(block, TextBlock):
                        text_parts.append(block.text)
            elif isinstance(msg, ResultMessage):
                pass
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass

    return "".join(text_parts).strip() or "お疲れさまでした。振り返りの積み重ねが次の一歩に繋がります。"


async def finalize_retro(
    ws: WebSocket,
    retro: RetrospectiveData,
    tasks: list[KanbanTask],
    goals: list[GoalData],
    profile: ProfileData,
) -> RetrospectiveData:
    """振り返りを完了状態にし、AI 評価コメントを生成して保存する。"""
    ai_comment = await _generate_retro_review_text(
        ws, retro, tasks, goals, profile
    )

    now_iso = datetime.datetime.now().isoformat(timespec="seconds")
    new_retro = dict(retro)
    new_messages = list(retro["messages"])
    new_messages.append({"role": "assistant", "text": ai_comment})
    new_retro["messages"] = new_messages
    new_retro["aiComment"] = ai_comment
    new_retro["completedAt"] = now_iso
    new_retro["updatedAt"] = now_iso
    save_retro(new_retro)
    schedule_autosync()

    await ws.send_json({"type": "retro_assistant", "text": ai_comment})
    await ws.send_json({"type": "retro_completed", "retro": new_retro})
    return new_retro


SYSTEM_PROMPT_APPEND = """\
あなたは TODO 管理 & ライフコーチ AI アシスタントです。
ユーザーのタスク管理を支援し、対話を通じて
タスクの追加・更新・優先度の見直し・新たなタスクの提案を行います。

ユーザーは「プロフィール」で自身の状態・指向を定義しています。
この情報を活用して、ユーザーの理想の状態・行動指針・やりたいことに
沿ったアドバイスやタスク提案を行ってください。
完璧主義や先延ばし傾向がある場合は、小さく始める具体的なアクションを提案し、
行動指針に反するアドバイスは避けてください。

## カンバンボード
- 「TODO」「進行中」「完了」の3つのカラム
- 各タスクにはメモと紐付け目標を設定できる

## タスク操作 (TodoWrite)
TodoWrite ツールで todos 配列を渡してタスクを管理する。
- ステータス: pending=TODO, in_progress=進行中, completed=完了
- 優先度: content の先頭に [HIGH] [MEDIUM] [LOW] を付ける
- 目標との紐付け: 優先度タグの直後に [GOAL:<目標id>] を付ける (例: "[HIGH][GOAL:abc12345] 企画書を作成")。紐付けを外す場合は [GOAL:] と書く。省略時は既存の紐付けを維持する
- TodoWrite を呼ぶ際は既存タスクも含めて全タスクリストを渡すこと

## 目標操作 (TodoWrite の特殊エントリ)
目標を追加・更新するには、同じ TodoWrite の todos 配列に特殊エントリを含める。
これらは目標として処理され、カンバンボードには表示されない。

### KPI の形式
各 KPI は以下のフィールドを持つ:
- name: KPI名 (必須)
- unit: "number" または "percent"
- targetValue: 目標値 (数値、0より大)。unit が "percent" の場合は常に 100 固定
- currentValue: 現在の値 (数値)
目標には必ず1つ以上の KPI を設定すること。全 KPI が targetValue に到達すると、目標は自動的に達成扱いになる。

### 目標の追加
content を以下の形式にする (status は "completed"):
  GOAL_ADD:{{"name":"目標名","memo":"メモ","kpis":[{{"name":"KPI名","unit":"number","targetValue":1000,"currentValue":0}}],"deadline":"2026-12-31"}}

### 目標の更新
content を以下の形式にする (status は "completed"):
  GOAL_UPDATE:既存の目標名:{{"memo":"新しいメモ","kpis":[{{"name":"KPI名","unit":"percent","targetValue":100,"currentValue":40}}]}}
更新では変更したいフィールドだけ含めればよい。KPI の currentValue を更新することで進捗を反映できる。

### 例: タスク追加と目標追加を同時に行う
TodoWrite の todos:
  [{{"content":"[HIGH] 企画書を作成","status":"pending"}},{{"content":"GOAL_ADD:{{\\\"name\\\":\\\"Q3売上目標\\\",\\\"memo\\\":\\\"前年比120%\\\",\\\"kpis\\\":[{{\\\"name\\\":\\\"月間売上(万円)\\\",\\\"unit\\\":\\\"number\\\",\\\"targetValue\\\":1000,\\\"currentValue\\\":0}}],\\\"deadline\\\":\\\"2026-09-30\\\"}}","status":"completed"}}]

## プロフィール操作 (TodoWrite の特殊エントリ)
ユーザーの「プロフィール」（currentState / balanceWheel / actionPrinciples / wantToDo）を更新する場合、
同じ TodoWrite の todos 配列に PROFILE_UPDATE 特殊エントリを含める。ユーザーから明示的な変更依頼
（「現在の状態を○○に」「行動指針に○○を追加」等）があったときのみ使うこと。

content を以下の形式にする (status は "completed"):
  PROFILE_UPDATE:{{"currentState":"...","balanceWheel":[...],"actionPrinciples":[...],"wantToDo":[...]}}

更新ルール:
- 変更したいキーだけ含めればよい（未指定のキーは既存値を維持）。
- 配列キー (balanceWheel / actionPrinciples / wantToDo) は **常に全要素を渡す**。差分追記ではなく丸ごと置き換えになる。
  既存項目を残したい場合は、チャットコンテキスト末尾の「ユーザーについて」セクションから現在値を読み取り、
  追加・削除・編集を反映した完全なリストを渡すこと。
- 各要素の形式:
  - balanceWheel 要素: {{"id":"...","name":"...","score":1-10,"icon":"絵文字"}} （id は既存のものを維持、新規追加時は任意文字列可）
  - actionPrinciples / wantToDo 要素: {{"id":"...","text":"..."}}

### 例: 現在の状態と行動指針を更新
TodoWrite の todos:
  [{{"content":"PROFILE_UPDATE:{{\\\"currentState\\\":\\\"転職活動中\\\",\\\"actionPrinciples\\\":[{{\\\"id\\\":\\\"p1\\\",\\\"text\\\":\\\"小さく始める\\\"}},{{\\\"id\\\":\\\"p2\\\",\\\"text\\\":\\\"毎日1つ進める\\\"}}]}}","status":"completed"}}]

## 目標に紐付いた GitHub リポジトリ
目標には `repository` ("owner/name") を任意で紐付けられる。紐付いた目標については、
ユーザーから次のタスク提案や進捗相談を受けたら、必要に応じて Bash で gh コマンドを
実行してリポジトリの状況を確認してよい。例:
- `gh issue list -R owner/name --state open --limit 20`
- `gh pr list -R owner/name --state open --limit 20`
- `gh repo view owner/name`
確認した状況（未対応 issue、直近の PR、README の ToDo など）から、目標達成に向けた
具体的な次のタスクを提案・追加する。毎回機械的に叩かず、必要なときに限って使うこと。

## 制約
- AskUserQuestion: 質問は最大4つ、各質問の選択肢は2〜4個まで
- 今日の日付: {today}

{profile_context}

{board_context}"""


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    active_sockets.add(ws)
    client: ClaudeSDKClient | None = None
    kanban_tasks: list[KanbanTask] = load_tasks()
    goals: list[GoalData] = load_goals()
    profile: ProfileData = load_profile()
    pending_retros: dict[str, RetrospectiveData] = {}

    await ws.send_json({"type": "kanban_sync", "tasks": kanban_tasks})
    await ws.send_json({"type": "goal_sync", "goals": goals})
    await ws.send_json({"type": "profile_sync", "profile": profile})
    await ws.send_json(
        {"type": "retro_list_sync", "retros": load_retros()}
    )
    await ws.send_json(await _build_github_status())
    await ws.send_json({"type": "ai_config_sync", "config": load_ai_config()})

    msg_queue: asyncio.Queue = asyncio.Queue()

    async def ws_reader():
        try:
            while True:
                raw = await ws.receive_text()
                data = json.loads(raw)
                msg_type = data.get("type")
                if msg_type == "ask_response":
                    request_id = data.get("requestId", "")
                    if request_id in pending_approvals:
                        pending_approvals[request_id].set_result(data)
                elif msg_type == "cancel":
                    if client is not None:
                        try:
                            await client.interrupt()
                        except Exception as e:
                            print(f"interrupt failed: {e}")
                elif msg_type == "clear_session":
                    if client is not None:
                        try:
                            await client.interrupt()
                        except Exception:
                            pass
                    await msg_queue.put(data)
                else:
                    await msg_queue.put(data)
        except WebSocketDisconnect:
            await msg_queue.put(None)

    reader_task = asyncio.create_task(ws_reader())

    try:
        while True:
            data = await msg_queue.get()
            if data is None:
                break

            # --- カンバン操作 ---
            if data["type"] == "kanban_move":
                for t in kanban_tasks:
                    if t["id"] == data["taskId"]:
                        before = {
                            "goalId": t.get("goalId", ""),
                            "kpiId": t.get("kpiId", ""),
                            "timeSpent": int(t.get("timeSpent", 0) or 0),
                            "kpiContributed": bool(
                                t.get("kpiContributed", False)
                            ),
                        }
                        t["column"] = data["column"]
                        for key in (
                            "timeSpent",
                            "timerStartedAt",
                            "completedAt",
                            "timeLogs",
                        ):
                            if key in data:
                                t[key] = data[key]
                        _rebalance_kpi_contribution(t, before, goals)
                        break
                save_tasks(kanban_tasks)
                save_goals(goals)
                schedule_autosync()
                await ws.send_json(
                    {"type": "kanban_sync", "tasks": kanban_tasks}
                )
                await ws.send_json({"type": "goal_sync", "goals": goals})
                continue

            if data["type"] == "kanban_add":
                new_task: KanbanTask = {
                    "id": _short_id(),
                    "title": data.get("title", "新しいタスク"),
                    "description": data.get("description", ""),
                    "column": data.get("column", "todo"),
                    "priority": data.get("priority", "medium"),
                    "memo": data.get("memo", ""),
                    "goalId": data.get("goalId", ""),
                    "kpiId": data.get("kpiId", ""),
                    "kpiContributed": False,
                    "estimatedMinutes": data.get("estimatedMinutes", 0),
                    "timeSpent": 0,
                    "timerStartedAt": "",
                    "completedAt": "",
                    "timeLogs": [],
                }
                kanban_tasks.append(new_task)
                save_tasks(kanban_tasks)
                schedule_autosync()
                await ws.send_json(
                    {"type": "kanban_sync", "tasks": kanban_tasks}
                )
                continue

            if data["type"] == "kanban_delete":
                target = next(
                    (t for t in kanban_tasks if t["id"] == data["taskId"]),
                    None,
                )
                if target and target.get("kpiContributed"):
                    _apply_kpi_time_delta(
                        goals,
                        target.get("goalId", ""),
                        target.get("kpiId", ""),
                        -int(target.get("timeSpent", 0) or 0),
                    )
                kanban_tasks = [
                    t for t in kanban_tasks if t["id"] != data["taskId"]
                ]
                save_tasks(kanban_tasks)
                save_goals(goals)
                schedule_autosync()
                await ws.send_json(
                    {"type": "kanban_sync", "tasks": kanban_tasks}
                )
                await ws.send_json({"type": "goal_sync", "goals": goals})
                continue

            if data["type"] == "kanban_reorder":
                ids = data.get("taskIds", [])
                task_map = {t["id"]: t for t in kanban_tasks}
                seen: set[str] = set()
                new_order: list[KanbanTask] = []
                for tid in ids:
                    if tid in task_map and tid not in seen:
                        new_order.append(task_map[tid])
                        seen.add(tid)
                for t in kanban_tasks:
                    if t["id"] not in seen:
                        new_order.append(t)
                kanban_tasks = new_order
                save_tasks(kanban_tasks)
                schedule_autosync()
                continue

            if data["type"] == "kanban_edit":
                task_id = data["taskId"]
                for t in kanban_tasks:
                    if t["id"] == task_id:
                        before = {
                            "goalId": t.get("goalId", ""),
                            "kpiId": t.get("kpiId", ""),
                            "timeSpent": int(t.get("timeSpent", 0) or 0),
                            "kpiContributed": bool(
                                t.get("kpiContributed", False)
                            ),
                        }
                        for key in (
                            "title",
                            "description",
                            "priority",
                            "memo",
                            "goalId",
                            "kpiId",
                            "estimatedMinutes",
                            "timeSpent",
                            "timerStartedAt",
                            "completedAt",
                            "timeLogs",
                        ):
                            if key in data:
                                t[key] = data[key]
                        # goalId が消えたら kpiId も連動で外す。
                        if not t.get("goalId"):
                            t["kpiId"] = ""
                        _rebalance_kpi_contribution(t, before, goals)
                        break
                save_tasks(kanban_tasks)
                save_goals(goals)
                schedule_autosync()
                await ws.send_json(
                    {"type": "kanban_sync", "tasks": kanban_tasks}
                )
                await ws.send_json({"type": "goal_sync", "goals": goals})
                continue

            # --- 目標操作 (クライアント直接) ---
            if data["type"] == "goal_add":
                goal = data.get("goal", {})
                if not goal.get("id"):
                    goal["id"] = _short_id()
                goal["kpis"] = _ensure_kpi_ids(goal.get("kpis", []))
                goal.setdefault("achieved", False)
                goal.setdefault("achievedAt", "")
                _normalize_goal_repository(goal)
                _sync_goal_achievement(goal)
                goals.append(goal)
                save_goals(goals)
                schedule_autosync()
                await ws.send_json({"type": "goal_sync", "goals": goals})
                continue

            if data["type"] == "goal_edit":
                incoming = data.get("goal", {})
                incoming["kpis"] = _ensure_kpi_ids(
                    incoming.get("kpis", [])
                )
                _normalize_goal_repository(incoming)
                _sync_goal_achievement(incoming)
                goal_id = incoming.get("id")
                # KPI が削除された or unit が time 以外に変わった場合、
                # 参照しているタスクの紐付けをクリアする。
                valid_time_kpi_ids = {
                    k["id"]
                    for k in incoming.get("kpis", [])
                    if k.get("unit") == "time"
                }
                for t in kanban_tasks:
                    if (
                        t.get("goalId") == goal_id
                        and t.get("kpiId")
                        and t["kpiId"] not in valid_time_kpi_ids
                    ):
                        t["kpiId"] = ""
                        t["kpiContributed"] = False
                goals = [
                    incoming if g["id"] == goal_id else g for g in goals
                ]
                save_goals(goals)
                save_tasks(kanban_tasks)
                schedule_autosync()
                await ws.send_json({"type": "goal_sync", "goals": goals})
                await ws.send_json(
                    {"type": "kanban_sync", "tasks": kanban_tasks}
                )
                continue

            if data["type"] == "goal_delete":
                goal_id = data["goalId"]
                goals = [g for g in goals if g["id"] != goal_id]
                for t in kanban_tasks:
                    if t.get("goalId") == goal_id:
                        t["goalId"] = ""
                        t["kpiId"] = ""
                        t["kpiContributed"] = False
                save_goals(goals)
                save_tasks(kanban_tasks)
                schedule_autosync()
                await ws.send_json({"type": "goal_sync", "goals": goals})
                await ws.send_json(
                    {"type": "kanban_sync", "tasks": kanban_tasks}
                )
                continue

            # --- セッションクリア ---
            if data["type"] == "clear_session":
                if client is not None:
                    try:
                        await client.disconnect()
                    except Exception:
                        pass
                    client = None
                await ws.send_json({"type": "session_cleared"})
                continue

            # --- プロフィール更新 ---
            if data["type"] == "profile_update":
                profile = data.get("profile", dict(DEFAULT_PROFILE))
                save_profile(profile)
                schedule_autosync()
                await ws.send_json(
                    {"type": "profile_sync", "profile": profile}
                )
                continue

            # --- GitHub 連携 ---
            if data["type"] == "github_status_request":
                await ws.send_json(await _build_github_status())
                continue

            if data["type"] == "github_list_repos":
                try:
                    repos = await asyncio.to_thread(github_sync.gh_list_repos)
                    await ws.send_json(
                        {"type": "github_repo_list", "repos": repos}
                    )
                except github_sync.GitHubSyncError as e:
                    github_state["lastError"] = str(e)
                    await ws.send_json(await _build_github_status())
                continue

            if data["type"] == "github_link":
                asyncio.create_task(
                    _do_link(
                        owner=data.get("owner"),
                        name=data.get("name", ""),
                        create=bool(data.get("create")),
                        private=bool(data.get("private", True)),
                    )
                )
                continue

            if data["type"] == "github_unlink":
                asyncio.create_task(_do_unlink())
                continue

            if data["type"] == "github_sync_now":
                asyncio.create_task(_do_push("manual sync"))
                continue

            if data["type"] == "github_pull_now":
                asyncio.create_task(_do_pull())
                continue

            if data["type"] == "github_set_auto_sync":
                cfg = _load_github_config()
                cfg["autoSync"] = bool(data.get("value", True))
                _save_github_config(cfg)
                await broadcast(await _build_github_status())
                continue

            if data["type"] == "github_list_commits":
                try:
                    commits = await asyncio.to_thread(
                        github_sync.git_log, REPO_DIR, 30
                    )
                    await ws.send_json(
                        {"type": "github_commit_list", "commits": commits}
                    )
                except github_sync.GitHubSyncError as e:
                    github_state["lastError"] = str(e)
                    await ws.send_json(await _build_github_status())
                continue

            if data["type"] == "github_commit_diff":
                chash = data.get("hash", "")
                if not chash:
                    continue
                try:
                    diff = await asyncio.to_thread(_compute_commit_diff, chash)
                    await ws.send_json(
                        {
                            "type": "github_commit_diff_result",
                            "hash": chash,
                            "summary": diff["summary"],
                            "details": diff["details"],
                            "error": None,
                        }
                    )
                except github_sync.GitHubSyncError as e:
                    await ws.send_json(
                        {
                            "type": "github_commit_diff_result",
                            "hash": chash,
                            "summary": None,
                            "details": None,
                            "error": str(e),
                        }
                    )
                continue

            if data["type"] == "github_restore_commit":
                chash = data.get("hash", "")
                if chash:
                    asyncio.create_task(_do_restore(chash))
                continue

            # --- AI ツール設定 ---
            if data["type"] == "ai_config_update":
                incoming = data.get("config", {})
                normalized = save_ai_config(incoming)
                # 次回メッセージで新しい allowed_tools を適用するため、既存クライアントを破棄
                if client is not None:
                    try:
                        await client.disconnect()
                    except Exception:
                        pass
                    client = None
                await broadcast(
                    {"type": "ai_config_sync", "config": normalized}
                )
                continue

            # --- 振り返り操作 ---
            if data["type"] == "retro_list":
                retros = load_retros()
                await ws.send_json(
                    {"type": "retro_list_sync", "retros": retros}
                )
                continue

            if data["type"] == "retro_discard_draft":
                did = data.get("draftId", "")
                if did:
                    pending_retros.pop(did, None)
                    delete_retro(did)
                    schedule_autosync()
                retros = load_retros()
                await ws.send_json(
                    {"type": "retro_list_sync", "retros": retros}
                )
                continue

            if data["type"] == "retro_delete":
                rid = data.get("retroId", "")
                if rid:
                    pending_retros.pop(rid, None)
                    delete_retro(rid)
                    schedule_autosync()
                retros = load_retros()
                await broadcast(
                    {"type": "retro_list_sync", "retros": retros}
                )
                continue

            if data["type"] == "retro_start":
                retro_type = data.get("retroType", "weekly")
                if retro_type not in RETRO_TYPES:
                    retro_type = "weekly"
                resume_id = data.get("resumeDraftId") or None
                anchor_raw = (data.get("anchorDate") or "").strip()
                anchor_date: datetime.date | None = None
                if anchor_raw:
                    try:
                        anchor_date = datetime.date.fromisoformat(anchor_raw)
                    except ValueError:
                        anchor_date = None

                retro_entry: RetrospectiveData | None = None
                if resume_id:
                    retro_entry = get_retro(resume_id)
                    if retro_entry and retro_entry.get("completedAt"):
                        # 完了済みは再開不可
                        retro_entry = None
                if retro_entry is None:
                    period_start, period_end = _compute_retro_period(
                        retro_type, anchor_date
                    )
                    now_iso = datetime.datetime.now().isoformat(
                        timespec="seconds"
                    )
                    welcome = _retro_welcome_text(
                        retro_type, period_start, period_end
                    )
                    retro_entry = {
                        "id": f"{_short_id()}{_short_id()}",
                        "type": retro_type,
                        "periodStart": period_start,
                        "periodEnd": period_end,
                        "document": {
                            "did": "",
                            "learned": "",
                            "next": "",
                            "dayRating": 0,
                            "wakeUpTime": "",
                            "bedtime": "",
                        },
                        "messages": [
                            {"role": "assistant", "text": welcome}
                        ],
                        "aiComment": "",
                        "completedAt": "",
                        "createdAt": now_iso,
                        "updatedAt": now_iso,
                    }
                    # 初期状態の振り返りは DB に保存せずメモリ上でのみ保持。
                    # 最初のユーザー発言を受信した時点で永続化する。
                    pending_retros[retro_entry["id"]] = retro_entry
                await ws.send_json(
                    {"type": "retro_sync", "retro": retro_entry}
                )
                continue

            if data["type"] == "retro_message":
                rid = data.get("retroId", "")
                user_text = (data.get("text", "") or "").strip()
                if not rid or not user_text:
                    continue
                retro_entry = get_retro(rid) or pending_retros.get(rid)
                if retro_entry is None or retro_entry.get("completedAt"):
                    await ws.send_json(
                        {
                            "type": "retro_error",
                            "message": "セッションが見つかりません",
                        }
                    )
                    continue
                await ws.send_json(
                    {"type": "retro_session_waiting", "waiting": True}
                )
                try:
                    updated = await run_retro_turn(
                        ws,
                        retro_entry,
                        user_text,
                        kanban_tasks,
                        goals,
                        profile,
                    )
                    # 中身が入った時点でのみ DB 保存されるため、保存済みかは get_retro で判定。
                    persisted = get_retro(rid) is not None
                    if persisted:
                        pending_retros.pop(rid, None)
                        # 永続化されたドラフトを履歴に反映。
                        await ws.send_json(
                            {
                                "type": "retro_list_sync",
                                "retros": load_retros(),
                            }
                        )
                    else:
                        # まだ空ドキュメントの場合はメモリ上の最新状態を保持。
                        # (履歴に載せたくないので retro_list_sync は送らない)
                        pending_retros[rid] = updated
                except Exception as e:
                    print(f"retro turn error: {e}")
                    await ws.send_json(
                        {
                            "type": "retro_error",
                            "message": f"AI応答中にエラーが発生しました: {e}",
                        }
                    )
                finally:
                    await ws.send_json(
                        {"type": "retro_session_waiting", "waiting": False}
                    )
                continue

            if data["type"] == "retro_complete":
                rid = data.get("retroId", "")
                retro_entry = get_retro(rid) or pending_retros.get(rid)
                if retro_entry is None:
                    await ws.send_json(
                        {
                            "type": "retro_error",
                            "message": "セッションが見つかりません",
                        }
                    )
                    continue
                if retro_entry.get("completedAt"):
                    await ws.send_json(
                        {"type": "retro_completed", "retro": retro_entry}
                    )
                    continue
                await ws.send_json(
                    {"type": "retro_session_waiting", "waiting": True}
                )
                try:
                    await finalize_retro(
                        ws,
                        retro_entry,
                        kanban_tasks,
                        goals,
                        profile,
                    )
                    pending_retros.pop(rid, None)
                    await ws.send_json(
                        {
                            "type": "retro_list_sync",
                            "retros": load_retros(),
                        }
                    )
                except Exception as e:
                    print(f"retro complete error: {e}")
                    await ws.send_json(
                        {
                            "type": "retro_error",
                            "message": f"完了処理中にエラーが発生しました: {e}",
                        }
                    )
                finally:
                    await ws.send_json(
                        {"type": "retro_session_waiting", "waiting": False}
                    )
                continue

            if data["type"] == "retro_reopen":
                rid = data.get("retroId", "")
                retro_entry = get_retro(rid)
                if retro_entry is None or not retro_entry.get("completedAt"):
                    await ws.send_json(
                        {
                            "type": "retro_error",
                            "message": "完了済みの振り返りが見つかりません",
                        }
                    )
                    continue
                now_iso = datetime.datetime.now().isoformat(timespec="seconds")
                reopened = dict(retro_entry)
                reopened["completedAt"] = ""
                reopened["aiComment"] = ""
                reopened["messages"] = []
                reopened["updatedAt"] = now_iso
                save_retro(reopened)
                schedule_autosync()
                # 直ちに「会話再開済み」状態を反映
                await ws.send_json({"type": "retro_sync", "retro": reopened})
                await ws.send_json(
                    {"type": "retro_session_waiting", "waiting": True}
                )
                try:
                    reopened = await run_retro_reopen_greeting(
                        ws, reopened, kanban_tasks, goals, profile
                    )
                    await broadcast(
                        {
                            "type": "retro_list_sync",
                            "retros": load_retros(),
                        }
                    )
                except Exception as e:
                    print(f"retro reopen greeting error: {e}")
                    await ws.send_json(
                        {
                            "type": "retro_error",
                            "message": f"再開時の挨拶生成中にエラーが発生しました: {e}",
                        }
                    )
                finally:
                    await ws.send_json(
                        {"type": "retro_session_waiting", "waiting": False}
                    )
                continue

            if data["type"] == "retro_edit_document":
                rid = data.get("retroId", "")
                if not rid:
                    continue
                retro_entry = get_retro(rid) or pending_retros.get(rid)
                if retro_entry is None:
                    await ws.send_json(
                        {
                            "type": "retro_error",
                            "message": "セッションが見つかりません",
                        }
                    )
                    continue

                updated = dict(retro_entry)
                updated["document"] = dict(updated.get("document", {}))

                doc_update = data.get("document")
                if isinstance(doc_update, dict):
                    for key in RETRO_DOC_TEXT_KEYS:
                        if key in doc_update and isinstance(
                            doc_update[key], str
                        ):
                            updated["document"][key] = doc_update[key]
                    if "dayRating" in doc_update:
                        ev = doc_update.get("dayRating")
                        if isinstance(ev, (int, float)):
                            iv = int(ev)
                            if 0 <= iv <= 10:
                                updated["document"]["dayRating"] = iv
                    for key in RETRO_DOC_TIME_KEYS:
                        if key not in doc_update:
                            continue
                        tv = doc_update.get(key)
                        if not isinstance(tv, str):
                            continue
                        ts = tv.strip()
                        if ts == "" or _is_valid_hhmm(ts):
                            updated["document"][key] = ts

                ai_comment_update = data.get("aiComment")
                if isinstance(ai_comment_update, str):
                    updated["aiComment"] = ai_comment_update

                updated["updatedAt"] = datetime.datetime.now().isoformat(
                    timespec="seconds"
                )

                doc_for_check = updated["document"]
                has_content = (
                    any(
                        (doc_for_check.get(k) or "").strip()
                        for k in RETRO_DOC_TEXT_KEYS
                    )
                    or bool(doc_for_check.get("dayRating"))
                    or any(
                        (doc_for_check.get(k) or "").strip()
                        for k in RETRO_DOC_TIME_KEYS
                    )
                    or bool((updated.get("aiComment") or "").strip())
                )

                was_persisted = get_retro(rid) is not None

                if has_content:
                    save_retro(updated)
                    pending_retros.pop(rid, None)
                    schedule_autosync()
                elif was_persisted:
                    delete_retro(rid)
                    pending_retros[rid] = updated
                    schedule_autosync()
                else:
                    pending_retros[rid] = updated

                await broadcast(
                    {
                        "type": "retro_list_sync",
                        "retros": load_retros(),
                    }
                )
                await ws.send_json(
                    {
                        "type": "retro_sync",
                        "retro": updated,
                    }
                )
                continue

            if data["type"] == "retro_close_session":
                await ws.send_json({"type": "retro_session_closed"})
                continue

            # --- チャットメッセージ ---
            if data["type"] == "message":

                async def can_use_tool(
                    tool_name: str,
                    tool_input: dict[str, Any],
                    context: ToolPermissionContext,
                ) -> PermissionResultAllow:
                    if tool_name == "AskUserQuestion":
                        return await handle_ask_user_via_ws(ws, tool_input)
                    return PermissionResultAllow(updated_input=tool_input)

                if client is None:
                    board_ctx = build_board_context(kanban_tasks, goals)
                    profile_ctx = build_profile_context(profile)
                    prompt_append = SYSTEM_PROMPT_APPEND.format(
                        today=datetime.date.today().isoformat(),
                        profile_context=profile_ctx,
                        board_context=board_ctx,
                    )
                    options = ClaudeAgentOptions(
                        model="sonnet",
                        cwd=str(Path(__file__).parent),
                        system_prompt={
                            "type": "preset",
                            "preset": "claude_code",
                            "append": prompt_append,
                        },
                        include_partial_messages=True,
                        can_use_tool=can_use_tool,
                        permission_mode="acceptEdits",
                        thinking={"type": "enabled", "budget_tokens": 10000},
                        allowed_tools=load_ai_config()["allowedTools"],
                    )
                    client = ClaudeSDKClient(options=options)
                    await client.connect()

                board_ctx = build_board_context(kanban_tasks, goals)
                profile_ctx = build_profile_context(profile)
                user_msg = data.get("message", "")
                full_msg = f"{user_msg}\n\n---\n{profile_ctx}\n\n{board_ctx}"

                await client.query(full_msg)

                result_sent = False
                try:
                    async for msg in client.receive_response():
                        if isinstance(msg, StreamEvent):
                            event = msg.event
                            if event.get("type") == "content_block_delta":
                                delta = event.get("delta", {})
                                if delta.get("type") == "text_delta":
                                    await ws.send_json(
                                        {
                                            "type": "stream_delta",
                                            "text": delta["text"],
                                        }
                                    )
                                elif delta.get("type") == "thinking_delta":
                                    await ws.send_json(
                                        {
                                            "type": "thinking_delta",
                                            "text": delta.get("thinking", ""),
                                        }
                                    )

                        elif isinstance(msg, AssistantMessage):
                            text_parts = []
                            for block in msg.content:
                                if isinstance(block, TextBlock):
                                    text_parts.append(block.text)
                                elif isinstance(block, ThinkingBlock):
                                    pass
                                elif isinstance(block, ToolUseBlock):
                                    await ws.send_json(
                                        {
                                            "type": "tool_use",
                                            "name": block.name,
                                            "input": block.input,
                                        }
                                    )
                                    if block.name == "TodoWrite":
                                        todos = block.input.get("todos", [])
                                        (
                                            kanban_tasks,
                                            goals,
                                            new_profile,
                                        ) = process_todos(
                                            todos,
                                            kanban_tasks,
                                            goals,
                                            profile,
                                        )
                                        save_tasks(kanban_tasks)
                                        save_goals(goals)
                                        profile_changed = new_profile != profile
                                        if profile_changed:
                                            profile = new_profile
                                            save_profile(profile)
                                        schedule_autosync()
                                        await ws.send_json(
                                            {
                                                "type": "kanban_sync",
                                                "tasks": kanban_tasks,
                                            }
                                        )
                                        await ws.send_json(
                                            {
                                                "type": "goal_sync",
                                                "goals": goals,
                                            }
                                        )
                                        if profile_changed:
                                            await ws.send_json(
                                                {
                                                    "type": "profile_sync",
                                                    "profile": profile,
                                                }
                                            )
                            if text_parts:
                                await ws.send_json(
                                    {
                                        "type": "assistant",
                                        "text": "".join(text_parts),
                                        "toolCalls": [],
                                    }
                                )

                        elif isinstance(msg, ResultMessage):
                            result_sent = True
                            await ws.send_json(
                                {
                                    "type": "result",
                                    "result": msg.result,
                                    "cost": msg.total_cost_usd or 0,
                                    "turns": msg.num_turns,
                                    "sessionId": msg.session_id,
                                }
                            )
                except Exception as e:
                    print(f"response error: {e}")
                finally:
                    if not result_sent:
                        await ws.send_json(
                            {
                                "type": "result",
                                "result": "(中断されました)",
                                "cost": 0,
                                "turns": 0,
                                "sessionId": "",
                            }
                        )

    except WebSocketDisconnect:
        pass
    finally:
        active_sockets.discard(ws)
        reader_task.cancel()
        if client:
            await client.disconnect()


@app.on_event("shutdown")
async def _on_shutdown() -> None:
    t: asyncio.Task | None = github_state.get("debounce_task")
    if t and not t.done():
        t.cancel()


_client_dist = os.path.join(os.path.dirname(__file__), "client", "dist")
if os.path.isdir(_client_dist):
    app.mount(
        "/", StaticFiles(directory=_client_dist, html=True), name="static"
    )
