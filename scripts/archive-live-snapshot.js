const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "youtube-ranking.json");
const SNAPSHOT_DIR = path.join(ROOT, "data", "live-snapshots");
const INDEX_PATH = path.join(SNAPSHOT_DIR, "index.json");
const RETENTION_DAYS = positiveInteger(process.env.YTB_RANKING_LIVE_SNAPSHOT_DAYS, 7);
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

main();

function main() {
  const payload = readJson(DATA_PATH);
  const liveGroup = payload.groups?.live;
  if (!liveGroup || !Array.isArray(liveGroup.items)) {
    throw new Error("data/youtube-ranking.json does not contain groups.live.items");
  }

  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

  const capturedAt = parseDate(liveGroup.updatedAt || liveGroup.collectedAt || payload.generatedAt || payload.collectedAt) || new Date();
  const now = new Date();
  const snapshotId = formatSnapshotId(capturedAt);
  const expiresAt = new Date(capturedAt.getTime() + RETENTION_MS);
  const file = `${snapshotId}.json`;
  const snapshotPath = path.join(SNAPSHOT_DIR, file);
  const index = loadIndex();
  const snapshot = buildSnapshot(payload, liveGroup, snapshotId, capturedAt, expiresAt);

  writeJson(snapshotPath, snapshot);

  const nextSnapshots = new Map();
  for (const entry of Array.isArray(index.snapshots) ? index.snapshots : []) {
    if (!entry || !isSafeSnapshotId(entry.id)) continue;
    const entryDate = parseDate(entry.capturedAt || entry.generatedAt || entry.id);
    if (!entryDate || now.getTime() - entryDate.getTime() > RETENTION_MS) continue;
    if (!fs.existsSync(path.join(SNAPSHOT_DIR, `${entry.id}.json`))) continue;
    nextSnapshots.set(entry.id, normalizeEntry(entry));
  }

  const summary = summarizeLiveGroup(liveGroup);
  nextSnapshots.set(snapshotId, {
    id: snapshotId,
    file,
    path: `data/live-snapshots/${file}`,
    generatedAt: capturedAt.toISOString(),
    capturedAt: capturedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    label: formatSnapshotLabel(capturedAt),
    itemCount: summary.itemCount,
    liveCount: summary.liveCount,
    upcomingCount: summary.upcomingCount,
    keywords: summary.keywords,
  });

  const snapshots = Array.from(nextSnapshots.values()).sort((a, b) => {
    return Date.parse(b.capturedAt || b.generatedAt || "") - Date.parse(a.capturedAt || a.generatedAt || "");
  });

  pruneSnapshotFiles(new Set(snapshots.map((entry) => `${entry.id}.json`)));

  writeJson(INDEX_PATH, {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    retentionDays: RETENTION_DAYS,
    retainedDays: RETENTION_DAYS,
    latestSnapshotId: snapshots[0]?.id || "",
    snapshots,
  });

  console.log(`[live-snapshot] wrote ${file}; retained ${snapshots.length} snapshot(s) for ${RETENTION_DAYS} days.`);
}

function buildSnapshot(payload, liveGroup, snapshotId, capturedAt, expiresAt) {
  return {
    schemaVersion: payload.schemaVersion || 1,
    snapshotType: "live",
    snapshotId,
    generatedAt: capturedAt.toISOString(),
    collectedAt: capturedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    target: payload.target,
    limits: payload.limits,
    locale: payload.locale,
    region: payload.region,
    groups: {
      live: {
        ...liveGroup,
        updatedAt: capturedAt.toISOString(),
        collectedAt: capturedAt.toISOString(),
      },
    },
  };
}

function summarizeLiveGroup(group) {
  const items = Array.isArray(group.items) ? group.items : [];
  const keywords = {};
  for (const item of items) {
    const keyword = String(item.keyword || "").trim() || "unknown";
    keywords[keyword] = (keywords[keyword] || 0) + 1;
  }
  return {
    itemCount: items.length,
    liveCount: items.filter((item) => item.statusType === "live").length,
    upcomingCount: items.filter((item) => item.statusType === "upcoming").length,
    keywords,
  };
}

function loadIndex() {
  try {
    return readJson(INDEX_PATH);
  } catch {
    return { snapshots: [] };
  }
}

function pruneSnapshotFiles(keepFiles) {
  if (!fs.existsSync(SNAPSHOT_DIR)) return;
  for (const dirent of fs.readdirSync(SNAPSHOT_DIR, { withFileTypes: true })) {
    if (!dirent.isFile() || !dirent.name.endsWith(".json") || dirent.name === "index.json") continue;
    if (!keepFiles.has(dirent.name)) fs.rmSync(path.join(SNAPSHOT_DIR, dirent.name));
  }
}

function normalizeEntry(entry) {
  const id = entry.id;
  return {
    id,
    file: entry.file || `${id}.json`,
    path: entry.path || `data/live-snapshots/${id}.json`,
    generatedAt: entry.generatedAt || entry.capturedAt,
    capturedAt: entry.capturedAt || entry.generatedAt,
    expiresAt: entry.expiresAt,
    label: entry.label || formatSnapshotLabel(parseDate(entry.capturedAt || entry.generatedAt || id) || new Date()),
    itemCount: Number(entry.itemCount) || 0,
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
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
