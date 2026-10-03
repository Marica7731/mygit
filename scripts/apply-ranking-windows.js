#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const {
  DEFAULT_TIME_ZONE: WINDOW_TIME_ZONE,
  WEEK_WINDOW_MS,
  formatDate,
  startOfCalendarMonth,
} = require("./lib/ranking-window");
const { loadSnapshotUnion, unionWindowItems } = require("./lib/snapshot-union");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const DATA_FILE = path.join(DATA_DIR, "youtube-ranking.json");

const KEYWORDS = ["歌枠", "弾き語り"];

function main() {
  const payload = readJson(DATA_FILE);

  const monthGroup = payload?.groups?.month;
  if (!monthGroup || !Array.isArray(monthGroup.items)) {
    throw new Error("data/youtube-ranking.json does not contain groups.month.items");
  }

  const windowEnd = Date.parse(monthGroup.updatedAt || monthGroup.collectedAt || payload.generatedAt || "");
  if (!Number.isFinite(windowEnd)) {
    throw new Error("groups.month.updatedAt is missing or invalid; cannot resolve ranking windows");
  }

  const previousWindows =
    payload.rankingWindows && payload.rankingWindows.applied === true ? payload.rankingWindows : null;
  const currentItems = monthGroup.items;
  const currentGroupIsWindowed = Boolean(monthGroup.window);
  const currentRawItemCount = currentGroupIsWindowed
    ? finiteCount(previousWindows?.sourceItemCount, currentItems.length)
    : currentItems.length;
  const monthStart = startOfCalendarMonth(windowEnd, WINDOW_TIME_ZONE);
  const weekStart = windowEnd - WEEK_WINDOW_MS;
  const snapshotHistory = loadSnapshotUnion(DATA_DIR, { start: weekStart, end: windowEnd });
  const candidateBatches = [
    { source: "current:groups.month.items", items: currentItems },
    { source: "historical:snapshot-union", items: snapshotHistory.items },
  ];

  const monthItems = unionWindowItems(candidateBatches, monthStart, windowEnd);
  const weekItems = unionWindowItems(candidateBatches, weekStart, windowEnd);
  const snapshotsFound = snapshotHistory.filesRead > 0;

  // A window can legitimately be empty in the first minutes of a month or week.
  // Warn loudly instead of failing the whole pipeline on an honest empty result.
  if (!monthItems.length) {
    console.warn(
      `[ranking-windows] WARNING: calendar-month window ${formatDate(monthStart, WINDOW_TIME_ZONE)}` +
        `..${formatDate(windowEnd, WINDOW_TIME_ZONE)} selected 0 items`,
    );
  }
  if (!weekItems.length) {
    console.warn(
      `[ranking-windows] WARNING: 7-day window ${formatDate(weekStart, WINDOW_TIME_ZONE)}` +
        `..${formatDate(windowEnd, WINDOW_TIME_ZONE)} selected 0 items`,
    );
  }

  const currentRawMonthItems = currentItems.filter((item) => inWindow(item, monthStart, windowEnd));
  const currentRawWeekItems = currentItems.filter((item) => inWindow(item, weekStart, windowEnd));
  const windows = {
    applied: true,
    appliedAt: new Date().toISOString(),
    timeZone: WINDOW_TIME_ZONE,
    source: snapshotsFound ? "snapshot-union+groups.month.items" : "groups.month.items",
    sourceItemCount: currentRawItemCount,
    sourceItemCountMeaning: "raw crawl pool size before snapshot-union output",
    snapshotUnion: {
      enabled: snapshotsFound,
      source: snapshotsFound ? "historical snapshots + current groups.month.items" : "current groups.month.items",
      sourceGroups: snapshotHistory.sourceGroups,
      filesRead: snapshotHistory.filesRead,
      itemsScanned: snapshotHistory.itemsScanned,
      missingFiles: snapshotHistory.missingFiles,
      skippedBeforeWindow: snapshotHistory.skippedBeforeWindow,
      currentRawItemCount,
      currentRawInWindow: {
        month: currentGroupIsWindowed
          ? finiteCount(
              previousWindows?.snapshotUnion?.currentRawInWindow?.month,
              currentRawMonthItems.length,
            )
          : currentRawMonthItems.length,
        week: currentGroupIsWindowed
          ? finiteCount(previousWindows?.snapshotUnion?.currentRawInWindow?.week, currentRawWeekItems.length)
          : currentRawWeekItems.length,
      },
      monthCount: monthItems.length,
      weekCount: weekItems.length,
      dedupeKey: "videoId | url | keyword/title/channel/publishedTimestamp",
      outputCap: null,
    },
    week: buildWindow("rolling", weekStart, windowEnd, WEEK_WINDOW_MS),
    month: buildWindow("calendar-month", monthStart, windowEnd, windowEnd - monthStart),
  };

  payload.groups.week = buildWeekGroup(monthGroup, weekItems, weekStart, windowEnd);
  applyMonthWindow(monthGroup, monthItems, monthStart, windowEnd);
  payload.rankingWindows = windows;

  fs.writeFileSync(DATA_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    `[ranking-windows] timezone=${WINDOW_TIME_ZONE} month=${monthItems.length} ` +
      `week=${weekItems.length} rawPool=${currentRawItemCount} ` +
      `snapshots=${snapshotHistory.filesRead} scanned=${snapshotHistory.itemsScanned} ` +
      `monthStart=${formatDate(monthStart, WINDOW_TIME_ZONE)} windowEnd=${formatDate(windowEnd, WINDOW_TIME_ZONE)}`,
  );
}

function finiteCount(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function countInWindow(items, start, end) {
  return items.filter((item) => inWindow(item, start, end)).length;
}

function buildWindow(kind, start, end, durationMs) {
  return {
    kind,
    timeZone: WINDOW_TIME_ZONE,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    durationMs: Number(durationMs),
    startLabel: formatDate(start, WINDOW_TIME_ZONE),
    endLabel: formatDate(end, WINDOW_TIME_ZONE),
  };
}

function buildWeekGroup(monthGroup, items, start, end) {
  return {
    ...monthGroup,
    sourceGroup: "week",
    label: "近7天热度",
    title: "近7天歌枠 / 弾き語り热度排行",
    description:
      "Historical snapshots and the current crawl pool, merged by published time and deduplicated by video. No output cap.",
    items,
    keywords: keywordsByGroup(items),
    sources: rescopeSources(monthGroup.sources, items),
    window: buildWindow("rolling", start, end, end - start),
  };
}

function applyMonthWindow(monthGroup, items, start, end) {
  monthGroup.items = items;
  monthGroup.description =
    "Historical snapshots and the current crawl pool, merged by published time and deduplicated by video. No output cap.";
  monthGroup.keywords = keywordsByGroup(items);
  monthGroup.sources = rescopeSources(monthGroup.sources, items);
  monthGroup.window = buildWindow("calendar-month", start, end, end - start);
}

function rescopeSources(sources, items) {
  if (!Array.isArray(sources)) return sources;
  return sources.map((source) => ({
    ...source,
    itemCount: items.filter((item) => matchesKeyword(item, source.keyword)).length,
  }));
}

function keywordsByGroup(items) {
  const grouped = {};
  for (const keyword of KEYWORDS) grouped[keyword] = [];
  for (const item of items) {
    const keyword = String(item.keyword || item.group || "");
    if (!Object.prototype.hasOwnProperty.call(grouped, keyword)) grouped[keyword] = [];
    grouped[keyword].push(item);
  }
  return grouped;
}

function matchesKeyword(item, keyword) {
  return String(item.keyword || item.group || "") === String(keyword || "");
}

function inWindow(item, start, end) {
  const timestamp = Number(item?.publishedTimestamp);
  if (!Number.isFinite(timestamp)) return false;
  return timestamp >= start && timestamp <= end;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

main();
