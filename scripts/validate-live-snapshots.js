const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const SNAPSHOT_GROUPS = snapshotGroups();

main();

function main() {
  let checked = 0;
  for (const groupName of SNAPSHOT_GROUPS) {
    checked += validateGroupSnapshots(groupName);
  }
  if (!checked) {
    console.log("[validate-snapshots] no snapshot indexes; skipping.");
  }
}

function validateGroupSnapshots(groupName) {
  const snapshotDir = path.join(DATA_DIR, `${groupName}-snapshots`);
  const indexPath = path.join(snapshotDir, "index.json");
  if (!fs.existsSync(indexPath)) {
    console.log(`[validate-snapshots] ${groupName}: no snapshot index; skipping.`);
    return 0;
  }

  const index = readJson(indexPath);
  const errors = validateIndex(index, groupName, snapshotDir);

  if (errors.length) {
    for (const error of errors) console.error(`[validate-snapshots] ${error}`);
    process.exit(1);
  }

  const count = (index.snapshots || []).length;
  console.log(`[validate-snapshots] ${groupName}: checked ${count} snapshot(s).`);
  return count;
}

function validateIndex(index, groupName, snapshotDir) {
  const errors = [];
  if (!index || typeof index !== "object") {
    errors.push(`${groupName}: index must be an object`);
    return errors;
  }

  const retentionDays = Number(index.retentionDays || index.retainedDays || 7);
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  const generatedAt = Date.parse(index.generatedAt || "");

  if (!Number.isInteger(index.schemaVersion)) errors.push(`${groupName}: index.schemaVersion must be an integer`);
  if (index.snapshotType && index.snapshotType !== groupName) errors.push(`${groupName}: index.snapshotType must be ${groupName}`);
  if (index.group && index.group !== groupName) errors.push(`${groupName}: index.group must be ${groupName}`);
  if (!Number.isFinite(generatedAt)) errors.push(`${groupName}: index.generatedAt must be a valid timestamp`);
  if (!Number.isFinite(retentionMs) || retentionMs <= 0) errors.push(`${groupName}: index.retentionDays must be positive`);
  if (!Array.isArray(index.snapshots)) errors.push(`${groupName}: index.snapshots must be an array`);

  const seen = new Set();
  for (const entry of Array.isArray(index.snapshots) ? index.snapshots : []) {
    validateSnapshotEntry({ entry, groupName, snapshotDir, generatedAt, retentionMs, retentionDays, seen, errors });
  }

  return errors;
}

function validateSnapshotEntry({ entry, groupName, snapshotDir, generatedAt, retentionMs, retentionDays, seen, errors }) {
  const id = String(entry?.id || "");
  if (!/^[0-9]{8}T[0-9]{6}Z$/.test(id)) errors.push(`${groupName}: invalid snapshot id: ${id || "(empty)"}`);
  if (seen.has(id)) errors.push(`${groupName}: duplicate snapshot id: ${id}`);
  seen.add(id);

  const fileName = entry.file || `${id}.json`;
  const snapshotPath = path.join(snapshotDir, fileName);
  if (!fs.existsSync(snapshotPath)) {
    errors.push(`${groupName}: missing snapshot file: ${fileName}`);
    return;
  }

  const snapshot = readJson(snapshotPath);
  const items = snapshot.groups?.[groupName]?.items;
  const capturedAt = Date.parse(entry.capturedAt || entry.generatedAt || snapshot.generatedAt || "");
  if (snapshot.snapshotType !== groupName) errors.push(`${groupName}/${fileName}: snapshotType must be ${groupName}`);
  if (snapshot.group && snapshot.group !== groupName) errors.push(`${groupName}/${fileName}: group must be ${groupName}`);
  if (!Array.isArray(items)) errors.push(`${groupName}/${fileName}: groups.${groupName}.items must be an array`);
  if (!Number.isFinite(capturedAt)) errors.push(`${groupName}/${fileName}: capturedAt/generatedAt must be valid`);
  if (Number.isFinite(generatedAt) && Number.isFinite(capturedAt) && generatedAt - capturedAt > retentionMs + 60 * 1000) {
    errors.push(`${groupName}/${fileName}: snapshot is older than ${retentionDays} day retention`);
  }
}

function snapshotGroups() {
  const raw = process.env.YTB_RANKING_SNAPSHOT_GROUPS || "live,today,month";
  const supported = new Set(["live", "today", "month"]);
  const groups = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => supported.has(value));
  return groups.length ? Array.from(new Set(groups)) : ["live", "today", "month"];
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
