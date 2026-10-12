#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const { snapshotItemKey } = require("./lib/snapshot-union");
const { REQUIRED_SOURCE_GROUPS, cachePathFor, loadRankingUnionCache } = require("./lib/ranking-union-cache");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT_DIR, "data", "youtube-ranking.json");

function main() {
  const payload = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  const windows = payload?.rankingWindows;
  const union = windows?.snapshotUnion;
  const monthItems = payload?.groups?.month?.items;
  const errors = [];

  if (!Array.isArray(monthItems)) fail("groups.month.items must be an array");

  let cache;
  try {
    cache = loadRankingUnionCache(path.join(ROOT_DIR, "data"));
  } catch (error) {
    fail(error.message);
  }

  assert(errors, windows?.applied === true, "rankingWindows.applied must be true");
  assert(errors, windows?.month?.kind === "rolling-month", "month window must be rolling-month");
  assert(errors, union?.enabled === true, "snapshot union must be enabled");
  assert(
    errors,
    String(windows?.source || "").startsWith("snapshot-union-cache"),
    "windows.source must identify the ranking union cache",
  );
  assert(errors, Date.parse(union?.historyStart || "") === Date.parse(windows?.month?.start || ""),
    "snapshot union historyStart must equal month.start");
  assert(errors, union?.outputCap === null, "snapshot union outputCap must be null");
  assert(errors, Number(union?.filesRead) === 1, "cache-based union must read exactly one cache file");

  const cacheInfo = union?.cache || {};
  assert(errors, Number(union?.itemsScanned) === Number(cacheInfo.itemsScanned), "cache scan count must match cache metadata");
  assert(errors, cacheInfo.enabled === true, "snapshot union cache metadata must be enabled");
  assert(errors, cacheInfo.path === "data/ranking-union-cache.json", "cache path metadata is invalid");
  assert(errors, cacheInfo.schemaVersion === 1, "cache schemaVersion metadata must be 1");
  assert(errors, cache.generatedAt === cacheInfo.generatedAt, "cache generatedAt metadata is stale");
  assert(
    errors,
    cache.derivedFrom?.cacheGeneratedAt === cacheInfo.sourceCacheGeneratedAt,
    "cache derivedFrom lineage does not match the previous cache",
  );
  const missingProvenance = REQUIRED_SOURCE_GROUPS.filter((group) => {
    return !union?.sourceGroups?.includes(group) || !cacheInfo.sourceGroups?.includes(group);
  });
  assert(
    errors,
    missingProvenance.length === 0,
    `cache provenance is missing source groups: ${missingProvenance.join(", ")}`,
  );

  if (cache.items.length !== monthItems.length) {
    errors.push(
      `cache item count (${cache.items.length}) must equal month items (${monthItems.length})`,
    );
  } else {
    const cacheKeys = new Set(cache.items.map(snapshotItemKey));
    const monthKeys = new Set(monthItems.map(snapshotItemKey));
    if (cacheKeys.size !== cache.items.length || monthKeys.size !== monthItems.length) {
      errors.push("cache and month union must both be deduplicated");
    }
    for (const key of cacheKeys) {
      if (!monthKeys.has(key)) {
        errors.push("ranking union cache contains an item absent from the month union");
        break;
      }
    }
    for (const key of monthKeys) {
      if (!cacheKeys.has(key)) {
        errors.push("month union contains an item absent from the ranking union cache");
        break;
      }
    }
  }

  if (errors.length) {
    console.error("[verify-ranking-union-cache] failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  const expectedPath = cachePathFor(path.join(ROOT_DIR, "data"));
  console.log(`[verify-ranking-union-cache] passed: ${cache.items.length} items (${expectedPath})`);
}

function assert(errors, condition, message) {
  if (condition !== true) errors.push(message);
}

function fail(message) {
  console.error(`[verify-ranking-union-cache] ${message}`);
  process.exit(1);
}

main();
