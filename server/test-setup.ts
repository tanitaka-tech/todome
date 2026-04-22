import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "bun:test";

// Bun はテストファイルごとに新しいワーカーでこのプリロードを評価する。
// 静的 import より前に実行されるため、config.ts が DATA_DIR を解決する時点で
// TODOME_DATA_DIR が確実にセットされている。
const dir = mkdtempSync(join(tmpdir(), "todome-test-"));
process.env.TODOME_DATA_DIR = dir;

afterAll(() => rmSync(dir, { recursive: true, force: true }));
