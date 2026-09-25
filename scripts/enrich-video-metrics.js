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
  limit: parseIntegerEnv("YTB_RANKING_METRIC_DETAIL_LIMIT", 24),
  fetchLimit: parseIntegerEnv("YTB_RANKING_METRIC_FETCH_LIMIT", 280),
  fetchConcurrency: parseIntegerEnv("YTB_RANKING_METRIC_FETCH_CONCURRENCY", 1),
  fetchTimeoutMs: parseIntegerEnv("YTB_RANKING_METRIC_FETCH_TIMEOUT_MS", 10000),
  oembedLimit: parseIntegerEnv("YTB_RANKING_OEMBED_CHANNEL_LIMIT", 24),
  oembedConcurrency: parseIntegerEnv("YTB_RANKING_OEMBED_CHANNEL_CONCURRENCY", 1),
  oembedTimeoutMs: parseIntegerEnv("YTB_RANKING_OEMBED_CHANNEL_TIMEOUT_MS", 6000),
  delayMs: parseIntegerEnv("YTB_RANKING_METRIC_DETAIL_DELAY_MS", 900),
  requestDelayMs: parseIntegerEnv("YTB_RANKING_YOUTUBE_REQUEST_DELAY_MS", 1200),
  navigationTimeoutMs: parseIntegerEnv("YTB_RANKING_METRIC_DETAIL_NAVIGATION_TIMEOUT_MS", 20000),
  youtubeApiKey: process.env.YOUTUBE_API_KEY || process.env.YTB_RANKING_YOUTUBE_API_KEY || "",
  headless: parseBooleanEnv("YTB_RANKING_HEADLESS", true),
  chromeExecutable: process.env.YTB_RANKING_CHROME_EXECUTABLE || "",
};

// Shared throttle/circuit: all YouTube metrics requests stop after the first HTTP 429.
const youtubeCircuit = { tripped: false, retryAfter: "", blockedUntil: "", reason: "", requests: 0 };
let nextYoutubeRequestAt = 0;

async function reserveYoutubeRequest() {
  if (youtubeCircuit.tripped) return false;
  const now = Date.now();
  const start = Math.max(now, nextYoutubeRequestAt);
  nextYoutubeRequestAt = start + CONFIG.requestDelayMs;
  if (start > now) await new Promise((resolve) => setTimeout(resolve, start - now));
  if (youtubeCircuit.tripped) return false;
  youtubeCircuit.requests += 1;
  return true;
}

async function stopOn429(response, where) {
  const status = typeof response.status === "function" ? response.status() : response.status;
  if (status !== 429) return;
  const headers = typeof response.headers === "function" ? await response.headers() : response.headers;
  const retryAfter = headers?.get?.("retry-after") || headers?.["retry-after"] || "";
  const seconds = Number(retryAfter);
  const until = retryAfter
    ? (Number.isFinite(seconds) && seconds >= 0 ? Date.now() + seconds * 1000 : Date.parse(retryAfter))
    : NaN;
  if (!youtubeCircuit.tripped) {
    youtubeCircuit.tripped = true;
    youtubeCircuit.retryAfter = retryAfter;
    youtubeCircuit.blockedUntil = Number.isFinite(until) ? new Date(until).toISOString() : "";
    youtubeCircuit.reason = where;
    console.error(
      `[metric-post] HTTP 429 at ${where}; shared YouTube circuit OPEN; Retry-After=${retryAfter || "absent"}; blockedUntil=${youtubeCircuit.blockedUntil || "unknown"}; stopping requests`,
    );
  }
  throw new Error(`HTTP 429 at ${where}; YouTube circuit open`);
}

function uniqueItemsByVideoId(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item.videoId || seen.has(item.videoId)) return false;
    seen.add(item.videoId);
    return true;
  });
}

function formatCount(value, suffix) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return `${Math.round(number).toLocaleString("ja-JP")} ${suffix}`;
}

function positiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function shouldReplaceViewCount(item, source) {
  if (!positiveNumber(item?.viewCount)) return true;
  return source === "youtubeDataApi";
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
      if (!item.videoId || item.statusType === "live" || item.statusType === "upcoming") continue;
      if (positiveNumber(item.viewCount)) continue; // Channel-link-only work is NOT metric work.
      items.push(item);
    }
  }
  return items;
}
function itemsMissingViewMetric(payload) { return allTargetItems(payload); }

function itemsMissingChannelLink(payload) {
  const items = [];
  for (const group of ["today", "month"]) {
    for (const item of payload.groups?.[group]?.items || []) {
      if (!item.videoId) continue;
      if (item.statusType === "live" || item.statusType === "upcoming") continue;
      if (item.channelId || item.channelUrl) continue;
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

function spreadKnownVideoMetrics(payload) {
  // A single video may occur in multiple ranking groups. Reuse its actual collected
  // metric for missing copies before scheduling network calls, never fabricate counts.
  let recovered = 0;
  for (const entries of mapByVideoId(payload).values()) {
    const source = entries.find((item) => positiveNumber(item.viewCount));
    if (!source) continue;
    for (const item of entries) {
      if (positiveNumber(item.viewCount) || item.statusType === "live" || item.statusType === "upcoming") continue;
      if (mergeMetric(item, {
        viewCount: Number(source.viewCount),
        channelId: source.channelId,
        channelUrl: source.channelUrl,
      }, "sameVideoId")) recovered += 1;
    }
  }
  if (recovered) console.log(`[metric-post] recovered ${recovered} missing group copies by shared videoId`);
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
  if (!(await reserveYoutubeRequest())) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.fetchTimeoutMs);
  try {
    const response = await fetch(canonicalWatchUrl(item), {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8",
      },
    });
    await stopOn429(response, "watch HTML");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return extractMetricFromWatchHtml(await response.text());
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchYoutubeApi(pathname, params) {
  if (!(await reserveYoutubeRequest())) return null;
  const url = new URL(`https://www.googleapis.com/youtube/v3/${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") url.searchParams.set(key, value);
  }
  url.searchParams.set("key", CONFIG.youtubeApiKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.fetchTimeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    await stopOn429(response, `YouTube Data API ${pathname}`);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`YouTube Data API ${pathname} failed: ${response.status} ${body.slice(0, 240)}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOEmbedChannel(item) {
  if (!(await reserveYoutubeRequest())) return null;
  const url = new URL("https://www.youtube.com/oembed");
  url.searchParams.set("url", canonicalWatchUrl(item));
  url.searchParams.set("format", "json");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.oembedTimeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8",
      },
    });
    await stopOn429(response, "oEmbed");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return { channelUrl: absoluteYoutubeUrl(data.author_url) };
  } finally {
    clearTimeout(timeout);
  }
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

  if (detail.viewCount != null && detail.viewCount > 0 && shouldReplaceViewCount(item, source)) {
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

async function enrichChannelLinksWithOEmbed(payload) {
  const targets = uniqueItemsByVideoId(itemsMissingChannelLink(payload)).slice(0, CONFIG.oembedLimit);
  if (!targets.length || youtubeCircuit.tripped) return { checked: 0, changed: 0, failed: 0 };
  const byVideoId = mapByVideoId(payload);
  let index = 0, checked = 0, changed = 0, failed = 0;
  console.log(`[metric-post] oEmbed channel targets=${targets.length}, limit=${CONFIG.oembedLimit}, concurrency=${CONFIG.oembedConcurrency}`);
  async function worker() {
    while (index < targets.length && !youtubeCircuit.tripped) {
      const item = targets[index++];
      if ((byVideoId.get(item.videoId) || []).every((entry) => entry.channelId || entry.channelUrl)) continue;
      try {
        const detail = await fetchOEmbedChannel(item);
        if (!detail) break;
        checked++;
        for (const entry of byVideoId.get(item.videoId) || []) {
          if (mergeMetric(entry, detail, "youtubeOEmbed")) changed++;
        }
      } catch (error) {
        failed++;
        console.warn(`[metric-post] oEmbed ${item.videoId}: ${error.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONFIG.oembedConcurrency, targets.length) }, () => worker()));
  console.log(`[metric-post] oEmbed checked=${checked}, changed=${changed}, failed=${failed}`);
  return { checked, changed, failed };
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
    if (youtubeCircuit.tripped) break;
    const data = await fetchYoutubeApi("videos", {
      part: "snippet,statistics",
      id: part.join(","),
      maxResults: "50",
    });
    if (!data) break;

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
  const targets = uniqueItemsByVideoId(itemsMissingViewMetric(payload)).slice(0, CONFIG.fetchLimit);
  if (!targets.length || youtubeCircuit.tripped) return { checked: 0, changed: 0 };
  const byVideoId = mapByVideoId(payload);
  let index = 0, checked = 0, changed = 0;
  console.log(`[metric-post] fetch fallback targets=${targets.length}, limit=${CONFIG.fetchLimit}, concurrency=${CONFIG.fetchConcurrency}`);
  async function worker() {
    while (index < targets.length && !youtubeCircuit.tripped) {
      const item = targets[index++];
      if ((byVideoId.get(item.videoId) || []).some((entry) => positiveNumber(entry.viewCount))) continue;
      try {
        const detail = await fetchWatchMetric(item);
        if (!detail) break;
        checked++;
        for (const entry of byVideoId.get(item.videoId) || []) {
          if (mergeMetric(entry, detail, "watchHtmlFetch")) changed++;
        }
      } catch (error) {
        console.warn(`[metric-post] fetch ${item.videoId}: ${error.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONFIG.fetchConcurrency, targets.length) }, () => worker()));
  console.log(`[metric-post] fetch checked=${checked}, changed=${changed}`);
  return { checked, changed };
}

async function gotoWithRetry(page, url) {
  let lastError;
  for (let attempt = 1; attempt <= 2 && !youtubeCircuit.tripped; attempt++) {
    if (!(await reserveYoutubeRequest())) break;
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: CONFIG.navigationTimeoutMs });
      if (response) await stopOn429(response, "browser navigation");
      if (youtubeCircuit.tripped) throw new Error("YouTube circuit opened during navigation");
      return;
    } catch (error) {
      lastError = error;
      if (youtubeCircuit.tripped) break;
      await page.waitForTimeout(1000 * attempt);
    }
  }
  throw lastError || new Error("YouTube circuit open");
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
  const targets = uniqueItemsByVideoId(itemsMissingViewMetric(payload)).slice(0, CONFIG.limit);
  if (!targets.length || youtubeCircuit.tripped) return { checked: 0, changed: 0 };
  const byVideoId = mapByVideoId(payload);
  let checked = 0, changed = 0;
  const browser = await chromium.launch({
    headless: CONFIG.headless,
    executablePath: CONFIG.chromeExecutable || undefined,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  try {
    const page = await browser.newPage({
      locale: "ja-JP",
      viewport: { width: 1280, height: 900 },
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    });
    page.setDefaultTimeout(12000);
    page.on("response", async (response) => {
      if (response.status() === 429 && /(?:^|\.)youtube\.com$/.test(new URL(response.url()).hostname)) {
        try { await stopOn429(response, "browser YouTube response"); } catch { /* circuit logs once */ }
      }
    });
    console.log(`[metric-post] watch fallback targets=${targets.length}, limit=${CONFIG.limit}`);
    for (const item of targets) {
      if (youtubeCircuit.tripped) break;
      if ((byVideoId.get(item.videoId) || []).some((entry) => positiveNumber(entry.viewCount))) continue;
      try {
        await gotoWithRetry(page, canonicalWatchUrl(item));
        if (youtubeCircuit.tripped) break;
        await dismissConsent(page);
        await page.waitForTimeout(CONFIG.delayMs);
        if (youtubeCircuit.tripped) break;
        const detail = await extractWatchMetric(page);
        checked++;
        for (const entry of byVideoId.get(item.videoId) || []) {
          if (mergeMetric(entry, detail, "watchPageMetric")) changed++;
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
  spreadKnownVideoMetrics(payload);
  const beforeMissing = uniqueVideoIds(itemsMissingViewMetric(payload)).length;
  const api = await enrichWithYoutubeApi(payload).catch((error) => {
    console.warn(`[metric-post] api skipped: ${error.message}`);
    return { checked: 0, changed: 0 };
  });
  const fetchPages = !youtubeCircuit.tripped && itemsMissingViewMetric(payload).length
    ? await enrichWithFetchPages(payload).catch((error) => {
        console.warn(`[metric-post] fetch skipped: ${error.message}`);
        return { checked: 0, changed: 0 };
      })
    : { checked: 0, changed: 0 };
  const watch = !youtubeCircuit.tripped && itemsMissingViewMetric(payload).length
    ? await enrichWithWatchPages(payload).catch((error) => {
        console.warn(`[metric-post] browser skipped: ${error.message}`);
        return { checked: 0, changed: 0 };
      })
    : { checked: 0, changed: 0 };
  // Optional channel links run only after the high-priority viewCount phase.
  const oembed = !youtubeCircuit.tripped
    ? await enrichChannelLinksWithOEmbed(payload).catch((error) => {
        console.warn(`[metric-post] oEmbed skipped: ${error.message}`);
        return { checked: 0, changed: 0, failed: 0 };
      })
    : { checked: 0, changed: 0, failed: 0 };
  const afterMissing = uniqueVideoIds(itemsMissingViewMetric(payload)).length;
  payload.metricDetailPostProcess = {
    generatedAt: new Date().toISOString(),
    limit: CONFIG.limit,
    youtubeDataApiConfigured: Boolean(CONFIG.youtubeApiKey),
    beforeMissing,
    afterMissing,
    api,
    fetch: fetchPages,
    watch,
    oembed,
    rateLimited: youtubeCircuit.tripped,
    retryAfter: youtubeCircuit.retryAfter,
    blockedUntil: youtubeCircuit.blockedUntil,
    rateLimitSource: youtubeCircuit.reason,
    youtubeRequestsStarted: youtubeCircuit.requests,
  };
  await fs.writeFile(DATA_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, `rate_limited=${youtubeCircuit.tripped}\n`);
  }
  console.log(`[metric-post] missing viewCount videoIds ${beforeMissing} -> ${afterMissing}; rateLimited=${youtubeCircuit.tripped}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
