import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { clickNav } from "../fixtures/helpers";

const HARNESS_PATH = path.resolve(__dirname, "ws-harness.js");
const FRAMES_ROOT = path.resolve(__dirname, "..", "animation-frames");

type Clip = { x: number; y: number; width: number; height: number };
type InjectEvent = {
  at: number;
  msg?: unknown;
  action?: (page: Page) => Promise<void>;
};

async function injectWS(page: Page, msg: unknown): Promise<void> {
  await page.evaluate(
    (m) => {
      const inject = (window as unknown as { __wsInject?: (m: unknown) => boolean })
        .__wsInject;
      if (inject) inject(m);
    },
    msg,
  );
}

async function gotoStubbedApp(page: Page): Promise<void> {
  await page.addInitScript({ path: HARNESS_PATH });
  await page.goto("/");
  await page.waitForSelector(".app-shell");
  await page.waitForSelector(".topbar-status-dot--online", { timeout: 10_000 });
}

async function hydrateBaseline(
  page: Page,
  overrides: Partial<{
    tasks: unknown[];
    goals: unknown[];
    retros: unknown[];
  }> = {},
): Promise<void> {
  await injectWS(page, { type: "kanban_sync", tasks: overrides.tasks ?? [] });
  await injectWS(page, { type: "goal_sync", goals: overrides.goals ?? [] });
  await injectWS(page, {
    type: "profile_sync",
    profile: {
      currentState: "",
      balanceWheel: [],
      actionPrinciples: [],
      wantToDo: [],
    },
  });
  await injectWS(page, {
    type: "ai_config_sync",
    config: { allowedTools: ["TodoWrite", "Bash"] },
  });
  await injectWS(page, {
    type: "retro_list_sync",
    retros: overrides.retros ?? [],
  });
  await page.waitForTimeout(150);
}

async function closeChatIfOpen(page: Page): Promise<void> {
  const closeBtn = page.locator(".chat-panel-close");
  if (await closeBtn.isVisible()) {
    await closeBtn.click();
    await page.waitForTimeout(150);
  }
}

async function captureLoop(
  page: Page,
  name: string,
  durationMs: number,
  fps: number,
  clip: Clip,
  events: InjectEvent[],
): Promise<void> {
  const frameDir = path.join(FRAMES_ROOT, name);
  await fs.mkdir(frameDir, { recursive: true });
  // 以前の実行残骸は消しておく
  const existing = await fs.readdir(frameDir).catch(() => []);
  await Promise.all(
    existing.map((f) => fs.unlink(path.join(frameDir, f)).catch(() => {})),
  );

  const frameInterval = 1000 / fps;
  const totalFrames = Math.ceil(durationMs / frameInterval);
  const pending = [...events].sort((a, b) => a.at - b.at);

  const start = Date.now();
  for (let i = 0; i < totalFrames; i++) {
    const elapsed = Date.now() - start;
    while (pending.length > 0 && pending[0].at <= elapsed) {
      const ev = pending.shift();
      if (!ev) continue;
      if (ev.msg !== undefined) await injectWS(page, ev.msg);
      if (ev.action) await ev.action(page);
    }
    await page.screenshot({
      path: path.join(frameDir, `${String(i).padStart(3, "0")}.png`),
      clip,
      animations: "allow",
    });
    const nextTick = (i + 1) * frameInterval;
    const delta = nextTick - (Date.now() - start);
    if (delta > 0) await page.waitForTimeout(delta);
  }
  // 残ったイベントも撮影後に投げておく (完了系メッセージが最後に落ちると次のテストの
  // 残留状態が気になるので念のため)
  for (const ev of pending) {
    if (ev.msg !== undefined) await injectWS(page, ev.msg);
    if (ev.action) await ev.action(page);
  }

  await fs.writeFile(
    path.join(frameDir, "frames.json"),
    JSON.stringify(
      { name, fps, durationMs, clip, frameCount: totalFrames },
      null,
      2,
    ),
  );
}

const DEMO_BOARD = [
  {
    id: "t-1",
    title: "デザインレビュー",
    description: "",
    column: "in_progress",
    priority: "high",
    memo: "",
    goalId: "",
    estimatedMinutes: 30,
    timeSpent: 1825,
    timerStartedAt: "",
    completedAt: "",
    timeLogs: [],
  },
  {
    id: "t-2",
    title: "週次レポートの下書き",
    description: "",
    column: "todo",
    priority: "medium",
    memo: "",
    goalId: "",
    estimatedMinutes: 0,
    timeSpent: 0,
    timerStartedAt: "",
    completedAt: "",
    timeLogs: [],
  },
  {
    id: "t-3",
    title: "返信が必要なメールを片付ける",
    description: "",
    column: "todo",
    priority: "low",
    memo: "",
    goalId: "",
    estimatedMinutes: 0,
    timeSpent: 0,
    timerStartedAt: "",
    completedAt: "",
    timeLogs: [],
  },
  {
    id: "t-4",
    title: "朝のストレッチ",
    description: "",
    column: "done",
    priority: "low",
    memo: "",
    goalId: "",
    estimatedMinutes: 0,
    timeSpent: 600,
    timerStartedAt: "",
    completedAt: "2026-04-19T07:15:00",
    timeLogs: [],
  },
];

test.describe.configure({ mode: "serial" });

test.describe("画面説明書ハイライト用アニメーション", () => {
  test("celebration — 完了ドロップで褒めトースト", async ({ page }) => {
    await gotoStubbedApp(page);
    await hydrateBaseline(page, { tasks: DEMO_BOARD });
    await closeChatIfOpen(page);
    await clickNav(page, "ボード");
    await expect(page.locator(".kanban-column")).toHaveCount(3);

    // 進行中 → 完了 へドラッグ (HTML5 DnD を Playwright で再現)
    const source = page
      .locator(".kanban-card")
      .filter({ hasText: "デザインレビュー" })
      .first();
    const doneColumn = page.locator(".kanban-column").nth(2);
    await expect(source).toBeVisible();
    await expect(doneColumn).toBeVisible();

    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await source.dispatchEvent("dragstart", { dataTransfer });
    await page.waitForTimeout(60);
    await doneColumn.dispatchEvent("dragover", { dataTransfer });
    await page.waitForTimeout(60);
    // drop でトーストが表示されるので、直後からキャプチャを開始する
    await doneColumn.dispatchEvent("drop", { dataTransfer });
    await source.dispatchEvent("dragend", { dataTransfer });

    await captureLoop(
      page,
      "celebration",
      3800,
      10,
      { x: 0, y: 0, width: 1440, height: 860 },
      [],
    );
  });

  test("chat-ai — AI に頼んでタスクが追加される", async ({ page }) => {
    await gotoStubbedApp(page);
    const initialTasks = [
      {
        id: "t-a",
        title: "今週のリリースノート",
        description: "",
        column: "todo",
        priority: "medium",
        memo: "",
        goalId: "",
        estimatedMinutes: 0,
        timeSpent: 0,
        timerStartedAt: "",
        completedAt: "",
        timeLogs: [],
      },
      {
        id: "t-b",
        title: "PR レビューの返信",
        description: "",
        column: "todo",
        priority: "low",
        memo: "",
        goalId: "",
        estimatedMinutes: 0,
        timeSpent: 0,
        timerStartedAt: "",
        completedAt: "",
        timeLogs: [],
      },
    ];
    await hydrateBaseline(page, { tasks: initialTasks });
    await clickNav(page, "ボード");
    await expect(page.locator(".chat-panel")).toBeVisible();

    // チャット入力に「牛乳を買う」を打ち込んで送信
    const input = page.locator(".chat-input");
    await input.click();
    await input.fill("牛乳を買うタスクを追加して");
    await page.waitForTimeout(200);
    await page.locator(".chat-send").click();

    const addedTask = {
      id: "t-demo-milk",
      title: "牛乳を買う",
      description: "",
      column: "todo",
      priority: "medium",
      memo: "",
      goalId: "",
      estimatedMinutes: 0,
      timeSpent: 0,
      timerStartedAt: "",
      completedAt: "",
      timeLogs: [],
    };

    await captureLoop(
      page,
      "chat-ai",
      5200,
      10,
      { x: 0, y: 0, width: 1440, height: 860 },
      [
        { at: 300, msg: { type: "thinking_delta", text: "ユーザーが新しいタスクを追加したい。" } },
        { at: 900, msg: { type: "thinking_delta", text: "TodoWrite ツールで追加しよう。" } },
        { at: 1400, msg: { type: "stream_delta", text: "新しいタスク「" } },
        { at: 1700, msg: { type: "stream_delta", text: "牛乳を買う" } },
        { at: 2000, msg: { type: "stream_delta", text: "」を追加します。" } },
        {
          at: 2400,
          msg: {
            type: "tool_use",
            name: "TodoWrite",
            input: {
              todos: [
                { content: "牛乳を買う", status: "pending", activeForm: "牛乳を買う" },
              ],
            },
          },
        },
        {
          at: 2700,
          msg: {
            type: "kanban_sync",
            tasks: [...initialTasks, addedTask],
          },
        },
        {
          at: 3100,
          msg: {
            type: "assistant",
            text: "「牛乳を買う」を TODO に追加しました。",
            toolCalls: [],
          },
        },
        {
          at: 3500,
          msg: {
            type: "result",
            result: "ok",
            cost: 0.0042,
            turns: 1,
            sessionId: "demo",
          },
        },
      ],
    );
  });

  test("goal-ai — 目標タブで AI が目標と当日のタスクを作る", async ({ page }) => {
    await gotoStubbedApp(page);
    await hydrateBaseline(page, { tasks: [], goals: [] });
    await clickNav(page, "目標");
    await expect(
      page.getByRole("heading", { name: "目標", level: 1 }),
    ).toBeVisible();
    await expect(page.locator(".chat-panel")).toBeVisible();

    const demoGoal = {
      id: "g-demo-weight",
      name: "3ヶ月で10kg減量",
      memo: "健康的に、無理のないペースで",
      kpis: [
        {
          id: "k-exercise",
          name: "週あたり運動日数",
          unit: "number",
          targetValue: 4,
          currentValue: 0,
        },
        {
          id: "k-log",
          name: "食事記録継続日数",
          unit: "number",
          targetValue: 90,
          currentValue: 0,
        },
      ],
      deadline: "2026-07-20",
      achieved: false,
      achievedAt: "",
      icon: "💪",
    };

    const demoTasks = [
      {
        id: "t-walk",
        title: "朝のウォーキング30分",
        description: "",
        column: "todo",
        priority: "high",
        memo: "",
        goalId: "g-demo-weight",
        estimatedMinutes: 30,
        timeSpent: 0,
        timerStartedAt: "",
        completedAt: "",
        timeLogs: [],
      },
      {
        id: "t-meal",
        title: "今日の食事を記録する",
        description: "",
        column: "todo",
        priority: "medium",
        memo: "",
        goalId: "g-demo-weight",
        estimatedMinutes: 10,
        timeSpent: 0,
        timerStartedAt: "",
        completedAt: "",
        timeLogs: [],
      },
      {
        id: "t-weigh",
        title: "体重計に乗る(朝)",
        description: "",
        column: "todo",
        priority: "medium",
        memo: "",
        goalId: "g-demo-weight",
        estimatedMinutes: 2,
        timeSpent: 0,
        timerStartedAt: "",
        completedAt: "",
        timeLogs: [],
      },
    ];

    const goalAddContent =
      'GOAL_ADD:{"name":"3ヶ月で10kg減量","memo":"健康的に、無理のないペースで","kpis":[{"name":"週あたり運動日数","unit":"number","targetValue":4,"currentValue":0},{"name":"食事記録継続日数","unit":"number","targetValue":90,"currentValue":0}],"deadline":"2026-07-20"}';

    const sendFirst = async (p: Page) => {
      const input = p.locator(".chat-input");
      await input.click();
      await input.fill("3ヶ月後までに10kg痩せたいから目標とKPIを作って");
    };
    const clickSend = async (p: Page) => {
      await p.locator(".chat-send").click();
    };
    const sendSecond = async (p: Page) => {
      const input = p.locator(".chat-input");
      await input.click();
      await input.fill("この目標に向けて今日から始められるタスクを作成して");
    };
    const gotoBoard = async (p: Page) => {
      await clickNav(p, "ボード");
    };

    await captureLoop(
      page,
      "goal-ai",
      13000,
      10,
      { x: 0, y: 0, width: 1440, height: 860 },
      [
        { at: 300, action: sendFirst },
        { at: 1100, action: clickSend },
        {
          at: 1400,
          msg: {
            type: "thinking_delta",
            text: "3ヶ月で10kg減量なら、運動と食事記録のKPIが妥当そう。",
          },
        },
        {
          at: 1900,
          msg: {
            type: "stream_delta",
            text: "「3ヶ月で10kg減量」を、",
          },
        },
        {
          at: 2300,
          msg: {
            type: "stream_delta",
            text: "週あたり運動日数と食事記録継続日数のKPIで追加します。",
          },
        },
        {
          at: 2800,
          msg: {
            type: "tool_use",
            name: "TodoWrite",
            input: {
              todos: [
                {
                  content: goalAddContent,
                  status: "completed",
                  activeForm: "目標を追加",
                },
              ],
            },
          },
        },
        {
          at: 3300,
          msg: { type: "goal_sync", goals: [demoGoal] },
        },
        {
          at: 3800,
          msg: {
            type: "assistant",
            text: "「3ヶ月で10kg減量」を追加しました。",
            toolCalls: [],
          },
        },
        {
          at: 4200,
          msg: {
            type: "result",
            result: "ok",
            cost: 0.004,
            turns: 1,
            sessionId: "demo-goal",
          },
        },
        { at: 4900, action: sendSecond },
        { at: 5800, action: clickSend },
        {
          at: 6100,
          msg: {
            type: "thinking_delta",
            text: "今日から無理なく始められる3つに絞る。",
          },
        },
        {
          at: 6600,
          msg: {
            type: "stream_delta",
            text: "今日から始められるタスクを ",
          },
        },
        {
          at: 7000,
          msg: {
            type: "stream_delta",
            text: "3 件追加します。",
          },
        },
        {
          at: 7500,
          msg: {
            type: "tool_use",
            name: "TodoWrite",
            input: {
              todos: [
                {
                  content: "[HIGH] 朝のウォーキング30分",
                  status: "pending",
                  activeForm: "朝のウォーキング30分",
                },
                {
                  content: "[MEDIUM] 今日の食事を記録する",
                  status: "pending",
                  activeForm: "今日の食事を記録する",
                },
                {
                  content: "[MEDIUM] 体重計に乗る(朝)",
                  status: "pending",
                  activeForm: "体重計に乗る(朝)",
                },
              ],
            },
          },
        },
        {
          at: 8000,
          msg: { type: "kanban_sync", tasks: demoTasks },
        },
        {
          at: 8500,
          msg: {
            type: "assistant",
            text: "タスクを 3 件追加しました。",
            toolCalls: [],
          },
        },
        {
          at: 8900,
          msg: {
            type: "result",
            result: "ok",
            cost: 0.003,
            turns: 1,
            sessionId: "demo-goal-tasks",
          },
        },
        { at: 10200, action: gotoBoard },
      ],
    );
  });

  test("theme-switch — 設定画面でテーマを切り替えると全体の色味が変わる", async ({
    page,
  }) => {
    await gotoStubbedApp(page);
    await hydrateBaseline(page, { tasks: DEMO_BOARD });
    await closeChatIfOpen(page);
    await clickNav(page, "設定");
    await expect(
      page.getByRole("heading", { name: "設定", level: 1 }),
    ).toBeVisible();
    await expect(page.locator(".theme-switch")).toHaveCount(2);

    const clickTheme = (label: string) => async (p: Page) => {
      await p
        .locator(".theme-option")
        .filter({ hasText: new RegExp(`^${label}`) })
        .first()
        .click();
    };

    await captureLoop(
      page,
      "theme-switch",
      8500,
      10,
      { x: 0, y: 0, width: 1440, height: 860 },
      [
        { at: 700, action: clickTheme("Midnight") },
        { at: 1500, action: clickTheme("Forest") },
        { at: 2300, action: clickTheme("Sunset") },
        { at: 3100, action: clickTheme("Paper") },
        { at: 3900, action: clickTheme("Mint") },
        { at: 4700, action: clickTheme("Rose") },
        { at: 5500, action: clickTheme("Sky") },
        { at: 6300, action: clickTheme("Sand") },
        { at: 7200, action: clickTheme("Dark") },
      ],
    );
  });

  test("retro-ai — AI が振り返りを書き出す", async ({ page }) => {
    await gotoStubbedApp(page);
    const doneTasks = [
      {
        id: "t-r1",
        title: "デザインレビュー対応",
        description: "",
        column: "done",
        priority: "high",
        memo: "",
        goalId: "",
        estimatedMinutes: 30,
        timeSpent: 1800,
        timerStartedAt: "",
        completedAt: "2026-04-19T10:30:00",
        timeLogs: [],
      },
      {
        id: "t-r2",
        title: "週次レポート送信",
        description: "",
        column: "done",
        priority: "medium",
        memo: "",
        goalId: "",
        estimatedMinutes: 0,
        timeSpent: 900,
        timerStartedAt: "",
        completedAt: "2026-04-19T14:00:00",
        timeLogs: [],
      },
      {
        id: "t-r3",
        title: "買い物タスクの分解",
        description: "",
        column: "done",
        priority: "low",
        memo: "",
        goalId: "",
        estimatedMinutes: 0,
        timeSpent: 300,
        timerStartedAt: "",
        completedAt: "2026-04-19T15:40:00",
        timeLogs: [],
      },
    ];
    await hydrateBaseline(page, { tasks: doneTasks });
    await closeChatIfOpen(page);
    await clickNav(page, "振り返り");
    await expect(page.getByRole("heading", { name: "振り返り", level: 1 })).toBeVisible();

    const startBtn = page.getByRole("button", { name: "振り返りを始める" });
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    const demoRetro = {
      id: "retro-demo",
      type: "daily",
      periodStart: "2026-04-19",
      periodEnd: "2026-04-19",
      document: {
        did: "",
        learned: "",
        next: "",
        dayRating: 0,
      },
      messages: [],
      aiComment: "",
      completedAt: "",
      createdAt: "2026-04-19T18:00:00",
      updatedAt: "2026-04-19T18:00:00",
    };

    await injectWS(page, { type: "retro_sync", retro: demoRetro });
    await injectWS(page, { type: "retro_session_waiting", waiting: true });
    await page.waitForTimeout(200);
    await expect(page.locator(".retro-session")).toBeVisible();

    const finalAiComment =
      "## 今日のふりかえり\n\n" +
      "### よかったこと\n" +
      "- デザインレビューを時間通りに完了できた\n" +
      "- 週次レポートを自分から先回りして送れた\n\n" +
      "### 明日の挑戦\n" +
      "- 朝 30 分を計画時間に当てる";

    await captureLoop(
      page,
      "retro-ai",
      4200,
      10,
      { x: 0, y: 0, width: 1440, height: 860 },
      [
        { at: 200, msg: { type: "retro_thinking_delta", text: "今日の活動を整理中…" } },
        { at: 700, msg: { type: "retro_stream_delta", text: "## 今日のふりかえり\n\n" } },
        { at: 1100, msg: { type: "retro_stream_delta", text: "### よかったこと\n- " } },
        {
          at: 1500,
          msg: {
            type: "retro_stream_delta",
            text: "デザインレビューを時間通りに完了できた\n- ",
          },
        },
        {
          at: 1900,
          msg: {
            type: "retro_stream_delta",
            text: "週次レポートを自分から先回りして送れた\n\n",
          },
        },
        {
          at: 2300,
          msg: { type: "retro_stream_delta", text: "### 明日の挑戦\n- " },
        },
        {
          at: 2700,
          msg: { type: "retro_stream_delta", text: "朝 30 分を計画時間に当てる" },
        },
        {
          at: 3300,
          msg: {
            type: "retro_completed",
            retro: { ...demoRetro, aiComment: finalAiComment },
          },
        },
      ],
    );
  });
});
