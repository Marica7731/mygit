#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT_DIR, "data", "youtube-ranking.json");

function parseIntegerEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

const CONFIG = {
  limit: parseIntegerEnv("YTB_RANKING_METRIC_DETAIL_LIMIT", 120),
  fetchLimit: parseIntegerEnv("YTB_RANKING_METRIC_FETCH_LIMIT", 1800),
  fetchConcurrency: parseIntegerEnv("YTB_RANKING_METRIC_FETCH_CONCURRENCY", 6),
  fetchTimeoutMs: parseIntegerEnv("YTB_RANKING_METRIC_FETCH_TIMEOUT_MS", 10000),
  delayMs: parseIntegerEnv("YTB_RANKING_METRIC_DETAIL_DELAY_MS", 900),
  navigationTimeoutMs: parseIntegerEnv("YTB_RANKING_METRIC_DETAIL_NAVIGATION_TIMEOUT_MS", 20000),
  youtubeApiKey: process.env.YOUTUBE_API_KEY || process.env.YTB_RANKING_YOUTUBE_API_KEY || "",
  headless: parseBooleanEnv("YTB_RANKING_HEADLESS", true),
  chromeExecutable: process.env.YTB_RANKING_CHROME_EXECUTABLE || "",
};

function formatCount(value, suffix) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return `${Math.round(number).toLocaleString("ja-JP")} ${suffix}`;
}

function canonicalWatchUrl(item) {
  if (item.watchUrl) return item.watchUrl;
  return item.videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(item.videoId)}` : "";
}

function buildSearchableText(item) {
  return [
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
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function allTargetItems(payload) {
  const items = [];
  for (const group of ["today", "month"]) {
    for (const item of payload.groups?.[group]?.items || []) {
      if (!item.videoId) continue;
      if (item.statusType === "live" || item.statusType === "upcoming") continue;
      const needsViewMetric = item.viewCount == null || item.viewCount <= 0;
      const needsChannelLink = !item.channelId && !item.channelUrl;
      if (!needsViewMetric && !needsChannelLink) continue;
      items.push(item);
    }
  }
  return items;
}

function mapByVideoId(payload) {
  const map = new Map();
  for (const group of ["today", "month"]) {
    for (const item of payload.groups?.[group]?.items || []) {
      if (!item.videoId) continue;
      if (!map.has(item.videoId)) map.set(item.videoId, []);
      map.get(item.videoId).push(item);
    }
  }
  return map;
}

function uniqueVideoIds(items) {
  return Array.from(new Set(items.map((item) => item.videoId).filter(Boolean)));
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function jsonStringFromText(text, name) {
  const match = text.match(new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`));
  return match ? match[1].replace(/\\u0026/g, "&") : "";
}

function numberFromText(text, name) {
  const value = jsonStringFromText(text, name);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function absoluteYoutubeUrl(value) {
  if (!value) return "";
  try {
    return new URL(value, "https://www.youtube.com").href;
  } catch {
    return "";
  }
}

function extractMetricFromWatchHtml(html) {
  const channelId = jsonStringFromText(html, "externalChannelId") || jsonStringFromText(html, "channelId");
  const ownerProfileUrl = jsonStringFromText(html, "ownerProfileUrl");
  const canonicalBaseUrl = jsonStringFromText(html, "canonicalBaseUrl");
  const channelUrl =
    absoluteYoutubeUrl(ownerProfileUrl) ||
    absoluteYoutubeUrl(canonicalBaseUrl) ||
    (channelId ? `https://www.youtube.com/channel/${channelId}` : "");

  return {
    channelId,
    channelUrl,
    viewCount: numberFromText(html, "viewCount"),
  };
}

async function fetchWatchMetric(item) {
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
    return extractMetricFromWatchHtml(await response.text());
  } finally {
    clearTimeout(timeout);
  }
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

function mergeMetric(item, detail, source) {
  if (!item || !detail) return false;
  let changed = false;

  if (detail.channelId && item.channelId !== detail.channelId) {
    item.channelId = detail.channelId;
    changed = true;
  }

  if (detail.channelUrl && item.channelUrl !== detail.channelUrl) {
    item.channelUrl = detail.channelUrl;
    changed = true;
  }

  if (detail.viewCount != null && detail.viewCount > 0) {
    item.viewCount = detail.viewCount;
    item.viewText = formatCount(detail.viewCount, "回視聴");
    item.viewSource = source;
    changed = true;
  }

  if (detail.likeCount != null && detail.likeCount > 0) {
    item.likeCount = detail.likeCount;
    item.likeText = formatCount(detail.likeCount, "高評価");
    item.likeSource = source;
    changed = true;
  }

  if (changed) {
    item.statusType = item.statusType || "video";
    item.searchableText = buildSearchableText(item);
  }
  return changed;
}

async function enrichWithYoutubeApi(payload) {
  if (!CONFIG.youtubeApiKey) {
    console.log("[metric-post] YouTube Data API key not configured");
    return { checked: 0, changed: 0 };
  }

  const byVideoId = mapByVideoId(payload);
  const ids = uniqueVideoIds(allTargetItems(payload));
  let checked = 0;
  let changed = 0;

  for (const part of chunk(ids, 50)) {
    const data = await fetchYoutubeApi("videos", {
      part: "snippet,statistics",
      id: part.join(","),
      maxResults: "50",
    });

    for (const video of data.items || []) {
      checked += 1;
      const detail = {
        channelId: video.snippet?.channelId || "",
        viewCount: video.statistics?.viewCount != null ? Number(video.statistics.viewCount) : null,
        likeCount: video.statistics?.likeCount != null ? Number(video.statistics.likeCount) : null,
      };
      for (const item of byVideoId.get(video.id) || []) {
        if (mergeMetric(item, detail, "youtubeDataApi")) changed += 1;
      }
    }
  }

  console.log(`[metric-post] api checked=${checked}, changed=${changed}`);
  return { checked, changed };
}

async function enrichWithFetchPages(payload) {
  const targets = allTargetItems(payload).filter((item) => item.videoId).slice(0, CONFIG.fetchLimit);
  if (!targets.length) return { checked: 0, changed: 0 };

  const byVideoId = mapByVideoId(payload);
  let nextIndex = 0;
  let checked = 0;
  let changed = 0;

  console.log(
    `[metric-post] fetch fallback targets=${targets.length}, limit=${CONFIG.fetchLimit}, concurrency=${CONFIG.fetchConcurrency}`,
  );

  async function worker() {
    while (nextIndex < targets.length) {
      const item = targets[nextIndex];
      nextIndex += 1;
      try {
        const detail = await fetchWatchMetric(item);
        checked += 1;
        for (const entry of byVideoId.get(item.videoId) || []) {
          if (mergeMetric(entry, detail, "watchHtmlFetch")) changed += 1;
        }
      } catch (error) {
        console.warn(`[metric-post] fetch ${item.videoId}: ${error.message}`);
      }
    }
  }

  const workerCount = Math.min(CONFIG.fetchConcurrency, targets.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  console.log(`[metric-post] fetch checked=${checked}, changed=${changed}`);
  return { checked, changed };
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
    'button:has-text("同意する")',
    'button:has-text("すべて承諾")',
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

async function extractWatchMetric(page) {
  return page.evaluate(() => {
    const player = window.ytInitialPlayerResponse || {};
    const details = player.videoDetails || {};
    const absoluteUrl = (value) => {
      if (!value) return "";
      try {
        return new URL(value, location.origin).href;
      } catch {
        return "";
      }
    };
    const bodyText = document.documentElement.innerHTML || "";
    const fromJsonString = (name) => {
      const match = bodyText.match(new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`));
      return match ? match[1].replace(/\\u0026/g, "&") : "";
    };
    const fromJsonNumber = (name) => {
      const value = fromJsonString(name);
      if (!value) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const ownerProfileUrl = fromJsonString("ownerProfileUrl");
    const canonicalBaseUrl = fromJsonString("canonicalBaseUrl");
    const channelId =
      details.channelId ||
      fromJsonString("externalChannelId") ||
      fromJsonString("channelId") ||
      "";
    const channelUrl =
      absoluteUrl(ownerProfileUrl) ||
      absoluteUrl(canonicalBaseUrl) ||
      (channelId ? `https://www.youtube.com/channel/${channelId}` : "");
    return {
      channelId,
      channelUrl,
      viewCount: details.viewCount ? Number(details.viewCount) : fromJsonNumber("viewCount"),
    };
  });
}

async function enrichWithWatchPages(payload) {
  const targets = allTargetItems(payload).filter((item) => item.videoId).slice(0, CONFIG.limit);
  if (!targets.length) return { checked: 0, changed: 0 };

  const byVideoId = mapByVideoId(payload);
  let checked = 0;
  let changed = 0;

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

    console.log(`[metric-post] watch fallback targets=${targets.length}, limit=${CONFIG.limit}`);
    for (const item of targets) {
      try {
        await gotoWithRetry(page, canonicalWatchUrl(item));
        await dismissConsent(page);
        await page.waitForTimeout(CONFIG.delayMs);
        const detail = await extractWatchMetric(page);
        checked += 1;
        for (const entry of byVideoId.get(item.videoId) || []) {
          if (mergeMetric(entry, detail, "watchPageMetric")) changed += 1;
        }
      } catch (error) {
        console.warn(`[metric-post] watch ${item.videoId}: ${error.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`[metric-post] watch checked=${checked}, changed=${changed}`);
  return { checked, changed };
}

async function main() {
  const payload = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  const beforeMissing = allTargetItems(payload).length;
  const api = await enrichWithYoutubeApi(payload).catch((error) => {
    console.warn(`[metric-post] api skipped: ${error.message}`);
    return { checked: 0, changed: 0 };
  });
  const fetchPages = allTargetItems(payload).length
    ? await enrichWithFetchPages(payload).catch((error) => {
        console.warn(`[metric-post] fetch skipped: ${error.message}`);
        return { checked: 0, changed: 0 };
      })
    : { checked: 0, changed: 0 };
  const watch = allTargetItems(payload).length ? await enrichWithWatchPages(payload) : { checked: 0, changed: 0 };
  const afterMissing = allTargetItems(payload).length;

  payload.metricDetailPostProcess = {
    generatedAt: new Date().toISOString(),
    limit: CONFIG.limit,
    youtubeDataApiConfigured: Boolean(CONFIG.youtubeApiKey),
    beforeMissing,
    afterMissing,
    api,
    fetch: fetchPages,
    watch,
  };

  await fs.writeFile(DATA_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[metric-post] missing ${beforeMissing} -> ${afterMissing}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
