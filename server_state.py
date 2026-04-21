import asyncio
from dataclasses import dataclass, field
from typing import Any

from claude_agent_sdk import ClaudeSDKClient
from fastapi import WebSocket


KanbanTask = dict[str, Any]
GoalData = dict[str, Any]
ProfileData = dict[str, Any]
RetrospectiveData = dict[str, Any]


@dataclass
class SessionState:
    client: ClaudeSDKClient | None = None
    kanban_tasks: list[KanbanTask] = field(default_factory=list)
    goals: list[GoalData] = field(default_factory=list)
    profile: ProfileData = field(default_factory=dict)
    pending_retros: dict[str, RetrospectiveData] = field(default_factory=dict)


pending_approvals: dict[str, asyncio.Future] = {}
active_sockets: set[WebSocket] = set()
# Git 同期 (pull/restore/link/unlink) で DB が差し替わった際、各 WS 接続が保持する
# kanban_tasks/goals/profile のローカル変数は自動では更新されない。次ループ頭で
# reload するためのフラグ。
_ws_needs_reload: dict[WebSocket, bool] = {}

github_state: dict[str, Any] = {
    "syncing": False,
    "lastSyncAt": None,
    "lastError": None,
    "pendingSync": False,
    "debounce_task": None,
    "sync_lock": None,  # lazy init inside async context
    "diff_cache": {},  # commit hash -> {summary, details}
}
