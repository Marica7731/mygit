#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT_DIR, "data", "youtube-ranking.json");

function main() {
  const payload = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  let checked = 0;
  let durationChanged = 0;
  let statusChanged = 0;

  for (const item of allItems(payload)) {
    checked += 1;
    if (normalizeDuration(item)) durationChanged += 1;
    if (normalizeVideoStatus(item)) statusChanged += 1;
  }

  payload.durationFieldNormalize = {
    generatedAt: new Date().toISOString(),
    checked,
    changed: durationChanged,
    statusChanged,
  };

  fs.writeFileSync(DATA_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[duration-normalize] checked=${checked}, changed=${durationChanged}, statusChanged=${statusChanged}`);
}

function allItems(payload) {
  return Object.values(payload.groups || {}).flatMap((group) => (Array.isArray(group?.items) ? group.items : []));
}

function normalizeDuration(item) {
  const fromSeconds = positiveNumber(item.durationSeconds) ? Number(item.durationSeconds) : null;
  const fromText = parseDurationText(item.durationText);
  const seconds = fromSeconds || fromText;
  if (!seconds) return false;

  let changed = false;
  const nextText = formatDuration(seconds);
  if (item.durationSeconds !== seconds) {
    item.durationSeconds = seconds;
    changed = true;
  }
  if (clean(item.durationText) !== nextText) {
    item.durationText = nextText;
    changed = true;
  }
  if (changed) item.searchableText = buildSearchableText(item);
  return changed;
}

function normalizeVideoStatus(item) {
  if (!item || item.sourceGroup === "live") return false;
  if (item.statusType !== "live" && item.statusType !== "upcoming") return false;
  if (!hasVideoEvidence(item)) return false;

  let changed = false;
  item.statusType = "video";
  changed = true;

  if (item.liveViewerSource !== "youtubeDataApi") {
    if (item.liveViewerText) {
      item.liveViewerText = "";
      changed = true;
    }
    if (item.liveViewerCount != null) {
      item.liveViewerCount = null;
      changed = true;
    }
    if (item.liveViewerSource) {
      item.liveViewerSource = "";
      changed = true;
    }
  }

  if (changed) item.searchableText = buildSearchableText(item);
  return changed;
}

function hasVideoEvidence(item) {
  return (
    positiveNumber(item.viewCount) ||
    viewTextHasViews(item.viewText) ||
    positiveNumber(item.durationSeconds) ||
    Boolean(parseDurationText(item.durationText))
  );
}

function viewTextHasViews(value) {
  return /[0-9０-９][0-9０-９,，.．]*\s*(?:億|亿|万|萬|千|K|M|B)?\s*(?:回視聴|視聴回数|views?|次观看|次觀看|播放)/i.test(
    clean(value),
  );
}

function parseDurationText(value) {
  const match = clean(value).match(/\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/);
  if (!match) return null;
  const parts = match[0].split(":").map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + parts[1];
}

function formatDuration(seconds) {
  const number = Number(seconds);
  if (!Number.isFinite(number) || number <= 0) return "";
  const total = Math.round(number);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainSeconds = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainSeconds).padStart(2, "0")}`;
  return `${minutes}:${String(remainSeconds).padStart(2, "0")}`;
}

function buildSearchableText(item) {
  return clean(
    [
      item.title,
      item.channelName,
      item.videoId,
      item.watchUrl,
      item.viewText,
      item.liveViewerText,
      item.subscriberText,
      item.likeText,
      item.publishedText,
      item.durationText,
      item.statusText,
      item.channelId,
      item.channelUrl,
      item.group,
      item.keyword,
      item.sourceGroup,
      item.sourceUrl,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function positiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function clean(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

main();
