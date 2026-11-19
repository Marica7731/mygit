#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = path.join(__dirname, "..", "data");
const ITEM_FIELDS = [
  "rank", "originalRank", "title", "channelName", "videoId", "watchUrl", "thumbnailUrl",
  "channelUrl", "authorUrl", "ownerUrl", "channelId", "authorChannelId", "ownerChannelId",
  "channelHandle", "handle", "ownerHandle", "ownerText", "longBylineText", "shortBylineText",
  "keyword", "group", "statusType", "viewText", "viewCount", "liveViewerText",
  "liveViewerCount", "subscriberCount", "likeCount", "publishedTimestamp", "durationSeconds",
];

function read(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8"));
}

function buildTodayFiles() {
  const { generatedAt, groups } = read("youtube-ranking-today.json");
  const { updatedAt, collectedAt, items } = groups.today;
  if (!Array.isArray(items) || !items.length || !Number.isFinite(Date.parse(updatedAt || collectedAt || generatedAt))) {
    throw new Error("Cannot publish the today view without a valid ranking group");
  }
  const group = {
    updatedAt: updatedAt || collectedAt || generatedAt,
    items: items.map((item) => {
      const compact = {};
      for (const field of ITEM_FIELDS) {
        if (item[field] != null && item[field] !== "") compact[field] = item[field];
      }
      // Cards use fixed-sized, parameter-free thumbnails when their video ID is known.
      if (/^[A-Za-z0-9_-]{11}$/.test(compact.videoId)) delete compact.thumbnailUrl;
      return compact;
    }),
  };
  const index = read("today-snapshots/index.json");
  if (!Array.isArray(index.snapshots) || index.snapshots.some(({ id }) => !/^\d{8}T\d{6}Z$/.test(id))) {
    throw new Error("Cannot publish the today view without a valid history index");
  }
  const slice = { generatedAt, groups: { today: group } };
  const history = { snapshots: index.snapshots.map(({ id }) => id).sort().reverse() };
  return {
    "today-view.json": JSON.stringify(slice) + "\n",
    "today-history.json": JSON.stringify(history) + "\n",
  };
}

if (require.main === module) {
  for (const [name, content] of Object.entries(buildTodayFiles())) {
    fs.writeFileSync(path.join(DATA_DIR, name), content);
    console.log("[build-today-view] " + name + " " + Buffer.byteLength(content, "utf8") + " bytes");
  }
}

module.exports = { buildTodayFiles };
