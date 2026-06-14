#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT_DIR, "data", "youtube-ranking.json");

const CONFIG = {
  limit: intEnv("YTB_RANKING_LIVE_ELAPSED_LIMIT", 120),
  delayMs: intEnv("YTB_RANKING_LIVE_ELAPSED_DELAY_MS", 600),
  navigationTimeoutMs: intEnv("YTB_RANKING_LIVE_ELAPSED_NAVIGATION_TIMEOUT_MS", 15000),
  headless: booleanEnv("YTB_RANKING_HEADLESS", true),
  chromeExecutable: process.env.YTB_RANKING_CHROME_EXECUTABLE || "",
};

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function booleanEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

function isLiveLike(item) {
  return item.statusType === "live" || item.statusType === "upcoming";
}

function hasDuration(item) {
  return Number(item.durationSeconds) > 0 || clean(item.durationText);
}

function clean(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function canonicalWatchUrl(item) {
  if (item.watchUrl) return item.watchUrl;
  return item.videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(item.videoId)}` : "";
}

function formatDuration(seconds) {
  const number = Number(seconds);
  if (!Number.isFinite(number) || number <= 0) return "";
  const total = Math.round(number);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainSeconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainSeconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remainSeconds).padStart(2, "0")}`;
}

function allItems(payload) {
  const groups = payload.groups || {};
  return Object.values(groups).flatMap((group) => (Array.isArray(group?.items) ? group.items : []));
}

function targetItems(payload) {
  return (payload.groups?.live?.items || []).filter((item) => item.videoId && isLiveLike(item) && !hasDuration(item));
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
  item.durationSource = "liveStartTimestamp";
  item.searchableText = buildSearchableText(item);
  return true;
}

async function gotoWithRetry(page, url) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: CONFIG.navigationTimeoutMs });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1000 * attempt);
    }
  }
  throw lastError;
}

async function extractLiveDuration(page) {
  return page.evaluate(() => {
    const html = document.documentElement.innerHTML || "";
    const player = window.ytInitialPlayerResponse || {};
    const details = player.videoDetails || {};
    const liveDetails = player.microformat?.playerMicroformatRenderer?.liveBroadcastDetails || {};
    const jsonString = (name) => {
      const match = html.match(new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`));
      return match ? match[1] : "";
    };
    const jsonNumber = (name) => {
      const raw = jsonString(name) || html.match(new RegExp(`"${name}"\\s*:\\s*(\\d+)`))?.[1] || "";
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };
    const elapsedFrom = (value) => {
      const timestamp = Date.parse(String(value || ""));
      if (!Number.isFinite(timestamp)) return null;
      const elapsed = Math.floor((Date.now() - timestamp) / 1000);
      return elapsed > 0 ? elapsed : null;
    };

    return (
      Number(details.lengthSeconds) ||
      jsonNumber("lengthSeconds") ||
      elapsedFrom(liveDetails.startTimestamp || jsonString("startTimestamp") || jsonString("actualStartTime"))
    );
  });
}

async function main() {
  const payload = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  const targets = uniqueByVideoId(targetItems(payload)).slice(0, CONFIG.limit);
  const byVideoId = mapByVideoId(payload);
  let checked = 0;
  let changed = 0;
  let failed = 0;

  if (targets.length) {
    const browser = await chromium.launch({
      headless: CONFIG.headless,
      executablePath: CONFIG.chromeExecutable || undefined,
      args: ["--disable-dev-shm-usage", "--no-sandbox"],
    });

    try {
      const page = await browser.newPage({
        locale: "ja-JP",
        viewport: { width: 1280, height: 900 },
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      });
      page.setDefaultTimeout(12000);

      for (const item of targets) {
        try {
          await gotoWithRetry(page, canonicalWatchUrl(item));
          await page.waitForTimeout(CONFIG.delayMs);
          const seconds = await extractLiveDuration(page);
          checked += 1;
          if (!seconds) continue;
          for (const entry of byVideoId.get(item.videoId) || []) {
            if (mergeDuration(entry, seconds)) changed += 1;
          }
        } catch (error) {
          failed += 1;
          console.warn(`[live-duration] ${item.videoId}: ${error.message}`);
        }
      }
    } finally {
      await browser.close();
    }
  }

  payload.liveDurationPostProcess = {
    generatedAt: new Date().toISOString(),
    limit: CONFIG.limit,
    beforeMissing: targets.length,
    afterMissing: targetItems(payload).length,
    checked,
    changed,
    failed,
  };

  await fs.writeFile(DATA_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[live-duration] missing ${targets.length} -> ${payload.liveDurationPostProcess.afterMissing}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
