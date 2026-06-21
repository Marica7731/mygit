const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "youtube-ranking.json");
const DATA_DIR = path.join(ROOT, "data");
const SNAPSHOT_GROUPS = snapshotGroups();
const RETENTION_DAYS = positiveInteger(
  process.env.YTB_RANKING_SNAPSHOT_DAYS || process.env.YTB_RANKING_LIVE_SNAPSHOT_DAYS,
  7,
);
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const SNAPSHOT_TIME_ZONE = process.env.YTB_RANKING_SNAPSHOT_TIME_ZONE || "Asia/Taipei";

main();

function main() {
  const payload = readJson(DATA_PATH);
  for (const groupName of SNAPSHOT_GROUPS) archiveGroupSnapshot(payload, groupName);
}

function archiveGroupSnapshot(payload, groupName) {
  const group = payload.groups?.[groupName];
  if (!group || !Array.isArray(group.items)) {
    throw new Error(`data/youtube-ranking.json does not contain groups.${groupName}.items`);
  }

  const snapshotDir = snapshotDirForGroup(groupName);
  const indexPath = path.join(snapshotDir, "index.json");
  fs.mkdirSync(snapshotDir, { recursive: true });

  const capturedAt = parseDate(group.updatedAt || group.collectedAt || payload.generatedAt || payload.collectedAt) || new Date();
  const now = new Date();
  const snapshotId = formatSnapshotId(capturedAt);
  const expiresAt = new Date(capturedAt.getTime() + RETENTION_MS);
  const file = `${snapshotId}.json`;
  const snapshotPath = path.join(snapshotDir, file);
  const index = loadIndex(indexPath);
  const snapshot = buildSnapshot(payload, groupName, group, snapshotId, capturedAt, expiresAt);

  writeJson(snapshotPath, snapshot);

  const nextSnapshots = new Map();
  for (const entry of Array.isArray(index.snapshots) ? index.snapshots : []) {
    if (!entry || !isSafeSnapshotId(entry.id)) continue;
    const entryDate = parseDate(entry.capturedAt || entry.generatedAt || entry.id);
    if (!entryDate || now.getTime() - entryDate.getTime() > RETENTION_MS) continue;
    if (!fs.existsSync(path.join(snapshotDir, `${entry.id}.json`))) continue;
    nextSnapshots.set(entry.id, normalizeEntry(entry, groupName));
  }

  const summary = summarizeGroup(group);
  nextSnapshots.set(snapshotId, {
    id: snapshotId,
    file,
    path: `data/${groupName}-snapshots/${file}`,
    group: groupName,
    snapshotType: groupName,
    generatedAt: capturedAt.toISOString(),
    capturedAt: capturedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    label: formatSnapshotLabel(capturedAt),
    itemCount: summary.itemCount,
    videoCount: summary.videoCount,
    liveCount: summary.liveCount,
    upcomingCount: summary.upcomingCount,
    keywords: summary.keywords,
  });

  const snapshots = Array.from(nextSnapshots.values()).sort((a, b) => {
    return Date.parse(b.capturedAt || b.generatedAt || "") - Date.parse(a.capturedAt || a.generatedAt || "");
  });

  pruneSnapshotFiles(snapshotDir, new Set(snapshots.map((entry) => `${entry.id}.json`)));

  writeJson(indexPath, {
    schemaVersion: 1,
    snapshotType: groupName,
    group: groupName,
    generatedAt: now.toISOString(),
    retentionDays: RETENTION_DAYS,
    retainedDays: RETENTION_DAYS,
    latestSnapshotId: snapshots[0]?.id || "",
    snapshots,
  });

  console.log(`[snapshot] ${groupName}: wrote ${file}; retained ${snapshots.length} snapshot(s) for ${RETENTION_DAYS} days.`);
}

function buildSnapshot(payload, groupName, group, snapshotId, capturedAt, expiresAt) {
  return {
    schemaVersion: payload.schemaVersion || 1,
    snapshotType: groupName,
    group: groupName,
    snapshotId,
    generatedAt: capturedAt.toISOString(),
    collectedAt: capturedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    target: payload.target,
    limits: payload.limits,
    locale: payload.locale,
    region: payload.region,
    groups: {
      [groupName]: {
        ...group,
        updatedAt: capturedAt.toISOString(),
        collectedAt: capturedAt.toISOString(),
      },
    },
  };
}

function summarizeGroup(group) {
  const items = Array.isArray(group.items) ? group.items : [];
  const keywords = {};
  for (const item of items) {
    const keyword = String(item.keyword || "").trim() || "unknown";
    keywords[keyword] = (keywords[keyword] || 0) + 1;
  }
  return {
    itemCount: items.length,
    videoCount: items.filter((item) => item.statusType !== "live" && item.statusType !== "upcoming").length,
    liveCount: items.filter((item) => item.statusType === "live").length,
    upcomingCount: items.filter((item) => item.statusType === "upcoming").length,
    keywords,
  };
}

function loadIndex(indexPath) {
  try {
    return readJson(indexPath);
  } catch {
    return { snapshots: [] };
  }
}

function pruneSnapshotFiles(snapshotDir, keepFiles) {
  if (!fs.existsSync(snapshotDir)) return;
  for (const dirent of fs.readdirSync(snapshotDir, { withFileTypes: true })) {
    if (!dirent.isFile() || !dirent.name.endsWith(".json") || dirent.name === "index.json") continue;
    if (!keepFiles.has(dirent.name)) fs.rmSync(path.join(snapshotDir, dirent.name));
  }
}

function normalizeEntry(entry, groupName) {
  const id = entry.id;
  return {
    id,
    file: entry.file || `${id}.json`,
    path: entry.path || `data/${groupName}-snapshots/${id}.json`,
    group: entry.group || groupName,
    snapshotType: entry.snapshotType || groupName,
    generatedAt: entry.generatedAt || entry.capturedAt,
    capturedAt: entry.capturedAt || entry.generatedAt,
    expiresAt: entry.expiresAt,
    label: formatSnapshotLabel(parseDate(entry.capturedAt || entry.generatedAt || id) || new Date()),
    itemCount: Number(entry.itemCount) || 0,
    videoCount: Number(entry.videoCount) || 0,
    liveCount: Number(entry.liveCount) || 0,
    upcomingCount: Number(entry.upcomingCount) || 0,
    keywords: entry.keywords && typeof entry.keywords === "object" ? entry.keywords : {},
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function formatSnapshotId(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function formatSnapshotLabel(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SNAPSHOT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

function parseDate(value) {
  if (!value) return null;
  if (/^\d{8}T\d{6}Z$/.test(String(value))) {
    const text = String(value);
    return new Date(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${text.slice(9, 11)}:${text.slice(11, 13)}:${text.slice(13, 15)}Z`);
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function isSafeSnapshotId(value) {
  return /^[0-9]{8}T[0-9]{6}Z$/.test(String(value || ""));
}

function snapshotDirForGroup(groupName) {
  return path.join(DATA_DIR, `${groupName}-snapshots`);
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
