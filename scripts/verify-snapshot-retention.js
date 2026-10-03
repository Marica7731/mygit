#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const OLD_SNAPSHOT_ID = "20200101T000000Z";
const OLD_CAPTURED_AT = "2020-01-01T00:00:00Z";
const GROUPS = ["live", "today", "week", "month"];

function main() {
  const keepAll = makeWorkspace();
  runArchiver(keepAll);
  assertKeepAll(keepAll, "keep-all default");
  runArchiver(keepAll);
  assertKeepAll(keepAll, "keep-all idempotent rerun");
  assertValidator(keepAll);

  const pruned = makeWorkspace();
  runArchiver(pruned, { YTB_RANKING_SNAPSHOT_DAYS: "1" });
  const prunedFile = path.join(pruned, "data", "month-snapshots", `${OLD_SNAPSHOT_ID}.json`);
  if (fs.existsSync(prunedFile)) {
    fail("opt-in retention: expected the 2020 snapshot file to be pruned when YTB_RANKING_SNAPSHOT_DAYS=1");
  }
  console.log("[verify-snapshot-retention] opt-in pruning still works with an explicit retention window");
  console.log("[verify-snapshot-retention] passed");
}

function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytb-snapshot-retention-"));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "data", "month-snapshots"), { recursive: true });

  for (const name of ["archive-live-snapshot.js", "validate-live-snapshots.js"]) {
    fs.copyFileSync(path.join(ROOT_DIR, "scripts", name), path.join(dir, "scripts", name));
  }

  const collectedAt = new Date().toISOString();
  const groups = {};
  for (const group of GROUPS) {
    groups[group] = {
      sourceGroup: group,
      updatedAt: collectedAt,
      collectedAt,
      sources: [],
      keywords: { 歌枠: [], 弾き語り: [] },
      items: [],
    };
  }
  writeJson(path.join(dir, "data", "youtube-ranking.json"), {
    schemaVersion: 1,
    generatedAt: collectedAt,
    collectedAt,
    groups,
  });

  writeJson(path.join(dir, "data", "month-snapshots", `${OLD_SNAPSHOT_ID}.json`), {
    schemaVersion: 1,
    snapshotType: "month",
    group: "month",
    snapshotId: OLD_SNAPSHOT_ID,
    generatedAt: OLD_CAPTURED_AT,
    collectedAt: OLD_CAPTURED_AT,
    groups: { month: { items: [] } },
  });

  writeJson(path.join(dir, "data", "month-snapshots", "index.json"), {
    schemaVersion: 1,
    snapshotType: "month",
    group: "month",
    generatedAt: OLD_CAPTURED_AT,
    retentionDays: 7,
    retainedDays: 7,
    latestSnapshotId: OLD_SNAPSHOT_ID,
    snapshots: [
      {
        id: OLD_SNAPSHOT_ID,
        file: `${OLD_SNAPSHOT_ID}.json`,
        path: `data/month-snapshots/${OLD_SNAPSHOT_ID}.json`,
        group: "month",
        snapshotType: "month",
        generatedAt: OLD_CAPTURED_AT,
        capturedAt: OLD_CAPTURED_AT,
        itemCount: 0,
        keywords: {},
      },
    ],
  });

  return dir;
}

function runArchiver(dir, extraEnv = {}) {
  const result = spawnSync(process.execPath, ["scripts/archive-live-snapshot.js"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    fail(`archiver exited ${result.status}: ${result.stderr || result.stdout}`);
  }
}

function assertValidator(dir) {
  const result = spawnSync(process.execPath, ["scripts/validate-live-snapshots.js"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 30000,
  });
  if (result.status !== 0) {
    fail(`snapshot validator rejected retained history: ${result.stderr || result.stdout}`);
  }
}

function assertKeepAll(dir, label) {
  const snapshotFile = path.join(dir, "data", "month-snapshots", `${OLD_SNAPSHOT_ID}.json`);
  if (!fs.existsSync(snapshotFile)) {
    fail(`${label}: historical snapshot ${OLD_SNAPSHOT_ID}.json was deleted`);
  }
  const index = JSON.parse(fs.readFileSync(path.join(dir, "data", "month-snapshots", "index.json"), "utf8"));
  if (index.retentionPolicy !== "keep-all") {
    fail(`${label}: retentionPolicy must be keep-all, got ${index.retentionPolicy}`);
  }
  if (!index.snapshots.some((entry) => entry.id === OLD_SNAPSHOT_ID)) {
    fail(`${label}: historical snapshot ${OLD_SNAPSHOT_ID} was dropped from the index`);
  }
  console.log(`[verify-snapshot-retention] ${label}: preserved ${OLD_SNAPSHOT_ID}`);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fail(message) {
  console.error(`[verify-snapshot-retention] ${message}`);
  process.exit(1);
}

main();
