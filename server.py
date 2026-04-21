"""todome — FastAPI + WebSocket バックエンド

起動方法:
  uv run uvicorn server:app --host 0.0.0.0 --port 3002 --reload
"""

import asyncio
import datetime
import json
import os
import re
import shlex
import shutil
import sqlite3
import uuid
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles

from claude_agent_sdk.types import PermissionResultAllow

import github_sync
from server_state import (
    GoalData,
    KanbanTask,
    ProfileData,
    RetrospectiveData,
    _ws_needs_reload,
    active_sockets,
    github_state,
    pending_approvals,
)

load_dotenv()
app = FastAPI()


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

# UIで切り替え可能なモデルID。claude-agent-sdk v0.1.63+ のフルIDまたはエイリアスを受ける。
# 1M context 版は同じ base model ID に AI_1M_CONTEXT_MODELS 経由で beta フラグを付与する。
AI_AVAILABLE_MODELS: tuple[str, ...] = (
    "claude-opus-4-7",
    "claude-opus-4-7-1m",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
)
AI_DEFAULT_MODEL: str = "claude-sonnet-4-6"
# "1m" サフィックス付き疑似ID → 実モデルID への解決表。併せて 1M context beta を有効化する。
AI_1M_CONTEXT_MODELS: dict[str, str] = {
    "claude-opus-4-7-1m": "claude-opus-4-7",
}
# 旧エイリアスからの後方互換マイグレーション。load 時にのみ適用される。
AI_MODEL_ALIASES: dict[str, str] = {
    "sonnet": "claude-sonnet-4-6",
    "opus": "claude-opus-4-7",
    "haiku": "claude-haiku-4-5",
}

# 画像のUIに合わせた5段階の思考工数。`ClaudeAgentOptions.thinking` の budget_tokens にマップする。
AI_THINKING_EFFORTS: tuple[str, ...] = ("low", "medium", "high", "veryHigh", "max")
AI_THINKING_BUDGETS: dict[str, int] = {
    "low": 1024,
    "medium": 4000,
    "high": 10000,
    "veryHigh": 32000,
    "max": 64000,
}
AI_DEFAULT_THINKING_EFFORT: str = "high"

# Bash ツールが実行可能なコマンドの prefix allowlist。常時許可。
AI_BASH_ALLOWED_PREFIXES: tuple[tuple[str, ...], ...] = (
    ("gh", "issue", "list"),
    ("gh", "issue", "view"),
    ("gh", "pr", "list"),
    ("gh", "pr", "view"),
    ("gh", "repo", "view"),
    ("git", "status"),
    ("git", "log"),
    ("git", "diff"),
)
# allowGhApi=True のときのみ追加で許可する prefix。
AI_BASH_OPTIONAL_PREFIXES: tuple[tuple[str, ...], ...] = (("gh", "api"),)
# シェル展開・複文・リダイレクトを示すメタ文字。含まれるコマンドは常に拒否する。
_BASH_SHELL_META: tuple[str, ...] = (";", "&", "|", ">", "<", "`", "$(", "${")

_cfg_cache: dict[str, Any] | None = None
_ai_cfg_cache: dict[str, Any] | None = None


def _normalize_ai_config(cfg: Any) -> dict[str, Any]:
    """保存用 AI 設定を正規化する。未知ツール除外・重複除外・空は既定に戻す。"""
    if not isinstance(cfg, dict):
        return {
            "allowedTools": list(AI_DEFAULT_ALLOWED_TOOLS),
            "allowGhApi": False,
            "model": AI_DEFAULT_MODEL,
            "thinkingEffort": AI_DEFAULT_THINKING_EFFORT,
        }
    model = cfg.get("model")
    if isinstance(model, str) and model in AI_MODEL_ALIASES:
        model = AI_MODEL_ALIASES[model]
    if not isinstance(model, str) or model not in AI_AVAILABLE_MODELS:
        model = AI_DEFAULT_MODEL
    effort = cfg.get("thinkingEffort")
    if not isinstance(effort, str) or effort not in AI_THINKING_EFFORTS:
        effort = AI_DEFAULT_THINKING_EFFORT
    raw = cfg.get("allowedTools")
    if not isinstance(raw, list):
        return {
            "allowedTools": list(AI_DEFAULT_ALLOWED_TOOLS),
            "allowGhApi": bool(cfg.get("allowGhApi", False)),
            "model": model,
            "thinkingEffort": effort,
        }
    seen: set[str] = set()
    result: list[str] = []
    for tool in raw:
        if isinstance(tool, str) and tool in AI_TOOL_CATALOG and tool not in seen:
            result.append(tool)
            seen.add(tool)
    return {
        "allowedTools": result,
        "allowGhApi": bool(cfg.get("allowGhApi", False)),
        "model": model,
        "thinkingEffort": effort,
    }


def _resolve_ai_model(cfg: dict[str, Any]) -> tuple[str, list[str]]:
    """AI 設定の model を SDK 用の (モデルID, beta フラグ list) に解決する。"""
    model = cfg.get("model", AI_DEFAULT_MODEL)
    betas: list[str] = []
    if model in AI_1M_CONTEXT_MODELS:
        betas.append("context-1m-2025-08-07")
        model = AI_1M_CONTEXT_MODELS[model]
    return model, betas


def _resolve_thinking_budget(cfg: dict[str, Any]) -> int:
    """AI 設定の thinkingEffort を budget_tokens に解決する。"""
    effort = cfg.get("thinkingEffort", AI_DEFAULT_THINKING_EFFORT)
    return AI_THINKING_BUDGETS.get(effort, AI_THINKING_BUDGETS[AI_DEFAULT_THINKING_EFFORT])


def _is_bash_command_allowed(command: Any, *, allow_gh_api: bool) -> bool:
    """Bash ツールが実行するコマンドが allowlist に合致するか判定する。

    シェル制御文字（;, &, |, >, <, `, $(, ${）を含む場合は allow_gh_api に関わらず拒否する。
    """
    if not isinstance(command, str) or not command.strip():
        return False
    if any(meta in command for meta in _BASH_SHELL_META):
        return False
    try:
        tokens = shlex.split(command)
    except ValueError:
        return False
    if not tokens:
        return False
    prefixes = AI_BASH_ALLOWED_PREFIXES
    if allow_gh_api:
        prefixes = prefixes + AI_BASH_OPTIONAL_PREFIXES
    for prefix in prefixes:
        if len(tokens) >= len(prefix) and tuple(tokens[: len(prefix)]) == prefix:
            return True
    return False


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
            _ai_cfg_cache = _normalize_ai_config(None)
    else:
        _ai_cfg_cache = _normalize_ai_config(None)
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
            CREATE TABLE IF NOT EXISTS life_activities (
                id TEXT PRIMARY KEY,
                sort_order INTEGER NOT NULL,
                data TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS life_logs (
                id TEXT PRIMARY KEY,
                activity_id TEXT NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT NOT NULL DEFAULT '',
                memo TEXT NOT NULL DEFAULT '',
                alert_triggered TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_life_logs_started ON life_logs(started_at);
            CREATE TABLE IF NOT EXISTS quotas (
                id TEXT PRIMARY KEY,
                sort_order INTEGER NOT NULL,
                data TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS quota_logs (
                id TEXT PRIMARY KEY,
                quota_id TEXT NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT NOT NULL DEFAULT '',
                memo TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_quota_logs_started ON quota_logs(started_at);
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


# --- Timebox storage ---
LifeActivity = dict[str, Any]
LifeLog = dict[str, Any]

LIFE_ACTIVITY_CATEGORIES = ("rest", "play", "routine", "other")
LIFE_LIMIT_SCOPES = ("per_session", "per_day")

_DEFAULT_LIFE_ACTIVITIES: list[dict[str, Any]] = [
    {"name": "食事", "icon": "🍚", "category": "routine", "softLimitMinutes": 45, "hardLimitMinutes": 90, "limitScope": "per_session"},
    {"name": "風呂", "icon": "🛁", "category": "routine", "softLimitMinutes": 30, "hardLimitMinutes": 60, "limitScope": "per_session"},
    {"name": "遊び", "icon": "🎮", "category": "play", "softLimitMinutes": 60, "hardLimitMinutes": 180, "limitScope": "per_day"},
    {"name": "SNS", "icon": "📱", "category": "play", "softLimitMinutes": 30, "hardLimitMinutes": 90, "limitScope": "per_day"},
    {"name": "動画視聴", "icon": "📺", "category": "play", "softLimitMinutes": 60, "hardLimitMinutes": 180, "limitScope": "per_day"},
    {"name": "仮眠", "icon": "💤", "category": "rest", "softLimitMinutes": 20, "hardLimitMinutes": 45, "limitScope": "per_session"},
]


def _normalize_life_activity(activity: dict[str, Any]) -> LifeActivity:
    """ユーザー入力をバリデーション・既定値補完した LifeActivity に正規化する。"""
    category = activity.get("category")
    if category not in LIFE_ACTIVITY_CATEGORIES:
        category = "other"
    scope = activity.get("limitScope")
    if scope not in LIFE_LIMIT_SCOPES:
        scope = "per_session"
    try:
        soft = max(0, int(activity.get("softLimitMinutes", 0) or 0))
    except (TypeError, ValueError):
        soft = 0
    try:
        hard = max(0, int(activity.get("hardLimitMinutes", 0) or 0))
    except (TypeError, ValueError):
        hard = 0
    name = str(activity.get("name", "")).strip() or "未命名"
    icon = str(activity.get("icon", "")).strip() or "⏱"
    return {
        "id": activity.get("id") or _short_id(),
        "name": name,
        "icon": icon,
        "category": category,
        "softLimitMinutes": soft,
        "hardLimitMinutes": hard,
        "limitScope": scope,
        "archived": bool(activity.get("archived", False)),
    }


def load_life_activities() -> list[LifeActivity]:
    with _db() as conn:
        rows = conn.execute(
            "SELECT data FROM life_activities ORDER BY sort_order"
        ).fetchall()
    if not rows:
        activities = [_normalize_life_activity(a) for a in _DEFAULT_LIFE_ACTIVITIES]
        save_life_activities(activities)
        return activities
    return [_normalize_life_activity(json.loads(r["data"])) for r in rows]


def save_life_activities(activities: list[LifeActivity]) -> None:
    with _db() as conn:
        conn.execute("DELETE FROM life_activities")
        conn.executemany(
            "INSERT INTO life_activities (id, sort_order, data) VALUES (?, ?, ?)",
            [
                (a["id"], i, json.dumps(a, ensure_ascii=False))
                for i, a in enumerate(activities)
            ],
        )


def _life_log_row_to_dict(row: sqlite3.Row) -> LifeLog:
    return {
        "id": row["id"],
        "activityId": row["activity_id"],
        "startedAt": row["started_at"],
        "endedAt": row["ended_at"] or "",
        "memo": row["memo"] or "",
        "alertTriggered": row["alert_triggered"] or "",
    }


def load_today_life_logs(today_iso: str | None = None) -> list[LifeLog]:
    """当日分 (指定日) のタイムボックスを開始時刻昇順で返す。"""
    if today_iso is None:
        today_iso = datetime.date.today().isoformat()
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM life_logs WHERE substr(started_at, 1, 10) = ? "
            "ORDER BY started_at ASC",
            (today_iso,),
        ).fetchall()
    return [_life_log_row_to_dict(r) for r in rows]


def load_life_logs_in_range(start_iso: str, end_iso: str) -> list[LifeLog]:
    """[start_iso, end_iso) に重なるタイムボックスを返す（ISO文字列は辞書順比較可能)。"""
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM life_logs "
            "WHERE started_at < ? "
            "AND (ended_at = '' OR ended_at > ?) "
            "ORDER BY started_at ASC",
            (end_iso, start_iso),
        ).fetchall()
    return [_life_log_row_to_dict(r) for r in rows]


def _stop_all_active_life_logs(now_iso: str) -> None:
    with _db() as conn:
        conn.execute(
            "UPDATE life_logs SET ended_at = ? WHERE ended_at = ''",
            (now_iso,),
        )


def start_life_log(activity_id: str) -> LifeLog:
    """タイムボックス計測を開始する。既存の active ログは自動停止する。"""
    now_iso = datetime.datetime.now().isoformat(timespec="seconds")
    _stop_all_active_life_logs(now_iso)
    log_id = _short_id()
    with _db() as conn:
        conn.execute(
            "INSERT INTO life_logs (id, activity_id, started_at) VALUES (?, ?, ?)",
            (log_id, activity_id, now_iso),
        )
        row = conn.execute(
            "SELECT * FROM life_logs WHERE id = ?", (log_id,)
        ).fetchone()
    return _life_log_row_to_dict(row)


def stop_life_log(log_id: str, memo: str | None = None) -> LifeLog | None:
    now_iso = datetime.datetime.now().isoformat(timespec="seconds")
    with _db() as conn:
        if memo is None:
            conn.execute(
                "UPDATE life_logs SET ended_at = ? WHERE id = ? AND ended_at = ''",
                (now_iso, log_id),
            )
        else:
            conn.execute(
                "UPDATE life_logs SET ended_at = ?, memo = ? "
                "WHERE id = ? AND ended_at = ''",
                (now_iso, memo, log_id),
            )
        row = conn.execute(
            "SELECT * FROM life_logs WHERE id = ?", (log_id,)
        ).fetchone()
    return _life_log_row_to_dict(row) if row else None


def delete_life_log(log_id: str) -> None:
    with _db() as conn:
        conn.execute("DELETE FROM life_logs WHERE id = ?", (log_id,))


def _stop_task_timers_if_running(tasks: list[dict[str, Any]]) -> list[str]:
    """計測中のタスクタイマーを全て停止し、停止したタスクIDを返す。"""
    stopped_ids: list[str] = []
    now_naive = datetime.datetime.now()
    now_aware = datetime.datetime.now(datetime.timezone.utc)
    now_iso = now_naive.isoformat(timespec="seconds")
    for t in tasks:
        started = t.get("timerStartedAt") or ""
        if not started:
            continue
        try:
            # クライアントは ISO with 'Z' (tz-aware) を送ってくる場合があるため
            # fromisoformat にかけた上で、tz に応じて比較相手を切り替える。
            normalized = started.replace("Z", "+00:00")
            start_dt = datetime.datetime.fromisoformat(normalized)
        except ValueError:
            t["timerStartedAt"] = ""
            continue
        now = now_aware if start_dt.tzinfo else now_naive
        elapsed = max(0, int((now - start_dt).total_seconds()))
        t["timeSpent"] = int(t.get("timeSpent", 0) or 0) + elapsed
        logs = list(t.get("timeLogs") or [])
        logs.append({"start": started, "end": now_iso, "duration": elapsed})
        t["timeLogs"] = logs
        t["timerStartedAt"] = ""
        stopped_ids.append(t["id"])
    return stopped_ids


def _stop_active_life_log_if_any() -> str:
    """計測中のタイムボックスを全て停止し、停止したログIDを返す（なければ "")。"""
    now_iso = datetime.datetime.now().isoformat(timespec="seconds")
    with _db() as conn:
        row = conn.execute(
            "SELECT id FROM life_logs WHERE ended_at = '' LIMIT 1"
        ).fetchone()
        if not row:
            return ""
        conn.execute(
            "UPDATE life_logs SET ended_at = ? WHERE ended_at = ''",
            (now_iso,),
        )
    return row["id"]


# --- Quota storage ---
Quota = dict[str, Any]
QuotaLog = dict[str, Any]


_DEFAULT_QUOTAS: list[dict[str, Any]] = [
    {"name": "掃除", "icon": "🧹", "targetMinutes": 15},
    {"name": "運動", "icon": "🏃", "targetMinutes": 30},
    {"name": "料理", "icon": "🍳", "targetMinutes": 30},
]


def _normalize_quota(quota: dict[str, Any]) -> Quota:
    try:
        target = max(0, int(quota.get("targetMinutes", 0) or 0))
    except (TypeError, ValueError):
        target = 0
    name = str(quota.get("name", "")).strip() or "未命名ノルマ"
    icon = str(quota.get("icon", "")).strip() or "🎯"
    created = str(quota.get("createdAt", "")) or datetime.datetime.now().isoformat(
        timespec="seconds"
    )
    return {
        "id": quota.get("id") or _short_id(),
        "name": name,
        "icon": icon,
        "targetMinutes": target,
        "archived": bool(quota.get("archived", False)),
        "createdAt": created,
    }


def load_quotas() -> list[Quota]:
    with _db() as conn:
        rows = conn.execute(
            "SELECT data FROM quotas ORDER BY sort_order"
        ).fetchall()
    if not rows:
        quotas = [_normalize_quota(q) for q in _DEFAULT_QUOTAS]
        save_quotas(quotas)
        return quotas
    return [_normalize_quota(json.loads(r["data"])) for r in rows]


def save_quotas(quotas: list[Quota]) -> None:
    with _db() as conn:
        conn.execute("DELETE FROM quotas")
        conn.executemany(
            "INSERT INTO quotas (id, sort_order, data) VALUES (?, ?, ?)",
            [
                (q["id"], i, json.dumps(q, ensure_ascii=False))
                for i, q in enumerate(quotas)
            ],
        )


def _quota_log_row_to_dict(row: sqlite3.Row) -> QuotaLog:
    return {
        "id": row["id"],
        "quotaId": row["quota_id"],
        "startedAt": row["started_at"],
        "endedAt": row["ended_at"] or "",
        "memo": row["memo"] or "",
    }


def load_today_quota_logs(today_iso: str | None = None) -> list[QuotaLog]:
    if today_iso is None:
        today_iso = datetime.date.today().isoformat()
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM quota_logs WHERE substr(started_at, 1, 10) = ? "
            "ORDER BY started_at ASC",
            (today_iso,),
        ).fetchall()
    return [_quota_log_row_to_dict(r) for r in rows]


def load_all_quota_logs() -> list[QuotaLog]:
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM quota_logs ORDER BY started_at ASC"
        ).fetchall()
    return [_quota_log_row_to_dict(r) for r in rows]


def load_quota_logs_in_range(start_iso: str, end_iso: str) -> list[QuotaLog]:
    """[start_iso, end_iso) に重なるノルマログを開始昇順で返す。"""
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM quota_logs "
            "WHERE started_at < ? "
            "AND (ended_at = '' OR ended_at > ?) "
            "ORDER BY started_at ASC",
            (end_iso, start_iso),
        ).fetchall()
    return [_quota_log_row_to_dict(r) for r in rows]


def _stop_active_quota_log_if_any() -> str:
    now_iso = datetime.datetime.now().isoformat(timespec="seconds")
    with _db() as conn:
        row = conn.execute(
            "SELECT id FROM quota_logs WHERE ended_at = '' LIMIT 1"
        ).fetchone()
        if not row:
            return ""
        conn.execute(
            "UPDATE quota_logs SET ended_at = ? WHERE ended_at = ''",
            (now_iso,),
        )
    return row["id"]


def start_quota_log(quota_id: str) -> QuotaLog:
    """ノルマ計測を開始する。既存の active ログは自動停止する。"""
    now_iso = datetime.datetime.now().isoformat(timespec="seconds")
    with _db() as conn:
        conn.execute(
            "UPDATE quota_logs SET ended_at = ? WHERE ended_at = ''",
            (now_iso,),
        )
    log_id = _short_id()
    with _db() as conn:
        conn.execute(
            "INSERT INTO quota_logs (id, quota_id, started_at) VALUES (?, ?, ?)",
            (log_id, quota_id, now_iso),
        )
        row = conn.execute(
            "SELECT * FROM quota_logs WHERE id = ?", (log_id,)
        ).fetchone()
    return _quota_log_row_to_dict(row)


def stop_quota_log(log_id: str, memo: str | None = None) -> QuotaLog | None:
    now_iso = datetime.datetime.now().isoformat(timespec="seconds")
    with _db() as conn:
        if memo is None:
            conn.execute(
                "UPDATE quota_logs SET ended_at = ? WHERE id = ? AND ended_at = ''",
                (now_iso, log_id),
            )
        else:
            conn.execute(
                "UPDATE quota_logs SET ended_at = ?, memo = ? "
                "WHERE id = ? AND ended_at = ''",
                (now_iso, memo, log_id),
            )
        row = conn.execute(
            "SELECT * FROM quota_logs WHERE id = ?", (log_id,)
        ).fetchone()
    return _quota_log_row_to_dict(row) if row else None


def compute_quota_day_totals(
    logs: list[QuotaLog],
    now_iso: str | None = None,
) -> dict[str, dict[str, int]]:
    """ノルマごとに日別合計秒数を返す。active ログ (endedAt="") は now までを含める。

    戻り値: { quotaId: { "YYYY-MM-DD": seconds } }
    """
    if now_iso is None:
        now_iso = datetime.datetime.now().isoformat(timespec="seconds")
    try:
        now_dt = datetime.datetime.fromisoformat(now_iso.replace("Z", "+00:00"))
        if now_dt.tzinfo is not None:
            now_dt = now_dt.replace(tzinfo=None)
    except ValueError:
        now_dt = datetime.datetime.now()

    totals: dict[str, dict[str, int]] = {}
    for log in logs:
        qid = log.get("quotaId", "")
        started = log.get("startedAt", "")
        if not qid or not started:
            continue
        try:
            start_dt = datetime.datetime.fromisoformat(
                started.replace("Z", "+00:00")
            )
            if start_dt.tzinfo is not None:
                start_dt = start_dt.replace(tzinfo=None)
        except ValueError:
            continue
        ended = log.get("endedAt", "")
        if ended:
            try:
                end_dt = datetime.datetime.fromisoformat(
                    ended.replace("Z", "+00:00")
                )
                if end_dt.tzinfo is not None:
                    end_dt = end_dt.replace(tzinfo=None)
            except ValueError:
                end_dt = now_dt
        else:
            end_dt = now_dt
        if end_dt <= start_dt:
            continue
        # 日をまたぐログは日別に分割
        cursor = start_dt
        while cursor < end_dt:
            day_end = datetime.datetime.combine(
                cursor.date() + datetime.timedelta(days=1),
                datetime.time(0, 0, 0),
            )
            segment_end = min(day_end, end_dt)
            seconds = int((segment_end - cursor).total_seconds())
            if seconds > 0:
                key = cursor.date().isoformat()
                totals.setdefault(qid, {})
                totals[qid][key] = totals[qid].get(key, 0) + seconds
            cursor = segment_end
    return totals


def compute_quota_streak(
    day_totals: dict[str, int],
    target_seconds: int,
    today_iso: str,
) -> tuple[int, int, str]:
    """指定ノルマ1件の日別合計から (current, best, lastAchievedDate) を返す。

    - target_seconds <= 0 の場合は current/best ともに 0 を返す。
    - 今日未達でも、昨日まで連続達成していれば current は昨日までの連続数を保つ。
    - 今日達成済みなら今日を含めた連続数。
    - best は全期間で一度でも伸びた最大連続達成日数。
    """
    if target_seconds <= 0:
        return (0, 0, "")
    achieved_dates = sorted(
        d for d, s in day_totals.items() if s >= target_seconds
    )
    if not achieved_dates:
        return (0, 0, "")

    # best: 連続達成の最大長
    best = 1
    run = 1
    for i in range(1, len(achieved_dates)):
        prev = datetime.date.fromisoformat(achieved_dates[i - 1])
        cur = datetime.date.fromisoformat(achieved_dates[i])
        if (cur - prev).days == 1:
            run += 1
            best = max(best, run)
        else:
            run = 1

    last = achieved_dates[-1]
    try:
        today = datetime.date.fromisoformat(today_iso)
        last_date = datetime.date.fromisoformat(last)
    except ValueError:
        return (0, best, last)

    # current: today または today-1 が最終達成日なら、そこから遡って連続数を数える
    gap = (today - last_date).days
    if gap > 1:
        return (0, best, last)
    # 今日未達 (gap == 1) でも継続扱い。gap == 0 は今日達成済み。
    current = 1
    cursor = last_date
    i = len(achieved_dates) - 2
    while i >= 0:
        prev = datetime.date.fromisoformat(achieved_dates[i])
        if (cursor - prev).days == 1:
            current += 1
            cursor = prev
            i -= 1
        else:
            break
    return (current, max(best, current), last)


def compute_all_quota_streaks(
    quotas: list[Quota],
    logs: list[QuotaLog],
    today_iso: str | None = None,
    now_iso: str | None = None,
) -> list[dict[str, Any]]:
    if today_iso is None:
        today_iso = datetime.date.today().isoformat()
    totals = compute_quota_day_totals(logs, now_iso=now_iso)
    result: list[dict[str, Any]] = []
    for q in quotas:
        qid = q["id"]
        target_sec = int(q.get("targetMinutes", 0) or 0) * 60
        cur, best, last = compute_quota_streak(
            totals.get(qid, {}), target_sec, today_iso
        )
        result.append(
            {
                "quotaId": qid,
                "current": cur,
                "best": best,
                "lastAchievedDate": last,
            }
        )
    return result


# --- Retrospective storage ---


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
    """現在の DB からロードして全クライアントへ同期 push。

    DB が外部要因 (git pull/restore/link/unlink) で差し替わったタイミングで呼ばれるため、
    各 WS 接続のローカルキャッシュも次のループ頭で再ロードさせるフラグを立てる。
    """
    tasks = load_tasks()
    goals = load_goals()
    profile = load_profile()
    retros = load_retros()
    activities = load_life_activities()
    life_logs = load_today_life_logs()
    quotas = load_quotas()
    quota_logs = load_today_quota_logs()
    all_quota_logs = load_all_quota_logs()
    for ws in active_sockets:
        _ws_needs_reload[ws] = True
    await broadcast({"type": "kanban_sync", "tasks": tasks})
    await broadcast({"type": "goal_sync", "goals": goals})
    await broadcast({"type": "profile_sync", "profile": profile})
    await broadcast({"type": "retro_list_sync", "retros": retros})
    await broadcast({"type": "life_activity_sync", "activities": activities})
    await broadcast({"type": "life_log_sync", "logs": life_logs})
    await broadcast({"type": "quota_sync", "quotas": quotas})
    await broadcast({"type": "quota_log_sync", "logs": quota_logs})
    await broadcast(
        {
            "type": "quota_streak_sync",
            "streaks": compute_all_quota_streaks(quotas, all_quota_logs),
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

Bash は安全のため以下の prefix のみ許可されている。パイプ・リダイレクト・複文 (`|`, `>`, `;` など)
は拒否されるので、結果を加工したい場合は出力を受け取ってから手元で解釈すること。
- `gh issue list`, `gh issue view`, `gh pr list`, `gh pr view`, `gh repo view`
- `git status`, `git log`, `git diff`
- （設定で `gh api` が有効なときのみ）`gh api ...`

## 制約
- AskUserQuestion: 質問は最大4つ、各質問の選択肢は2〜4個まで
- 今日の日付: {today}

{profile_context}

{board_context}"""


from server_ws import websocket_endpoint


app.websocket("/ws")(websocket_endpoint)


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
