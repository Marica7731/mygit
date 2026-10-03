const fs = require("node:fs");
const path = require("node:path");

const SNAPSHOT_GROUPS = ["month", "week", "today", "live"];
const NUMERIC_FILL_FIELDS = ["viewCount", "liveViewerCount", "durationSeconds", "subscriberCount"];
const TEXT_FILL_FIELDS = ["viewText", "liveViewerText", "durationText", "publishedText", "thumbnailUrl"];

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function snapshotItemKey(item) {
  const videoId = String(item?.videoId || item?.id || "").trim();
  if (videoId) return `video:${videoId}`;

  const watchUrl = String(item?.watchUrl || item?.url || "").trim();
  if (watchUrl) return `url:${watchUrl}`;

  const title = String(item?.title || "").trim();
  const channel = String(item?.channelName || item?.channel || "").trim();
  const keyword = String(item?.keyword || item?.group || "").trim();
  const timestamp = Number(item?.publishedTimestamp);
  return [
    "fallback",
    keyword,
    title,
    channel,
    Number.isFinite(timestamp) ? timestamp : "",
  ].join("|");
}

function hasUsefulValue(value) {
  if (value == null || value === "") return false;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  return true;
}

function mergeSnapshotItem(existing, incoming) {
  let merged = existing;
  let changed = false;

  for (const field of NUMERIC_FILL_FIELDS) {
    if (!hasUsefulValue(existing[field]) && hasUsefulValue(incoming[field])) {
      if (!changed) merged = { ...existing };
      changed = true;
      merged[field] = incoming[field];
    }
  }
  for (const field of TEXT_FILL_FIELDS) {
    if (!hasUsefulValue(existing[field]) && hasUsefulValue(incoming[field])) {
      if (!changed) merged = { ...existing };
      changed = true;
      merged[field] = incoming[field];
    }
  }

  return merged;
}

function loadSnapshotBatches(dataDir, groups = SNAPSHOT_GROUPS) {
  const batches = [];
  const sourceGroups = [];
  let itemsScanned = 0;
  let missingFiles = 0;

  for (const group of groups) {
    const snapshotDir = path.join(dataDir, `${group}-snapshots`);
    const index = readJsonIfExists(path.join(snapshotDir, "index.json"));
    if (!index || !Array.isArray(index.snapshots)) continue;

    let groupRead = false;
    for (const entry of index.snapshots) {
      if (!entry || !entry.id) continue;
      const fileName = path.basename(String(entry.file || `${entry.id}.json`));
      const filePath = path.join(snapshotDir, fileName);
      const snapshot = readJsonIfExists(filePath);
      if (!snapshot) {
        missingFiles += 1;
        continue;
      }

      const items = snapshot.groups?.[group]?.items;
      if (!Array.isArray(items)) continue;
      groupRead = true;
      itemsScanned += items.length;
      batches.push({
        source: `${group}:${entry.id}`,
        capturedAt: entry.capturedAt || entry.generatedAt || null,
        items,
      });
    }

    if (groupRead) sourceGroups.push(group);
  }

  return {
    batches,
    sourceGroups,
    filesRead: batches.length,
    itemsScanned,
    missingFiles,
  };
}

function loadSnapshotUnion(dataDir, options = {}) {
  const groups = options.groups || SNAPSHOT_GROUPS;
  const start = Number.isFinite(options.start) ? options.start : -Infinity;
  const end = Number.isFinite(options.end) ? options.end : Infinity;
  const entries = [];

  for (const group of groups) {
    const snapshotDir = path.join(dataDir, `${group}-snapshots`);
    const index = readJsonIfExists(path.join(snapshotDir, "index.json"));
    if (!index || !Array.isArray(index.snapshots)) continue;

    for (const [order, entry] of index.snapshots.entries()) {
      if (!entry || !entry.id) continue;
      const capturedAtText = entry.capturedAt || entry.generatedAt || null;
      const capturedAt = capturedAtText ? Date.parse(capturedAtText) : NaN;
      const fileName = path.basename(String(entry.file || `${entry.id}.json`));
      entries.push({
        group,
        id: String(entry.id),
        order,
        capturedAt,
        filePath: path.join(snapshotDir, fileName),
      });
    }
  }

  // Index entries are normally newest-first, but sorting here makes merge
  // priority independent of how an older index was written.
  entries.sort((left, right) => {
    const leftTime = Number.isFinite(left.capturedAt) ? left.capturedAt : -Infinity;
    const rightTime = Number.isFinite(right.capturedAt) ? right.capturedAt : -Infinity;
    if (leftTime !== rightTime) return rightTime - leftTime;
    return left.order - right.order;
  });

  const byKey = new Map();
  const sourceGroups = new Set();
  let filesRead = 0;
  let itemsScanned = 0;
  let missingFiles = 0;
  let skippedBeforeWindow = 0;

  for (const entry of entries) {
    if (Number.isFinite(entry.capturedAt) && entry.capturedAt < start) {
      skippedBeforeWindow += 1;
      continue;
    }

    const snapshot = readJsonIfExists(entry.filePath);
    if (!snapshot) {
      missingFiles += 1;
      continue;
    }
    const items = snapshot.groups?.[entry.group]?.items;
    if (!Array.isArray(items)) continue;

    filesRead += 1;
    itemsScanned += items.length;
    sourceGroups.add(entry.group);
    for (const item of items) {
      if (!inWindow(item, start, end)) continue;
      const key = snapshotItemKey(item);
      const existing = byKey.get(key);
      byKey.set(key, existing ? mergeSnapshotItem(existing, item) : { ...item });
    }
  }

  return {
    items: Array.from(byKey.values()),
    sourceGroups: Array.from(sourceGroups),
    filesRead,
    itemsScanned,
    missingFiles,
    skippedBeforeWindow,
  };
}

function inWindow(item, start, end) {
  const timestamp = Number(item?.publishedTimestamp);
  return Number.isFinite(timestamp) && timestamp >= start && timestamp <= end;
}

function unionWindowItems(batches, start, end) {
  const byKey = new Map();

  for (const batch of batches) {
    for (const item of batch?.items || []) {
      if (!inWindow(item, start, end)) continue;
      const key = snapshotItemKey(item);
      const existing = byKey.get(key);
      byKey.set(key, existing ? mergeSnapshotItem(existing, item) : { ...item });
    }
  }

  return Array.from(byKey.values());
}

module.exports = {
  SNAPSHOT_GROUPS,
  loadSnapshotBatches,
  loadSnapshotUnion,
  mergeSnapshotItem,
  snapshotItemKey,
  unionWindowItems,
};
