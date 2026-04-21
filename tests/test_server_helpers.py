"""server.py の純粋関数のテスト。DB や WebSocket には触れない。"""

import datetime

import pytest

from server import (
    AI_DEFAULT_ALLOWED_TOOLS,
    _apply_kpi_time_delta,
    _compute_retro_period,
    _completed_task_ids_in_period,
    _diff_entities_by_id,
    _diff_profile,
    _ensure_kpi_ids,
    _ensure_task_fields,
    _find_time_kpi,
    _is_bash_command_allowed,
    _is_goal_all_kpis_achieved,
    _is_valid_hhmm,
    _merge_retro_document,
    _migrate_retro_document,
    _normalize_ai_config,
    _normalize_goal_repository,
    _normalize_quota,
    _pick_label,
    _rebalance_kpi_contribution,
    _short_id,
    _strip_retrodoc_block,
    _summarize_diff,
    _sync_goal_achievement,
    apply_profile_update,
    compute_quota_day_totals,
    compute_quota_streak,
    process_todos,
)


class TestShortId:
    def test_returns_8_char_string(self):
        sid = _short_id()
        assert isinstance(sid, str)
        assert len(sid) == 8

    def test_is_unique(self):
        assert _short_id() != _short_id()


class TestEnsureKpiIds:
    def test_assigns_missing_ids(self):
        kpis = [{"name": "売上", "targetValue": 100}]
        result = _ensure_kpi_ids(kpis)
        assert result[0]["id"]

    def test_preserves_existing_ids(self):
        kpis = [{"id": "abc12345", "name": "a", "targetValue": 10}]
        assert _ensure_kpi_ids(kpis)[0]["id"] == "abc12345"

    def test_defaults_invalid_unit_to_number(self):
        kpis = [{"name": "a", "unit": "weird", "targetValue": 1}]
        assert _ensure_kpi_ids(kpis)[0]["unit"] == "number"

    def test_preserves_percent_unit(self):
        kpis = [{"name": "a", "unit": "percent", "targetValue": 100}]
        assert _ensure_kpi_ids(kpis)[0]["unit"] == "percent"

    def test_preserves_time_unit(self):
        kpis = [{"name": "a", "unit": "time", "targetValue": 3600}]
        assert _ensure_kpi_ids(kpis)[0]["unit"] == "time"

    def test_percent_unit_forces_target_to_100(self):
        # percent は常に 100% 固定 (フォームと一貫)
        kpis = [{"name": "a", "unit": "percent", "targetValue": 50}]
        assert _ensure_kpi_ids(kpis)[0]["targetValue"] == 100

    def test_percent_unit_with_missing_target_defaults_to_100(self):
        kpis = [{"name": "a", "unit": "percent"}]
        assert _ensure_kpi_ids(kpis)[0]["targetValue"] == 100

    def test_coerces_non_numeric_to_zero(self):
        kpis = [{"name": "a", "targetValue": "x", "currentValue": None}]
        result = _ensure_kpi_ids(kpis)
        assert result[0]["targetValue"] == 0
        assert result[0]["currentValue"] == 0

    def test_negative_values_clamped_to_zero(self):
        kpis = [{"name": "a", "targetValue": -5, "currentValue": -10}]
        result = _ensure_kpi_ids(kpis)
        assert result[0]["targetValue"] == 0
        assert result[0]["currentValue"] == 0

    def test_drops_legacy_value_key(self):
        kpis = [{"name": "a", "value": 99, "targetValue": 1}]
        assert "value" not in _ensure_kpi_ids(kpis)[0]


class TestIsGoalAllKpisAchieved:
    def test_false_when_no_kpis(self):
        assert _is_goal_all_kpis_achieved({"kpis": []}) is False

    def test_false_when_target_zero(self):
        goal = {"kpis": [{"targetValue": 0, "currentValue": 0}]}
        assert _is_goal_all_kpis_achieved(goal) is False

    def test_false_when_current_below_target(self):
        goal = {"kpis": [{"targetValue": 100, "currentValue": 50}]}
        assert _is_goal_all_kpis_achieved(goal) is False

    def test_true_when_all_met(self):
        goal = {
            "kpis": [
                {"targetValue": 100, "currentValue": 100},
                {"targetValue": 10, "currentValue": 20},
            ]
        }
        assert _is_goal_all_kpis_achieved(goal) is True

    def test_false_when_any_kpi_unmet(self):
        goal = {
            "kpis": [
                {"targetValue": 100, "currentValue": 100},
                {"targetValue": 10, "currentValue": 5},
            ]
        }
        assert _is_goal_all_kpis_achieved(goal) is False


class TestSyncGoalAchievement:
    def test_marks_achieved_and_stamps_time(self):
        goal = {"kpis": [{"targetValue": 1, "currentValue": 1}], "achieved": False}
        result = _sync_goal_achievement(goal)
        assert result["achieved"] is True
        assert result["achievedAt"]

    def test_unmarks_when_target_increases(self):
        goal = {
            "kpis": [{"targetValue": 10, "currentValue": 1}],
            "achieved": True,
            "achievedAt": "2026-01-01T00:00:00",
        }
        result = _sync_goal_achievement(goal)
        assert result["achieved"] is False
        assert result["achievedAt"] == ""

    def test_leaves_already_achieved_untouched(self):
        goal = {
            "kpis": [{"targetValue": 1, "currentValue": 1}],
            "achieved": True,
            "achievedAt": "2026-01-01T00:00:00",
        }
        result = _sync_goal_achievement(goal)
        assert result["achievedAt"] == "2026-01-01T00:00:00"


class TestNormalizeGoalRepository:
    def test_keeps_valid_owner_name(self):
        goal = {"repository": "tanitaka_tech/todome"}
        assert _normalize_goal_repository(goal)["repository"] == "tanitaka_tech/todome"

    def test_trims_surrounding_whitespace(self):
        goal = {"repository": "  owner/repo  "}
        assert _normalize_goal_repository(goal)["repository"] == "owner/repo"

    def test_drops_empty_string(self):
        goal = {"repository": "   ", "name": "x"}
        result = _normalize_goal_repository(goal)
        assert "repository" not in result
        assert result["name"] == "x"

    def test_drops_bad_format(self):
        # スラッシュなしや空白混入は不正扱い
        for bad in ["owner", "owner/", "/repo", "owner/repo/extra", "own er/repo"]:
            goal = {"repository": bad}
            assert "repository" not in _normalize_goal_repository(goal)

    def test_drops_non_string(self):
        goal = {"repository": 123}
        assert "repository" not in _normalize_goal_repository(goal)

    def test_missing_key_is_noop(self):
        goal = {"name": "a"}
        assert _normalize_goal_repository(goal) == {"name": "a"}


class TestNormalizeAIConfig:
    def test_keeps_valid_tools(self):
        cfg = {"allowedTools": ["TodoWrite", "Bash", "Read"]}
        assert _normalize_ai_config(cfg) == {
            "allowedTools": ["TodoWrite", "Bash", "Read"],
            "allowGhApi": False,
            "model": "claude-sonnet-4-6",
            "thinkingEffort": "high",
        }

    def test_drops_unknown_tools(self):
        cfg = {"allowedTools": ["TodoWrite", "Evil", "Bash"]}
        assert _normalize_ai_config(cfg)["allowedTools"] == ["TodoWrite", "Bash"]

    def test_dedupes_tools(self):
        cfg = {"allowedTools": ["Bash", "Bash", "TodoWrite"]}
        assert _normalize_ai_config(cfg)["allowedTools"] == ["Bash", "TodoWrite"]

    def test_empty_list_is_empty(self):
        # 空リストは「全部オフ」を許容する
        assert _normalize_ai_config({"allowedTools": []}) == {
            "allowedTools": [],
            "allowGhApi": False,
            "model": "claude-sonnet-4-6",
            "thinkingEffort": "high",
        }

    def test_missing_key_uses_defaults(self):
        assert _normalize_ai_config({})["allowedTools"] == list(
            AI_DEFAULT_ALLOWED_TOOLS
        )

    def test_non_dict_falls_back_to_defaults(self):
        assert _normalize_ai_config(None)["allowedTools"] == list(
            AI_DEFAULT_ALLOWED_TOOLS
        )
        assert _normalize_ai_config("bogus")["allowedTools"] == list(
            AI_DEFAULT_ALLOWED_TOOLS
        )

    def test_non_string_entries_ignored(self):
        cfg = {"allowedTools": [1, None, "TodoWrite"]}
        assert _normalize_ai_config(cfg)["allowedTools"] == ["TodoWrite"]

    def test_allow_gh_api_defaults_false(self):
        assert _normalize_ai_config({"allowedTools": ["Bash"]})["allowGhApi"] is False

    def test_allow_gh_api_true_preserved(self):
        result = _normalize_ai_config(
            {"allowedTools": ["Bash"], "allowGhApi": True}
        )
        assert result["allowGhApi"] is True

    def test_allow_gh_api_coerced_to_bool(self):
        # 文字列など truthy な値は True に丸める
        result = _normalize_ai_config(
            {"allowedTools": ["Bash"], "allowGhApi": "yes"}
        )
        assert result["allowGhApi"] is True

    def test_model_valid_full_ids_preserved(self):
        for m in (
            "claude-opus-4-7",
            "claude-opus-4-7-1m",
            "claude-sonnet-4-6",
            "claude-haiku-4-5",
        ):
            result = _normalize_ai_config({"allowedTools": ["Bash"], "model": m})
            assert result["model"] == m

    def test_model_legacy_aliases_migrated(self):
        # 旧 ai_config.json に残る "sonnet" / "opus" / "haiku" はフルIDへ移行する
        assert (
            _normalize_ai_config({"allowedTools": ["Bash"], "model": "sonnet"})["model"]
            == "claude-sonnet-4-6"
        )
        assert (
            _normalize_ai_config({"allowedTools": ["Bash"], "model": "opus"})["model"]
            == "claude-opus-4-7"
        )
        assert (
            _normalize_ai_config({"allowedTools": ["Bash"], "model": "haiku"})["model"]
            == "claude-haiku-4-5"
        )

    def test_model_unknown_falls_back_to_default(self):
        result = _normalize_ai_config(
            {"allowedTools": ["Bash"], "model": "gpt-5"}
        )
        assert result["model"] == "claude-sonnet-4-6"

    def test_model_missing_defaults_to_sonnet(self):
        # model キーが欠けていても claude-sonnet-4-6 に倒す
        default = "claude-sonnet-4-6"
        assert _normalize_ai_config({"allowedTools": ["Bash"]})["model"] == default
        assert _normalize_ai_config({})["model"] == default
        assert _normalize_ai_config(None)["model"] == default

    def test_thinking_effort_valid_values_preserved(self):
        for e in ("low", "medium", "high", "veryHigh", "max"):
            result = _normalize_ai_config(
                {"allowedTools": ["Bash"], "thinkingEffort": e}
            )
            assert result["thinkingEffort"] == e

    def test_thinking_effort_unknown_falls_back(self):
        result = _normalize_ai_config(
            {"allowedTools": ["Bash"], "thinkingEffort": "extreme"}
        )
        assert result["thinkingEffort"] == "high"

    def test_thinking_effort_missing_defaults_to_high(self):
        assert (
            _normalize_ai_config({"allowedTools": ["Bash"]})["thinkingEffort"] == "high"
        )
        assert _normalize_ai_config({})["thinkingEffort"] == "high"
        assert _normalize_ai_config(None)["thinkingEffort"] == "high"


class TestIsBashCommandAllowed:
    def test_allows_gh_issue_list(self):
        assert _is_bash_command_allowed(
            "gh issue list -R owner/repo --state open", allow_gh_api=False
        )

    def test_allows_git_log_with_args(self):
        assert _is_bash_command_allowed(
            "git log --oneline -n 5", allow_gh_api=False
        )

    def test_rejects_rm(self):
        assert not _is_bash_command_allowed("rm -rf /", allow_gh_api=False)

    def test_rejects_gh_api_by_default(self):
        assert not _is_bash_command_allowed(
            "gh api /repos/owner/repo", allow_gh_api=False
        )

    def test_allows_gh_api_when_toggle_on(self):
        assert _is_bash_command_allowed(
            "gh api /repos/owner/repo", allow_gh_api=True
        )

    def test_rejects_shell_metacharacters(self):
        assert not _is_bash_command_allowed(
            "gh issue list; rm -rf /", allow_gh_api=False
        )

    def test_rejects_command_substitution(self):
        assert not _is_bash_command_allowed(
            "git log $(whoami)", allow_gh_api=False
        )

    def test_rejects_pipe(self):
        assert not _is_bash_command_allowed(
            "gh issue list | head", allow_gh_api=False
        )

    def test_rejects_redirect(self):
        assert not _is_bash_command_allowed(
            "git log > /tmp/out", allow_gh_api=False
        )

    def test_rejects_empty(self):
        assert not _is_bash_command_allowed("", allow_gh_api=False)
        assert not _is_bash_command_allowed("   ", allow_gh_api=False)

    def test_rejects_non_string(self):
        assert not _is_bash_command_allowed(None, allow_gh_api=False)
        assert not _is_bash_command_allowed(123, allow_gh_api=False)

    def test_rejects_partial_match(self):
        # "gh issue" だけでは許可されない（list/view のどちらも必要）
        assert not _is_bash_command_allowed("gh issue", allow_gh_api=False)

    def test_rejects_unbalanced_quotes(self):
        # shlex が失敗するケース
        assert not _is_bash_command_allowed(
            'gh issue list "unclosed', allow_gh_api=False
        )


class TestComputeRetroPeriod:
    def test_daily_is_single_day(self):
        d = datetime.date(2026, 4, 19)
        assert _compute_retro_period("daily", d) == ("2026-04-19", "2026-04-19")

    def test_weekly_starts_monday(self):
        # 2026-04-19 は日曜 → Mon=04-13, Sun=04-19
        start, end = _compute_retro_period("weekly", datetime.date(2026, 4, 19))
        assert start == "2026-04-13"
        assert end == "2026-04-19"

    def test_monthly_covers_full_month(self):
        start, end = _compute_retro_period("monthly", datetime.date(2026, 2, 10))
        assert start == "2026-02-01"
        assert end == "2026-02-28"

    def test_monthly_december_rolls_year(self):
        start, end = _compute_retro_period("monthly", datetime.date(2026, 12, 5))
        assert start == "2026-12-01"
        assert end == "2026-12-31"

    def test_yearly_covers_full_year(self):
        start, end = _compute_retro_period("yearly", datetime.date(2026, 7, 1))
        assert start == "2026-01-01"
        assert end == "2026-12-31"

    def test_unknown_type_falls_back_to_today(self):
        d = datetime.date(2026, 4, 19)
        assert _compute_retro_period("unknown", d) == ("2026-04-19", "2026-04-19")


class TestCompletedTaskIdsInPeriod:
    def _task(self, tid, column="done", completed_at=""):
        return {"id": tid, "column": column, "completedAt": completed_at}

    def test_picks_up_tasks_in_range(self):
        tasks = [
            self._task("a", completed_at="2026-04-19T10:00:00"),
            self._task("b", completed_at="2026-04-20T10:00:00"),
        ]
        ids = _completed_task_ids_in_period(tasks, "2026-04-19", "2026-04-19")
        assert ids == ["a"]

    def test_ignores_non_done_tasks(self):
        tasks = [self._task("a", column="in_progress", completed_at="2026-04-19T10:00:00")]
        assert _completed_task_ids_in_period(tasks, "2026-04-19", "2026-04-19") == []

    def test_ignores_tasks_without_timestamp(self):
        assert _completed_task_ids_in_period([self._task("a")], "2026-04-19", "2026-04-19") == []

    def test_handles_trailing_z_in_timestamp(self):
        tasks = [self._task("a", completed_at="2026-04-19T10:00:00Z")]
        assert _completed_task_ids_in_period(tasks, "2026-04-19", "2026-04-19") == ["a"]

    def test_invalid_period_returns_empty(self):
        tasks = [self._task("a", completed_at="2026-04-19T10:00:00")]
        assert _completed_task_ids_in_period(tasks, "bogus", "also-bogus") == []


class TestStripRetrodocBlock:
    def test_extracts_and_strips_block(self):
        text = 'お疲れさまでした。<retrodoc>{"did":"x"}</retrodoc> また明日。'
        cleaned, doc = _strip_retrodoc_block(text)
        assert doc == {"did": "x"}
        assert "<retrodoc>" not in cleaned
        assert "お疲れさまでした" in cleaned
        assert "また明日" in cleaned

    def test_returns_none_when_no_block(self):
        cleaned, doc = _strip_retrodoc_block("ただのメッセージ")
        assert doc is None
        assert cleaned == "ただのメッセージ"

    def test_returns_none_on_invalid_json(self):
        cleaned, doc = _strip_retrodoc_block("<retrodoc>not json</retrodoc>")
        assert doc is None

    def test_returns_none_when_payload_is_not_object(self):
        cleaned, doc = _strip_retrodoc_block("<retrodoc>[1,2,3]</retrodoc>")
        assert doc is None


class TestMigrateRetroDocument:
    def test_new_schema_is_untouched(self):
        doc = {"did": "a", "learned": "b", "next": "c", "dayRating": 3}
        result = _migrate_retro_document(doc)
        assert result["did"] == "a"
        assert result["learned"] == "b"
        assert result["next"] == "c"
        assert result["dayRating"] == 3

    def test_legacy_findings_maps_to_learned(self):
        doc = {"findings": "気づき"}
        assert _migrate_retro_document(doc)["learned"] == "気づき"

    def test_legacy_improvements_and_actions_join_into_next(self):
        doc = {"improvements": "A", "idealState": "B", "actions": "C"}
        assert _migrate_retro_document(doc)["next"] == "A\n\nB\n\nC"

    def test_legacy_energy_maps_to_dayrating(self):
        assert _migrate_retro_document({"energy": 4})["dayRating"] == 4

    def test_legacy_keys_removed_after_migration(self):
        doc = {"findings": "x", "improvements": "y", "energy": 3}
        result = _migrate_retro_document(doc)
        for k in ("findings", "improvements", "idealState", "actions", "energy"):
            assert k not in result

    def test_default_sleep_fields_are_empty(self):
        # 旧データに wakeUpTime/bedtime が無くても "" で埋まる
        result = _migrate_retro_document({"did": "x"})
        assert result["wakeUpTime"] == ""
        assert result["bedtime"] == ""


class TestMergeRetroDocument:
    def test_updates_expected_keys(self):
        current = {"did": "old", "learned": "old", "next": ""}
        updates = {"did": "new", "learned": "also new"}
        merged = _merge_retro_document(current, updates)
        assert merged["did"] == "new"
        assert merged["learned"] == "also new"

    def test_preserves_unrelated_fields(self):
        current = {"did": "x", "dayRating": 7}
        merged = _merge_retro_document(current, {"did": "y"})
        assert merged["dayRating"] == 7

    def test_accepts_valid_sleep_times(self):
        merged = _merge_retro_document(
            {}, {"wakeUpTime": "06:30", "bedtime": "23:45"}
        )
        assert merged["wakeUpTime"] == "06:30"
        assert merged["bedtime"] == "23:45"

    def test_accepts_empty_sleep_times_as_clear(self):
        # 空文字は明示的なクリア指示として受け入れる
        merged = _merge_retro_document(
            {"wakeUpTime": "07:00"}, {"wakeUpTime": ""}
        )
        assert merged["wakeUpTime"] == ""

    def test_rejects_invalid_sleep_times(self):
        merged = _merge_retro_document(
            {"wakeUpTime": "06:30"},
            {"wakeUpTime": "25:00", "bedtime": "abc"},
        )
        # 不正値は無視され、既存値が維持される
        assert merged["wakeUpTime"] == "06:30"
        assert "bedtime" not in merged


class TestIsValidHhmm:
    def test_valid_times(self):
        assert _is_valid_hhmm("00:00")
        assert _is_valid_hhmm("06:30")
        assert _is_valid_hhmm("23:59")

    def test_boundary_invalid_times(self):
        assert not _is_valid_hhmm("24:00")  # 時の上限超過
        assert not _is_valid_hhmm("12:60")  # 分の上限超過
        assert not _is_valid_hhmm("")        # 空文字は未設定扱い (False)

    def test_format_violations(self):
        assert not _is_valid_hhmm("6:30")    # 桁不足
        assert not _is_valid_hhmm("06-30")   # 区切り違い
        assert not _is_valid_hhmm("aa:bb")   # 数字でない
        assert not _is_valid_hhmm("06:30:00")  # 秒付き


class TestEnsureTaskFields:
    def test_defaults_kpi_fields_when_missing(self):
        task = {"id": "t1"}
        result = _ensure_task_fields(task)
        assert result["kpiId"] == ""
        assert result["kpiContributed"] is False

    def test_preserves_existing_fields(self):
        task = {"id": "t1", "kpiId": "k1", "kpiContributed": True}
        result = _ensure_task_fields(task)
        assert result["kpiId"] == "k1"
        assert result["kpiContributed"] is True

    def test_coerces_truthy_contributed_to_bool(self):
        task = {"id": "t1", "kpiContributed": 1}
        assert _ensure_task_fields(task)["kpiContributed"] is True


class TestFindTimeKpi:
    def _goals(self):
        return [
            {
                "id": "g1",
                "kpis": [
                    {"id": "kA", "unit": "time", "targetValue": 3600, "currentValue": 0},
                    {"id": "kB", "unit": "number", "targetValue": 5, "currentValue": 0},
                ],
            }
        ]

    def test_finds_time_kpi(self):
        k = _find_time_kpi(self._goals(), "g1", "kA")
        assert k is not None
        assert k["id"] == "kA"

    def test_returns_none_for_non_time_kpi(self):
        assert _find_time_kpi(self._goals(), "g1", "kB") is None

    def test_returns_none_for_missing_goal(self):
        assert _find_time_kpi(self._goals(), "bogus", "kA") is None

    def test_returns_none_for_empty_ids(self):
        assert _find_time_kpi(self._goals(), "", "kA") is None
        assert _find_time_kpi(self._goals(), "g1", "") is None


class TestApplyKpiTimeDelta:
    def _goals(self, current=0):
        return [
            {
                "id": "g1",
                "kpis": [
                    {
                        "id": "kA",
                        "unit": "time",
                        "targetValue": 3600,
                        "currentValue": current,
                    }
                ],
                "achieved": False,
                "achievedAt": "",
            }
        ]

    def test_adds_delta_to_current_value(self):
        goals = self._goals(current=100)
        ok = _apply_kpi_time_delta(goals, "g1", "kA", 900)
        assert ok is True
        assert goals[0]["kpis"][0]["currentValue"] == 1000

    def test_clamps_to_zero_on_negative(self):
        goals = self._goals(current=100)
        _apply_kpi_time_delta(goals, "g1", "kA", -500)
        assert goals[0]["kpis"][0]["currentValue"] == 0

    def test_returns_false_when_kpi_missing(self):
        goals = self._goals(current=100)
        assert _apply_kpi_time_delta(goals, "g1", "bogus", 100) is False
        assert goals[0]["kpis"][0]["currentValue"] == 100

    def test_zero_delta_is_noop(self):
        goals = self._goals(current=100)
        assert _apply_kpi_time_delta(goals, "g1", "kA", 0) is False
        assert goals[0]["kpis"][0]["currentValue"] == 100

    def test_syncs_achievement_on_target_reached(self):
        goals = self._goals(current=3000)
        _apply_kpi_time_delta(goals, "g1", "kA", 600)
        assert goals[0]["achieved"] is True
        assert goals[0]["achievedAt"]


class TestRebalanceKpiContribution:
    def _make_goals(self, current=0):
        return [
            {
                "id": "g1",
                "kpis": [
                    {
                        "id": "kA",
                        "unit": "time",
                        "targetValue": 3600,
                        "currentValue": current,
                    }
                ],
                "achieved": False,
                "achievedAt": "",
            }
        ]

    def test_contributes_on_move_to_done(self):
        # todo -> done: 未 contributed で done 列にあり KPI が紐付いていれば加算される
        goals = self._make_goals()
        task = {
            "column": "done",
            "goalId": "g1",
            "kpiId": "kA",
            "timeSpent": 1800,
            "kpiContributed": False,
        }
        before = {
            "goalId": "g1",
            "kpiId": "kA",
            "timeSpent": 1800,
            "kpiContributed": False,
        }
        _rebalance_kpi_contribution(task, before, goals)
        assert task["kpiContributed"] is True
        assert goals[0]["kpis"][0]["currentValue"] == 1800

    def test_uncontributes_on_move_away_from_done(self):
        # done -> todo: 以前 contributed なら減算し、non-done なので再加算しない
        goals = self._make_goals(current=1800)
        task = {
            "column": "todo",
            "goalId": "g1",
            "kpiId": "kA",
            "timeSpent": 1800,
            "kpiContributed": True,
        }
        before = {
            "goalId": "g1",
            "kpiId": "kA",
            "timeSpent": 1800,
            "kpiContributed": True,
        }
        _rebalance_kpi_contribution(task, before, goals)
        assert task["kpiContributed"] is False
        assert goals[0]["kpis"][0]["currentValue"] == 0

    def test_noop_when_no_kpi_linked(self):
        goals = self._make_goals()
        task = {
            "column": "done",
            "goalId": "",
            "kpiId": "",
            "timeSpent": 600,
            "kpiContributed": False,
        }
        before = {
            "goalId": "",
            "kpiId": "",
            "timeSpent": 600,
            "kpiContributed": False,
        }
        _rebalance_kpi_contribution(task, before, goals)
        assert task["kpiContributed"] is False
        assert goals[0]["kpis"][0]["currentValue"] == 0

    def test_retargets_to_new_kpi_when_link_changes_in_done(self):
        goals = [
            {
                "id": "g1",
                "kpis": [
                    {"id": "kA", "unit": "time", "targetValue": 3600, "currentValue": 600},
                    {"id": "kB", "unit": "time", "targetValue": 7200, "currentValue": 0},
                ],
                "achieved": False,
                "achievedAt": "",
            }
        ]
        task = {
            "column": "done",
            "goalId": "g1",
            "kpiId": "kB",
            "timeSpent": 600,
            "kpiContributed": True,
        }
        before = {
            "goalId": "g1",
            "kpiId": "kA",
            "timeSpent": 600,
            "kpiContributed": True,
        }
        _rebalance_kpi_contribution(task, before, goals)
        # 旧 kA からは 600 減算、新 kB に 600 加算
        assert goals[0]["kpis"][0]["currentValue"] == 0
        assert goals[0]["kpis"][1]["currentValue"] == 600
        assert task["kpiContributed"] is True


class TestPickLabel:
    def test_returns_first_non_empty_string(self):
        assert _pick_label({"title": "a", "name": "b"}, ("title", "name"), "x") == "a"

    def test_skips_empty_values(self):
        assert _pick_label({"title": "", "name": "b"}, ("title", "name"), "x") == "b"

    def test_falls_back_when_all_missing(self):
        assert _pick_label({}, ("title",), "fallback-id") == "fallback-id"


class TestDiffEntitiesById:
    def test_added_removed_modified_mixed(self):
        current = [
            {"id": "a", "title": "A"},
            {"id": "b", "title": "B"},
            {"id": "c", "title": "C"},
        ]
        target = [
            {"id": "a", "title": "A"},          # 同じ
            {"id": "b", "title": "B changed"},  # 変更
            {"id": "d", "title": "D"},          # target のみ → added
        ]
        result = _diff_entities_by_id(current, target, "id", ("title",))
        assert [e["id"] for e in result["added"]] == ["d"]
        assert [e["id"] for e in result["removed"]] == ["c"]
        assert [e["id"] for e in result["modified"]] == ["b"]
        assert result["modified"][0]["label"] == "B changed"

    def test_both_empty(self):
        result = _diff_entities_by_id([], [], "id", ("title",))
        assert result == {"added": [], "removed": [], "modified": []}

    def test_one_side_empty(self):
        current = [{"id": "a", "title": "A"}]
        assert _diff_entities_by_id(current, [], "id", ("title",))["removed"][0]["id"] == "a"
        assert _diff_entities_by_id([], current, "id", ("title",))["added"][0]["id"] == "a"

    def test_same_id_same_content_is_not_modified(self):
        a = [{"id": "x", "title": "same"}]
        b = [{"id": "x", "title": "same"}]
        assert _diff_entities_by_id(a, b, "id", ("title",))["modified"] == []

    def test_label_fallback_to_id_when_all_keys_missing(self):
        current = [{"id": "only-current"}]
        result = _diff_entities_by_id(current, [], "id", ("title", "name"))
        assert result["removed"][0]["label"] == "only-current"

    def test_entities_without_id_key_are_ignored(self):
        # id フィールドが空のエンティティは diff の対象外
        current = [{"id": "", "title": "noid"}, {"id": "a", "title": "A"}]
        target = [{"id": "a", "title": "A"}]
        result = _diff_entities_by_id(current, target, "id", ("title",))
        assert result == {"added": [], "removed": [], "modified": []}


class TestDiffProfile:
    def test_same_returns_false(self):
        assert _diff_profile({"x": 1}, {"x": 1}) is False

    def test_different_returns_true(self):
        assert _diff_profile({"x": 1}, {"x": 2}) is True

    def test_both_empty_returns_false(self):
        assert _diff_profile({}, {}) is False


class TestSummarizeDiff:
    def test_counts_per_section(self):
        details = {
            "tasks": {
                "added": [{"id": "a", "label": "A"}],
                "removed": [],
                "modified": [{"id": "b", "label": "B"}, {"id": "c", "label": "C"}],
            },
            "goals": {"added": [], "removed": [{"id": "g", "label": "G"}], "modified": []},
            "retros": {"added": [], "removed": [], "modified": []},
            "profileChanged": True,
        }
        summary = _summarize_diff(details)
        assert summary["tasks"] == {"added": 1, "removed": 0, "modified": 2}
        assert summary["goals"] == {"added": 0, "removed": 1, "modified": 0}
        assert summary["retros"] == {"added": 0, "removed": 0, "modified": 0}
        assert summary["profileChanged"] is True

    def test_empty_sections_default_to_zero(self):
        summary = _summarize_diff({})
        assert summary == {
            "tasks": {"added": 0, "removed": 0, "modified": 0},
            "goals": {"added": 0, "removed": 0, "modified": 0},
            "retros": {"added": 0, "removed": 0, "modified": 0},
            "profileChanged": False,
        }

    def test_profile_changed_flag_preserved_as_bool(self):
        # dict が無い / 値が truthy な非 bool でも bool 化される
        assert _summarize_diff({"profileChanged": 1})["profileChanged"] is True
        assert _summarize_diff({"profileChanged": 0})["profileChanged"] is False


class TestApplyProfileUpdate:
    def _base_profile(self):
        return {
            "currentState": "既存の状態",
            "balanceWheel": [{"id": "b1", "name": "仕事", "score": 5}],
            "actionPrinciples": [{"id": "p1", "text": "小さく始める"}],
            "wantToDo": [{"id": "w1", "text": "本を読む"}],
        }

    def test_updates_current_state_only(self):
        # 正常系: 単一キーだけ更新し、他は既存値を維持
        result = apply_profile_update(
            self._base_profile(), {"currentState": "転職活動中"}
        )
        assert result["currentState"] == "転職活動中"
        assert result["balanceWheel"] == [{"id": "b1", "name": "仕事", "score": 5}]
        assert result["actionPrinciples"] == [{"id": "p1", "text": "小さく始める"}]

    def test_replaces_list_fields_entirely(self):
        # 境界値: 配列は差分追記ではなく丸ごと置き換えになる
        updates = {
            "actionPrinciples": [
                {"id": "p2", "text": "毎日1つ進める"},
                {"id": "p3", "text": "完璧を求めない"},
            ]
        }
        result = apply_profile_update(self._base_profile(), updates)
        assert [p["text"] for p in result["actionPrinciples"]] == [
            "毎日1つ進める",
            "完璧を求めない",
        ]
        # 他のキーは維持
        assert result["currentState"] == "既存の状態"
        assert result["wantToDo"] == [{"id": "w1", "text": "本を読む"}]

    def test_ignores_invalid_types_and_unknown_keys(self):
        # 異常系: 型が合わないキーや未知キーは無視し、既存値を維持
        updates = {
            "currentState": 123,  # str じゃない → 無視
            "balanceWheel": "not a list",  # list じゃない → 無視
            "unknownKey": "ignored",  # 未知キー → 無視
        }
        result = apply_profile_update(self._base_profile(), updates)
        assert result["currentState"] == "既存の状態"
        assert result["balanceWheel"] == [{"id": "b1", "name": "仕事", "score": 5}]
        assert "unknownKey" not in result

    def test_applies_to_empty_profile_via_defaults(self):
        # 空プロフィールに対しても DEFAULT_PROFILE で埋めた上で更新が効く
        result = apply_profile_update({}, {"currentState": "新規"})
        assert result["currentState"] == "新規"
        assert result["balanceWheel"] == []
        assert result["actionPrinciples"] == []
        assert result["wantToDo"] == []


class TestProcessTodosProfileUpdate:
    def _base_profile(self):
        return {
            "currentState": "旧状態",
            "balanceWheel": [],
            "actionPrinciples": [{"id": "p1", "text": "旧指針"}],
            "wantToDo": [],
        }

    def test_profile_update_entry_is_applied(self):
        # PROFILE_UPDATE 特殊エントリはカンバンタスクにならず profile に反映される
        todos = [
            {
                "content": 'PROFILE_UPDATE:{"currentState":"新状態"}',
                "status": "completed",
            }
        ]
        tasks, goals, profile = process_todos(
            todos, [], [], self._base_profile()
        )
        assert tasks == []
        assert goals == []
        assert profile["currentState"] == "新状態"
        # 他のキーは既存値を維持
        assert profile["actionPrinciples"] == [{"id": "p1", "text": "旧指針"}]

    def test_profile_update_coexists_with_task_entry(self):
        # 通常タスクと PROFILE_UPDATE を同時に渡せる
        todos = [
            {"content": "[HIGH] 企画書作成", "status": "pending"},
            {
                "content": 'PROFILE_UPDATE:{"currentState":"集中期間"}',
                "status": "completed",
            },
        ]
        tasks, _, profile = process_todos(
            todos, [], [], self._base_profile()
        )
        assert len(tasks) == 1
        assert tasks[0]["title"] == "企画書作成"
        assert profile["currentState"] == "集中期間"

    def test_malformed_profile_json_is_ignored(self):
        # 異常系: JSON が壊れているエントリは無視され、既存 profile が返る
        todos = [
            {"content": "PROFILE_UPDATE:{broken json", "status": "completed"}
        ]
        _, _, profile = process_todos(todos, [], [], self._base_profile())
        assert profile == self._base_profile()


class TestNormalizeQuota:
    def test_fills_defaults(self):
        q = _normalize_quota({})
        assert q["name"] == "未命名ノルマ"
        assert q["icon"] == "🎯"
        assert q["targetMinutes"] == 0
        assert q["archived"] is False
        assert q["id"]
        assert q["createdAt"]

    def test_keeps_provided_fields(self):
        q = _normalize_quota(
            {
                "id": "abc",
                "name": "読書",
                "icon": "📖",
                "targetMinutes": 30,
                "archived": True,
                "createdAt": "2026-01-01T00:00:00",
            }
        )
        assert q["id"] == "abc"
        assert q["name"] == "読書"
        assert q["icon"] == "📖"
        assert q["targetMinutes"] == 30
        assert q["archived"] is True
        assert q["createdAt"] == "2026-01-01T00:00:00"

    def test_rejects_bad_target_minutes(self):
        # 異常系: 負の値・非数値は 0 に丸める
        q = _normalize_quota({"targetMinutes": -5})
        assert q["targetMinutes"] == 0
        q2 = _normalize_quota({"targetMinutes": "abc"})
        assert q2["targetMinutes"] == 0


class TestComputeQuotaDayTotals:
    def test_single_log_within_one_day(self):
        logs = [
            {
                "id": "l1",
                "quotaId": "q1",
                "startedAt": "2026-04-21T09:00:00",
                "endedAt": "2026-04-21T09:30:00",
                "memo": "",
            }
        ]
        totals = compute_quota_day_totals(logs, now_iso="2026-04-21T10:00:00")
        assert totals == {"q1": {"2026-04-21": 30 * 60}}

    def test_multiple_logs_same_day_sum(self):
        # 境界値: 同じ quota の複数ログが合算される
        logs = [
            {
                "id": "l1",
                "quotaId": "q1",
                "startedAt": "2026-04-21T09:00:00",
                "endedAt": "2026-04-21T09:20:00",
                "memo": "",
            },
            {
                "id": "l2",
                "quotaId": "q1",
                "startedAt": "2026-04-21T15:00:00",
                "endedAt": "2026-04-21T15:10:00",
                "memo": "",
            },
        ]
        totals = compute_quota_day_totals(logs, now_iso="2026-04-21T20:00:00")
        assert totals["q1"]["2026-04-21"] == 30 * 60

    def test_active_log_uses_now(self):
        logs = [
            {
                "id": "l1",
                "quotaId": "q1",
                "startedAt": "2026-04-21T09:00:00",
                "endedAt": "",
                "memo": "",
            }
        ]
        totals = compute_quota_day_totals(logs, now_iso="2026-04-21T09:15:00")
        assert totals["q1"]["2026-04-21"] == 15 * 60

    def test_log_spanning_midnight_splits(self):
        # 異常系相当: 日をまたぐログは日別に分割される
        logs = [
            {
                "id": "l1",
                "quotaId": "q1",
                "startedAt": "2026-04-21T23:30:00",
                "endedAt": "2026-04-22T00:15:00",
                "memo": "",
            }
        ]
        totals = compute_quota_day_totals(logs, now_iso="2026-04-22T01:00:00")
        assert totals["q1"]["2026-04-21"] == 30 * 60
        assert totals["q1"]["2026-04-22"] == 15 * 60


class TestComputeQuotaStreak:
    def test_today_achieved_extends_streak(self):
        day_totals = {
            "2026-04-19": 3600,
            "2026-04-20": 3600,
            "2026-04-21": 3600,
        }
        current, best, last = compute_quota_streak(
            day_totals, target_seconds=3600, today_iso="2026-04-21"
        )
        assert current == 3
        assert best == 3
        assert last == "2026-04-21"

    def test_today_unachieved_but_yesterday_kept(self):
        # 境界値: 今日まだ未達でも昨日までの連続は残る
        day_totals = {
            "2026-04-19": 3600,
            "2026-04-20": 3600,
        }
        current, best, _ = compute_quota_streak(
            day_totals, target_seconds=3600, today_iso="2026-04-21"
        )
        assert current == 2
        assert best == 2

    def test_gap_breaks_streak(self):
        day_totals = {
            "2026-04-15": 3600,
            "2026-04-16": 3600,
            "2026-04-20": 3600,
        }
        current, best, _ = compute_quota_streak(
            day_totals, target_seconds=3600, today_iso="2026-04-21"
        )
        assert current == 1  # 4-20 のみ継続（gap=1 = 昨日）
        assert best == 2  # 4-15, 4-16 が過去最高

    def test_unachieved_all_days(self):
        day_totals = {"2026-04-20": 1800}  # target 未達
        current, best, last = compute_quota_streak(
            day_totals, target_seconds=3600, today_iso="2026-04-21"
        )
        assert current == 0
        assert best == 0
        assert last == ""

    def test_zero_target_returns_zero(self):
        # 異常系: target=0 (ノルマ未設定) は常に 0
        current, best, _ = compute_quota_streak(
            {"2026-04-21": 3600}, target_seconds=0, today_iso="2026-04-21"
        )
        assert current == 0
        assert best == 0
