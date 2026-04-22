import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { AI_CONFIG_PATH } from "../config.ts";
import {
  AI_1M_CONTEXT_MODELS,
  AI_DEFAULT_ALLOWED_TOOLS,
  AI_DEFAULT_MODEL,
  AI_DEFAULT_THINKING_EFFORT,
  AI_THINKING_BUDGETS,
  isBashCommandAllowed,
  loadAIConfig,
  normalizeAIConfig,
  resetAIConfigCache,
  resolveAIModel,
  resolveThinkingBudget,
  saveAIConfig,
} from "./aiConfig.ts";

beforeEach(() => {
  resetAIConfigCache();
  if (existsSync(AI_CONFIG_PATH)) unlinkSync(AI_CONFIG_PATH);
});

afterEach(() => {
  resetAIConfigCache();
});

afterAll(() => {
  resetAIConfigCache();
  if (existsSync(AI_CONFIG_PATH)) unlinkSync(AI_CONFIG_PATH);
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeAIConfig — 純粋関数・境界値
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeAIConfig — 正規化 (純粋関数)", () => {
  it("null / undefined / プリミティブはデフォルトに正規化される", () => {
    const expected = {
      allowedTools: [...AI_DEFAULT_ALLOWED_TOOLS],
      allowGhApi: false,
      model: AI_DEFAULT_MODEL,
      thinkingEffort: AI_DEFAULT_THINKING_EFFORT,
    };
    expect(normalizeAIConfig(null)).toEqual(expected);
    expect(normalizeAIConfig(undefined)).toEqual(expected);
    expect(normalizeAIConfig(42)).toEqual(expected);
    expect(normalizeAIConfig("string")).toEqual(expected);
  });

  it("エイリアス (sonnet / opus / haiku) は正式モデル名に解決される", () => {
    expect(normalizeAIConfig({ model: "sonnet" }).model).toBe("claude-sonnet-4-6");
    expect(normalizeAIConfig({ model: "opus" }).model).toBe("claude-opus-4-7");
    expect(normalizeAIConfig({ model: "haiku" }).model).toBe("claude-haiku-4-5");
  });

  it("未知のモデル名はデフォルトにフォールバックする", () => {
    expect(normalizeAIConfig({ model: "gpt-4" }).model).toBe(AI_DEFAULT_MODEL);
    expect(normalizeAIConfig({ model: 123 }).model).toBe(AI_DEFAULT_MODEL);
  });

  it("正式な model 名 (1M variant 含む) はそのまま通す", () => {
    expect(normalizeAIConfig({ model: "claude-opus-4-7" }).model).toBe("claude-opus-4-7");
    expect(normalizeAIConfig({ model: "claude-opus-4-7-1m" }).model).toBe("claude-opus-4-7-1m");
    expect(normalizeAIConfig({ model: "claude-haiku-4-5" }).model).toBe("claude-haiku-4-5");
  });

  it("thinkingEffort は列挙値のみ許可、それ以外はデフォルトにフォールバック", () => {
    expect(normalizeAIConfig({ thinkingEffort: "low" }).thinkingEffort).toBe("low");
    expect(normalizeAIConfig({ thinkingEffort: "max" }).thinkingEffort).toBe("max");
    expect(normalizeAIConfig({ thinkingEffort: "insane" }).thinkingEffort).toBe(
      AI_DEFAULT_THINKING_EFFORT,
    );
    expect(normalizeAIConfig({ thinkingEffort: 3 }).thinkingEffort).toBe(
      AI_DEFAULT_THINKING_EFFORT,
    );
  });

  it("allowedTools はカタログ内の文字列のみ通し、重複は dedupe される", () => {
    const result = normalizeAIConfig({
      allowedTools: ["Read", "Read", "Bash", "Unknown", 42, null, "Grep"],
    });
    expect(result.allowedTools).toEqual(["Read", "Bash", "Grep"]);
  });

  it("allowedTools が非配列ならデフォルトに戻る", () => {
    expect(normalizeAIConfig({ allowedTools: "Read" }).allowedTools).toEqual([
      ...AI_DEFAULT_ALLOWED_TOOLS,
    ]);
    expect(normalizeAIConfig({ allowedTools: null }).allowedTools).toEqual([
      ...AI_DEFAULT_ALLOWED_TOOLS,
    ]);
  });

  it("allowedTools が空配列なら空配列のまま通す (既存挙動)", () => {
    expect(normalizeAIConfig({ allowedTools: [] }).allowedTools).toEqual([]);
  });

  it("allowGhApi は Boolean に変換される", () => {
    expect(normalizeAIConfig({ allowGhApi: true }).allowGhApi).toBe(true);
    expect(normalizeAIConfig({ allowGhApi: false }).allowGhApi).toBe(false);
    expect(normalizeAIConfig({ allowGhApi: 1 }).allowGhApi).toBe(true);
    expect(normalizeAIConfig({ allowGhApi: 0 }).allowGhApi).toBe(false);
    expect(normalizeAIConfig({ allowGhApi: "yes" }).allowGhApi).toBe(true);
    expect(normalizeAIConfig({}).allowGhApi).toBe(false);
  });

  it("余分なキーは無視され、出力は4フィールドのみ", () => {
    const result = normalizeAIConfig({
      model: "sonnet",
      thinkingEffort: "low",
      allowedTools: ["Bash"],
      allowGhApi: true,
      secret: "leak",
    }) as unknown as Record<string, unknown>;
    expect(Object.keys(result).sort()).toEqual(
      ["allowGhApi", "allowedTools", "model", "thinkingEffort"].sort(),
    );
  });

  it("入力オブジェクトを破壊しない (immutability)", () => {
    const input = {
      allowedTools: ["Read", "Bash"],
      model: "sonnet",
      thinkingEffort: "low",
      allowGhApi: true,
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    normalizeAIConfig(input);
    expect(input).toEqual(snapshot);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// loadAIConfig / saveAIConfig — 永続化ラウンドトリップ
// ─────────────────────────────────────────────────────────────────────────────

describe("loadAIConfig / saveAIConfig — 永続化", () => {
  it("ファイルがないときはデフォルトを返す", () => {
    const cfg = loadAIConfig();
    expect(cfg.model).toBe(AI_DEFAULT_MODEL);
    expect(cfg.thinkingEffort).toBe(AI_DEFAULT_THINKING_EFFORT);
    expect(cfg.allowGhApi).toBe(false);
    expect(cfg.allowedTools).toEqual([...AI_DEFAULT_ALLOWED_TOOLS]);
  });

  it("保存した値を復元できる", () => {
    saveAIConfig({
      model: "claude-opus-4-7",
      thinkingEffort: "max",
      allowedTools: ["Read", "Grep"],
      allowGhApi: true,
    });
    resetAIConfigCache();
    const cfg = loadAIConfig();
    expect(cfg.model).toBe("claude-opus-4-7");
    expect(cfg.thinkingEffort).toBe("max");
    expect(cfg.allowedTools).toEqual(["Read", "Grep"]);
    expect(cfg.allowGhApi).toBe(true);
  });

  it("saveAIConfig は正規化された値を返す (未知ツール除去)", () => {
    const result = saveAIConfig({
      model: "sonnet",
      allowedTools: ["Bash", "RmRf"],
      allowGhApi: false,
    });
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.allowedTools).toEqual(["Bash"]);
  });

  it("壊れた JSON はデフォルト値にフォールバックする", () => {
    writeFileSync(AI_CONFIG_PATH, "{ not valid json");
    resetAIConfigCache();
    const cfg = loadAIConfig();
    expect(cfg.model).toBe(AI_DEFAULT_MODEL);
  });

  it("キャッシュが効く (2回目の load でファイル削除後も同じ値)", () => {
    saveAIConfig({ model: "opus" });
    const first = loadAIConfig();
    unlinkSync(AI_CONFIG_PATH);
    const second = loadAIConfig();
    expect(second).toBe(first);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveAIModel — 1M context 判定
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveAIModel — 1M variant の展開", () => {
  it("通常モデルは betas 空で返る", () => {
    const { model, betas } = resolveAIModel({
      model: "claude-sonnet-4-6",
      thinkingEffort: "high",
      allowedTools: [],
      allowGhApi: false,
    });
    expect(model).toBe("claude-sonnet-4-6");
    expect(betas).toEqual([]);
  });

  it("1M モデルは実モデルに置換され context-1m beta が付く", () => {
    const { model, betas } = resolveAIModel({
      model: "claude-opus-4-7-1m",
      thinkingEffort: "high",
      allowedTools: [],
      allowGhApi: false,
    });
    expect(AI_1M_CONTEXT_MODELS["claude-opus-4-7-1m"]).toBe("claude-opus-4-7");
    expect(model).toBe("claude-opus-4-7");
    expect(betas).toEqual(["context-1m-2025-08-07"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveThinkingBudget
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveThinkingBudget", () => {
  it("各 effort 値に対応する budget を返す", () => {
    for (const effort of Object.keys(AI_THINKING_BUDGETS) as Array<
      keyof typeof AI_THINKING_BUDGETS
    >) {
      const budget = resolveThinkingBudget({
        model: AI_DEFAULT_MODEL,
        thinkingEffort: effort,
        allowedTools: [],
        allowGhApi: false,
      });
      expect(budget).toBe(AI_THINKING_BUDGETS[effort]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isBashCommandAllowed — セキュリティ境界
// ─────────────────────────────────────────────────────────────────────────────

describe("isBashCommandAllowed — 入力型のガード", () => {
  it("文字列以外・空文字列は拒否される", () => {
    expect(isBashCommandAllowed(undefined, false)).toBe(false);
    expect(isBashCommandAllowed(null, false)).toBe(false);
    expect(isBashCommandAllowed(42, false)).toBe(false);
    expect(isBashCommandAllowed({}, false)).toBe(false);
    expect(isBashCommandAllowed([], false)).toBe(false);
    expect(isBashCommandAllowed("", false)).toBe(false);
    expect(isBashCommandAllowed("   ", false)).toBe(false);
  });
});

describe("isBashCommandAllowed — シェルメタ文字の拒否", () => {
  const metaSamples: readonly [string, string][] = [
    ["セミコロン", "git status; rm -rf /"],
    ["アンパサンド", "git status & echo x"],
    ["パイプ", "git status | cat"],
    ["リダイレクト >", "git status > out.txt"],
    ["リダイレクト <", "git status < in.txt"],
    ["バッククォート", "git status `whoami`"],
    ["$( 展開", "git status $(whoami)"],
    ["${ 展開", "git status ${HOME}"],
  ];

  for (const [label, cmd] of metaSamples) {
    it(`${label} を含むコマンドは常に拒否される`, () => {
      expect(isBashCommandAllowed(cmd, true)).toBe(false);
      expect(isBashCommandAllowed(cmd, false)).toBe(false);
    });
  }
});

describe("isBashCommandAllowed — 許可プレフィックス (allowGhApi=false)", () => {
  const allowed = [
    "gh issue list",
    "gh issue list --state open",
    "gh issue view 123",
    "gh pr list",
    "gh pr view 42 --web",
    "gh repo view",
    "git status",
    "git status -s",
    "git log",
    "git log --oneline -20",
    "git diff",
    "git diff HEAD~1 HEAD",
  ];

  for (const cmd of allowed) {
    it(`"${cmd}" は許可される`, () => {
      expect(isBashCommandAllowed(cmd, false)).toBe(true);
    });
  }

  const denied = [
    "git push",
    "git commit -m foo",
    "git reset --hard",
    "gh auth login",
    "gh issue create",
    "gh pr create",
    "gh api repos/foo/bar/issues",
    "gh",
    "git",
    "rm -rf /tmp",
    "echo hello",
    "node server.js",
  ];

  for (const cmd of denied) {
    it(`"${cmd}" は拒否される`, () => {
      expect(isBashCommandAllowed(cmd, false)).toBe(false);
    });
  }

  it("プレフィックスの部分文字列一致 (ghxxx など) は拒否される", () => {
    expect(isBashCommandAllowed("ghxxx issue list", false)).toBe(false);
    expect(isBashCommandAllowed("gitlog", false)).toBe(false);
  });
});

describe("isBashCommandAllowed — allowGhApi=true で許可される拡張", () => {
  it("gh api ... は allowGhApi=true のときだけ許可される", () => {
    expect(isBashCommandAllowed("gh api repos/foo/bar", false)).toBe(false);
    expect(isBashCommandAllowed("gh api repos/foo/bar", true)).toBe(true);
    expect(isBashCommandAllowed("gh api user", true)).toBe(true);
  });

  it("allowGhApi=true でも元の通常プレフィックスは引き続き許可される", () => {
    expect(isBashCommandAllowed("gh issue list", true)).toBe(true);
    expect(isBashCommandAllowed("git status", true)).toBe(true);
  });

  it("allowGhApi=true でもシェルメタ文字入り gh api は拒否される", () => {
    expect(isBashCommandAllowed("gh api repos/foo/bar; rm -rf /", true)).toBe(false);
    expect(isBashCommandAllowed("gh api user | jq .login", true)).toBe(false);
  });
});
