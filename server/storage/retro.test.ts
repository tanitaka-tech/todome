// config.ts は読み込み時点で DATA_DIR を固定するため、server コードを import する前に
// テスト用ディレクトリを環境変数で指すようにする。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), "todome-retro-test-"));
process.env.TODOME_DATA_DIR = TEST_DATA_DIR;

import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDb, resetDbCache } from "../db.ts";
import type { Retrospective } from "../types.ts";

beforeEach(() => {
  resetDbCache();
  // 空の DB からテスト開始することを保証
  getDb().exec("DELETE FROM retrospectives");
});

afterEach(() => {
  resetDbCache();
});

afterAll(() => {
  rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

function makeRetro(partial: Partial<Retrospective> & Pick<Retrospective, "id">): Retrospective {
  return {
    type: "daily",
    periodStart: "2026-04-21",
    periodEnd: "2026-04-21",
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
    createdAt: "2026-04-21T10:00:00",
    updatedAt: "2026-04-21T10:00:00",
    ...partial,
  };
}

describe("retro storage — 完了フローの永続化 (regression: 完了時にaiComment/completedAt が保存される)", () => {
  it("完了済み retro を save→load するとすべてのフィールドが保持される", async () => {
    const { saveRetro, getRetro } = await import("./retro.ts");
    const draft = makeRetro({
      id: "retro-1",
      document: {
        did: "WebGLビルドの検証",
        learned: "FancyScrollView は重い",
        next: "別ライブラリに差し替え",
        dayRating: 7,
        wakeUpTime: "08:00",
        bedtime: "23:30",
      },
      messages: [
        { role: "assistant", text: "振り返りを始めましょう" },
        { role: "user", text: "WebGLビルドの検証をしました" },
      ],
    });
    saveRetro(draft);

    const completed: Retrospective = {
      ...draft,
      messages: [
        ...draft.messages,
        { role: "assistant", text: "お疲れさまでした。次も頑張りましょう。" },
      ],
      aiComment: "お疲れさまでした。次も頑張りましょう。",
      completedAt: "2026-04-21T11:00:00",
      updatedAt: "2026-04-21T11:00:00",
    };
    saveRetro(completed);

    const loaded = getRetro("retro-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.completedAt).toBe("2026-04-21T11:00:00");
    expect(loaded!.aiComment).toBe("お疲れさまでした。次も頑張りましょう。");
    expect(loaded!.messages).toHaveLength(3);
    expect(loaded!.messages[2]).toEqual({
      role: "assistant",
      text: "お疲れさまでした。次も頑張りましょう。",
    });
    expect(loaded!.document.did).toBe("WebGLビルドの検証");
  });

  it("1件を完了保存しても、無関係なドラフト retro は変更されない", async () => {
    const { saveRetro, getRetro, loadRetros } = await import("./retro.ts");
    const draftA = makeRetro({
      id: "retro-A",
      createdAt: "2026-04-20T10:00:00",
      updatedAt: "2026-04-20T10:00:00",
      document: {
        did: "A作業",
        learned: "",
        next: "",
        dayRating: 0,
        wakeUpTime: "",
        bedtime: "",
      },
    });
    const draftB = makeRetro({
      id: "retro-B",
      createdAt: "2026-04-21T10:00:00",
      updatedAt: "2026-04-21T10:00:00",
      document: {
        did: "B作業",
        learned: "",
        next: "",
        dayRating: 0,
        wakeUpTime: "",
        bedtime: "",
      },
    });
    saveRetro(draftA);
    saveRetro(draftB);

    const snapshotA = JSON.stringify(getRetro("retro-A"));

    saveRetro({
      ...draftB,
      aiComment: "B の総評",
      completedAt: "2026-04-21T11:00:00",
      updatedAt: "2026-04-21T11:00:00",
    });

    expect(JSON.stringify(getRetro("retro-A"))).toBe(snapshotA);
    expect(getRetro("retro-B")!.completedAt).toBe("2026-04-21T11:00:00");
    expect(loadRetros()).toHaveLength(2);
  });
});
