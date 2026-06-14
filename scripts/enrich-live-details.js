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
  limit: parseIntegerEnv("YTB_RANKING_LIVE_POST_DETAIL_LIMIT", 120),
  channelLimit: parseIntegerEnv("YTB_RANKING_LIVE_POST_CHANNEL_LIMIT", 120),
  delayMs: parseIntegerEnv("YTB_RANKING_LIVE_POST_DELAY_MS", 550),
  navigationTimeoutMs: parseIntegerEnv("YTB_RANKING_LIVE_POST_NAVIGATION_TIMEOUT_MS", 12000),
  headless: parseBooleanEnv("YTB_RANKING_HEADLESS", true),
  chromeExecutable: process.env.YTB_RANKING_CHROME_EXECUTABLE || "",
};

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDigits(value) {
  return String(value || "").replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0),
  );
}

function parseCompactCount(text) {
  const normalized = normalizeDigits(normalizeWhitespace(text)).replace(/,/g, "");
  if (!normalized) return null;
  const match = normalized.match(/(\d+(?:[.]\d+)?)/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;

  let multiplier = 1;
  if (/[億亿]/.test(normalized)) multiplier = 100000000;
  else if (/[万萬]/.test(normalized)) multiplier = 10000;
  else if (/千/.test(normalized)) multiplier = 1000;
  else if (/\bK\b/i.test(normalized)) multiplier = 1000;
  else if (/\bM\b/i.test(normalized)) multiplier = 1000000;
  else if (/\bB\b/i.test(normalized)) multiplier = 1000000000;

  return Math.round(value * multiplier);
}

function hasSubscriberText(text) {
  const normalized = normalizeDigits(normalizeWhitespace(text));
  return /[0-9][0-9,.\s]*(?:億|亿|万|萬|千|K|M|B)?\s*(?:登録者|subscribers?|subscriber|订阅者|訂閱者|粉丝)/i.test(
    normalized,
  );
}

function formatCount(value, suffix) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return `${Math.round(number).toLocaleString("ja-JP")} ${suffix}`;
}

function canonicalWatchUrl(item) {
  if (item.watchUrl) return item.watchUrl;
  if (item.videoId) return `https://www.youtube.com/watch?v=${encodeURIComponent(item.videoId)}`;
  return "";
}

function buildSearchableText(item) {
  return normalizeWhitespace(
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

function normalizeChannelDetailUrl(channelUrl) {
  try {
    const url = new URL(channelUrl);
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname
      .replace(/\/+$/g, "")
      .replace(/\/(?:featured|videos|streams|live|shorts|community|about)$/i, "");
    if (!url.pathname || url.pathname === "/") return "";
    url.pathname = `${url.pathname}/about`;
    return url.href;
  } catch {
    return "";
  }
}

function hasSpecificThumbnailUrl(thumbnailUrl) {
  const value = String(thumbnailUrl || "");
  if (!value) return false;
  return !/\/(?:default|mqdefault|hqdefault)\.jpg(?:[?#]|$)/i.test(value);
}

function uniqueLiveEntries(payload) {
  const groups = payload.groups || {};
  const items = groups.live?.items || [];
  const byVideoId = new Map();

  for (const item of items) {
    if (!item.videoId) continue;
    if (!byVideoId.has(item.videoId)) byVideoId.set(item.videoId, []);
    byVideoId.get(item.videoId).push(item);
  }

  return Array.from(byVideoId.values()).map((duplicates) => duplicates[0]);
}

function clearUntrustedLiveViewer(item) {
  if (item.liveViewerSource && item.liveViewerSource === "youtubeDataApi") return false;
  const hadValue = item.liveViewerText || item.liveViewerCount != null || item.liveViewerSource;
  item.liveViewerText = "";
  item.liveViewerCount = null;
  item.liveViewerSource = "";
  return Boolean(hadValue);
}

function needsWatchDetail(item) {
  return (
    item.subscriberCount == null ||
    !hasSpecificThumbnailUrl(item.thumbnailUrl) ||
    !item.channelUrl ||
    !item.channelAvatarUrl
  );
}

function mergeDetail(target, detail, source) {
  if (!target || !detail) return false;
  let changed = false;

  for (const key of ["channelId", "channelUrl", "channelAvatarUrl", "thumbnailUrl"]) {
    if (detail[key] && target[key] !== detail[key]) {
      target[key] = detail[key];
      changed = true;
    }
  }

  const subscriberCount =
    detail.subscriberCount != null
      ? detail.subscriberCount
      : hasSubscriberText(detail.subscriberText)
        ? parseCompactCount(detail.subscriberText)
        : null;

  if (subscriberCount != null) {
    target.subscriberCount = subscriberCount;
    target.subscriberText = formatCount(subscriberCount, "登録者");
    target.subscriberSource = source;
    changed = true;
  }

  target.thumbnailMissing = !target.thumbnailUrl;
  if (changed) target.searchableText = buildSearchableText(target);
  return changed;
}

async function dismissConsent(page) {
  const selectors = [
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Agree")',
    'button:has-text("同意する")',
    'button:has-text("すべて承諾")',
    'button:has-text("全部接受")',
    'button:has-text("接受全部")',
  ];

  for (const selector of selectors) {
    const button = page.locator(selector).first();
    try {
      if (await button.isVisible({ timeout: 900 })) {
        await button.click({ timeout: 2500 });
        await page.waitForTimeout(900);
        return;
      }
    } catch {
      // Consent UI is regional and often absent.
    }
  }
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

async function extractWatchDetails(page) {
  return page.evaluate(() => {
    const normalize = (value) =>
      String(value || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const absoluteUrl = (href) => {
      if (!href) return "";
      try {
        return new URL(href, location.origin).href;
      } catch {
        return "";
      }
    };
    const textFromSelectors = (selectors, predicate = Boolean) =>
      selectors
        .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
        .map((node) => normalize(node.innerText || node.textContent || node.getAttribute("aria-label") || ""))
        .find(predicate) || "";

    const player = window.ytInitialPlayerResponse || {};
    const videoDetails = player.videoDetails || {};
    const thumbnails = Array.isArray(videoDetails.thumbnail?.thumbnails)
      ? [...videoDetails.thumbnail.thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0))
      : [];
    const channelLink =
      document.querySelector("ytd-video-owner-renderer a[href]") ||
      document.querySelector("#owner a[href]") ||
      document.querySelector('a[href^="/@"]') ||
      document.querySelector('a[href*="/channel/"]');
    const channelAvatar =
      document.querySelector("ytd-video-owner-renderer #avatar img") ||
      document.querySelector("#owner #avatar img") ||
      document.querySelector('img[src*="yt3.ggpht.com"]') ||
      document.querySelector('img[src*="yt3.googleusercontent.com"]');
    const metaImage =
      document.querySelector('meta[property="og:image"]')?.getAttribute("content") ||
      document.querySelector('link[itemprop="thumbnailUrl"]')?.getAttribute("href") ||
      "";
    const subscriberText = textFromSelectors(
      ["#owner-sub-count", "ytd-video-owner-renderer #owner-sub-count", "#owner #owner-sub-count"],
      (value) => /(登録者|subscribers?|订阅者|訂閱者)/i.test(value),
    );

    return {
      channelId: videoDetails.channelId || "",
      channelUrl: absoluteUrl(channelLink ? channelLink.getAttribute("href") : ""),
      channelAvatarUrl: absoluteUrl(channelAvatar?.currentSrc || channelAvatar?.src || ""),
      thumbnailUrl: absoluteUrl(thumbnails.find((item) => item.url)?.url || metaImage),
      subscriberText,
    };
  });
}

async function extractChannelDetails(page) {
  return page.evaluate(() => {
    const normalize = (value) =>
      String(value || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const numberPattern = String.raw`[0-9０-９][0-9０-９,，.．]*(?:\s*(?:億|亿|万|萬|千|K|M|B))?`;
    const bodyText = normalize(document.body?.innerText || document.body?.textContent || "");
    const selectorText =
      [
        "#subscriber-count",
        "yt-content-metadata-view-model span",
        "yt-content-metadata-view-model",
        "ytd-channel-about-metadata-renderer",
      ]
        .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
        .map((node) => normalize(node.innerText || node.textContent || node.getAttribute("aria-label") || ""))
        .find((value) => /(登録者|subscribers?|订阅者|訂閱者)/i.test(value)) || "";
    const match = bodyText.match(new RegExp(`${numberPattern}\\s*(?:登録者|subscribers?|subscriber|订阅者|訂閱者)`, "i"));
    return { subscriberText: selectorText || normalize(match?.[0] || "") };
  });
}

async function main() {
  const payload = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  const liveItems = uniqueLiveEntries(payload);
  if (!liveItems.length) {
    console.log("[live-post] no live items");
    return;
  }

  const byVideoId = new Map();
  for (const item of payload.groups.live.items || []) {
    if (!item.videoId) continue;
    if (!byVideoId.has(item.videoId)) byVideoId.set(item.videoId, []);
    byVideoId.get(item.videoId).push(item);
  }

  let cleared = 0;
  for (const item of payload.groups.live.items || []) {
    if (clearUntrustedLiveViewer(item)) cleared += 1;
  }

  const browser = await chromium.launch({
    headless: CONFIG.headless,
    executablePath: CONFIG.chromeExecutable || undefined,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });

  let watchChecked = 0;
  let watchChanged = 0;
  let channelChecked = 0;
  let channelChanged = 0;

  try {
    const page = await browser.newPage({
      locale: "ja-JP",
      viewport: { width: 1280, height: 900 },
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    });
    page.setDefaultTimeout(12000);

    const watchTargets = liveItems.filter(needsWatchDetail).slice(0, CONFIG.limit);
    console.log(`[live-post] watch detail targets=${watchTargets.length}, limit=${CONFIG.limit}`);
    for (const item of watchTargets) {
      try {
        await gotoWithRetry(page, canonicalWatchUrl(item));
        await dismissConsent(page);
        await page.waitForTimeout(CONFIG.delayMs);
        const detail = await extractWatchDetails(page);
        watchChecked += 1;
        for (const entry of byVideoId.get(item.videoId) || []) {
          if (mergeDetail(entry, detail, "watchPagePost")) watchChanged += 1;
        }
      } catch (error) {
        console.warn(`[live-post] watch ${item.videoId}: ${error.message}`);
      }
    }

    const byChannelUrl = new Map();
    for (const item of payload.groups.live.items || []) {
      if (item.subscriberCount != null || !item.channelUrl) continue;
      const detailUrl = normalizeChannelDetailUrl(item.channelUrl);
      if (!detailUrl) continue;
      if (!byChannelUrl.has(detailUrl)) byChannelUrl.set(detailUrl, []);
      byChannelUrl.get(detailUrl).push(item);
    }

    const channelTargets = Array.from(byChannelUrl.entries()).slice(0, CONFIG.channelLimit);
    console.log(`[live-post] channel detail targets=${channelTargets.length}, limit=${CONFIG.channelLimit}`);
    for (const [detailUrl, items] of channelTargets) {
      try {
        await gotoWithRetry(page, detailUrl);
        await dismissConsent(page);
        await page.waitForTimeout(CONFIG.delayMs);
        const detail = await extractChannelDetails(page);
        channelChecked += 1;
        for (const item of items) {
          if (mergeDetail(item, detail, "channelPagePost")) channelChanged += 1;
        }
      } catch (error) {
        console.warn(`[live-post] channel ${detailUrl}: ${error.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  payload.liveDetailPostProcess = {
    generatedAt: new Date().toISOString(),
    limit: CONFIG.limit,
    channelLimit: CONFIG.channelLimit,
    clearedUntrustedLiveViewers: cleared,
    watchChecked,
    watchChanged,
    channelChecked,
    channelChanged,
  };

  await fs.writeFile(DATA_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    `[live-post] cleared=${cleared}, watch=${watchChecked}/${watchChanged}, channel=${channelChecked}/${channelChanged}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
