#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT_DIR, "data", "youtube-ranking.json");

const CONFIG = {
  limit: intEnv("YTB_RANKING_LIVE_INNERTUBE_LIMIT", 120),
  concurrency: intEnv("YTB_RANKING_LIVE_INNERTUBE_CONCURRENCY", 4),
  timeoutMs: intEnv("YTB_RANKING_LIVE_INNERTUBE_TIMEOUT_MS", 8000),
  apiKey: process.env.YTB_RANKING_INNERTUBE_API_KEY || "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
  clientVersion: process.env.YTB_RANKING_INNERTUBE_CLIENT_VERSION || "2.20260615.01.00",
};

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clean(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function isLiveLike(item) {
  return item.statusType === "live" || item.statusType === "upcoming";
}

function hasDuration(item) {
  return Number(item.durationSeconds) > 0 || clean(item.durationText);
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (!total) return "";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainSeconds = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainSeconds).padStart(2, "0")}`;
  return `${minutes}:${String(remainSeconds).padStart(2, "0")}`;
}

function elapsedFromTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return null;
  const elapsed = Math.floor((Date.now() - timestamp) / 1000);
  return elapsed > 0 ? elapsed : null;
}

function durationFromTimestampRange(startValue, endValue) {
  const start = Date.parse(String(startValue || ""));
  const end = Date.parse(String(endValue || ""));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.floor((end - start) / 1000);
}

function allItems(payload) {
  return Object.values(payload.groups || {}).flatMap((group) => (Array.isArray(group?.items) ? group.items : []));
}

function uniqueByVideoId(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    if (!item.videoId || seen.has(item.videoId)) continue;
    seen.add(item.videoId);
    unique.push(item);
  }
  return unique;
}

function targetItems(payload) {
  return uniqueByVideoId(
    (payload.groups?.live?.items || []).filter((item) => item.videoId && isLiveLike(item) && !hasDuration(item)),
  );
}

function mapByVideoId(payload) {
  const map = new Map();
  for (const item of allItems(payload)) {
    if (!item.videoId) continue;
    if (!map.has(item.videoId)) map.set(item.videoId, []);
    map.get(item.videoId).push(item);
  }
  return map;
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

function mergeDuration(item, seconds) {
  const durationSeconds = Number(seconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
  item.durationSeconds = durationSeconds;
  item.durationText = formatDuration(durationSeconds);
  item.durationSource = "innertubePlayer";
  item.searchableText = buildSearchableText(item);
  return true;
}

function durationFromPlayerPayload(payload) {
  const details = payload?.videoDetails || {};
  const liveDetails = payload?.microformat?.playerMicroformatRenderer?.liveBroadcastDetails || {};
  return (
    Number(details.lengthSeconds) ||
    durationFromTimestampRange(liveDetails.startTimestamp, liveDetails.endTimestamp) ||
    elapsedFromTimestamp(liveDetails.startTimestamp)
  );
}

async function fetchPlayerDuration(item) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.timeoutMs);
  try {
    const response = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${CONFIG.apiKey}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({
        videoId: item.videoId,
        context: {
          client: {
            clientName: "WEB",
            clientVersion: CONFIG.clientVersion,
            hl: "ja",
            gl: "JP",
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return durationFromPlayerPayload(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const payload = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  const beforeMissing = targetItems(payload).length;
  const targets = targetItems(payload).slice(0, CONFIG.limit);
  const byVideoId = mapByVideoId(payload);
  let nextIndex = 0;
  let checked = 0;
  let changed = 0;
  let failed = 0;
  const samples = [];

  async function worker() {
    while (nextIndex < targets.length) {
      const item = targets[nextIndex];
      nextIndex += 1;
      try {
        const seconds = await fetchPlayerDuration(item);
        checked += 1;
        if (!seconds) continue;
        for (const entry of byVideoId.get(item.videoId) || []) {
          if (mergeDuration(entry, seconds)) changed += 1;
        }
      } catch (error) {
        failed += 1;
        if (samples.length < 8) samples.push({ videoId: item.videoId, message: error.message });
      }
    }
  }

  if (CONFIG.apiKey && targets.length) {
    await Promise.all(Array.from({ length: Math.min(CONFIG.concurrency, targets.length) }, () => worker()));
  }

  payload.liveInnertubeDurationPostProcess = {
    generatedAt: new Date().toISOString(),
    limit: CONFIG.limit,
    beforeMissing,
    attempted: targets.length,
    afterMissing: targetItems(payload).length,
    checked,
    changed,
    failed,
    samples,
  };

  await fs.writeFile(DATA_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[live-innertube-duration] missing ${beforeMissing} -> ${payload.liveInnertubeDurationPostProcess.afterMissing}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
