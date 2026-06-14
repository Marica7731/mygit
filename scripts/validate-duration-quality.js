#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT_DIR, "data", "youtube-ranking.json");

const CONFIG = {
  minDurationCoverage: numberEnv("YTB_RANKING_MIN_DURATION_COVERAGE", 0.85),
  minKeywordDurationCoverage: numberEnv("YTB_RANKING_MIN_KEYWORD_DURATION_COVERAGE", 0.8),
  minGroupItems: intEnv("YTB_RANKING_MIN_VIEW_GROUP_ITEMS", 30),
  minKeywordItems: intEnv("YTB_RANKING_MIN_KEYWORD_ITEMS", 10),
};

const KEYWORDS = ["歌枠", "弾き語り"];
const GROUPS = ["today", "month"];

function main() {
  const payload = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  const errors = [];

  for (const group of GROUPS) {
    checkDurationCoverage(group, getItems(payload, group), errors);
  }

  if (errors.length) {
    console.error("[validate-duration] data quality check failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log("[validate-duration] duration quality check passed");
}

function getItems(payload, group) {
  const items = payload?.groups?.[group]?.items;
  return Array.isArray(items) ? items : [];
}

function checkDurationCoverage(group, items, errors) {
  const videos = items.filter((item) => item.statusType !== "live" && item.statusType !== "upcoming");
  if (videos.length < CONFIG.minGroupItems) {
    errors.push(`${group}: only ${videos.length} non-live videos collected`);
    return;
  }

  const withDuration = videos.filter(hasDuration);
  const ratio = withDuration.length / videos.length;
  if (ratio < CONFIG.minDurationCoverage) {
    errors.push(
      `${group}: duration coverage ${withDuration.length}/${videos.length} (${percent(ratio)}) below ${percent(
        CONFIG.minDurationCoverage,
      )}`,
    );
  }

  for (const keyword of KEYWORDS) {
    const keywordVideos = videos.filter((item) => item.keyword === keyword || item.group === keyword);
    if (keywordVideos.length < CONFIG.minKeywordItems) continue;

    const keywordWithDuration = keywordVideos.filter(hasDuration);
    const keywordRatio = keywordWithDuration.length / keywordVideos.length;
    if (keywordRatio < CONFIG.minKeywordDurationCoverage) {
      errors.push(
        `${group}/${keyword}: duration coverage ${keywordWithDuration.length}/${keywordVideos.length} (${percent(
          keywordRatio,
        )}) below ${percent(CONFIG.minKeywordDurationCoverage)}`,
      );
    }
  }
}

function hasDuration(item) {
  return positiveNumber(item.durationSeconds) || clean(item.durationText);
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
