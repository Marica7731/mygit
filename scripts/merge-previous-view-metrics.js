#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT_DIR, "data", "youtube-ranking.json");
const PREVIOUS_FILE = process.env.YTB_RANKING_PREVIOUS_DATA || "/tmp/youtube-ranking-previous.json";

function positiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function clean(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
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

function groupItems(payload, group) {
  const items = payload?.groups?.[group]?.items;
  return Array.isArray(items) ? items : [];
}

function previousByVideoId(previousPayload) {
  const map = new Map();
  for (const group of ["today", "month"]) {
    for (const item of groupItems(previousPayload, group)) {
      if (!item.videoId || !positiveNumber(item.viewCount)) continue;
      if (!map.has(item.videoId)) map.set(item.videoId, item);
    }
  }
  return map;
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const payload = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  const previousPayload = await readJsonIfExists(PREVIOUS_FILE);
  if (!previousPayload) {
    console.log(`[previous-metric] previous data not available at ${PREVIOUS_FILE}`);
    return;
  }

  const previous = previousByVideoId(previousPayload);
  let checked = 0;
  let changed = 0;

  for (const group of ["today", "month"]) {
    for (const item of groupItems(payload, group)) {
      if (!item.videoId || item.statusType === "live" || item.statusType === "upcoming") continue;
      if (positiveNumber(item.viewCount)) continue;
      checked += 1;

      const oldItem = previous.get(item.videoId);
      if (!oldItem) continue;

      item.viewCount = Number(oldItem.viewCount);
      item.viewText = oldItem.viewText || `${Math.round(Number(oldItem.viewCount)).toLocaleString("ja-JP")} 回視聴`;
      item.viewSource = "previousRun";
      item.searchableText = buildSearchableText(item);
      changed += 1;
    }
  }

  payload.previousMetricMerge = {
    generatedAt: new Date().toISOString(),
    previousGeneratedAt: previousPayload.generatedAt || "",
    checked,
    changed,
  };

  await fs.writeFile(DATA_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[previous-metric] checked=${checked}, changed=${changed}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
