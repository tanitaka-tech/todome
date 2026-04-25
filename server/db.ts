import { Database } from "bun:sqlite";
import { getDbPath } from "./config.ts";

let cachedDb: Database | null = null;
let cachedPath: string | null = null;

export function getDb(): Database {
  const path = getDbPath();
  if (cachedDb && cachedPath === path) return cachedDb;
  if (cachedDb) cachedDb.close();
  cachedDb = new Database(path, { create: true });
  cachedDb.exec("PRAGMA journal_mode = WAL");
  cachedPath = path;
  initDb(cachedDb);
  return cachedDb;
}

export function resetDbCache(): void {
  if (cachedDb) {
    cachedDb.close();
    cachedDb = null;
    cachedPath = null;
  }
}

export function initDb(db: Database = getDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kanban_tasks (
      id TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS retrospectives (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      document TEXT NOT NULL,
      messages TEXT NOT NULL,
      ai_comment TEXT NOT NULL DEFAULT '',
      completed_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS life_activities (
      id TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS life_logs (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL DEFAULT '',
      memo TEXT NOT NULL DEFAULT '',
      alert_triggered TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_life_logs_started ON life_logs(started_at);
    CREATE TABLE IF NOT EXISTS quotas (
      id TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quota_logs (
      id TEXT PRIMARY KEY,
      quota_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL DEFAULT '',
      memo TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_quota_logs_started ON quota_logs(started_at);
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      subscription_id TEXT NOT NULL DEFAULT '',
      external_uid TEXT NOT NULL DEFAULT '',
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_schedules_start ON schedules(start_at);
    CREATE INDEX IF NOT EXISTS idx_schedules_subscription ON schedules(subscription_id);
    CREATE TABLE IF NOT EXISTS calendar_subscriptions (
      id TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);
}

export function walCheckpoint(): void {
  if (!cachedDb) return;
  try {
    cachedDb.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch {
    // DB が切り替わった直後などの一時エラーは無視
  }
}
