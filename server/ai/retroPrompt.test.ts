import { describe, expect, it } from "bun:test";
import type { Retrospective, UserProfile } from "../types.ts";
import { buildRetroSystemPrompt } from "./retroPrompt.ts";

function makeRetro(partial: Partial<Retrospective> = {}): Retrospective {
  return {
    id: "r1",
    type: "daily",
    periodStart: "2026-04-22",
    periodEnd: "2026-04-22",
    document: {
      did: "",
      learned: "",
      next: "",
      dayRating: 0,
      wakeUpTime: "",
      bedtime: "",
    },
    messages: [],
    aiComment: "",
    completedAt: "",
    createdAt: "2026-04-22T00:00:00",
    updatedAt: "2026-04-22T00:00:00",
    ...partial,
  };
}

function makeProfile(partial: Partial<UserProfile> = {}): UserProfile {
  return {
    currentState: "",
    balanceWheel: [],
    actionPrinciples: [],
    wantToDo: [],
    timezone: "",
    ...partial,
  };
}

describe("buildRetroSystemPrompt", () => {
  it("タイムスケジュールを振り返りコメントの根拠にする指示を含める", () => {
    const timelineContext = [
      "=== 振り返り期間のタイムスケジュール (2026-04-22 〜 2026-04-22) ===",
      "生成時刻: 21:00",
      "  - [タスク] 09:00–10:00 (1時間) 企画書作成",
      "  - [ライフログ] 12:00–12:30 (30分) 食事",
    ].join("\n");

    const out = buildRetroSystemPrompt(
      makeRetro(),
      [],
      [],
      makeProfile({ currentState: "集中時間を増やしたい" }),
      timelineContext
    );

    expect(out).toContain("## タイムスケジュール");
    expect(out).toContain("[タスク] 09:00–10:00 (1時間) 企画書作成");
    expect(out).toContain("時間配分や流れを根拠にコメントする");
    expect(out).toContain("記録されていない時間帯は推測で埋めず");
    expect(out).toContain("計測中/未完了の作業やライフログ");
  });
});
