#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT_DIR, "data", "youtube-ranking.json");

const CONFIG = {
  limit: intEnv("YTB_RANKING_DURATION_DETAIL_LIMIT", 500),
  liveLimit: intEnv("YTB_RANKING_LIVE_DURATION_DETAIL_LIMIT", 120),
  fetchConcurrency: intEnv("YTB_RANKING_DURATION_FETCH_CONCURRENCY", 4),
  fetchTimeoutMs: intEnv("YTB_RANKING_DURATION_FETCH_TIMEOUT_MS", 10000),
  playwrightLimit: intEnv("YTB_RANKING_DURATION_PLAYWRIGHT_LIMIT", 160),
  delayMs: intEnv("YTB_RANKING_DURATION_PLAYWRIGHT_DELAY_MS", 600),
  navigationTimeoutMs: intEnv("YTB_RANKING_DURATION_PLAYWRIGHT_NAVIGATION_TIMEOUT_MS", 15000),
  headless: booleanEnv("YTB_RANKING_HEADLESS", true),
  chromeExecutable: process.env.YTB_RANKING_CHROME_EXECUTABLE || "",
  youtubeApiKey: process.env.YOUTUBE_API_KEY || process.env.YTB_RANKING_YOUTUBE_API_KEY || "",
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

function durationMissing(item) {
  return item.durationSeconds == null || item.durationSeconds <= 0 || !clean(item.durationText);
}

function isLiveLike(item) {
  return item.statusType === "live" || item.statusType === "upcoming";
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

function parseIsoDuration(value) {
  const match = String(value || "").match(/^P(?!$)(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
  const total = Number(days) * 86400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  return Number.isFinite(total) && total > 0 ? total : null;
}

function elapsedFromTimestamp(value, now = Date.now()) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return null;
  const elapsed = Math.floor((now - timestamp) / 1000);
  return elapsed > 0 ? elapsed : null;
}

function durationFromTimestampRange(startValue, endValue) {
  const start = Date.parse(String(startValue || ""));
  const end = Date.parse(String(endValue || ""));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.floor((end - start) / 1000);
}

function jsonStringFromText(text, name) {
  const match = text.match(new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`));
  return match ? match[1].replace(/\\u0026/g, "&") : "";
}

function jsonNumberFromText(text, name) {
  const stringValue = jsonStringFromText(text, name);
  const rawValue = stringValue || text.match(new RegExp(`"${name}"\\s*:\\s*(\\d+)`))?.[1] || "";
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function durationFromWatchHtml(html) {
  const lengthSeconds = jsonNumberFromText(html, "lengthSeconds");
  if (lengthSeconds) return lengthSeconds;

  const approxDurationMs = jsonNumberFromText(html, "approxDurationMs");
  if (approxDurationMs) return Math.round(approxDurationMs / 1000);

  const isoDuration =
    jsonStringFromText(html, "duration") ||
    html.match(/itemprop=["']duration["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    "";
  const parsedIsoDuration = parseIsoDuration(isoDuration);
  if (parsedIsoDuration) return parsedIsoDuration;

  const startTimestamp = jsonStringFromText(html, "startTimestamp") || jsonStringFromText(html, "actualStartTime");
  const endTimestamp = jsonStringFromText(html, "endTimestamp") || jsonStringFromText(html, "actualEndTime");
  return durationFromTimestampRange(startTimestamp, endTimestamp) || elapsedFromTimestamp(startTimestamp);
}

function allItems(payload) {
  const groups = payload.groups || {};
  return Object.values(groups).flatMap((group) => (Array.isArray(group?.items) ? group.items : []));
}

function targetVideoItems(payload) {
  const items = [];
  for (const group of ["today", "month"]) {
    for (const item of payload.groups?.[group]?.items || []) {
      if (!item.videoId || isLiveLike(item) || !durationMissing(item)) continue;
      items.push(item);
    }
  }
  return items;
}

function targetLiveItems(payload) {
  return (payload.groups?.live?.items || []).filter(
    (item) => item.videoId && isLiveLike(item) && durationMissing(item),
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

function mergeDuration(item, seconds, source) {
  const durationSeconds = Number(seconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
  const durationText = formatDuration(durationSeconds);
  if (item.durationSeconds === durationSeconds && item.durationText === durationText) return false;
  item.durationSeconds = durationSeconds;
  item.durationText = durationText;
  item.durationSource = source;
  item.searchableText = buildSearchableText(item);
  return true;
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

async function fetchYoutubeApi(pathname, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") url.searchParams.set(key, value);
  }
  url.searchParams.set("key", CONFIG.youtubeApiKey);

  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`YouTube Data API ${pathname} failed: ${response.status} ${body.slice(0, 240)}`);
  }
  return response.json();
}

async function enrichWithYoutubeApi(payload, targets) {
  if (!CONFIG.youtubeApiKey) return { checked: 0, changed: 0, skipped: "api key not configured" };

  const byVideoId = mapByVideoId(payload);
  let checked = 0;
  let changed = 0;
  const ids = uniqueByVideoId(targets).map((item) => item.videoId);

  for (const part of chunk(ids, 50)) {
    const data = await fetchYoutubeApi("videos", {
      part: "contentDetails,liveStreamingDetails",
      id: part.join(","),
      maxResults: "50",
    });

    for (const video of data.items || []) {
      checked += 1;
      const live = video.liveStreamingDetails || {};
      const seconds =
        parseIsoDuration(video.contentDetails?.duration) ||
        durationFromTimestampRange(live.actualStartTime, live.actualEndTime) ||
        elapsedFromTimestamp(live.actualStartTime);
      for (const item of byVideoId.get(video.id) || []) {
        if (mergeDuration(item, seconds, "youtubeDataApi")) changed += 1;
      }
    }
  }

  return { checked, changed };
}

async function fetchWatchDuration(item) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.fetchTimeoutMs);
  try {
    const response = await fetch(canonicalWatchUrl(item), {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return durationFromWatchHtml(await response.text());
  } finally {
    clearTimeout(timeout);
  }
}

async function enrichWithFetch(payload, targets) {
  const uniqueTargets = uniqueByVideoId(targets);
  if (!uniqueTargets.length) return { checked: 0, changed: 0, failed: 0 };

  const byVideoId = mapByVideoId(payload);
  let nextIndex = 0;
  let checked = 0;
  let changed = 0;
  let failed = 0;

  async function worker() {
    while (nextIndex < uniqueTargets.length) {
      const item = uniqueTargets[nextIndex];
      nextIndex += 1;
      try {
        const seconds = await fetchWatchDuration(item);
        checked += 1;
        if (!seconds) continue;
        for (const entry of byVideoId.get(item.videoId) || []) {
          if (mergeDuration(entry, seconds, "watchHtmlDuration")) changed += 1;
        }
      } catch (error) {
        failed += 1;
        console.warn(`[duration-post] fetch ${item.videoId}: ${error.message}`);
      }
    }
  }

  const workerCount = Math.min(CONFIG.fetchConcurrency, uniqueTargets.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { checked, changed, failed };
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

async function dismissConsent(page) {
  for (const selector of [
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Agree")',
    'button:has-text("同意する")',
    'button:has-text("すべて承諾")',
    'button:has-text("全部接受")',
    'button:has-text("接受全部")',
  ]) {
    try {
      const button = page.locator(selector).first();
      if (await button.isVisible({ timeout: 700 })) {
        await button.click({ timeout: 2000 });
        await page.waitForTimeout(700);
        return;
      }
    } catch {
      // Consent UI is regional and often absent.
    }
  }
}

async function extractDurationFromPage(page) {
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
      const stringValue = jsonString(name);
      const rawValue = stringValue || html.match(new RegExp(`"${name}"\\s*:\\s*(\\d+)`))?.[1] || "";
      const parsed = Number(rawValue);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };
    const isoToSeconds = (value) => {
      const match = String(value || "").match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
      if (!match) return null;
      const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
      const total = Number(days) * 86400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
      return Number.isFinite(total) && total > 0 ? total : null;
    };
    const elapsedFrom = (value) => {
      const timestamp = Date.parse(String(value || ""));
      if (!Number.isFinite(timestamp)) return null;
      const elapsed = Math.floor((Date.now() - timestamp) / 1000);
      return elapsed > 0 ? elapsed : null;
    };

    const lengthSeconds = Number(details.lengthSeconds) || jsonNumber("lengthSeconds");
    if (lengthSeconds) return lengthSeconds;

    const approxDurationMs = jsonNumber("approxDurationMs");
    if (approxDurationMs) return Math.round(approxDurationMs / 1000);

    return isoToSeconds(
      jsonString("duration") ||
        document.querySelector('meta[itemprop="duration"]')?.getAttribute("content") ||
        "",
    ) || elapsedFrom(liveDetails.startTimestamp || jsonString("startTimestamp") || jsonString("actualStartTime"));
  });
}

async function enrichWithPlaywright(payload, targets) {
  const uniqueTargets = uniqueByVideoId(targets).slice(0, CONFIG.playwrightLimit);
  if (!uniqueTargets.length) return { checked: 0, changed: 0, failed: 0 };

  const byVideoId = mapByVideoId(payload);
  let checked = 0;
  let changed = 0;
  let failed = 0;

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

    for (const item of uniqueTargets) {
      try {
        await gotoWithRetry(page, canonicalWatchUrl(item));
        await dismissConsent(page);
        await page.waitForTimeout(CONFIG.delayMs);
        const seconds = await extractDurationFromPage(page);
        checked += 1;
        if (!seconds) continue;
        for (const entry of byVideoId.get(item.videoId) || []) {
          if (mergeDuration(entry, seconds, "watchPageDuration")) changed += 1;
        }
      } catch (error) {
        failed += 1;
        console.warn(`[duration-post] playwright ${item.videoId}: ${error.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  return { checked, changed, failed };
}

async function main() {
  const payload = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  const beforeVideoMissing = targetVideoItems(payload).length;
  const beforeLiveMissing = targetLiveItems(payload).length;

  const apiTargets = [
    ...targetVideoItems(payload).slice(0, CONFIG.limit),
    ...targetLiveItems(payload).slice(0, CONFIG.liveLimit),
  ];
  const api = await enrichWithYoutubeApi(payload, apiTargets).catch((error) => {
    console.warn(`[duration-post] api skipped: ${error.message}`);
    return { checked: 0, changed: 0, error: error.message };
  });

  const videoTargets = targetVideoItems(payload).slice(0, CONFIG.limit);
  const liveTargets = targetLiveItems(payload).slice(0, CONFIG.liveLimit);
  const fetchResult = await enrichWithFetch(payload, [...videoTargets, ...liveTargets]);
  const playwrightResult = await enrichWithPlaywright(payload, [
    ...targetVideoItems(payload).slice(0, CONFIG.limit),
    ...targetLiveItems(payload).slice(0, CONFIG.liveLimit),
  ]);

  const afterVideoMissing = targetVideoItems(payload).length;
  const afterLiveMissing = targetLiveItems(payload).length;

  payload.durationDetailPostProcess = {
    generatedAt: new Date().toISOString(),
    limit: CONFIG.limit,
    liveLimit: CONFIG.liveLimit,
    beforeVideoMissing,
    afterVideoMissing,
    beforeLiveMissing,
    afterLiveMissing,
    youtubeDataApiConfigured: Boolean(CONFIG.youtubeApiKey),
    api,
    fetch: fetchResult,
    playwright: playwrightResult,
  };

  await fs.writeFile(DATA_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    `[duration-post] video missing ${beforeVideoMissing} -> ${afterVideoMissing}; live missing ${beforeLiveMissing} -> ${afterLiveMissing}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
