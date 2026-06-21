#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT_DIR, "data", "youtube-ranking.json");

const KEYWORDS = [
  {
    keyword: "歌枠",
    key: "utawaku",
    urls: {
      live: "https://www.youtube.com/results?search_query=%E6%AD%8C%E6%9E%A0&sp=CAASAkAB",
      today: "https://www.youtube.com/results?search_query=%E6%AD%8C%E6%9E%A0&sp=CAMSBAgCGAI%253D",
      month: "https://www.youtube.com/results?search_query=%E6%AD%8C%E6%9E%A0&sp=CAMSBggEEAEYAg%253D%253D",
    },
  },
  {
    keyword: "弾き語り",
    key: "hikigatari",
    urls: {
      live: "https://www.youtube.com/results?search_query=%E5%BC%BE%E3%81%8D%E8%AA%9E%E3%82%8A&sp=CAASAkAB",
      today: "https://www.youtube.com/results?search_query=%E5%BC%BE%E3%81%8D%E8%AA%9E%E3%82%8A&sp=CAMSBAgCGAI%253D",
      month: "https://www.youtube.com/results?search_query=%E5%BC%BE%E3%81%8D%E8%AA%9E%E3%82%8A&sp=CAMSBggEEAEYAg%253D%253D",
    },
  },
];

const SOURCE_GROUPS = {
  live: {
    label: "直播 / 预约",
    title: "歌枠 / 弾き語り直播与预约",
    description: "YouTube 搜索结果中的直播、预约和即将开始内容。",
  },
  today: {
    label: "今日热度",
    title: "今日歌枠 / 弾き語り热度排行",
    description: "YouTube 今日筛选结果，保留页面原始展示顺序。",
  },
  month: {
    label: "本月热度",
    title: "本月歌枠 / 弾き語り热度排行",
    description: "YouTube 本月筛选结果，每个来源最多保留 500 条。",
  },
};

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

function parseCsvEnv(name, fallback) {
  const raw = process.env[name] || fallback;
  return new Set(
    raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

const CONFIG = {
  target: parseIntegerEnv("YTB_RANKING_TARGET", 300),
  globalLimit: parseIntegerEnv("YTB_RANKING_LIMIT", 1000),
  groupLimits: {
    live: parseIntegerEnv("YTB_RANKING_LIVE_LIMIT", 500),
    today: parseIntegerEnv("YTB_RANKING_TODAY_LIMIT", 500),
    month: parseIntegerEnv("YTB_RANKING_MONTH_LIMIT", 500),
  },
  scrollToBottomGroups: parseCsvEnv("YTB_RANKING_SCROLL_TO_BOTTOM_GROUPS", "live,today"),
  maxScrolls: parseIntegerEnv("YTB_RANKING_MAX_SCROLLS", 160),
  scrollDelayMs: parseIntegerEnv("YTB_RANKING_SCROLL_DELAY_MS", 1400),
  initialDelayMs: parseIntegerEnv("YTB_RANKING_INITIAL_DELAY_MS", 2500),
  navigationTimeoutMs: parseIntegerEnv("YTB_RANKING_NAVIGATION_TIMEOUT_MS", 60000),
  enrichLiveDetails: parseBooleanEnv("YTB_RANKING_ENRICH_LIVE_DETAILS", true),
  liveDetailLimit: parseIntegerEnv("YTB_RANKING_LIVE_DETAIL_LIMIT", 120),
  liveDetailDelayMs: parseIntegerEnv("YTB_RANKING_LIVE_DETAIL_DELAY_MS", 2500),
  liveDetailNavigationTimeoutMs: parseIntegerEnv("YTB_RANKING_LIVE_DETAIL_NAVIGATION_TIMEOUT_MS", 60000),
  youtubeApiKey: process.env.YOUTUBE_API_KEY || process.env.YTB_RANKING_YOUTUBE_API_KEY || "",
  headless: parseBooleanEnv("YTB_RANKING_HEADLESS", true),
  locale: process.env.YTB_RANKING_LOCALE || "ja-JP",
  region: process.env.YTB_RANKING_REGION || "JP",
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
  if (/[億亿]/.test(normalized)) {
    multiplier = 100000000;
  } else if (/[万萬]/.test(normalized)) {
    multiplier = 10000;
  } else if (/千/.test(normalized)) {
    multiplier = 1000;
  } else if (/\bK\b/i.test(normalized)) {
    multiplier = 1000;
  } else if (/\bM\b/i.test(normalized)) {
    multiplier = 1000000;
  } else if (/\bB\b/i.test(normalized)) {
    multiplier = 1000000000;
  }

  return Math.round(value * multiplier);
}

function formatCount(value, suffix) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return `${Math.round(number).toLocaleString("ja-JP")} ${suffix}`;
}

function parseDurationSeconds(text) {
  const normalized = normalizeDigits(normalizeWhitespace(text));
  if (!normalized) return null;

  const colonMatch = normalized.match(/\b(\d{1,2}:)?\d{1,2}:\d{2}\b|\b\d{1,2}:\d{2}\b/);
  if (colonMatch) {
    const parts = colonMatch[0].split(":").map((part) => Number.parseInt(part, 10));
    if (parts.some((part) => !Number.isFinite(part))) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return parts[0] * 60 + parts[1];
  }

  let seconds = 0;
  const hourMatch = normalized.match(/(\d+(?:[.]\d+)?)\s*(hours?|hrs?|時間|小时|小時)/i);
  const minuteMatch = normalized.match(/(\d+(?:[.]\d+)?)\s*(minutes?|mins?|分|分钟|分鐘)/i);
  const secondMatch = normalized.match(/(\d+(?:[.]\d+)?)\s*(seconds?|secs?|秒)/i);

  if (hourMatch) seconds += Number.parseFloat(hourMatch[1]) * 3600;
  if (minuteMatch) seconds += Number.parseFloat(minuteMatch[1]) * 60;
  if (secondMatch) seconds += Number.parseFloat(secondMatch[1]);

  return seconds > 0 ? Math.round(seconds) : null;
}

function parsePublishedTimestamp(text, nowMs) {
  const normalized = normalizeDigits(normalizeWhitespace(text).toLowerCase());
  if (!normalized) return null;

  if (/昨日|yesterday/.test(normalized)) return nowMs - 24 * 60 * 60 * 1000;

  const directDate = normalized.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
  if (directDate) {
    const date = new Date(
      Number.parseInt(directDate[1], 10),
      Number.parseInt(directDate[2], 10) - 1,
      Number.parseInt(directDate[3], 10),
    );
    const value = date.getTime();
    return Number.isFinite(value) ? value : null;
  }

  const match = normalized.match(/(\d+(?:[.]\d+)?)\s*(seconds?|secs?|秒|minutes?|mins?|分|hours?|hrs?|時間|小时|小時|days?|日|weeks?|週間|周|months?|か月|ヶ月|月|years?|年)/i);
  if (!match) return null;

  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;

  const unit = match[2];
  let days = 0;
  if (/seconds?|secs?|秒/i.test(unit)) return nowMs - value * 1000;
  if (/minutes?|mins?|分/i.test(unit)) return nowMs - value * 60 * 1000;
  if (/hours?|hrs?|時間|小时|小時/i.test(unit)) return nowMs - value * 60 * 60 * 1000;
  if (/days?|日/i.test(unit)) days = value;
  if (/weeks?|週間|周/i.test(unit)) days = value * 7;
  if (/months?|か月|ヶ月|月/i.test(unit)) days = value * 30;
  if (/years?|年/i.test(unit)) days = value * 365;

  return days > 0 ? nowMs - days * 24 * 60 * 60 * 1000 : null;
}

function deriveStatusType(item) {
  const text = normalizeWhitespace(
    [item.statusText, item.liveViewerText, item.viewText, item.publishedText, item.durationText]
      .filter(Boolean)
      .join(" "),
  ).toLowerCase();

  const hasLiveViewer = item.liveViewerCount != null;
  const upcomingPattern =
    /(upcoming|scheduled|premiere|waiting|notify me|公開予定|配信予定|ライブ配信予定|予定|予約|待機|まもなく|即将|預約|预约)/i;
  const livePattern = /(live|ライブ|配信中|生放送|視聴中|watching|直播中|正在观看|正在觀看|실시간|시청 중)/i;

  if (!hasLiveViewer && upcomingPattern.test(text)) return "upcoming";
  if (hasLiveViewer || livePattern.test(text)) return "live";
  if (item.durationSeconds != null || item.viewCount != null || item.viewText) return "video";
  return "unknown";
}

function canonicalWatchUrl(rawUrl, videoId) {
  if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
  return rawUrl || "";
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
      item.group,
      item.keyword,
      item.sourceGroup,
      item.sourceUrl,
    ]
      .filter(Boolean)
      .join(" "),
  );
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
      if (await button.isVisible({ timeout: 1200 })) {
        await button.click({ timeout: 3000 });
        await page.waitForTimeout(1200);
        return;
      }
    } catch {
      // Consent UI is regional and often absent.
    }
  }
}

async function gotoWithRetry(page, url, timeout) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1500 * attempt);
    }
  }
  throw lastError;
}

async function extractSearchItems(page) {
  return page.evaluate(() => {
    const normalize = (value) =>
      String(value || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const text = (node) => normalize(node ? node.innerText || node.textContent : "");

    const absoluteUrl = (href) => {
      if (!href) return "";
      try {
        return new URL(href, location.origin).href;
      } catch {
        return "";
      }
    };

    const videoIdFromUrl = (url) => {
      try {
        const parsed = new URL(url);
        if (parsed.searchParams.get("v")) return parsed.searchParams.get("v");
        const shortsMatch = parsed.pathname.match(/\/shorts\/([^/?#]+)/);
        if (shortsMatch) return shortsMatch[1];
      } catch {
        return "";
      }
      return "";
    };

    const pickFirstText = (nodes, predicate) => {
      for (const node of nodes) {
        const value = text(node);
        if (value && (!predicate || predicate(value))) return value;
      }
      return "";
    };

    const imageUrl = (img) => {
      if (!img) return "";
      const direct =
        img.currentSrc ||
        img.src ||
        img.getAttribute("data-thumb") ||
        img.getAttribute("data-src") ||
        "";
      if (direct && !direct.startsWith("data:")) return direct;

      const srcset = img.getAttribute("srcset") || "";
      const firstSrcsetUrl = srcset
        .split(",")
        .map((part) => part.trim().split(/\s+/)[0])
        .find(Boolean);
      return firstSrcsetUrl && !firstSrcsetUrl.startsWith("data:") ? firstSrcsetUrl : "";
    };

    const renderers = Array.from(
      document.querySelectorAll(
        [
          "ytd-video-renderer",
          "ytd-grid-video-renderer",
          "ytd-rich-item-renderer",
          "ytd-reel-item-renderer",
          "ytd-compact-video-renderer",
        ].join(","),
      ),
    );

    return renderers
      .map((renderer) => {
        const titleLink =
          renderer.querySelector('a#video-title[href*="/watch"]') ||
          renderer.querySelector('a#video-title-link[href*="/watch"]') ||
          renderer.querySelector('a[href*="/watch?v="]') ||
          renderer.querySelector('a[href*="/shorts/"]');

        const rawWatchUrl = absoluteUrl(titleLink ? titleLink.getAttribute("href") : "");
        const videoId = videoIdFromUrl(rawWatchUrl);
        if (!videoId) return null;

        const title =
          normalize(titleLink.getAttribute("title")) ||
          text(titleLink) ||
          normalize(titleLink.getAttribute("aria-label"));

        const channelNode =
          renderer.querySelector("ytd-channel-name a") ||
          renderer.querySelector("#channel-name a") ||
          renderer.querySelector('a[href^="/@"]') ||
          renderer.querySelector('a[href*="/channel/"]') ||
          renderer.querySelector('a[href*="/c/"]') ||
          renderer.querySelector('a[href*="/user/"]');

        const imageNodes = Array.from(renderer.querySelectorAll("img"));
        const thumbnailUrl =
          imageNodes
            .map(imageUrl)
            .find((src) => src && !src.startsWith("data:") && /ytimg|googleusercontent|ggpht/.test(src)) ||
          imageNodes.map(imageUrl).find((src) => src && !src.startsWith("data:")) ||
          "";

        const channelAvatarNode =
          renderer.querySelector("a#avatar-link img") ||
          renderer.querySelector("#avatar img") ||
          renderer.querySelector("#channel-thumbnail img") ||
          renderer.querySelector("yt-img-shadow#avatar img") ||
          renderer.querySelector('img[src*="yt3.ggpht.com"]') ||
          renderer.querySelector('img[src*="yt3.googleusercontent.com"]') ||
          renderer.querySelector('img[src*="ggpht.com/ytc"]') ||
          renderer.querySelector('img[src*="googleusercontent.com/ytc"]');
        const channelAvatarUrl = imageUrl(channelAvatarNode);

        const metadataNodes = Array.from(
          renderer.querySelectorAll(
            [
              "#metadata-line span",
              "ytd-video-meta-block span",
              ".metadata-snippet-text",
              ".inline-metadata-item",
              ".yt-lockup-metadata-view-model-wiz__metadata span",
            ].join(","),
          ),
        );

        const badgeNodes = Array.from(
          renderer.querySelectorAll(
            [
              "ytd-badge-supported-renderer",
              ".badge-shape-wiz__text",
              ".yt-badge-shape__text",
              "ytd-thumbnail-overlay-time-status-renderer",
              "ytd-thumbnail-overlay-live-chat-renderer",
              "ytd-thumbnail-overlay-inline-unplayable-renderer",
              "#overlays",
            ].join(","),
          ),
        );

        const durationText = pickFirstText(badgeNodes, (value) => /\b(\d{1,2}:)?\d{1,2}:\d{2}\b/.test(value));
        const liveViewerText =
          pickFirstText(metadataNodes, (value) =>
            /(watching|視聴中|人が視聴|直播中|正在观看|正在觀看|시청 중|명 시청)/i.test(value),
          ) ||
          pickFirstText(badgeNodes, (value) =>
            /(watching|視聴中|人が視聴|直播中|正在观看|正在觀看|시청 중|명 시청)/i.test(value),
          );
        const viewText = pickFirstText(metadataNodes, (value) =>
          /(views?|回視聴|視聴回数|次观看|次觀看|조회수|회 시청)/i.test(value),
        );
        const publishedText = pickFirstText(metadataNodes, (value) =>
          /(ago|前|昨日|streamed|premiere|seconds?|minutes?|hours?|days?|weeks?|months?|years?|秒|分|時間|日|週間|か月|ヶ月|年|小时前|天前|周前|月前|年前)/i.test(
            value,
          ),
        );
        const statusText = Array.from(new Set(badgeNodes.map(text).filter(Boolean))).join(" / ");

        return {
          title,
          channelName: text(channelNode),
          channelAvatarUrl,
          videoId,
          watchUrl: rawWatchUrl,
          thumbnailUrl,
          viewText,
          liveViewerText,
          publishedText,
          durationText,
          statusText,
        };
      })
      .filter(Boolean);
  });
}

function dedupeItems(items) {
  const seen = new Set();
  const deduped = [];

  for (const item of items) {
    const key = item.videoId || item.watchUrl;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function usableThumbnailUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || /^(?:undefined|null)$/i.test(raw) || raw.startsWith("data:")) return "";

  let url;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }

  if (!/^https?:$/i.test(url.protocol)) return "";
  if (/\/(?:undefined|null)(?:[?#]|$)/i.test(url.pathname)) return "";
  if (!/(?:ytimg|googleusercontent|ggpht)\./i.test(url.hostname)) return "";
  return url.href;
}

async function getScrollState(page) {
  return page.evaluate(() => {
    const scrollingElement = document.scrollingElement || document.documentElement;
    const scrollTop = scrollingElement.scrollTop || window.scrollY || 0;
    const clientHeight = scrollingElement.clientHeight || window.innerHeight || 0;
    const scrollHeight = scrollingElement.scrollHeight || document.documentElement.scrollHeight || 0;
    return {
      scrollTop,
      clientHeight,
      scrollHeight,
      atBottom: scrollTop + clientHeight >= scrollHeight - 8,
    };
  });
}

async function scrollToBottom(page) {
  await page.evaluate(() => {
    const scrollingElement = document.scrollingElement || document.documentElement;
    scrollingElement.scrollTo({ top: scrollingElement.scrollHeight, behavior: "auto" });
  });
}

function sourceLimit(sourceGroup) {
  return Math.min(CONFIG.groupLimits[sourceGroup], CONFIG.globalLimit);
}

async function scrapeSource(page, source, collectedAt) {
  const limit = sourceLimit(source.sourceGroup);
  const shouldScrollToBottom = CONFIG.scrollToBottomGroups.has(source.sourceGroup);

  console.log(
    `[${source.sourceGroup}] ${source.keyword}: start, limit=${limit}, scrollToBottom=${shouldScrollToBottom}`,
  );

  await gotoWithRetry(page, source.sourceUrl, CONFIG.navigationTimeoutMs);
  await dismissConsent(page);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(CONFIG.initialDelayMs);

  let lastHeight = 0;
  let lastCount = 0;
  let stableRounds = 0;
  let reachedBottom = false;
  let truncatedByLimit = false;
  let collectedItems = [];

  for (let round = 0; round <= CONFIG.maxScrolls; round += 1) {
    const rawItems = await extractSearchItems(page);
    collectedItems = dedupeItems(rawItems);
    const scrollState = await getScrollState(page);

    if (collectedItems.length >= limit) {
      reachedBottom = scrollState.atBottom;
      truncatedByLimit = !scrollState.atBottom;
      break;
    }

    const unchanged = scrollState.scrollHeight === lastHeight && collectedItems.length === lastCount;
    stableRounds = unchanged ? stableRounds + 1 : 0;
    lastHeight = scrollState.scrollHeight;
    lastCount = collectedItems.length;

    if (scrollState.atBottom && stableRounds >= (shouldScrollToBottom ? 4 : 3)) {
      reachedBottom = true;
      break;
    }

    if (round === CONFIG.maxScrolls) {
      reachedBottom = scrollState.atBottom;
      truncatedByLimit = !scrollState.atBottom;
      break;
    }

    await scrollToBottom(page);
    await page.waitForTimeout(CONFIG.scrollDelayMs);
  }

  const finalRawItems = await extractSearchItems(page);
  const finalScrollState = await getScrollState(page);
  const finalItems = dedupeItems(finalRawItems).slice(0, limit);

  if (finalItems.length >= limit && !finalScrollState.atBottom) {
    truncatedByLimit = true;
    reachedBottom = false;
  } else if (finalScrollState.atBottom) {
    reachedBottom = true;
    truncatedByLimit = false;
  }

  const nowMs = Date.now();
  const enrichedItems = finalItems.map((rawItem, index) => {
    const durationSeconds = parseDurationSeconds(rawItem.durationText);
    const viewCount = parseCompactCount(rawItem.viewText);
    const liveViewerCount = parseCompactCount(rawItem.liveViewerText);
    const watchUrl = canonicalWatchUrl(rawItem.watchUrl, rawItem.videoId);
    const thumbnailUrl =
      usableThumbnailUrl(rawItem.thumbnailUrl) ||
      (rawItem.videoId ? `https://i.ytimg.com/vi/${encodeURIComponent(rawItem.videoId)}/hqdefault.jpg` : "");
    const baseItem = {
      rank: index + 1,
      originalRank: index + 1,
      visibleRank: index + 1,
      title: rawItem.title,
      channelName: rawItem.channelName,
      channelAvatarUrl: rawItem.channelAvatarUrl,
      videoId: rawItem.videoId,
      watchUrl,
      thumbnailUrl,
      viewText: rawItem.viewText,
      viewCount,
      liveViewerText: rawItem.liveViewerText,
      liveViewerCount,
      liveViewerSource: liveViewerCount != null ? "search" : "",
      channelId: rawItem.channelId || "",
      subscriberText: rawItem.subscriberText || "",
      subscriberCount: parseCompactCount(rawItem.subscriberText),
      subscriberSource: "",
      likeText: rawItem.likeText || "",
      likeCount: parseCompactCount(rawItem.likeText),
      likeSource: "",
      publishedText: rawItem.publishedText,
      publishedTimestamp: parsePublishedTimestamp(rawItem.publishedText, nowMs),
      durationText: rawItem.durationText,
      durationSeconds,
      statusText: rawItem.statusText,
      group: source.keyword,
      keyword: source.keyword,
      keywordKey: source.keywordKey,
      sourceGroup: source.sourceGroup,
      sourceUrl: source.sourceUrl,
      reachedBottom,
      truncatedByLimit,
      collectedAt,
    };

    return {
      ...baseItem,
      statusType: deriveStatusType(baseItem),
      searchableText: buildSearchableText(baseItem),
    };
  });

  const summary = {
    sourceGroup: source.sourceGroup,
    keyword: source.keyword,
    keywordKey: source.keywordKey,
    sourceUrl: source.sourceUrl,
    itemCount: enrichedItems.length,
    limit,
    reachedBottom,
    truncatedByLimit,
    collectedAt,
  };

  console.log(
    `[${source.sourceGroup}] ${source.keyword}: collected=${summary.itemCount}, reachedBottom=${reachedBottom}, truncatedByLimit=${truncatedByLimit}`,
  );

  return {
    summary,
    items: enrichedItems,
  };
}

function uniqueLiveItems(results) {
  const seen = new Set();
  const items = [];
  for (const item of results.flatMap((result) => result.items)) {
    if (item.sourceGroup !== "live" || !item.videoId || seen.has(item.videoId)) continue;
    seen.add(item.videoId);
    items.push(item);
  }
  return items;
}

function allItemsByVideoId(results) {
  const map = new Map();
  for (const item of results.flatMap((result) => result.items)) {
    if (!item.videoId) continue;
    if (!map.has(item.videoId)) map.set(item.videoId, []);
    map.get(item.videoId).push(item);
  }
  return map;
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
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

function mergeLiveDetail(item, detail, source) {
  if (!item || !detail) return false;
  let changed = false;

  if (detail.channelId && item.channelId !== detail.channelId) {
    item.channelId = detail.channelId;
    changed = true;
  }

  const liveViewerCount =
    detail.liveViewerCount != null ? detail.liveViewerCount : parseCompactCount(detail.liveViewerText);
  if (liveViewerCount != null) {
    item.liveViewerCount = liveViewerCount;
    item.liveViewerText = formatCount(liveViewerCount, "人が視聴中");
    item.liveViewerSource = source;
    changed = true;
  }

  const subscriberCount =
    detail.subscriberCount != null ? detail.subscriberCount : parseCompactCount(detail.subscriberText);
  if (subscriberCount != null) {
    item.subscriberCount = subscriberCount;
    item.subscriberText = formatCount(subscriberCount, "登録者");
    item.subscriberSource = source;
    changed = true;
  }

  const likeCount = detail.likeCount != null ? detail.likeCount : parseCompactCount(detail.likeText);
  if (likeCount != null) {
    item.likeCount = likeCount;
    item.likeText = formatCount(likeCount, "高評価");
    item.likeSource = source;
    changed = true;
  }

  const viewCount = parseCompactCount(detail.viewText) ?? detail.viewCount;
  if (viewCount != null && item.viewCount == null) {
    item.viewCount = viewCount;
    item.viewText = formatCount(viewCount, "回視聴");
    changed = true;
  }

  if (changed) {
    item.statusType = deriveStatusType(item);
    item.searchableText = buildSearchableText(item);
  }

  return changed;
}

async function enrichLiveItemsWithYoutubeApi(results) {
  if (!CONFIG.youtubeApiKey) {
    console.log("[live-detail] YouTube Data API key not configured; using page fallback only.");
    return { videoCount: 0, channelCount: 0 };
  }

  const liveItems = uniqueLiveItems(results);
  const ids = liveItems.map((item) => item.videoId);
  if (!ids.length) return { videoCount: 0, channelCount: 0 };

  const byVideoId = allItemsByVideoId(results);
  const channelIds = new Set();
  let videoCount = 0;

  for (const part of chunk(ids, 50)) {
    const data = await fetchYoutubeApi("videos", {
      part: "snippet,statistics,liveStreamingDetails",
      id: part.join(","),
      maxResults: "50",
    });

    for (const video of data.items || []) {
      const detail = {
        channelId: video.snippet?.channelId || "",
        viewCount: video.statistics?.viewCount != null ? Number(video.statistics.viewCount) : null,
        likeCount: video.statistics?.likeCount != null ? Number(video.statistics.likeCount) : null,
        liveViewerCount:
          video.liveStreamingDetails?.concurrentViewers != null
            ? Number(video.liveStreamingDetails.concurrentViewers)
            : null,
      };
      if (detail.channelId) channelIds.add(detail.channelId);
      for (const item of byVideoId.get(video.id) || []) {
        if (mergeLiveDetail(item, detail, "youtubeDataApi")) videoCount += 1;
      }
    }
  }

  const byChannelId = new Map();
  for (const item of byVideoId.values()) {
    for (const entry of item) {
      if (!entry.channelId) continue;
      if (!byChannelId.has(entry.channelId)) byChannelId.set(entry.channelId, []);
      byChannelId.get(entry.channelId).push(entry);
    }
  }

  let channelCount = 0;
  for (const part of chunk(Array.from(channelIds), 50)) {
    const data = await fetchYoutubeApi("channels", {
      part: "statistics",
      id: part.join(","),
      maxResults: "50",
    });

    for (const channel of data.items || []) {
      if (channel.statistics?.hiddenSubscriberCount) continue;
      const subscriberCount =
        channel.statistics?.subscriberCount != null ? Number(channel.statistics.subscriberCount) : null;
      if (subscriberCount == null) continue;
      for (const item of byChannelId.get(channel.id) || []) {
        if (mergeLiveDetail(item, { subscriberCount }, "youtubeDataApi")) channelCount += 1;
      }
    }
  }

  console.log(`[live-detail] YouTube Data API enriched videos=${videoCount}, subscribers=${channelCount}`);
  return { videoCount, channelCount };
}

async function extractWatchPageDetails(page) {
  return page.evaluate(() => {
    const normalize = (value) =>
      String(value || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const numberPattern = String.raw`[0-9０-９][0-9０-９,，.．]*(?:\\s*(?:億|亿|万|萬|千|K|M|B))?`;
    const findMatch = (text, patterns) => {
      const normalized = normalize(text);
      for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (match) return normalize(match[0]);
      }
      return "";
    };
    const textFromSelectors = (selectors) =>
      selectors
        .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
        .map((node) => normalize(node.innerText || node.textContent || node.getAttribute("aria-label") || ""))
        .find(Boolean) || "";
    const buttonTexts = Array.from(document.querySelectorAll("button, yt-button-view-model"))
      .map((node) => normalize(node.innerText || node.textContent || node.getAttribute("aria-label") || ""))
      .filter(Boolean);

    const bodyText = normalize(document.body?.innerText || document.body?.textContent || "");
    const player = window.ytInitialPlayerResponse || {};
    const videoDetails = player.videoDetails || {};

    const liveViewerText = findMatch(bodyText, [
      new RegExp(`${numberPattern}\\s*(?:人が視聴中|視聴中|watching now|watching)`, "i"),
      new RegExp(`(?:視聴中|watching now|watching)\\s*${numberPattern}`, "i"),
    ]);
    const subscriberText =
      textFromSelectors(["#owner-sub-count", "ytd-video-owner-renderer #owner-sub-count"]) ||
      findMatch(bodyText, [
        new RegExp(`${numberPattern}\\s*(?:登録者|subscribers|subscriber|订阅者|訂閱者)`, "i"),
      ]);
    const likeText =
      buttonTexts.find((value) => /(高く評価|like|いいね)/i.test(value) && new RegExp(numberPattern).test(value)) ||
      findMatch(bodyText, [new RegExp(`${numberPattern}\\s*(?:高く評価|likes?|いいね)`, "i")]);
    const viewText = findMatch(bodyText, [
      new RegExp(`${numberPattern}\\s*(?:回視聴|views?|次观看|次觀看)`, "i"),
    ]);

    return {
      channelId: videoDetails.channelId || "",
      viewCount: videoDetails.viewCount ? Number(videoDetails.viewCount) : null,
      liveViewerText,
      subscriberText,
      likeText,
      viewText,
    };
  });
}

async function enrichLiveItemsWithWatchPages(page, results) {
  if (!CONFIG.enrichLiveDetails) return { checked: 0, changed: 0 };

  const liveItems = uniqueLiveItems(results)
    .filter((item) => item.statusType === "live")
    .slice(0, CONFIG.liveDetailLimit);
  if (!liveItems.length) return { checked: 0, changed: 0 };

  const byVideoId = allItemsByVideoId(results);
  let checked = 0;
  let changed = 0;

  console.log(`[live-detail] watch page fallback start, limit=${CONFIG.liveDetailLimit}, items=${liveItems.length}`);

  for (const item of liveItems) {
    if (item.liveViewerCount != null && item.subscriberCount != null && item.likeCount != null) continue;

    try {
      await gotoWithRetry(page, item.watchUrl, CONFIG.liveDetailNavigationTimeoutMs);
      await dismissConsent(page);
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(CONFIG.liveDetailDelayMs);
      const detail = await extractWatchPageDetails(page);
      checked += 1;
      for (const entry of byVideoId.get(item.videoId) || []) {
        if (mergeLiveDetail(entry, detail, "watchPage")) changed += 1;
      }
    } catch (error) {
      console.warn(`[live-detail] ${item.videoId}: ${error.message}`);
    }
  }

  console.log(`[live-detail] watch page fallback checked=${checked}, changed=${changed}`);
  return { checked, changed };
}

async function main() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });

  const collectedAt = new Date().toISOString();
  const sources = [];
  for (const sourceGroup of Object.keys(SOURCE_GROUPS)) {
    for (const keyword of KEYWORDS) {
      sources.push({
        sourceGroup,
        keyword: keyword.keyword,
        keywordKey: keyword.key,
        sourceUrl: keyword.urls[sourceGroup],
      });
    }
  }

  const browser = await chromium.launch({
    headless: CONFIG.headless,
    executablePath: CONFIG.chromeExecutable || undefined,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });

  const context = await browser.newContext({
    locale: CONFIG.locale,
    timezoneId: "Asia/Tokyo",
    viewport: { width: 1440, height: 1200 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });

  const results = [];
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(30000);

    for (const source of sources) {
      results.push(await scrapeSource(page, source, collectedAt));
    }

    await enrichLiveItemsWithYoutubeApi(results).catch((error) => {
      console.warn(`[live-detail] YouTube Data API skipped: ${error.message}`);
    });

    if (CONFIG.enrichLiveDetails) {
      const detailPage = await context.newPage();
      detailPage.setDefaultTimeout(30000);
      try {
        await enrichLiveItemsWithWatchPages(detailPage, results);
      } finally {
        await detailPage.close().catch(() => {});
      }
    }
  } finally {
    await browser.close();
  }

  const groups = {};
  for (const sourceGroup of Object.keys(SOURCE_GROUPS)) {
    const groupResults = results.filter((result) => result.summary.sourceGroup === sourceGroup);
    const items = groupResults.flatMap((result) => result.items);
    groups[sourceGroup] = {
      sourceGroup,
      ...SOURCE_GROUPS[sourceGroup],
      collectedAt,
      updatedAt: collectedAt,
      sources: groupResults.map((result) => result.summary),
      keywords: Object.fromEntries(
        KEYWORDS.map((keyword) => [
          keyword.keyword,
          groupResults
            .filter((result) => result.summary.keyword === keyword.keyword)
            .flatMap((result) => result.items),
        ]),
      ),
      items,
    };
  }

  const payload = {
    schemaVersion: 1,
    generatedAt: collectedAt,
    collectedAt,
    target: CONFIG.target,
    limits: {
      global: CONFIG.globalLimit,
      live: sourceLimit("live"),
      today: sourceLimit("today"),
      month: sourceLimit("month"),
    },
    scrollToBottomGroups: Array.from(CONFIG.scrollToBottomGroups),
    liveDetailEnrichment: {
      enabled: CONFIG.enrichLiveDetails,
      limit: CONFIG.liveDetailLimit,
      youtubeDataApiConfigured: Boolean(CONFIG.youtubeApiKey),
    },
    locale: CONFIG.locale,
    region: CONFIG.region,
    groups,
  };

  await fs.writeFile(DATA_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${path.relative(ROOT_DIR, DATA_FILE)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
