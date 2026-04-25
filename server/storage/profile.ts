import { getDb } from "../db.ts";
import type { UserProfile } from "../types.ts";

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

function normalizeProfile(raw: unknown): UserProfile {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<UserProfile>;
  return {
    currentState: typeof r.currentState === "string" ? r.currentState : "",
    balanceWheel: Array.isArray(r.balanceWheel) ? r.balanceWheel : [],
    actionPrinciples: Array.isArray(r.actionPrinciples) ? r.actionPrinciples : [],
    wantToDo: Array.isArray(r.wantToDo) ? r.wantToDo : [],
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
  if (Array.isArray(updates.balanceWheel)) next.balanceWheel = updates.balanceWheel as UserProfile["balanceWheel"];
  if (Array.isArray(updates.actionPrinciples)) next.actionPrinciples = updates.actionPrinciples as UserProfile["actionPrinciples"];
  if (Array.isArray(updates.wantToDo)) next.wantToDo = updates.wantToDo as UserProfile["wantToDo"];
  if (typeof updates.timezone === "string") next.timezone = updates.timezone;
  return next;
}
