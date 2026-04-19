"""server.py の純粋関数のテスト。DB や WebSocket には触れない。"""

import datetime

import pytest

from server import (
    _compute_retro_period,
    _completed_task_ids_in_period,
    _ensure_kpi_ids,
    _is_goal_all_kpis_achieved,
    _merge_retro_document,
    _migrate_retro_document,
    _short_id,
    _strip_retrodoc_block,
    _sync_goal_achievement,
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
        kpis = [{"name": "a", "unit": "percent", "targetValue": 50}]
        assert _ensure_kpi_ids(kpis)[0]["unit"] == "percent"

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


class TestMergeRetroDocument:
    def test_updates_expected_keys(self):
        current = {"did": "old", "learned": "old", "next": ""}
        updates = {"did": "new", "learned": "also new"}
        merged = _merge_retro_document(current, updates)
        assert merged["did"] == "new"
        assert merged["learned"] == "also new"

    def test_preserves_unrelated_fields(self):
        current = {"did": "x", "completedTasks": ["t1"]}
        merged = _merge_retro_document(current, {"did": "y"})
        assert merged["completedTasks"] == ["t1"]
