import type { SdkBeta } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { AI_CONFIG_PATH } from "../config.ts";
import type { AIModel, AIToolConfig, ThinkingEffort } from "../types.ts";

export const AI_TOOL_CATALOG: readonly string[] = [
  "TodoWrite",
  "Bash",
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
];

export const AI_DEFAULT_ALLOWED_TOOLS: readonly string[] = ["TodoWrite", "Bash"];

export const AI_AVAILABLE_MODELS: readonly AIModel[] = [
  "claude-opus-4-7",
  "claude-opus-4-7-1m",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
];
export const AI_DEFAULT_MODEL: AIModel = "claude-sonnet-4-6";

export const AI_1M_CONTEXT_MODELS: Partial<Record<AIModel, AIModel>> = {
  "claude-opus-4-7-1m": "claude-opus-4-7",
};

export const AI_MODEL_ALIASES: Record<string, AIModel> = {
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-7",
  haiku: "claude-haiku-4-5",
};

export const AI_THINKING_EFFORTS: readonly ThinkingEffort[] = [
  "low",
  "medium",
  "high",
  "veryHigh",
  "max",
];

export const AI_THINKING_BUDGETS: Record<ThinkingEffort, number> = {
  low: 1024,
  medium: 4000,
  high: 10000,
  veryHigh: 32000,
  max: 64000,
};

export const AI_DEFAULT_THINKING_EFFORT: ThinkingEffort = "high";

export const AI_BASH_ALLOWED_PREFIXES: readonly (readonly string[])[] = [
  ["gh", "issue", "list"],
  ["gh", "issue", "view"],
  ["gh", "pr", "list"],
  ["gh", "pr", "view"],
  ["gh", "repo", "view"],
  ["git", "status"],
  ["git", "log"],
  ["git", "diff"],
];

export const AI_BASH_OPTIONAL_PREFIXES: readonly (readonly string[])[] = [["gh", "api"]];

const BASH_SHELL_META: readonly string[] = [";", "&", "|", ">", "<", "`", "$(", "${"];

let cache: AIToolConfig | null = null;

export function normalizeAIConfig(raw: unknown): AIToolConfig {
  const defaults: AIToolConfig = {
    allowedTools: [...AI_DEFAULT_ALLOWED_TOOLS],
    allowGhApi: false,
    model: AI_DEFAULT_MODEL,
    thinkingEffort: AI_DEFAULT_THINKING_EFFORT,
  };
  if (!raw || typeof raw !== "object") return defaults;
  const cfg = raw as Record<string, unknown>;

  let modelRaw = cfg.model;
  if (typeof modelRaw === "string" && modelRaw in AI_MODEL_ALIASES) {
    modelRaw = AI_MODEL_ALIASES[modelRaw];
  }
  const model: AIModel =
    typeof modelRaw === "string" && AI_AVAILABLE_MODELS.includes(modelRaw as AIModel)
      ? (modelRaw as AIModel)
      : AI_DEFAULT_MODEL;

  const effortRaw = cfg.thinkingEffort;
  const thinkingEffort: ThinkingEffort =
    typeof effortRaw === "string" &&
    AI_THINKING_EFFORTS.includes(effortRaw as ThinkingEffort)
      ? (effortRaw as ThinkingEffort)
      : AI_DEFAULT_THINKING_EFFORT;

  const rawTools = cfg.allowedTools;
  let allowedTools: string[];
  if (Array.isArray(rawTools)) {
    const seen = new Set<string>();
    allowedTools = [];
    for (const tool of rawTools) {
      if (typeof tool === "string" && AI_TOOL_CATALOG.includes(tool) && !seen.has(tool)) {
        allowedTools.push(tool);
        seen.add(tool);
      }
    }
  } else {
    allowedTools = [...AI_DEFAULT_ALLOWED_TOOLS];
  }

  return {
    allowedTools,
    allowGhApi: Boolean(cfg.allowGhApi),
    model,
    thinkingEffort,
  };
}

export function loadAIConfig(): AIToolConfig {
  if (cache) return cache;
  if (existsSync(AI_CONFIG_PATH)) {
    try {
      cache = normalizeAIConfig(JSON.parse(readFileSync(AI_CONFIG_PATH, "utf8")));
    } catch {
      cache = normalizeAIConfig(null);
    }
  } else {
    cache = normalizeAIConfig(null);
  }
  return cache;
}

export function saveAIConfig(cfg: unknown): AIToolConfig {
  const normalized = normalizeAIConfig(cfg);
  cache = normalized;
  writeFileSync(AI_CONFIG_PATH, JSON.stringify(normalized, null, 2));
  return normalized;
}

export function resolveAIModel(cfg: AIToolConfig): { model: AIModel; betas: SdkBeta[] } {
  const betas: SdkBeta[] = [];
  let model = cfg.model;
  if (model in AI_1M_CONTEXT_MODELS) {
    betas.push("context-1m-2025-08-07");
    model = AI_1M_CONTEXT_MODELS[model]!;
  }
  return { model, betas };
}

export function resolveThinkingBudget(cfg: AIToolConfig): number {
  return AI_THINKING_BUDGETS[cfg.thinkingEffort] ?? AI_THINKING_BUDGETS[AI_DEFAULT_THINKING_EFFORT];
}

export function isBashCommandAllowed(command: unknown, allowGhApi: boolean): boolean {
  if (typeof command !== "string" || !command.trim()) return false;
  if (BASH_SHELL_META.some((m) => command.includes(m))) return false;
  const tokens = command.trim().split(/\s+/);
  if (tokens.length === 0) return false;
  const prefixes = allowGhApi
    ? [...AI_BASH_ALLOWED_PREFIXES, ...AI_BASH_OPTIONAL_PREFIXES]
    : AI_BASH_ALLOWED_PREFIXES;
  for (const prefix of prefixes) {
    if (tokens.length >= prefix.length && prefix.every((p, i) => tokens[i] === p)) {
      return true;
    }
  }
  return false;
}
