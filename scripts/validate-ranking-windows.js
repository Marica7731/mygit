#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const {
  DEFAULT_TIME_ZONE,
  WEEK_WINDOW_MS,
  formatDate,
  startOfCalendarMonth,
} = require("./lib/ranking-window");

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

  // sourceItemCount describes the raw crawl pool, so it must stay at least as
  // large as the retained month window.
  if (Number(windows.sourceItemCount) < monthGroup.items.length) {
    errors.push(
      `rankingWindows.sourceItemCount (${windows.sourceItemCount}) must be >= month items (${monthGroup.items.length})`,
    );
  }

  report(errors);
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
