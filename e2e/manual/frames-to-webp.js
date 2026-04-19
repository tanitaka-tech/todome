#!/usr/bin/env node
// animation-frames/<name>/*.png と frames.json を読み、
// docs/manual/assets/animations/<name>.webp に変換する。
// 依存: Homebrew の `webp` パッケージ (`brew install webp`) が提供する img2webp。

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const FRAMES_ROOT = path.resolve(__dirname, "..", "animation-frames");
const OUT_ROOT = path.resolve(
  __dirname,
  "..",
  "..",
  "docs",
  "manual",
  "assets",
  "animations",
);

function ensureImg2webp() {
  const res = spawnSync("img2webp", ["-version"], { stdio: "ignore" });
  if (res.error || res.status !== 0) {
    console.error(
      "img2webp が見つかりません。Homebrew で `brew install webp` を実行してください。",
    );
    process.exit(1);
  }
}

function buildOne(name) {
  const dir = path.join(FRAMES_ROOT, name);
  const metaPath = path.join(dir, "frames.json");
  if (!fs.existsSync(metaPath)) {
    console.warn(`skip: ${name} (frames.json なし)`);
    return;
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  const delayMs = Math.round(1000 / meta.fps);
  const frames = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".png"))
    .sort();
  if (frames.length === 0) {
    console.warn(`skip: ${name} (PNG フレーム 0 枚)`);
    return;
  }

  fs.mkdirSync(OUT_ROOT, { recursive: true });
  const output = path.join(OUT_ROOT, `${name}.webp`);

  // img2webp: -loop はファイル全体オプション、-d/-q/-m/-lossy は先頭フレームに適用
  // すると以降の全フレームに引き継がれる。
  const args = [
    "-loop",
    "0",
    "-d",
    String(delayMs),
    "-q",
    "70",
    "-m",
    "6",
    "-lossy",
    ...frames.map((f) => path.join(dir, f)),
    "-o",
    output,
  ];
  console.log(
    `Building ${name}.webp (${frames.length} frames @ ${meta.fps}fps, ${delayMs}ms/frame)…`,
  );
  execFileSync("img2webp", args, { stdio: "inherit" });
  const size = fs.statSync(output).size;
  console.log(`  → ${output} (${(size / 1024).toFixed(1)} KB)`);
}

function main() {
  ensureImg2webp();
  if (!fs.existsSync(FRAMES_ROOT)) {
    console.error(
      `animation-frames/ がありません。先に \`npm run animate:capture\` を走らせてください。`,
    );
    process.exit(1);
  }
  const names = fs
    .readdirSync(FRAMES_ROOT)
    .filter((n) => fs.statSync(path.join(FRAMES_ROOT, n)).isDirectory());
  if (names.length === 0) {
    console.error("animation-frames/ 配下に対象ディレクトリがありません。");
    process.exit(1);
  }
  for (const name of names) buildOne(name);
}

main();
