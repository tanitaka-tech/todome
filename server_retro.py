import datetime
import json
from pathlib import Path
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    ResultMessage,
    StreamEvent,
    TextBlock,
)
from fastapi import WebSocket

import server as core
from server_state import GoalData, KanbanTask, ProfileData, RetrospectiveData


RETRO_TYPES = ("daily", "weekly", "monthly", "yearly")

RETRO_TYPE_LABEL = {
    "daily": "日次振り返り",
    "weekly": "週次振り返り",
    "monthly": "月次振り返り",
    "yearly": "年次振り返り",
}

RETRO_DOC_TAG_OPEN = "<retrodoc>"
RETRO_DOC_TAG_CLOSE = "</retrodoc>"

RETRO_DOC_TEXT_KEYS = ("did", "learned", "next")
RETRO_DOC_TIME_KEYS = ("wakeUpTime", "bedtime")


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
    profile_ctx = core.build_profile_context(profile)
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
        model=core.load_ai_config()["model"],
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
        core.save_retro(new_retro)
        core.schedule_autosync()
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
        model=core.load_ai_config()["model"],
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
    core.save_retro(new_retro)
    core.schedule_autosync()
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
    profile_ctx = core.build_profile_context(profile)
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
        model=core.load_ai_config()["model"],
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
    core.save_retro(new_retro)
    core.schedule_autosync()

    await ws.send_json({"type": "retro_assistant", "text": ai_comment})
    await ws.send_json({"type": "retro_completed", "retro": new_retro})
    return new_retro
