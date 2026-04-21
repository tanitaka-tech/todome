import asyncio
import datetime
import json
from pathlib import Path
from typing import Any, Awaitable, Callable

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
    PermissionResultDeny,
    ToolPermissionContext,
)
from fastapi import WebSocket, WebSocketDisconnect

import github_sync
import server as core
import server_retro
from server_state import (
    SessionState,
    _ws_needs_reload,
    active_sockets,
    pending_approvals,
)

Handler = Callable[[WebSocket, SessionState, dict[str, Any]], Awaitable[None]]


def _load_session_state() -> SessionState:
    return SessionState(
        kanban_tasks=core.load_tasks(),
        goals=core.load_goals(),
        profile=core.load_profile(),
    )


async def _interrupt_client(session: SessionState) -> None:
    if session.client is None:
        return
    try:
        await session.client.interrupt()
    except Exception as e:
        print(f"interrupt failed: {e}")


async def _disconnect_client(session: SessionState) -> None:
    if session.client is None:
        return
    try:
        await session.client.disconnect()
    except Exception:
        pass
    session.client = None


async def _reload_session_if_needed(ws: WebSocket, session: SessionState) -> None:
    if not _ws_needs_reload.pop(ws, False):
        return
    session.kanban_tasks = core.load_tasks()
    session.goals = core.load_goals()
    session.profile = core.load_profile()
    await _disconnect_client(session)


async def _send_initial_state(ws: WebSocket, session: SessionState) -> None:
    await ws.send_json({"type": "kanban_sync", "tasks": session.kanban_tasks})
    await ws.send_json({"type": "goal_sync", "goals": session.goals})
    await ws.send_json({"type": "profile_sync", "profile": session.profile})
    await ws.send_json({"type": "retro_list_sync", "retros": core.load_retros()})
    await ws.send_json(await core._build_github_status())
    await ws.send_json({"type": "ai_config_sync", "config": core.load_ai_config()})
    await ws.send_json(
        {"type": "life_activity_sync", "activities": core.load_life_activities()}
    )
    await ws.send_json({"type": "life_log_sync", "logs": core.load_today_life_logs()})
    initial_quotas = core.load_quotas()
    initial_all_quota_logs = core.load_all_quota_logs()
    await ws.send_json({"type": "quota_sync", "quotas": initial_quotas})
    await ws.send_json({"type": "quota_log_sync", "logs": core.load_today_quota_logs()})
    await ws.send_json(
        {
            "type": "quota_streak_sync",
            "streaks": core.compute_all_quota_streaks(
                initial_quotas, initial_all_quota_logs
            ),
        }
    )


async def _send_kanban_and_goals(ws: WebSocket, session: SessionState) -> None:
    await ws.send_json({"type": "kanban_sync", "tasks": session.kanban_tasks})
    await ws.send_json({"type": "goal_sync", "goals": session.goals})


async def _broadcast_time_tracking_sync() -> None:
    await core.broadcast({"type": "life_log_sync", "logs": core.load_today_life_logs()})
    await core.broadcast(
        {"type": "quota_log_sync", "logs": core.load_today_quota_logs()}
    )
    await core.broadcast(
        {
            "type": "quota_streak_sync",
            "streaks": core.compute_all_quota_streaks(
                core.load_quotas(), core.load_all_quota_logs()
            ),
        }
    )


async def _handle_kanban_move(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    starting_timer = bool(data.get("timerStartedAt"))
    for task in session.kanban_tasks:
        if task["id"] != data["taskId"]:
            continue
        before = {
            "goalId": task.get("goalId", ""),
            "kpiId": task.get("kpiId", ""),
            "timeSpent": int(task.get("timeSpent", 0) or 0),
            "kpiContributed": bool(task.get("kpiContributed", False)),
        }
        task["column"] = data["column"]
        for key in ("timeSpent", "timerStartedAt", "completedAt", "timeLogs"):
            if key in data:
                task[key] = data[key]
        core._rebalance_kpi_contribution(task, before, session.goals)
        break
    if starting_timer:
        core._stop_active_life_log_if_any()
        core._stop_active_quota_log_if_any()
    core.save_tasks(session.kanban_tasks)
    core.save_goals(session.goals)
    core.schedule_autosync()
    await _send_kanban_and_goals(ws, session)
    if starting_timer:
        await _broadcast_time_tracking_sync()


async def _handle_kanban_add(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    new_task = {
        "id": core._short_id(),
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
    session.kanban_tasks.append(new_task)
    core.save_tasks(session.kanban_tasks)
    core.schedule_autosync()
    await ws.send_json({"type": "kanban_sync", "tasks": session.kanban_tasks})


async def _handle_kanban_delete(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    target = next(
        (task for task in session.kanban_tasks if task["id"] == data["taskId"]),
        None,
    )
    if target and target.get("kpiContributed"):
        core._apply_kpi_time_delta(
            session.goals,
            target.get("goalId", ""),
            target.get("kpiId", ""),
            -int(target.get("timeSpent", 0) or 0),
        )
    session.kanban_tasks = [
        task for task in session.kanban_tasks if task["id"] != data["taskId"]
    ]
    core.save_tasks(session.kanban_tasks)
    core.save_goals(session.goals)
    core.schedule_autosync()
    await _send_kanban_and_goals(ws, session)


async def _handle_kanban_reorder(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    ids = data.get("taskIds", [])
    task_map = {task["id"]: task for task in session.kanban_tasks}
    seen: set[str] = set()
    new_order: list[dict[str, Any]] = []
    for task_id in ids:
        if task_id in task_map and task_id not in seen:
            new_order.append(task_map[task_id])
            seen.add(task_id)
    for task in session.kanban_tasks:
        if task["id"] not in seen:
            new_order.append(task)
    session.kanban_tasks = new_order
    core.save_tasks(session.kanban_tasks)
    core.schedule_autosync()


async def _handle_kanban_edit(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    starting_timer = bool(data.get("timerStartedAt"))
    for task in session.kanban_tasks:
        if task["id"] != data["taskId"]:
            continue
        before = {
            "goalId": task.get("goalId", ""),
            "kpiId": task.get("kpiId", ""),
            "timeSpent": int(task.get("timeSpent", 0) or 0),
            "kpiContributed": bool(task.get("kpiContributed", False)),
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
                task[key] = data[key]
        if not task.get("goalId"):
            task["kpiId"] = ""
        core._rebalance_kpi_contribution(task, before, session.goals)
        break
    if starting_timer:
        core._stop_active_life_log_if_any()
        core._stop_active_quota_log_if_any()
    core.save_tasks(session.kanban_tasks)
    core.save_goals(session.goals)
    core.schedule_autosync()
    await _send_kanban_and_goals(ws, session)
    if starting_timer:
        await _broadcast_time_tracking_sync()


async def _handle_goal_add(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    goal = data.get("goal", {})
    if not goal.get("id"):
        goal["id"] = core._short_id()
    goal["kpis"] = core._ensure_kpi_ids(goal.get("kpis", []))
    goal.setdefault("achieved", False)
    goal.setdefault("achievedAt", "")
    core._normalize_goal_repository(goal)
    core._sync_goal_achievement(goal)
    session.goals.append(goal)
    core.save_goals(session.goals)
    core.schedule_autosync()
    await ws.send_json({"type": "goal_sync", "goals": session.goals})


async def _handle_goal_edit(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    incoming = data.get("goal", {})
    incoming["kpis"] = core._ensure_kpi_ids(incoming.get("kpis", []))
    core._normalize_goal_repository(incoming)
    core._sync_goal_achievement(incoming)
    goal_id = incoming.get("id")
    valid_time_kpi_ids = {
        kpi["id"]
        for kpi in incoming.get("kpis", [])
        if kpi.get("unit") == "time"
    }
    for task in session.kanban_tasks:
        if (
            task.get("goalId") == goal_id
            and task.get("kpiId")
            and task["kpiId"] not in valid_time_kpi_ids
        ):
            task["kpiId"] = ""
            task["kpiContributed"] = False
    session.goals = [
        incoming if goal["id"] == goal_id else goal for goal in session.goals
    ]
    core.save_goals(session.goals)
    core.save_tasks(session.kanban_tasks)
    core.schedule_autosync()
    await ws.send_json({"type": "goal_sync", "goals": session.goals})
    await ws.send_json({"type": "kanban_sync", "tasks": session.kanban_tasks})


async def _handle_goal_delete(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    goal_id = data["goalId"]
    session.goals = [goal for goal in session.goals if goal["id"] != goal_id]
    for task in session.kanban_tasks:
        if task.get("goalId") == goal_id:
            task["goalId"] = ""
            task["kpiId"] = ""
            task["kpiContributed"] = False
    core.save_goals(session.goals)
    core.save_tasks(session.kanban_tasks)
    core.schedule_autosync()
    await ws.send_json({"type": "goal_sync", "goals": session.goals})
    await ws.send_json({"type": "kanban_sync", "tasks": session.kanban_tasks})


async def _handle_clear_session(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    await _disconnect_client(session)
    await ws.send_json({"type": "session_cleared"})


async def _handle_profile_update(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    session.profile = data.get("profile", dict(core.DEFAULT_PROFILE))
    core.save_profile(session.profile)
    core.schedule_autosync()
    await ws.send_json({"type": "profile_sync", "profile": session.profile})


async def _handle_github_status_request(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    await ws.send_json(await core._build_github_status())


async def _handle_github_list_repos(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    try:
        repos = await asyncio.to_thread(github_sync.gh_list_repos)
        await ws.send_json({"type": "github_repo_list", "repos": repos})
    except github_sync.GitHubSyncError as e:
        core.github_state["lastError"] = str(e)
        await ws.send_json(await core._build_github_status())


async def _handle_github_link(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    asyncio.create_task(
        core._do_link(
            owner=data.get("owner"),
            name=data.get("name", ""),
            create=bool(data.get("create")),
            private=bool(data.get("private", True)),
        )
    )


async def _handle_github_unlink(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    asyncio.create_task(core._do_unlink())


async def _handle_github_sync_now(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    asyncio.create_task(core._do_push("manual sync"))


async def _handle_github_pull_now(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    asyncio.create_task(core._do_pull())


async def _handle_github_set_auto_sync(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    cfg = core._load_github_config()
    cfg["autoSync"] = bool(data.get("value", True))
    core._save_github_config(cfg)
    await core.broadcast(await core._build_github_status())


async def _handle_github_list_commits(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    try:
        commits = await asyncio.to_thread(github_sync.git_log, core.REPO_DIR, 30)
        await ws.send_json({"type": "github_commit_list", "commits": commits})
    except github_sync.GitHubSyncError as e:
        core.github_state["lastError"] = str(e)
        await ws.send_json(await core._build_github_status())


async def _handle_github_commit_diff(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    commit_hash = data.get("hash", "")
    if not commit_hash:
        return
    try:
        diff = await asyncio.to_thread(core._compute_commit_diff, commit_hash)
        await ws.send_json(
            {
                "type": "github_commit_diff_result",
                "hash": commit_hash,
                "summary": diff["summary"],
                "details": diff["details"],
                "error": None,
            }
        )
    except github_sync.GitHubSyncError as e:
        await ws.send_json(
            {
                "type": "github_commit_diff_result",
                "hash": commit_hash,
                "summary": None,
                "details": None,
                "error": str(e),
            }
        )


async def _handle_github_restore_commit(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    commit_hash = data.get("hash", "")
    if commit_hash:
        asyncio.create_task(core._do_restore(commit_hash))


async def _handle_ai_config_update(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    normalized = core.save_ai_config(data.get("config", {}))
    await _disconnect_client(session)
    await core.broadcast({"type": "ai_config_sync", "config": normalized})


async def _handle_life_activity_upsert(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    incoming = data.get("activity", {}) or {}
    activities = core.load_life_activities()
    normalized = core._normalize_life_activity(incoming)
    replaced = False
    for index, activity in enumerate(activities):
        if activity["id"] == normalized["id"]:
            activities[index] = normalized
            replaced = True
            break
    if not replaced:
        activities.append(normalized)
    core.save_life_activities(activities)
    core.schedule_autosync()
    await core.broadcast({"type": "life_activity_sync", "activities": activities})


async def _handle_life_activity_archive(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    activity_id = data.get("id", "")
    if not activity_id:
        return
    activities = core.load_life_activities()
    for activity in activities:
        if activity["id"] == activity_id:
            activity["archived"] = True
            break
    core.save_life_activities(activities)
    core.schedule_autosync()
    await core.broadcast({"type": "life_activity_sync", "activities": activities})


async def _handle_life_activity_delete(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    activity_id = data.get("id", "")
    if not activity_id:
        return
    activities = [
        activity
        for activity in core.load_life_activities()
        if activity["id"] != activity_id
    ]
    core.save_life_activities(activities)
    core.schedule_autosync()
    await core.broadcast({"type": "life_activity_sync", "activities": activities})


async def _handle_life_activity_reorder(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    ids = data.get("ids", []) or []
    activities = core.load_life_activities()
    activity_map = {activity["id"]: activity for activity in activities}
    seen: set[str] = set()
    ordered: list[dict[str, Any]] = []
    for activity_id in ids:
        if activity_id in activity_map and activity_id not in seen:
            ordered.append(activity_map[activity_id])
            seen.add(activity_id)
    for activity in activities:
        if activity["id"] not in seen:
            ordered.append(activity)
    core.save_life_activities(ordered)
    core.schedule_autosync()
    await core.broadcast({"type": "life_activity_sync", "activities": ordered})


async def _handle_life_log_start(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    activity_id = data.get("activity_id") or data.get("activityId", "")
    if not activity_id:
        return
    core._stop_task_timers_if_running(session.kanban_tasks)
    core.save_tasks(session.kanban_tasks)
    quota_stopped = core._stop_active_quota_log_if_any()
    log = core.start_life_log(activity_id)
    core.schedule_autosync()
    await core.broadcast({"type": "kanban_sync", "tasks": session.kanban_tasks})
    await core.broadcast({"type": "life_log_sync", "logs": core.load_today_life_logs()})
    await core.broadcast({"type": "life_log_started", "log": log})
    if quota_stopped:
        await core.broadcast(
            {"type": "quota_log_sync", "logs": core.load_today_quota_logs()}
        )
        await core.broadcast(
            {
                "type": "quota_streak_sync",
                "streaks": core.compute_all_quota_streaks(
                    core.load_quotas(), core.load_all_quota_logs()
                ),
            }
        )


async def _handle_life_log_stop(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    log_id = data.get("log_id") or data.get("logId", "")
    memo = data.get("memo")
    if not log_id:
        return
    stopped = core.stop_life_log(log_id, memo)
    core.schedule_autosync()
    await core.broadcast({"type": "life_log_sync", "logs": core.load_today_life_logs()})
    if stopped:
        await core.broadcast({"type": "life_log_stopped", "log": stopped})


async def _handle_life_log_delete(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    log_id = data.get("log_id") or data.get("logId", "")
    if not log_id:
        return
    core.delete_life_log(log_id)
    core.schedule_autosync()
    await core.broadcast({"type": "life_log_sync", "logs": core.load_today_life_logs()})


async def _handle_life_log_range_request(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    request_id = str(data.get("requestId", ""))
    start_iso = str(data.get("startIso", ""))
    end_iso = str(data.get("endIso", ""))
    logs = (
        core.load_life_logs_in_range(start_iso, end_iso)
        if start_iso and end_iso
        else []
    )
    await ws.send_json(
        {"type": "life_log_range_sync", "requestId": request_id, "logs": logs}
    )


async def _handle_quota_log_range_request(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    request_id = str(data.get("requestId", ""))
    start_iso = str(data.get("startIso", ""))
    end_iso = str(data.get("endIso", ""))
    logs = (
        core.load_quota_logs_in_range(start_iso, end_iso)
        if start_iso and end_iso
        else []
    )
    await ws.send_json(
        {"type": "quota_log_range_sync", "requestId": request_id, "logs": logs}
    )


async def _handle_quota_upsert(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    incoming = data.get("quota", {}) or {}
    normalized = core._normalize_quota(incoming)
    quotas = core.load_quotas()
    found = False
    for index, quota in enumerate(quotas):
        if quota["id"] == normalized["id"]:
            quotas[index] = normalized
            found = True
            break
    if not found:
        quotas.append(normalized)
    core.save_quotas(quotas)
    core.schedule_autosync()
    await core.broadcast({"type": "quota_sync", "quotas": quotas})
    await core.broadcast(
        {
            "type": "quota_streak_sync",
            "streaks": core.compute_all_quota_streaks(
                quotas, core.load_all_quota_logs()
            ),
        }
    )


async def _handle_quota_delete(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    quota_id = data.get("id", "")
    if not quota_id:
        return
    quotas = [quota for quota in core.load_quotas() if quota["id"] != quota_id]
    core.save_quotas(quotas)
    with core._db() as conn:
        conn.execute("DELETE FROM quota_logs WHERE quota_id = ?", (quota_id,))
    core.schedule_autosync()
    await core.broadcast({"type": "quota_sync", "quotas": quotas})
    await core.broadcast({"type": "quota_log_sync", "logs": core.load_today_quota_logs()})
    await core.broadcast(
        {
            "type": "quota_streak_sync",
            "streaks": core.compute_all_quota_streaks(
                quotas, core.load_all_quota_logs()
            ),
        }
    )


async def _handle_quota_reorder(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    ids = data.get("ids", []) or []
    quotas = core.load_quotas()
    quota_map = {quota["id"]: quota for quota in quotas}
    seen: set[str] = set()
    ordered: list[dict[str, Any]] = []
    for quota_id in ids:
        if quota_id in quota_map and quota_id not in seen:
            ordered.append(quota_map[quota_id])
            seen.add(quota_id)
    for quota in quotas:
        if quota["id"] not in seen:
            ordered.append(quota)
    core.save_quotas(ordered)
    core.schedule_autosync()
    await core.broadcast({"type": "quota_sync", "quotas": ordered})


async def _handle_quota_log_start(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    quota_id = data.get("quota_id") or data.get("quotaId", "")
    if not quota_id:
        return
    core._stop_task_timers_if_running(session.kanban_tasks)
    core.save_tasks(session.kanban_tasks)
    life_stopped = core._stop_active_life_log_if_any()
    log = core.start_quota_log(quota_id)
    core.schedule_autosync()
    await core.broadcast({"type": "kanban_sync", "tasks": session.kanban_tasks})
    if life_stopped:
        await core.broadcast(
            {"type": "life_log_sync", "logs": core.load_today_life_logs()}
        )
    await core.broadcast({"type": "quota_log_sync", "logs": core.load_today_quota_logs()})
    await core.broadcast({"type": "quota_log_started", "log": log})
    await core.broadcast(
        {
            "type": "quota_streak_sync",
            "streaks": core.compute_all_quota_streaks(
                core.load_quotas(), core.load_all_quota_logs()
            ),
        }
    )


async def _handle_quota_log_stop(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    log_id = data.get("log_id") or data.get("logId", "")
    memo = data.get("memo")
    if not log_id:
        return
    stopped = core.stop_quota_log(log_id, memo)
    core.schedule_autosync()
    await core.broadcast({"type": "quota_log_sync", "logs": core.load_today_quota_logs()})
    if stopped:
        await core.broadcast({"type": "quota_log_stopped", "log": stopped})
    await core.broadcast(
        {
            "type": "quota_streak_sync",
            "streaks": core.compute_all_quota_streaks(
                core.load_quotas(), core.load_all_quota_logs()
            ),
        }
    )


async def _handle_retro_list(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    await ws.send_json({"type": "retro_list_sync", "retros": core.load_retros()})


async def _handle_retro_discard_draft(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    draft_id = data.get("draftId", "")
    if draft_id:
        session.pending_retros.pop(draft_id, None)
        core.delete_retro(draft_id)
        core.schedule_autosync()
    await ws.send_json({"type": "retro_list_sync", "retros": core.load_retros()})


async def _handle_retro_delete(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    retro_id = data.get("retroId", "")
    if retro_id:
        session.pending_retros.pop(retro_id, None)
        core.delete_retro(retro_id)
        core.schedule_autosync()
    await core.broadcast({"type": "retro_list_sync", "retros": core.load_retros()})


async def _handle_retro_start(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    retro_type = data.get("retroType", "weekly")
    if retro_type not in server_retro.RETRO_TYPES:
        retro_type = "weekly"
    resume_id = data.get("resumeDraftId") or None
    anchor_raw = (data.get("anchorDate") or "").strip()
    anchor_date: datetime.date | None = None
    if anchor_raw:
        try:
            anchor_date = datetime.date.fromisoformat(anchor_raw)
        except ValueError:
            anchor_date = None

    retro_entry: dict[str, Any] | None = None
    if resume_id:
        retro_entry = core.get_retro(resume_id)
        if retro_entry and retro_entry.get("completedAt"):
            retro_entry = None
    if retro_entry is None:
        period_start, period_end = server_retro._compute_retro_period(retro_type, anchor_date)
        now_iso = datetime.datetime.now().isoformat(timespec="seconds")
        welcome = server_retro._retro_welcome_text(retro_type, period_start, period_end)
        retro_entry = {
            "id": f"{core._short_id()}{core._short_id()}",
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
            "messages": [{"role": "assistant", "text": welcome}],
            "aiComment": "",
            "completedAt": "",
            "createdAt": now_iso,
            "updatedAt": now_iso,
        }
        session.pending_retros[retro_entry["id"]] = retro_entry
    await ws.send_json({"type": "retro_sync", "retro": retro_entry})


async def _handle_retro_message(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    retro_id = data.get("retroId", "")
    user_text = (data.get("text", "") or "").strip()
    if not retro_id or not user_text:
        return
    retro_entry = core.get_retro(retro_id) or session.pending_retros.get(retro_id)
    if retro_entry is None or retro_entry.get("completedAt"):
        await ws.send_json(
            {"type": "retro_error", "message": "セッションが見つかりません"}
        )
        return
    await ws.send_json({"type": "retro_session_waiting", "waiting": True})
    try:
        updated = await server_retro.run_retro_turn(
            ws,
            retro_entry,
            user_text,
            session.kanban_tasks,
            session.goals,
            session.profile,
        )
        persisted = core.get_retro(retro_id) is not None
        if persisted:
            session.pending_retros.pop(retro_id, None)
            await ws.send_json({"type": "retro_list_sync", "retros": core.load_retros()})
        else:
            session.pending_retros[retro_id] = updated
    except Exception as e:
        print(f"retro turn error: {e}")
        await ws.send_json(
            {
                "type": "retro_error",
                "message": f"AI応答中にエラーが発生しました: {e}",
            }
        )
    finally:
        await ws.send_json({"type": "retro_session_waiting", "waiting": False})


async def _handle_retro_complete(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    retro_id = data.get("retroId", "")
    retro_entry = core.get_retro(retro_id) or session.pending_retros.get(retro_id)
    if retro_entry is None:
        await ws.send_json(
            {"type": "retro_error", "message": "セッションが見つかりません"}
        )
        return
    if retro_entry.get("completedAt"):
        await ws.send_json({"type": "retro_completed", "retro": retro_entry})
        return
    await ws.send_json({"type": "retro_session_waiting", "waiting": True})
    try:
        await server_retro.finalize_retro(
            ws,
            retro_entry,
            session.kanban_tasks,
            session.goals,
            session.profile,
        )
        session.pending_retros.pop(retro_id, None)
        await ws.send_json({"type": "retro_list_sync", "retros": core.load_retros()})
    except Exception as e:
        print(f"retro complete error: {e}")
        await ws.send_json(
            {
                "type": "retro_error",
                "message": f"完了処理中にエラーが発生しました: {e}",
            }
        )
    finally:
        await ws.send_json({"type": "retro_session_waiting", "waiting": False})


async def _handle_retro_reopen(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    retro_id = data.get("retroId", "")
    retro_entry = core.get_retro(retro_id)
    if retro_entry is None or not retro_entry.get("completedAt"):
        await ws.send_json(
            {
                "type": "retro_error",
                "message": "完了済みの振り返りが見つかりません",
            }
        )
        return
    now_iso = datetime.datetime.now().isoformat(timespec="seconds")
    reopened = dict(retro_entry)
    reopened["completedAt"] = ""
    reopened["aiComment"] = ""
    reopened["messages"] = []
    reopened["updatedAt"] = now_iso
    core.save_retro(reopened)
    core.schedule_autosync()
    await ws.send_json({"type": "retro_sync", "retro": reopened})
    await ws.send_json({"type": "retro_session_waiting", "waiting": True})
    try:
        reopened = await server_retro.run_retro_reopen_greeting(
            ws,
            reopened,
            session.kanban_tasks,
            session.goals,
            session.profile,
        )
        await core.broadcast({"type": "retro_list_sync", "retros": core.load_retros()})
    except Exception as e:
        print(f"retro reopen greeting error: {e}")
        await ws.send_json(
            {
                "type": "retro_error",
                "message": f"再開時の挨拶生成中にエラーが発生しました: {e}",
            }
        )
    finally:
        await ws.send_json({"type": "retro_session_waiting", "waiting": False})


async def _handle_retro_edit_document(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    retro_id = data.get("retroId", "")
    if not retro_id:
        return
    retro_entry = core.get_retro(retro_id) or session.pending_retros.get(retro_id)
    if retro_entry is None:
        await ws.send_json(
            {"type": "retro_error", "message": "セッションが見つかりません"}
        )
        return

    updated = dict(retro_entry)
    updated["document"] = dict(updated.get("document", {}))

    doc_update = data.get("document")
    if isinstance(doc_update, dict):
        for key in server_retro.RETRO_DOC_TEXT_KEYS:
            if key in doc_update and isinstance(doc_update[key], str):
                updated["document"][key] = doc_update[key]
        if "dayRating" in doc_update:
            event_value = doc_update.get("dayRating")
            if isinstance(event_value, (int, float)):
                int_value = int(event_value)
                if 0 <= int_value <= 10:
                    updated["document"]["dayRating"] = int_value
        for key in server_retro.RETRO_DOC_TIME_KEYS:
            if key not in doc_update:
                continue
            time_value = doc_update.get(key)
            if not isinstance(time_value, str):
                continue
            stripped = time_value.strip()
            if stripped == "" or server_retro._is_valid_hhmm(stripped):
                updated["document"][key] = stripped

    ai_comment_update = data.get("aiComment")
    if isinstance(ai_comment_update, str):
        updated["aiComment"] = ai_comment_update

    updated["updatedAt"] = datetime.datetime.now().isoformat(timespec="seconds")

    doc_for_check = updated["document"]
    has_content = (
        any((doc_for_check.get(key) or "").strip() for key in server_retro.RETRO_DOC_TEXT_KEYS)
        or bool(doc_for_check.get("dayRating"))
        or any((doc_for_check.get(key) or "").strip() for key in server_retro.RETRO_DOC_TIME_KEYS)
        or bool((updated.get("aiComment") or "").strip())
    )
    was_persisted = core.get_retro(retro_id) is not None

    if has_content:
        core.save_retro(updated)
        session.pending_retros.pop(retro_id, None)
        core.schedule_autosync()
    elif was_persisted:
        core.delete_retro(retro_id)
        session.pending_retros[retro_id] = updated
        core.schedule_autosync()
    else:
        session.pending_retros[retro_id] = updated

    await core.broadcast({"type": "retro_list_sync", "retros": core.load_retros()})
    await ws.send_json({"type": "retro_sync", "retro": updated})


async def _handle_retro_close_session(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    await ws.send_json({"type": "retro_session_closed"})


async def _handle_message(
    ws: WebSocket, session: SessionState, data: dict[str, Any]
) -> None:
    async def can_use_tool(
        tool_name: str,
        tool_input: dict[str, Any],
        context: ToolPermissionContext,
    ) -> PermissionResultAllow | PermissionResultDeny:
        if tool_name == "AskUserQuestion":
            return await core.handle_ask_user_via_ws(ws, tool_input)
        if tool_name == "Bash":
            cfg = core.load_ai_config()
            command = tool_input.get("command", "")
            if not core._is_bash_command_allowed(
                command, allow_gh_api=bool(cfg.get("allowGhApi", False))
            ):
                return PermissionResultDeny(
                    message=(
                        "この Bash コマンドは allowlist に含まれていません: "
                        f"{command!r}"
                    )
                )
        return PermissionResultAllow(updated_input=tool_input)

    if session.client is None:
        board_ctx = core.build_board_context(session.kanban_tasks, session.goals)
        profile_ctx = core.build_profile_context(session.profile)
        prompt_append = core.SYSTEM_PROMPT_APPEND.format(
            today=datetime.date.today().isoformat(),
            profile_context=profile_ctx,
            board_context=board_ctx,
        )
        ai_cfg = core.load_ai_config()
        resolved_model, betas = core._resolve_ai_model(ai_cfg)
        options = ClaudeAgentOptions(
            model=resolved_model,
            betas=betas,
            cwd=str(Path(__file__).parent),
            system_prompt={
                "type": "preset",
                "preset": "claude_code",
                "append": prompt_append,
            },
            include_partial_messages=True,
            can_use_tool=can_use_tool,
            permission_mode="acceptEdits",
            thinking={
                "type": "enabled",
                "budget_tokens": core._resolve_thinking_budget(ai_cfg),
            },
            allowed_tools=ai_cfg["allowedTools"],
        )
        session.client = ClaudeSDKClient(options=options)
        await session.client.connect()

    board_ctx = core.build_board_context(session.kanban_tasks, session.goals)
    profile_ctx = core.build_profile_context(session.profile)
    user_msg = data.get("message", "")
    full_msg = f"{user_msg}\n\n---\n{profile_ctx}\n\n{board_ctx}"

    await session.client.query(full_msg)

    result_sent = False
    try:
        async for msg in session.client.receive_response():
            if isinstance(msg, StreamEvent):
                event = msg.event
                if event.get("type") == "content_block_delta":
                    delta = event.get("delta", {})
                    if delta.get("type") == "text_delta":
                        await ws.send_json({"type": "stream_delta", "text": delta["text"]})
                    elif delta.get("type") == "thinking_delta":
                        await ws.send_json(
                            {
                                "type": "thinking_delta",
                                "text": delta.get("thinking", ""),
                            }
                        )
            elif isinstance(msg, AssistantMessage):
                text_parts: list[str] = []
                for block in msg.content:
                    if isinstance(block, TextBlock):
                        text_parts.append(block.text)
                    elif isinstance(block, ThinkingBlock):
                        pass
                    elif isinstance(block, ToolUseBlock):
                        await ws.send_json(
                            {"type": "tool_use", "name": block.name, "input": block.input}
                        )
                        if block.name == "TodoWrite":
                            todos = block.input.get("todos", [])
                            session.kanban_tasks = core.load_tasks()
                            session.goals = core.load_goals()
                            session.profile = core.load_profile()
                            current_profile = session.profile
                            (
                                session.kanban_tasks,
                                session.goals,
                                new_profile,
                            ) = core.process_todos(
                                todos,
                                session.kanban_tasks,
                                session.goals,
                                current_profile,
                            )
                            core.save_tasks(session.kanban_tasks)
                            core.save_goals(session.goals)
                            profile_changed = new_profile != current_profile
                            if profile_changed:
                                session.profile = new_profile
                                core.save_profile(session.profile)
                            core.schedule_autosync()
                            await ws.send_json(
                                {"type": "kanban_sync", "tasks": session.kanban_tasks}
                            )
                            await ws.send_json(
                                {"type": "goal_sync", "goals": session.goals}
                            )
                            if profile_changed:
                                await ws.send_json(
                                    {"type": "profile_sync", "profile": session.profile}
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


MESSAGE_HANDLERS: dict[str, Handler] = {
    "kanban_move": _handle_kanban_move,
    "kanban_add": _handle_kanban_add,
    "kanban_delete": _handle_kanban_delete,
    "kanban_reorder": _handle_kanban_reorder,
    "kanban_edit": _handle_kanban_edit,
    "goal_add": _handle_goal_add,
    "goal_edit": _handle_goal_edit,
    "goal_delete": _handle_goal_delete,
    "clear_session": _handle_clear_session,
    "profile_update": _handle_profile_update,
    "github_status_request": _handle_github_status_request,
    "github_list_repos": _handle_github_list_repos,
    "github_link": _handle_github_link,
    "github_unlink": _handle_github_unlink,
    "github_sync_now": _handle_github_sync_now,
    "github_pull_now": _handle_github_pull_now,
    "github_set_auto_sync": _handle_github_set_auto_sync,
    "github_list_commits": _handle_github_list_commits,
    "github_commit_diff": _handle_github_commit_diff,
    "github_restore_commit": _handle_github_restore_commit,
    "ai_config_update": _handle_ai_config_update,
    "life_activity_upsert": _handle_life_activity_upsert,
    "life_activity_archive": _handle_life_activity_archive,
    "life_activity_delete": _handle_life_activity_delete,
    "life_activity_reorder": _handle_life_activity_reorder,
    "life_log_start": _handle_life_log_start,
    "life_log_stop": _handle_life_log_stop,
    "life_log_delete": _handle_life_log_delete,
    "life_log_range_request": _handle_life_log_range_request,
    "quota_log_range_request": _handle_quota_log_range_request,
    "quota_upsert": _handle_quota_upsert,
    "quota_delete": _handle_quota_delete,
    "quota_reorder": _handle_quota_reorder,
    "quota_log_start": _handle_quota_log_start,
    "quota_log_stop": _handle_quota_log_stop,
    "retro_list": _handle_retro_list,
    "retro_discard_draft": _handle_retro_discard_draft,
    "retro_delete": _handle_retro_delete,
    "retro_start": _handle_retro_start,
    "retro_message": _handle_retro_message,
    "retro_complete": _handle_retro_complete,
    "retro_reopen": _handle_retro_reopen,
    "retro_edit_document": _handle_retro_edit_document,
    "retro_close_session": _handle_retro_close_session,
    "message": _handle_message,
}


async def websocket_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    active_sockets.add(ws)
    session = _load_session_state()
    await _send_initial_state(ws, session)

    msg_queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    async def ws_reader() -> None:
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
                    await _interrupt_client(session)
                elif msg_type == "clear_session":
                    await _interrupt_client(session)
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
            await _reload_session_if_needed(ws, session)
            handler = MESSAGE_HANDLERS.get(data.get("type", ""))
            if handler is not None:
                await handler(ws, session, data)
    except WebSocketDisconnect:
        pass
    finally:
        active_sockets.discard(ws)
        _ws_needs_reload.pop(ws, None)
        reader_task.cancel()
        await _disconnect_client(session)
