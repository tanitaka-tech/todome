"""todome — FastAPI + WebSocket バックエンド

起動方法:
  uv run uvicorn server:app --host 0.0.0.0 --port 3002 --reload
"""

import asyncio
import datetime
import json
import os
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

load_dotenv()
app = FastAPI()

pending_approvals: dict[str, asyncio.Future] = {}


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


# --- SQLite storage ---
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = DATA_DIR / "todome.db"


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
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
            """
        )


def load_tasks() -> list[KanbanTask]:
    with _db() as conn:
        rows = conn.execute(
            "SELECT data FROM kanban_tasks ORDER BY sort_order"
        ).fetchall()
    return [json.loads(r["data"]) for r in rows]


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


init_db()


def _short_id() -> str:
    return str(uuid.uuid4())[:8]


def _ensure_kpi_ids(kpis: list[dict]) -> list[dict]:
    """KPI に id とデフォルト値を付与する。"""
    for kpi in kpis:
        if not kpi.get("id"):
            kpi["id"] = _short_id()
        unit = kpi.get("unit")
        if unit not in ("number", "percent"):
            kpi["unit"] = "number"
        try:
            kpi["targetValue"] = max(0, int(round(float(kpi.get("targetValue", 0) or 0))))
        except (TypeError, ValueError):
            kpi["targetValue"] = 0
        try:
            kpi["currentValue"] = max(0, int(round(float(kpi.get("currentValue", 0) or 0))))
        except (TypeError, ValueError):
            kpi["currentValue"] = 0
        kpi.pop("value", None)
    return kpis


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


def process_todos(
    todos: list[dict],
    existing_tasks: list[KanbanTask],
    existing_goals: list[GoalData],
) -> tuple[list[KanbanTask], list[GoalData]]:
    """TodoWrite 出力をパースし、タスクと目標操作に分離する。

    content が GOAL_ADD: / GOAL_UPDATE: で始まるエントリは目標操作として処理し、
    それ以外は通常のカンバンタスクに変換する。
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

    for todo in todos:
        content = todo.get("content", "")

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

        if title in existing_task_map:
            task = existing_task_map[title].copy()
            task["column"] = status_to_column.get(status, "todo")
            task["priority"] = priority
        else:
            task = {
                "id": _short_id(),
                "title": title,
                "description": "",
                "column": status_to_column.get(status, "todo"),
                "priority": priority,
                "memo": "",
                "goalId": "",
                "estimatedMinutes": 0,
                "timeSpent": 0,
                "timerStartedAt": "",
                "completedAt": "",
                "timeLogs": [],
            }
        tasks.append(task)

    return tasks, goals


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
        lines.append("\nバランスホイール（理想の状態）:")
        for cat in bw:
            ideals = [i["text"] for i in cat.get("ideals", []) if i.get("text")]
            if ideals:
                lines.append(f"  【{cat['name']}】")
                for ideal in ideals:
                    lines.append(f"    - {ideal}")

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

ユーザーは「自分について」でプロフィールを定義しています。
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
- TodoWrite を呼ぶ際は既存タスクも含めて全タスクリストを渡すこと

## 目標操作 (TodoWrite の特殊エントリ)
目標を追加・更新するには、同じ TodoWrite の todos 配列に特殊エントリを含める。
これらは目標として処理され、カンバンボードには表示されない。

### KPI の形式
各 KPI は以下のフィールドを持つ:
- name: KPI名 (必須)
- unit: "number" または "percent"
- targetValue: 目標値 (数値、0より大)
- currentValue: 現在の値 (数値)
目標には必ず1つ以上の KPI を設定すること。全 KPI が targetValue に到達すると、目標は自動的に達成扱いになる。

### 目標の追加
content を以下の形式にする (status は "completed"):
  GOAL_ADD:{{"name":"目標名","memo":"メモ","kpis":[{{"name":"KPI名","unit":"number","targetValue":1000,"currentValue":0}}],"deadline":"2026-12-31"}}

### 目標の更新
content を以下の形式にする (status は "completed"):
  GOAL_UPDATE:既存の目標名:{{"memo":"新しいメモ","kpis":[{{"name":"KPI名","unit":"percent","targetValue":80,"currentValue":40}}]}}
更新では変更したいフィールドだけ含めればよい。KPI の currentValue を更新することで進捗を反映できる。

### 例: タスク追加と目標追加を同時に行う
TodoWrite の todos:
  [{{"content":"[HIGH] 企画書を作成","status":"pending"}},{{"content":"GOAL_ADD:{{\\\"name\\\":\\\"Q3売上目標\\\",\\\"memo\\\":\\\"前年比120%\\\",\\\"kpis\\\":[{{\\\"name\\\":\\\"月間売上(万円)\\\",\\\"unit\\\":\\\"number\\\",\\\"targetValue\\\":1000,\\\"currentValue\\\":0}}],\\\"deadline\\\":\\\"2026-09-30\\\"}}","status":"completed"}}]

## 制約
- AskUserQuestion: 質問は最大4つ、各質問の選択肢は2〜4個まで
- 今日の日付: {today}

{profile_context}

{board_context}"""


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    client: ClaudeSDKClient | None = None
    kanban_tasks: list[KanbanTask] = load_tasks()
    goals: list[GoalData] = load_goals()
    profile: ProfileData = load_profile()

    await ws.send_json({"type": "kanban_sync", "tasks": kanban_tasks})
    await ws.send_json({"type": "goal_sync", "goals": goals})
    await ws.send_json({"type": "profile_sync", "profile": profile})

    msg_queue: asyncio.Queue = asyncio.Queue()

    async def ws_reader():
        try:
            while True:
                raw = await ws.receive_text()
                data = json.loads(raw)
                if data["type"] == "ask_response":
                    request_id = data.get("requestId", "")
                    if request_id in pending_approvals:
                        pending_approvals[request_id].set_result(data)
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
                        t["column"] = data["column"]
                        for key in (
                            "timeSpent",
                            "timerStartedAt",
                            "completedAt",
                            "timeLogs",
                        ):
                            if key in data:
                                t[key] = data[key]
                        break
                save_tasks(kanban_tasks)
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
                    "estimatedMinutes": data.get("estimatedMinutes", 0),
                    "timeSpent": 0,
                    "timerStartedAt": "",
                    "completedAt": "",
                    "timeLogs": [],
                }
                kanban_tasks.append(new_task)
                save_tasks(kanban_tasks)
                await ws.send_json(
                    {"type": "kanban_sync", "tasks": kanban_tasks}
                )
                continue

            if data["type"] == "kanban_delete":
                kanban_tasks = [
                    t for t in kanban_tasks if t["id"] != data["taskId"]
                ]
                save_tasks(kanban_tasks)
                await ws.send_json(
                    {"type": "kanban_sync", "tasks": kanban_tasks}
                )
                continue

            if data["type"] == "kanban_edit":
                task_id = data["taskId"]
                for t in kanban_tasks:
                    if t["id"] == task_id:
                        for key in (
                            "title",
                            "description",
                            "priority",
                            "memo",
                            "goalId",
                            "estimatedMinutes",
                            "timeSpent",
                            "timerStartedAt",
                            "completedAt",
                            "timeLogs",
                        ):
                            if key in data:
                                t[key] = data[key]
                        break
                save_tasks(kanban_tasks)
                await ws.send_json(
                    {"type": "kanban_sync", "tasks": kanban_tasks}
                )
                continue

            # --- 目標操作 (クライアント直接) ---
            if data["type"] == "goal_add":
                goal = data.get("goal", {})
                if not goal.get("id"):
                    goal["id"] = _short_id()
                goal["kpis"] = _ensure_kpi_ids(goal.get("kpis", []))
                goal.setdefault("achieved", False)
                goal.setdefault("achievedAt", "")
                _sync_goal_achievement(goal)
                goals.append(goal)
                save_goals(goals)
                await ws.send_json({"type": "goal_sync", "goals": goals})
                continue

            if data["type"] == "goal_edit":
                incoming = data.get("goal", {})
                incoming["kpis"] = _ensure_kpi_ids(
                    incoming.get("kpis", [])
                )
                _sync_goal_achievement(incoming)
                goals = [
                    incoming if g["id"] == incoming.get("id") else g
                    for g in goals
                ]
                save_goals(goals)
                await ws.send_json({"type": "goal_sync", "goals": goals})
                continue

            if data["type"] == "goal_delete":
                goal_id = data["goalId"]
                goals = [g for g in goals if g["id"] != goal_id]
                for t in kanban_tasks:
                    if t.get("goalId") == goal_id:
                        t["goalId"] = ""
                save_goals(goals)
                save_tasks(kanban_tasks)
                await ws.send_json({"type": "goal_sync", "goals": goals})
                await ws.send_json(
                    {"type": "kanban_sync", "tasks": kanban_tasks}
                )
                continue

            # --- プロフィール更新 ---
            if data["type"] == "profile_update":
                profile = data.get("profile", dict(DEFAULT_PROFILE))
                save_profile(profile)
                await ws.send_json(
                    {"type": "profile_sync", "profile": profile}
                )
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
                        system_prompt={
                            "type": "preset",
                            "preset": "claude_code",
                            "append": prompt_append,
                        },
                        include_partial_messages=True,
                        can_use_tool=can_use_tool,
                        permission_mode="acceptEdits",
                        thinking={"type": "enabled", "budget_tokens": 10000},
                        allowed_tools=["TodoWrite"],
                    )
                    client = ClaudeSDKClient(options=options)
                    await client.connect()

                board_ctx = build_board_context(kanban_tasks, goals)
                profile_ctx = build_profile_context(profile)
                user_msg = data.get("message", "")
                full_msg = f"{user_msg}\n\n---\n{profile_ctx}\n\n{board_ctx}"

                await client.query(full_msg)

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
                                input_summary = str(block.input)[:200]
                                await ws.send_json(
                                    {
                                        "type": "tool_use",
                                        "name": block.name,
                                        "input": input_summary,
                                    }
                                )
                                if block.name == "TodoWrite":
                                    todos = block.input.get("todos", [])
                                    kanban_tasks, goals = process_todos(
                                        todos,
                                        kanban_tasks,
                                        goals,
                                    )
                                    save_tasks(kanban_tasks)
                                    save_goals(goals)
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
                        if text_parts:
                            await ws.send_json(
                                {
                                    "type": "assistant",
                                    "text": "".join(text_parts),
                                    "toolCalls": [],
                                }
                            )

                    elif isinstance(msg, ResultMessage):
                        await ws.send_json(
                            {
                                "type": "result",
                                "result": msg.result,
                                "cost": msg.total_cost_usd or 0,
                                "turns": msg.num_turns,
                                "sessionId": msg.session_id,
                            }
                        )

    except WebSocketDisconnect:
        pass
    finally:
        reader_task.cancel()
        if client:
            await client.disconnect()


_client_dist = os.path.join(os.path.dirname(__file__), "client", "dist")
if os.path.isdir(_client_dist):
    app.mount(
        "/", StaticFiles(directory=_client_dist, html=True), name="static"
    )
