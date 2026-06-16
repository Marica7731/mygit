#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const DATA_FILE = path.resolve(process.cwd(), "data/youtube-ranking.json");
const DURATION_RE = /\b(?:\d{1,3}:)?\d{1,2}:\d{2}\b/;
const DIRTY_VIDEO_IDS = new Set(["Q549p5qmepE"]);
const DIRTY_CHANNELS = ["みかんとボーカルノート"];
const DIRTY_TITLE_RE = [/24\s*時間\s*配信へようこそ/i];

function clean(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function hasDuration(item) {
  if (Number(item?.durationSeconds) > 0) return true;
  return DURATION_RE.test(clean(item?.durationText));
}

function isExplicitDirtyLiveItem(item) {
  if (!item || item.sourceGroup !== "live") return false;
  if (DIRTY_VIDEO_IDS.has(clean(item.videoId))) return true;
  const title = clean(item.title);
  const channel = clean(item.channelName);
  if (DIRTY_CHANNELS.some((value) => channel.includes(value))) return true;
  return DIRTY_TITLE_RE.some((pattern) => pattern.test(title));
}

function normalizeRanks(items) {
  return items.map((item, index) => ({ ...item, visibleRank: index + 1 }));
}

function positiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function main() {
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error(`Ranking data not found: ${DATA_FILE}`);
  }

  const payload = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  const group = payload.groups?.live;
  if (!group) {
    console.log("[live-duration-clean] live group not found; nothing to do.");
    return;
  }

  const removed = [];
  let clearedDuration = 0;

  const cleanItem = (item) => {
    if (isExplicitDirtyLiveItem(item)) {
      removed.push({
        videoId: item.videoId || "",
        title: clean(item.title).slice(0, 120),
        channelName: clean(item.channelName),
        durationText: clean(item.durationText),
        durationSeconds: Number(item.durationSeconds) || null,
      });
      return null;
    }

    if (item?.sourceGroup !== "live") return item;
    if (hasDuration(item)) clearedDuration += 1;
    return { ...item, durationText: "", durationSeconds: null };
  };

  const primaryItems = normalizeRanks((Array.isArray(group.items) ? group.items : []).map(cleanItem).filter(Boolean));
  const primaryByVideoId = new Map(primaryItems.filter((item) => item.videoId).map((item) => [item.videoId, item]));

  group.items = primaryItems;

  if (group.keywords && typeof group.keywords === "object") {
    for (const [keyword, items] of Object.entries(group.keywords)) {
      group.keywords[keyword] = normalizeRanks(
        (Array.isArray(items) ? items : [])
          .map(cleanItem)
          .filter(Boolean)
          .map((item) => mergePrimaryFields(item, primaryByVideoId.get(item.videoId))),
      );
    }
  }

  const counts = new Map();
  for (const item of group.items || []) {
    const key = item.keyword || item.group || "";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const source of group.sources || []) {
    source.itemCount = counts.get(source.keyword) || 0;
  }

  const subscriberItems = (group.items || []).filter((item) => positiveNumber(item.subscriberCount)).length;
  payload.liveDurationPostProcess = {
    ...(payload.liveDurationPostProcess || {}),
    durationDisplayPolicy: "hidden-on-live-page",
    clearedLiveDurationItems: clearedDuration,
    removedExplicitDirtyLiveItems: removed.length,
    removedExplicitDirtyLiveSamples: removed.slice(0, 12),
    subscriberItemsAfterClean: subscriberItems,
    processedAt: new Date().toISOString(),
  };

  fs.writeFileSync(DATA_FILE, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(
    `[live-duration-clean] cleared=${clearedDuration}, removed=${removed.length}, liveItems=${group.items?.length || 0}, subscribers=${subscriberItems}`,
  );
}

function mergePrimaryFields(item, primary) {
  if (!primary) return { ...item, durationText: "", durationSeconds: null };
  return {
    ...item,
    channelUrl: primary.channelUrl || item.channelUrl,
    channelAvatarUrl: primary.channelAvatarUrl || item.channelAvatarUrl,
    channelId: primary.channelId || item.channelId,
    thumbnailUrl: primary.thumbnailUrl || item.thumbnailUrl,
    statusType: primary.statusType || item.statusType,
    subscriberText: primary.subscriberText || item.subscriberText,
    subscriberCount: primary.subscriberCount ?? item.subscriberCount,
    subscriberSource: primary.subscriberSource || item.subscriberSource,
    liveViewerText: primary.liveViewerText || item.liveViewerText,
    liveViewerCount: primary.liveViewerCount ?? item.liveViewerCount,
    liveViewerSource: primary.liveViewerSource || item.liveViewerSource,
    likeText: primary.likeText || item.likeText,
    likeCount: primary.likeCount ?? item.likeCount,
    likeSource: primary.likeSource || item.likeSource,
    durationText: "",
    durationSeconds: null,
  };
}

main();
