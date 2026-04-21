import { getDb } from "../db.ts";
import type { UserProfile } from "../types.ts";

export const DEFAULT_PROFILE: UserProfile = {
  currentState: "",
  balanceWheel: [],
  actionPrinciples: [],
  wantToDo: [],
};

interface Row {
  data: string;
}

export function loadProfile(): UserProfile {
  const row = getDb()
    .prepare("SELECT data FROM profile WHERE id = 1")
    .get() as Row | undefined;
  if (!row) return { ...DEFAULT_PROFILE };
  return JSON.parse(row.data) as UserProfile;
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
  if (Array.isArray(updates.balanceWheel)) next.balanceWheel = updates.balanceWheel;
  if (Array.isArray(updates.actionPrinciples)) next.actionPrinciples = updates.actionPrinciples;
  if (Array.isArray(updates.wantToDo)) next.wantToDo = updates.wantToDo;
  return next;
}
