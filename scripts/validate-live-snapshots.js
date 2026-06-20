const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_DIR = path.join(ROOT, "data", "live-snapshots");
const INDEX_PATH = path.join(SNAPSHOT_DIR, "index.json");

main();

function main() {
  if (!fs.existsSync(INDEX_PATH)) {
    console.log("[validate-live-snapshots] no snapshot index; skipping.");
    return;
  }

  const index = readJson(INDEX_PATH);
  const retentionDays = Number(index.retentionDays || index.retainedDays || 7);
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  const generatedAt = Date.parse(index.generatedAt || "");
  const errors = [];

  if (!Number.isInteger(index.schemaVersion)) errors.push("index.schemaVersion must be an integer");
  if (!Number.isFinite(generatedAt)) errors.push("index.generatedAt must be a valid timestamp");
  if (!Number.isFinite(retentionMs) || retentionMs <= 0) errors.push("index.retentionDays must be positive");
  if (!Array.isArray(index.snapshots)) errors.push("index.snapshots must be an array");

  const seen = new Set();
  for (const entry of Array.isArray(index.snapshots) ? index.snapshots : []) {
    const id = String(entry?.id || "");
    if (!/^[0-9]{8}T[0-9]{6}Z$/.test(id)) errors.push(`invalid snapshot id: ${id || "(empty)"}`);
    if (seen.has(id)) errors.push(`duplicate snapshot id: ${id}`);
    seen.add(id);

    const fileName = entry.file || `${id}.json`;
    const snapshotPath = path.join(SNAPSHOT_DIR, fileName);
    if (!fs.existsSync(snapshotPath)) {
      errors.push(`missing snapshot file: ${fileName}`);
      continue;
    }

    const snapshot = readJson(snapshotPath);
    const liveItems = snapshot.groups?.live?.items;
    const capturedAt = Date.parse(entry.capturedAt || entry.generatedAt || snapshot.generatedAt || "");
    if (snapshot.snapshotType !== "live") errors.push(`${fileName}: snapshotType must be live`);
    if (!Array.isArray(liveItems)) errors.push(`${fileName}: groups.live.items must be an array`);
    if (!Number.isFinite(capturedAt)) errors.push(`${fileName}: capturedAt/generatedAt must be valid`);
    if (Number.isFinite(generatedAt) && Number.isFinite(capturedAt) && generatedAt - capturedAt > retentionMs + 60 * 1000) {
      errors.push(`${fileName}: snapshot is older than ${retentionDays} day retention`);
    }
  }

  if (errors.length) {
    for (const error of errors) console.error(`[validate-live-snapshots] ${error}`);
    process.exit(1);
  }

  console.log(`[validate-live-snapshots] checked ${(index.snapshots || []).length} snapshot(s).`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
