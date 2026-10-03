#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const {
  DEFAULT_TIME_ZONE,
  WEEK_WINDOW_MS,
  formatDate,
  startOfCalendarMonth,
} = require("./lib/ranking-window");
const { snapshotItemKey } = require("./lib/snapshot-union");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT_DIR, "data", "youtube-ranking.json");
const KEYWORDS = ["歌枠", "弾き語り"];
const GROUPS = ["week", "month"];

function main() {
  const payload = readJson(DATA_FILE);
  const errors = [];

  const windows = payload?.rankingWindows;
  if (!windows || windows.applied !== true) {
    errors.push("rankingWindows.applied must be true; run node scripts/apply-ranking-windows.js");
    report(errors);
    return;
  }
  if (windows.timeZone !== DEFAULT_TIME_ZONE) {
    errors.push(`rankingWindows.timeZone must be ${DEFAULT_TIME_ZONE}, got ${windows.timeZone}`);
  }

  const monthGroup = payload?.groups?.month;
  const weekGroup = payload?.groups?.week;
  if (!monthGroup || !Array.isArray(monthGroup.items)) errors.push("groups.month.items must be an array");
  if (!weekGroup || !Array.isArray(weekGroup.items)) errors.push("groups.week.items must be an array");
  if (errors.length) {
    report(errors);
    return;
  }

  const windowEnd = Date.parse(monthGroup.updatedAt || monthGroup.collectedAt || payload.generatedAt || "");
  if (!Number.isFinite(windowEnd)) {
    errors.push("groups.month.updatedAt must be a valid timestamp");
    report(errors);
    return;
  }

  const expectedMonthStart = startOfCalendarMonth(windowEnd, DEFAULT_TIME_ZONE);
  const expectedWeekStart = windowEnd - WEEK_WINDOW_MS;
  checkWindowSpec(errors, "month", windows.month, "calendar-month", expectedMonthStart, windowEnd);
  checkWindowSpec(errors, "week", windows.week, "rolling", expectedWeekStart, windowEnd);

  checkGroupWindow(errors, "month", monthGroup, expectedMonthStart, windowEnd);
  checkGroupWindow(errors, "week", weekGroup, expectedWeekStart, windowEnd);

  const monthStartDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIME_ZONE,
    day: "2-digit",
  }).format(new Date(expectedMonthStart));
  if (monthStartDay !== "01") {
    errors.push(`month window must start on day 01 in ${DEFAULT_TIME_ZONE}, got ${monthStartDay}`);
  }

  const sourceItemCount = Number(windows.sourceItemCount);
  if (!Number.isFinite(sourceItemCount) || sourceItemCount < 0) {
    errors.push(`rankingWindows.sourceItemCount must be a finite nonnegative count, got ${windows.sourceItemCount}`);
  }

  validateSnapshotUnion(errors, windows, monthGroup, weekGroup);

  report(errors);
}

function validateSnapshotUnion(errors, windows, monthGroup, weekGroup) {
  const union = windows.snapshotUnion;
  if (!union || typeof union !== "object") {
    // Old payloads were created before snapshot union existed. They still pass
    // the window checks; the first workflow run adds and then enforces union
    // metadata.
    return;
  }

  if (union.enabled !== true) {
    errors.push("rankingWindows.snapshotUnion.enabled must be true after snapshot history is available");
    return;
  }
  if (!String(windows.source || "").startsWith("snapshot-union")) {
    errors.push("rankingWindows.source must identify snapshot-union output when snapshotUnion.enabled is true");
  }

  const numericFields = [
    "filesRead",
    "itemsScanned",
    "missingFiles",
    "skippedBeforeWindow",
    "currentRawItemCount",
    "monthCount",
    "weekCount",
  ];
  for (const field of numericFields) {
    const value = Number(union[field]);
    if (!Number.isFinite(value) || value < 0) {
      errors.push(`rankingWindows.snapshotUnion.${field} must be a finite nonnegative count, got ${union[field]}`);
    }
  }
  if (Number(union.filesRead) <= 0) {
    errors.push("rankingWindows.snapshotUnion.filesRead must be > 0 when snapshot union is enabled");
  }
  const expectedSourceGroups = ["month", "week", "today", "live"];
  const sourceGroups = new Set(Array.isArray(union.sourceGroups) ? union.sourceGroups : []);
  const missingSourceGroups = expectedSourceGroups.filter((group) => !sourceGroups.has(group));
  if (missingSourceGroups.length) {
    errors.push(
      `rankingWindows.snapshotUnion.sourceGroups is missing required history: ${missingSourceGroups.join(", ")}`,
    );
  }
  if (Number(union.itemsScanned) <= 0) {
    errors.push("rankingWindows.snapshotUnion.itemsScanned must be > 0 when snapshot union is enabled");
  }
  validateUniqueItems(errors, "month", monthGroup.items);
  validateUniqueItems(errors, "week", weekGroup.items);
  if (Number(union.monthCount) !== monthGroup.items.length) {
    errors.push(
      `rankingWindows.snapshotUnion.monthCount (${union.monthCount}) must equal month items (${monthGroup.items.length})`,
    );
  }
  if (Number(union.weekCount) !== weekGroup.items.length) {
    errors.push(
      `rankingWindows.snapshotUnion.weekCount (${union.weekCount}) must equal week items (${weekGroup.items.length})`,
    );
  }

  const currentRaw = union.currentRawInWindow;
  if (!currentRaw || typeof currentRaw !== "object") {
    errors.push("rankingWindows.snapshotUnion.currentRawInWindow must be an object");
    return;
  }
  for (const name of ["month", "week"]) {
    const rawCount = Number(currentRaw[name]);
    const unionCount = Number(name === "month" ? union.monthCount : union.weekCount);
    if (!Number.isFinite(rawCount) || rawCount < 0) {
      errors.push(`rankingWindows.snapshotUnion.currentRawInWindow.${name} must be a finite nonnegative count`);
    } else if (unionCount < rawCount) {
      errors.push(
        `rankingWindows.snapshotUnion.${name} union count (${unionCount}) must be >= current raw in-window count (${rawCount})`,
      );
    }
  }
  if (union.outputCap !== null) {
    errors.push("rankingWindows.snapshotUnion.outputCap must be null; formal window output has no item cap");
  }
}

function validateUniqueItems(errors, name, items) {
  const seen = new Set();
  const duplicates = new Set();
  for (const item of items) {
    const key = snapshotItemKey(item);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  if (duplicates.size) {
    errors.push(`groups.${name}: ${duplicates.size} duplicate snapshot-union key(s) remain`);
  }
}

function checkWindowSpec(errors, name, spec, kind, expectedStart, expectedEnd) {
  if (!spec || typeof spec !== "object") {
    errors.push(`rankingWindows.${name} must be an object`);
    return;
  }
  if (spec.kind !== kind) errors.push(`rankingWindows.${name}.kind must be ${kind}, got ${spec.kind}`);
  if (Date.parse(spec.start) !== expectedStart) {
    errors.push(
      `rankingWindows.${name}.start must be ${formatDate(expectedStart, DEFAULT_TIME_ZONE)}, got ${spec.start}`,
    );
  }
  if (Date.parse(spec.end) !== expectedEnd) {
    errors.push(`rankingWindows.${name}.end must be ${new Date(expectedEnd).toISOString()}, got ${spec.end}`);
  }
  if (name === "week" && Number(spec.durationMs) !== WEEK_WINDOW_MS) {
    errors.push(`rankingWindows.week.durationMs must be ${WEEK_WINDOW_MS}, got ${spec.durationMs}`);
  }
}

function checkGroupWindow(errors, name, group, start, end) {
  const window = group.window;
  if (!window || typeof window !== "object") {
    errors.push(`groups.${name}.window must be present`);
    return;
  }
  if (Date.parse(window.start) !== start || Date.parse(window.end) !== end) {
    errors.push(`groups.${name}.window does not match rankingWindows.${name}`);
  }

  const outside = (group.items || []).filter((item) => {
    const timestamp = Number(item?.publishedTimestamp);
    return !Number.isFinite(timestamp) || timestamp < start || timestamp > end;
  });
  if (outside.length) {
    errors.push(`groups.${name}: ${outside.length} item(s) fall outside ${window.start}..${window.end}`);
  }
  if (!group.items.length) {
    console.warn(`[validate-windows] WARNING: groups.${name}.items is empty for ${window.start}..${window.end}`);
  }

  const keywordTotal = KEYWORDS.reduce((sum, keyword) => sum + (group.keywords?.[keyword]?.length || 0), 0);
  if (keywordTotal !== group.items.length) {
    errors.push(`groups.${name}: keywords total ${keywordTotal} != items ${group.items.length}`);
  }

  if (Array.isArray(group.sources)) {
    const sourceTotal = group.sources.reduce((sum, source) => sum + (Number(source.itemCount) || 0), 0);
    if (sourceTotal !== group.items.length) {
      errors.push(`groups.${name}: source itemCount total ${sourceTotal} != items ${group.items.length}`);
    }
    const incomplete = group.sources.filter(
      (source) => source.reachedBottom !== true && source.truncatedByLimit !== true,
    );
    if (incomplete.length) {
      errors.push(`groups.${name}: ${incomplete.length} source(s) lost crawl completion metadata`);
    }
  }
}

function report(errors) {
  if (errors.length) {
    console.error("[validate-windows] ranking window check failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log("[validate-windows] ranking window check passed");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

main();
