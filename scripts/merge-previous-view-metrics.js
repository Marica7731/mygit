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

function previousViewsByVideoId(previousPayload) {
  const map = new Map();
  for (const group of ["today", "month"]) {
    for (const item of groupItems(previousPayload, group)) {
      if (!item.videoId || !positiveNumber(item.viewCount)) continue;
      if (!map.has(item.videoId)) map.set(item.videoId, item);
    }
  }
  return map;
}

function channelUrlKey(value) {
  const raw = clean(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/g, "");
    return url.href.toLowerCase();
  } catch {
    return raw.replace(/\/+$/g, "").toLowerCase();
  }
}

function rememberFirst(map, key, item) {
  if (key && !map.has(key)) map.set(key, item);
}

function previousLiveSubscriberIndexes(previousPayload) {
  const byVideoId = new Map();
  const byChannelId = new Map();
  const byChannelUrl = new Map();
  const byChannelName = new Map();

  for (const item of groupItems(previousPayload, "live")) {
    if (!positiveNumber(item.subscriberCount)) continue;
    rememberFirst(byVideoId, clean(item.videoId), item);
    rememberFirst(byChannelId, clean(item.channelId), item);
    rememberFirst(byChannelUrl, channelUrlKey(item.channelUrl), item);
    rememberFirst(byChannelName, clean(item.channelName).toLowerCase(), item);
  }

  return { byVideoId, byChannelId, byChannelUrl, byChannelName };
}

function findPreviousLiveSubscriber(indexes, item) {
  return (
    indexes.byVideoId.get(clean(item.videoId)) ||
    indexes.byChannelId.get(clean(item.channelId)) ||
    indexes.byChannelUrl.get(channelUrlKey(item.channelUrl)) ||
    indexes.byChannelName.get(clean(item.channelName).toLowerCase()) ||
    null
  );
}

function formatSubscriberText(value) {
  return `${Math.round(Number(value)).toLocaleString("ja-JP")} 登録者`;
}

function recoverLiveSubscriber(item, oldItem) {
  if (!oldItem || !positiveNumber(oldItem.subscriberCount)) return false;

  item.subscriberCount = Number(oldItem.subscriberCount);
  item.subscriberText = oldItem.subscriberText || formatSubscriberText(oldItem.subscriberCount);
  item.subscriberSource = "previousRun";

  for (const key of ["channelId", "channelUrl", "channelAvatarUrl", "thumbnailUrl"]) {
    if (!item[key] && oldItem[key]) item[key] = oldItem[key];
  }

  item.searchableText = buildSearchableText(item);
  return true;
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

  const previous = previousViewsByVideoId(previousPayload);
  const previousLiveSubscribers = previousLiveSubscriberIndexes(previousPayload);
  let checked = 0;
  let changed = 0;
  let liveSubscriberChecked = 0;
  let liveSubscriberChanged = 0;

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

  for (const item of groupItems(payload, "live")) {
    if (!(item.statusType === "live" || item.statusType === "upcoming")) continue;
    if (positiveNumber(item.subscriberCount)) continue;
    liveSubscriberChecked += 1;

    if (recoverLiveSubscriber(item, findPreviousLiveSubscriber(previousLiveSubscribers, item))) {
      liveSubscriberChanged += 1;
    }
  }

  payload.previousMetricMerge = {
    generatedAt: new Date().toISOString(),
    previousGeneratedAt: previousPayload.generatedAt || "",
    checked,
    changed,
    liveSubscriberChecked,
    liveSubscriberChanged,
  };

  await fs.writeFile(DATA_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    `[previous-metric] checked=${checked}, changed=${changed}, liveSubscriberChecked=${liveSubscriberChecked}, liveSubscriberChanged=${liveSubscriberChanged}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
