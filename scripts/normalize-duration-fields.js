#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT_DIR, "data", "youtube-ranking.json");

function main() {
  const payload = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  let checked = 0;
  let changed = 0;

  for (const item of allItems(payload)) {
    checked += 1;
    if (normalizeDuration(item)) changed += 1;
  }

  payload.durationFieldNormalize = {
    generatedAt: new Date().toISOString(),
    checked,
    changed,
  };

  fs.writeFileSync(DATA_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[duration-normalize] checked=${checked}, changed=${changed}`);
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
