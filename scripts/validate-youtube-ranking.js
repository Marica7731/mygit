#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT_DIR, "data", "youtube-ranking.json");

const CONFIG = {
  minViewCoverage: numberEnv("YTB_RANKING_MIN_VIEW_COVERAGE", 0.5),
  minKeywordViewCoverage: numberEnv("YTB_RANKING_MIN_KEYWORD_VIEW_COVERAGE", 0.45),
  minViewGroupItems: intEnv("YTB_RANKING_MIN_VIEW_GROUP_ITEMS", 30),
  minKeywordItems: intEnv("YTB_RANKING_MIN_KEYWORD_ITEMS", 10),
  minLiveSubscriberCoverage: numberEnv("YTB_RANKING_MIN_LIVE_SUBSCRIBER_COVERAGE", 0.55),
  maxMissingThumbnailRatio: numberEnv("YTB_RANKING_MAX_MISSING_THUMBNAIL_RATIO", 0.05),
};

const KEYWORDS = ["歌枠", "弾き語り"];
const VIEW_GROUPS = ["today", "month"];

function main() {
  const payload = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  const errors = [];

  for (const group of ["live", "today", "month"]) {
    const items = getItems(payload, group);
    if (!items.length) errors.push(`${group}: items is empty`);
    checkThumbnails(group, items, errors);
  }

  checkLiveSubscribers(getItems(payload, "live"), errors);
  for (const group of VIEW_GROUPS) checkViewCoverage(group, getItems(payload, group), errors);

  if (errors.length) {
    console.error("[validate-ranking] data quality check failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log("[validate-ranking] data quality check passed");
}

function getItems(payload, group) {
  const items = payload?.groups?.[group]?.items;
  return Array.isArray(items) ? items : [];
}

function checkThumbnails(group, items, errors) {
  if (!items.length) return;
  const missing = items.filter((item) => !clean(item.thumbnailUrl)).length;
  const ratio = missing / items.length;
  if (ratio > CONFIG.maxMissingThumbnailRatio) {
    errors.push(
      `${group}: missing thumbnails ${missing}/${items.length} (${percent(ratio)}) exceeds ${percent(
        CONFIG.maxMissingThumbnailRatio,
      )}`,
    );
  }
}

function checkLiveSubscribers(items, errors) {
  if (!items.length) return;
  const liveItems = items.filter((item) => item.statusType === "live" || item.statusType === "upcoming");
  if (!liveItems.length) return;

  const subscriberItems = liveItems.filter((item) => positiveNumber(item.subscriberCount));
  const ratio = subscriberItems.length / liveItems.length;
  if (ratio < CONFIG.minLiveSubscriberCoverage) {
    errors.push(
      `live: subscriber coverage ${subscriberItems.length}/${liveItems.length} (${percent(ratio)}) below ${percent(
        CONFIG.minLiveSubscriberCoverage,
      )}`,
    );
  }

  const untrustedLiveViewers = liveItems.filter(
    (item) => positiveNumber(item.liveViewerCount) && item.liveViewerSource !== "youtubeDataApi",
  );
  if (untrustedLiveViewers.length) {
    errors.push(`live: ${untrustedLiveViewers.length} untrusted liveViewerCount values remain`);
  }
}

function checkViewCoverage(group, items, errors) {
  const videos = items.filter((item) => item.statusType !== "live" && item.statusType !== "upcoming");
  if (videos.length < CONFIG.minViewGroupItems) {
    errors.push(`${group}: only ${videos.length} non-live videos collected`);
    return;
  }

  const withViews = videos.filter((item) => positiveNumber(item.viewCount));
  const ratio = withViews.length / videos.length;
  if (ratio < CONFIG.minViewCoverage) {
    errors.push(
      `${group}: view coverage ${withViews.length}/${videos.length} (${percent(ratio)}) below ${percent(
        CONFIG.minViewCoverage,
      )}`,
    );
  }

  for (const keyword of KEYWORDS) {
    const keywordVideos = videos.filter((item) => item.keyword === keyword || item.group === keyword);
    if (keywordVideos.length < CONFIG.minKeywordItems) continue;
    const keywordWithViews = keywordVideos.filter((item) => positiveNumber(item.viewCount));
    const keywordRatio = keywordWithViews.length / keywordVideos.length;
    if (keywordRatio < CONFIG.minKeywordViewCoverage) {
      errors.push(
        `${group}/${keyword}: view coverage ${keywordWithViews.length}/${keywordVideos.length} (${percent(
          keywordRatio,
        )}) below ${percent(CONFIG.minKeywordViewCoverage)}`,
      );
    }
  }
}

function positiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function clean(value) {
  return String(value || "").trim();
}

function percent(value) {
  return `${Math.round(value * 1000) / 10}%`;
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

main();
