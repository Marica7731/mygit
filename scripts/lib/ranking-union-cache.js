const fs = require("node:fs");
const path = require("node:path");

const { snapshotItemKey } = require("./snapshot-union");

const CACHE_FILENAME = "ranking-union-cache.json";
const CACHE_PATH = `data/${CACHE_FILENAME}`;
const CACHE_SCHEMA_VERSION = 1;
const REQUIRED_SOURCE_GROUPS = ["month", "week", "today", "live"];

function cachePathFor(dataDir) {
  return path.join(dataDir, CACHE_FILENAME);
}

function buildRankingUnionCache(payload, options = {}) {
  const sourceCacheGeneratedAt = options.sourceCacheGeneratedAt || null;
  const windows = payload?.rankingWindows;
  const union = windows?.snapshotUnion;
  const monthWindow = windows?.month;
  const items = payload?.groups?.month?.items;
  const errors = [];

  if (windows?.applied !== true) errors.push("rankingWindows.applied must be true");
  if (monthWindow?.kind !== "rolling-month") errors.push("rankingWindows.month.kind must be rolling-month");
  if (union?.enabled !== true) errors.push("rankingWindows.snapshotUnion.enabled must be true");
  if (Date.parse(union?.historyStart || "") !== Date.parse(monthWindow?.start || "")) {
    errors.push("rankingWindows.snapshotUnion.historyStart must equal month.start");
  }
  if (union?.outputCap !== null) errors.push("rankingWindows.snapshotUnion.outputCap must be null");
  if (!Array.isArray(items) || !items.length) errors.push("groups.month.items must be a nonempty array");
  if (errors.length) throw new Error(`cannot build ranking union cache: ${errors.join("; ")}`);

  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    generatedAt: windows.appliedAt || payload.generatedAt,
    source: windows.source,
    sourceGroups: normalizeSourceGroups(union.sourceGroups),
    ...(sourceCacheGeneratedAt ? { derivedFrom: { cacheGeneratedAt: sourceCacheGeneratedAt } } : {}),
    month: {
      kind: monthWindow.kind,
      timeZone: monthWindow.timeZone,
      start: monthWindow.start,
      end: monthWindow.end,
    },
    snapshotUnion: {
      enabled: true,
      historyStart: union.historyStart,
      sourceGroups: normalizeSourceGroups(union.sourceGroups),
      outputCap: null,
    },
    items,
  };
}

function loadRankingUnionCache(dataDir) {
  const filePath = cachePathFor(dataDir);
  let cache;
  try {
    cache = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(
      `ranking union cache is required and must be valid JSON (${CACHE_PATH}): ${error.message}`,
    );
  }

  const errors = [];
  if (cache?.schemaVersion !== CACHE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${CACHE_SCHEMA_VERSION}`);
  }
  if (!Number.isFinite(Date.parse(cache?.generatedAt || ""))) errors.push("generatedAt must be valid");
  if (cache?.month?.kind !== "rolling-month") errors.push("month.kind must be rolling-month");
  if (!Number.isFinite(Date.parse(cache?.month?.start || ""))) errors.push("month.start must be valid");
  if (!Number.isFinite(Date.parse(cache?.month?.end || ""))) errors.push("month.end must be valid");
  if (cache?.snapshotUnion?.enabled !== true) errors.push("snapshotUnion.enabled must be true");
  if (Date.parse(cache?.snapshotUnion?.historyStart || "") !== Date.parse(cache?.month?.start || "")) {
    errors.push("snapshotUnion.historyStart must equal month.start");
  }
  if (cache?.snapshotUnion?.outputCap !== null) errors.push("snapshotUnion.outputCap must be null");
  if (!Array.isArray(cache?.items) || !cache.items.length) errors.push("items must be a nonempty array");

  const sourceGroups = normalizeSourceGroups(cache?.sourceGroups);
  if (REQUIRED_SOURCE_GROUPS.some((group) => !sourceGroups.includes(group))) {
    errors.push(`sourceGroups must include ${REQUIRED_SOURCE_GROUPS.join(", ")}`);
  }
  if (errors.length) throw new Error(`invalid ranking union cache (${CACHE_PATH}): ${errors.join("; ")}`);

  const seen = new Set();
  for (const item of cache.items) {
    const key = snapshotItemKey(item);
    if (seen.has(key)) throw new Error(`ranking union cache contains duplicate key: ${key}`);
    seen.add(key);
  }

  const start = Date.parse(cache.month.start);
  const end = Date.parse(cache.month.end);
  const itemsOutsideWindow = cache.items.filter((item) => !inWindow(item, start, end)).length;
  return {
    items: cache.items,
    sourceGroups,
    generatedAt: cache.generatedAt,
    derivedFrom: cache.derivedFrom || null,
    month: cache.month,
    snapshotUnion: cache.snapshotUnion,
    filesRead: 1,
    itemsScanned: cache.items.length,
    missingFiles: 0,
    skippedBeforeWindow: itemsOutsideWindow,
    itemsOutsideWindow,
  };
}

function normalizeSourceGroups(value) {
  return Array.isArray(value) ? Array.from(new Set(value.map(String))) : [];
}

function inWindow(item, start, end) {
  const timestamp = Number(item?.publishedTimestamp);
  return Number.isFinite(timestamp) && timestamp >= start && timestamp <= end;
}

function writeRankingUnionCache(dataDir, cache) {
  const filePath = cachePathFor(dataDir);
  fs.writeFileSync(filePath, `${JSON.stringify(cache)}\n`, "utf8");
  return filePath;
}

module.exports = {
  CACHE_PATH,
  CACHE_SCHEMA_VERSION,
  REQUIRED_SOURCE_GROUPS,
  buildRankingUnionCache,
  cachePathFor,
  loadRankingUnionCache,
  writeRankingUnionCache,
};
