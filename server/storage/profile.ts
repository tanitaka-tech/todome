import { getDb } from "../db.ts";
import type { UserProfile } from "../types.ts";
import { shortId } from "../utils/shortId.ts";

export const DEFAULT_PROFILE: UserProfile = {
  currentState: "",
  balanceWheel: [],
  actionPrinciples: [],
  wantToDo: [],
  timezone: "",
};

interface Row {
  data: string;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return Boolean(raw && typeof raw === "object" && !Array.isArray(raw));
}

function normalizeScore(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return Math.min(10, Math.max(1, Math.trunc(raw)));
}

function normalizeBalanceWheel(raw: unknown): UserProfile["balanceWheel"] {
  if (!Array.isArray(raw)) return [];
  const categories: UserProfile["balanceWheel"] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) continue;
    const category: UserProfile["balanceWheel"][number] = {
      id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : shortId(),
      name,
    };
    const score = normalizeScore(item.score);
    if (score !== undefined) category.score = score;
    if (typeof item.icon === "string" && item.icon.trim()) {
      category.icon = item.icon.trim();
    }
    categories.push(category);
  }
  return categories;
}

function normalizeTextItems(raw: unknown): UserProfile["actionPrinciples"] {
  if (!Array.isArray(raw)) return [];
  const items: UserProfile["actionPrinciples"] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const text = typeof item.text === "string" ? item.text : "";
    if (!id && !text) continue;
    items.push({
      id: id || shortId(),
      text,
    });
  }
  return items;
}

export function normalizeProfile(raw: unknown): UserProfile {
  const r = isRecord(raw) ? raw : {};
  return {
    currentState: typeof r.currentState === "string" ? r.currentState : "",
    balanceWheel: normalizeBalanceWheel(r.balanceWheel),
    actionPrinciples: normalizeTextItems(r.actionPrinciples),
    wantToDo: normalizeTextItems(r.wantToDo),
    timezone: typeof r.timezone === "string" ? r.timezone : "",
  };
}

export function loadProfile(): UserProfile {
  const row = getDb()
    .prepare("SELECT data FROM profile WHERE id = 1")
    .get() as Row | undefined;
  if (!row) return { ...DEFAULT_PROFILE };
  try {
    return normalizeProfile(JSON.parse(row.data));
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export function saveProfile(profile: UserProfile): void {
  getDb()
    .prepare(
      "INSERT INTO profile (id, data) VALUES (1, ?) " +
        "ON CONFLICT(id) DO UPDATE SET data = excluded.data"
    )
    .run(JSON.stringify(profile));
}

export function applyProfileUpdate(
  profile: UserProfile,
  updates: Record<string, unknown>
): UserProfile {
  const next: UserProfile = { ...DEFAULT_PROFILE, ...profile };
  if (typeof updates.currentState === "string") {
    next.currentState = updates.currentState;
  }
  if (Array.isArray(updates.balanceWheel)) next.balanceWheel = normalizeBalanceWheel(updates.balanceWheel);
  if (Array.isArray(updates.actionPrinciples)) next.actionPrinciples = normalizeTextItems(updates.actionPrinciples);
  if (Array.isArray(updates.wantToDo)) next.wantToDo = normalizeTextItems(updates.wantToDo);
  if (typeof updates.timezone === "string") next.timezone = updates.timezone;
  return next;
}
