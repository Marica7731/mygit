(function () {
  const STORAGE_PREFIX = "ytb-ranking-state-v1:";
  const DEFAULT_TITLE_TERMS = ["歌枠", "弾き語り"];
  const KOREAN_TEXT_PATTERN = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;
  const DEFAULT_TITLE_DISABLED_PREFIX = "ytb-ranking-default-title-filter-disabled-v1:";
  const originalFetch = window.fetch.bind(window);
  let localizeQueued = false;
  let itemByVideoId = new Map();
  let orderByVideoId = new Map();
  const thumbnailCheckCache = new Map();
  const thumbnailScanSrc = new WeakMap();
  let thumbnailSweepQueued = false;

  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    const url = typeof input === "string" ? input : input?.url || "";
    if (!url.includes("data/youtube-ranking.json")) return response;

    try {
      const data = await response.clone().json();
      return new Response(JSON.stringify(transformData(data)), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      return response;
    }
  };

  document.addEventListener("change", handleSortChange, true);
  document.addEventListener("error", handleThumbnailError, true);
  document.addEventListener("load", handleThumbnailLoad, true);
  document.addEventListener("DOMContentLoaded", boot);

  function boot() {
    installSortOptions();
    scheduleLocalizeCards();
    scheduleThumbnailSweep();
    for (let index = 1; index <= 12; index += 1) {
      setTimeout(scheduleLocalizeCards, index * 300);
      setTimeout(scheduleThumbnailSweep, index * 300 + 120);
    }
    window.addEventListener("scroll", scheduleThumbnailSweep, { passive: true });
    const root = document.getElementById("ranking-sections") || document.body;
    new MutationObserver(scheduleLocalizeCards).observe(root, {
      childList: true,
      subtree: true,
    });
  }

  function scheduleLocalizeCards() {
    if (localizeQueued) return;
    localizeQueued = true;
    requestAnimationFrame(() => {
      localizeQueued = false;
      localizeCards();
    });
  }

  function handleSortChange(event) {
    const select = event.target.closest('select[data-state="sortOrder"]');
    if (!select) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    writeState({ sortOrder: select.value });
    window.location.reload();
  }

  function installSortOptions() {
    const select = document.querySelector('select[data-state="sortOrder"]');
    if (!select || select.dataset.sortHotfix) return;
    select.innerHTML = [
      ["liveViewersDesc", "粉丝多到少"],
      ["liveViewersAsc", "粉丝少到多"],
      ["viewsDesc", "播放量多到少"],
      ["viewsAsc", "播放量少到多"],
      ["publishedDesc", "发布时间新到旧"],
      ["publishedAsc", "发布时间旧到新"],
      ["durationDesc", "时长长到短"],
      ["durationAsc", "时长短到长"],
      ["titleAsc", "标题 A-Z"],
      ["titleDesc", "标题 Z-A"],
      ["channelAsc", "频道名 A-Z"],
      ["channelDesc", "频道名 Z-A"],
    ]
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join("");
    select.value = getSortOrder();
    select.dataset.sortHotfix = "1";
  }

  function transformData(data) {
    const cloned = JSON.parse(JSON.stringify(data));
    const group = cloned?.groups?.[sourceGroup()];
    if (!group) return cloned;

    let items = group.items || [];
    if (localStorage.getItem(`${DEFAULT_TITLE_DISABLED_PREFIX}${sourceGroup()}`) !== "1") {
      items = items.filter((item) => {
        const title = String(item.title || "");
        return DEFAULT_TITLE_TERMS.some((term) => title.includes(term)) && !KOREAN_TEXT_PATTERN.test(title);
      });
    }

    const order = getSortOrder();
    items = items.filter((item) => matchesSortMetric(item, order));
    const sorted = sortItems(items, order).map((item, index) => ({ ...item, visibleRank: index + 1 }));
    group.items = sorted;
    itemByVideoId = new Map(sorted.filter((item) => item.videoId).map((item) => [item.videoId, item]));
    orderByVideoId = new Map();
    sorted.forEach((item, index) => {
      if (item.videoId && !orderByVideoId.has(item.videoId)) orderByVideoId.set(item.videoId, index);
    });

    if (group.keywords) {
      for (const key of Object.keys(group.keywords)) {
        group.keywords[key] = sorted.filter((item) => item.keyword === key || item.group === key);
      }
    }
    if (Array.isArray(group.sources)) {
      group.sources = group.sources.map((source) => ({
        ...source,
        itemCount: sorted.filter((item) => item.keyword === source.keyword || item.group === source.keyword).length,
      }));
    }
    return cloned;
  }

  function getSortOrder() {
    const order = readState().sortOrder;
    const valid = new Set([
      "liveViewersDesc",
      "liveViewersAsc",
      "viewsDesc",
      "viewsAsc",
      "publishedDesc",
      "publishedAsc",
      "durationDesc",
      "durationAsc",
      "titleAsc",
      "titleDesc",
      "channelAsc",
      "channelDesc",
    ]);
    if (valid.has(order) && order !== "original") return order;
    return sourceGroup() === "live" ? "liveViewersDesc" : "viewsDesc";
  }

  function matchesSortMetric(item, order) {
    const status = item?.statusType || "unknown";
    if (order === "viewsDesc" || order === "viewsAsc") {
      return status !== "live" && status !== "upcoming" && item?.liveViewerCount == null;
    }
    if (order === "liveViewersDesc" || order === "liveViewersAsc") {
      return sourceGroup() === "live" ? true : status === "live" || status === "upcoming" || isTrustedLiveViewer(item);
    }
    return true;
  }

  function sortItems(items, order) {
    const collator = new Intl.Collator(["ja", "zh", "en"], { numeric: true, sensitivity: "base" });
    const entries = items.map((item, index) => ({ item, index }));
    const originalOrder = (a, b) =>
      (a.item.originalRank || a.item.rank || a.index) - (b.item.originalRank || b.item.rank || b.index) ||
      a.index - b.index;
    const metric = (item, field) => {
      if (field === "liveSortMetric") {
        return item.subscriberCount ?? (isTrustedLiveViewer(item) ? item.liveViewerCount : null) ?? item.likeCount ?? null;
      }
      return item[field];
    };
    const desc = (field) => (a, b) => compareMetric(metric(a.item, field), metric(b.item, field), a, b, -1);
    const asc = (field) => (a, b) => compareMetric(metric(a.item, field), metric(b.item, field), a, b, 1);

    entries.sort((a, b) => {
      if (order === "viewsDesc") return desc("viewCount")(a, b);
      if (order === "viewsAsc") return asc("viewCount")(a, b);
      if (order === "liveViewersDesc") return desc("liveSortMetric")(a, b);
      if (order === "liveViewersAsc") return asc("liveSortMetric")(a, b);
      if (order === "publishedDesc") return desc("publishedTimestamp")(a, b);
      if (order === "publishedAsc") return asc("publishedTimestamp")(a, b);
      if (order === "durationDesc") return desc("durationSeconds")(a, b);
      if (order === "durationAsc") return asc("durationSeconds")(a, b);
      if (order === "titleAsc") return collator.compare(a.item.title || "", b.item.title || "") || originalOrder(a, b);
      if (order === "titleDesc") return collator.compare(b.item.title || "", a.item.title || "") || originalOrder(a, b);
      if (order === "channelAsc") {
        return collator.compare(a.item.channelName || "", b.item.channelName || "") || originalOrder(a, b);
      }
      if (order === "channelDesc") {
        return collator.compare(b.item.channelName || "", a.item.channelName || "") || originalOrder(a, b);
      }
      return originalOrder(a, b);
    });
    return entries.map((entry) => entry.item);

    function compareMetric(aValue, bValue, a, b, direction) {
      if (aValue == null && bValue == null) return originalOrder(a, b);
      if (aValue == null) return 1;
      if (bValue == null) return -1;
      return (aValue - bValue) * direction || originalOrder(a, b);
    }
  }

  function localizeCards() {
    installSortOptions();
    reorderCards();
    reconcileRankMetrics();
    document.querySelectorAll(".rank-metric, .meta-list span").forEach((node) => {
      const nextText = localizeMetric(node.textContent || "");
      if (node.textContent !== nextText) node.textContent = nextText;
    });
  }

  function reorderCards() {
    if (!orderByVideoId.size) return;
    document.querySelectorAll(".cards").forEach((parent) => {
      const cards = Array.from(parent.children).filter((child) => child.classList?.contains("video-card"));
      if (cards.length < 2) return;
      const sorted = cards
        .map((card, index) => ({ card, index, order: orderByVideoId.get(getCardVideoId(card)) }))
        .sort((a, b) => {
          if (a.order == null && b.order == null) return a.index - b.index;
          if (a.order == null) return 1;
          if (b.order == null) return -1;
          return a.order - b.order || a.index - b.index;
        })
        .map((entry) => entry.card);
      if (sorted.every((card, index) => card === cards[index])) return;
      const fragment = document.createDocumentFragment();
      sorted.forEach((card) => fragment.append(card));
      parent.append(fragment);
    });
  }

  function reconcileRankMetrics() {
    document.querySelectorAll(".video-card").forEach((card) => {
      const rankLine = card.querySelector(".rank-line");
      if (!rankLine) return;

      const metric = getPrimaryMetric(card);
      let hotfixMetric = rankLine.querySelector(".hotfix-rank-metric");
      let node = rankLine.querySelector(".rank-metric");
      if (!metric) {
        if (hotfixMetric) hotfixMetric.remove();
        if (node) node.remove();
        card.classList.remove("has-rank-metric", "has-primary-metric");
        return;
      }

      if (!hotfixMetric) {
        hotfixMetric = document.createElement("span");
        rankLine.append(hotfixMetric);
      }
      hotfixMetric.className = `hotfix-rank-metric metric-${metric.type}`;
      hotfixMetric.textContent = localizeMetric(metric.text);

      if (node) node.remove();
      card.classList.add("has-rank-metric", "has-primary-metric");
    });
  }

  function getPrimaryMetric(card) {
    const item = itemByVideoId.get(getCardVideoId(card));
    if (sourceGroup() === "live") {
      if (item?.subscriberCount != null) return { type: "subscriber", text: `${formatCompactCount(item.subscriberCount)}粉丝` };
      if (hasSubscriberMetricText(item?.subscriberText)) return { type: "subscriber", text: item.subscriberText };
      if (isTrustedLiveViewer(item)) return { type: "live", text: `${formatCompactCount(item.liveViewerCount)} 人` };
      if (isTrustedLiveViewerText(item?.liveViewerText, item?.liveViewerSource)) {
        return { type: "live", text: item.liveViewerText };
      }
      if (item?.likeCount != null) return { type: "like", text: `${formatCompactCount(item.likeCount)}赞` };
      return null;
    }

    if (item?.viewCount != null) return { type: "view", text: `${formatCompactCount(item.viewCount)}播放` };
    if (hasViewMetricText(item?.viewText)) return { type: "view", text: item.viewText };
    if (hasViewMetricText(card.querySelector(".rank-metric, .meta-list span.metric-view")?.textContent)) {
      return { type: "view", text: card.querySelector(".rank-metric, .meta-list span.metric-view")?.textContent || "" };
    }
    return null;
  }

  function localizeMetric(text) {
    const value = normalize(text);
    if (!value) return "";
    const number = "([0-9０-９][0-9０-９,，.．]*(?:\\s*(?:億|亿|万|萬|千|K|M|B))?)";
    const live = value.match(new RegExp(`${number}\\s*(?:人が視聴中|人が視聴|視聴中|watching now|watching|观看中|觀看中)`, "i"));
    if (live) return `${normalizeNumber(live[1])} 人`;
    const views = value.match(new RegExp(`${number}\\s*(?:回視聴|視聴回数|views?|次观看|次觀看|播放)`, "i"));
    if (views) return `${normalizeNumber(views[1])}播放`;
    const subs = value.match(new RegExp(`${number}\\s*(?:登録者|subscribers?|subscriber|订阅者|訂閱者|粉丝)`, "i"));
    if (subs) return `${normalizeNumber(subs[1])}粉丝`;
    return value
      .replace(/回視聴|視聴回数|views?/gi, "播放")
      .replace(/人が視聴中|人が視聴|視聴中/gi, "人")
      .replace(/登録者|subscribers?|subscriber/gi, "粉丝");
  }

  function hasViewMetricText(text) {
    return /[0-9０-９][0-9０-９,，.．]*\s*(?:億|亿|万|萬|千|K|M|B)?\s*(?:回視聴|視聴回数|views?|次观看|次觀看|播放)/i.test(
      normalize(text),
    );
  }

  function hasLiveMetricText(text) {
    return /[0-9０-９][0-9０-９,，.．]*\s*(?:人が視聴中|人が視聴|視聴中|watching now|watching|观看中|觀看中|人)/i.test(
      normalize(text),
    );
  }

  function isTrustedLiveViewer(item) {
    return item?.liveViewerCount != null && item.liveViewerSource === "youtubeDataApi";
  }

  function isTrustedLiveViewerText(text, source) {
    return source === "youtubeDataApi" && hasLiveMetricText(text);
  }

  function hasSubscriberMetricText(text) {
    return /[0-9０-９][0-9０-９,，.．]*\s*(?:億|亿|万|萬|千|K|M|B)?\s*(?:登録者|subscribers?|subscriber|订阅者|訂閱者|粉丝)/i.test(
      normalize(text),
    );
  }

  function formatCompactCount(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    if (number >= 100000000) return `${trimDecimal(number / 100000000)}亿`;
    if (number >= 10000) return `${trimDecimal(number / 10000)}万`;
    return String(Math.round(number));
  }

  function trimDecimal(value) {
    return value.toFixed(value >= 10 ? 0 : 1).replace(/\\.0$/, "");
  }

  function handleThumbnailError(event) {
    const img = event.target;
    if (img instanceof HTMLImageElement && img.closest(".thumbnail")) useNextThumbnail(img);
  }

  function handleThumbnailLoad(event) {
    const img = event.target;
    if (img instanceof HTMLImageElement && img.closest(".thumbnail")) scheduleThumbnailPlaceholderCheck(img);
  }

  function scheduleThumbnailSweep() {
    if (thumbnailSweepQueued) return;
    thumbnailSweepQueued = true;
    requestAnimationFrame(() => {
      thumbnailSweepQueued = false;
      document.querySelectorAll(".thumbnail img").forEach((img) => {
        if (!(img instanceof HTMLImageElement) || !isNearViewport(img)) return;
        const src = absoluteUrl(img.currentSrc || img.src);
        if (!src || thumbnailScanSrc.get(img) === src) return;
        thumbnailScanSrc.set(img, src);
        if (img.complete && img.naturalWidth === 0) useNextThumbnail(img);
        else if (img.complete) scheduleThumbnailPlaceholderCheck(img);
      });
    });
  }

  function isNearViewport(element) {
    const rect = element.getBoundingClientRect();
    const margin = Math.max(700, window.innerHeight || 800);
    return rect.bottom >= -margin && rect.top <= (window.innerHeight || 800) + margin;
  }

  function isWeakThumbnail(img) {
    const src = absoluteUrl(img.currentSrc || img.src);
    if (!src || img.hidden || !img.complete || img.naturalWidth === 0) return false;
    return /\/vi(?:_webp)?\/[^/]+\/(?:default|mqdefault|hqdefault|sddefault|hq720|maxresdefault|hqdefault_live)\.(?:jpg|webp)(?:[?#]|$)/i.test(
      src,
    );
  }

  function scheduleThumbnailPlaceholderCheck(img) {
    if (!(img instanceof HTMLImageElement) || !img.closest(".thumbnail") || !isNearViewport(img) || !isWeakThumbnail(img)) return;
    const src = absoluteUrl(img.currentSrc || img.src);
    if (!src) return;

    const cached = thumbnailCheckCache.get(src);
    if (cached === "missing") {
      useNextThumbnail(img);
      return;
    }
    if (cached === "ok") return;
    if (cached && typeof cached.then === "function") {
      cached.then((isPlaceholder) => {
        if (isPlaceholder && absoluteUrl(img.currentSrc || img.src) === src) useNextThumbnail(img);
      });
      return;
    }
    if (img.dataset.placeholderCheckedSrc === src) return;
    img.dataset.placeholderCheckedSrc = src;

    let checkPromise;
    const run = () => {
      checkPromise = inspectThumbnailPixels(src);
      thumbnailCheckCache.set(src, checkPromise);
      checkPromise.then((isPlaceholder) => {
        thumbnailCheckCache.set(src, isPlaceholder ? "missing" : "ok");
        if (isPlaceholder && absoluteUrl(img.currentSrc || img.src) === src) useNextThumbnail(img);
      });
    };
    if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 900 });
    else setTimeout(run, 80);
  }

  function inspectThumbnailPixels(src) {
    return new Promise((resolve) => {
      const probe = new Image();
      probe.crossOrigin = "anonymous";
      probe.decoding = "async";
      probe.onload = () => {
        try {
          const width = 32;
          const height = 18;
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(probe, 0, 0, width, height);
          resolve(isFlatGrayPlaceholder(context.getImageData(0, 0, width, height).data));
        } catch {
          resolve(false);
        }
      };
      probe.onerror = () => resolve(true);
      probe.src = src;
    });
  }

  function isFlatGrayPlaceholder(data) {
    let grayish = 0;
    let saturated = 0;
    let total = 0;
    let sum = 0;
    let sumSquared = 0;

    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      if (alpha < 16) continue;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const spread = max - min;
      const brightness = (red + green + blue) / 3;
      if (spread <= 12) grayish += 1;
      if (spread > 36) saturated += 1;
      total += 1;
      sum += brightness;
      sumSquared += brightness * brightness;
    }

    if (!total) return true;
    const mean = sum / total;
    const variance = sumSquared / total - mean * mean;
    const grayRatio = grayish / total;
    const saturatedRatio = saturated / total;

    return grayRatio > 0.93 && saturatedRatio < 0.015 && variance < 1400 && mean > 70 && mean < 230;
  }

  function useNextThumbnail(img) {
    const candidates = getThumbnailCandidates(img);
    const current = absoluteUrl(img.currentSrc || img.src);
    const currentIndex = Math.max(0, candidates.findIndex((candidate) => absoluteUrl(candidate) === current));
    for (let index = currentIndex + 1; index < candidates.length; index += 1) {
      if (absoluteUrl(candidates[index]) !== current) {
        img.src = candidates[index];
        return;
      }
    }
    markThumbnailMissing(img);
  }

  function getThumbnailCandidates(img) {
    const href = img.closest(".thumbnail")?.href || img.src || "";
    const videoId = getVideoId(href);
    const values = [img.dataset.originalThumbnailSrc, img.getAttribute("src"), img.currentSrc, img.src].filter(Boolean);
    if (videoId) {
      values.push(
        `https://i.ytimg.com/vi/${videoId}/hq720.jpg`,
        `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/default.jpg`,
      );
    }
    return Array.from(new Set(values.map(absoluteUrl).filter(Boolean)));
  }

  function getVideoId(value) {
    try {
      const url = new URL(value, location.href);
      return url.searchParams.get("v") || (url.pathname.match(/\/(?:shorts|embed|vi)\/([^/?#]+)/) || [])[1] || "";
    } catch {
      return "";
    }
  }

  function getCardVideoId(card) {
    const link = card.querySelector('a[href*="watch"], a[href*="/shorts/"], .thumbnail');
    return getVideoId(link?.href || "");
  }

  function markThumbnailMissing(img) {
    const card = img.closest(".video-card");
    if (card) card.classList.add("is-thumbnail-missing");
  }

  function readState() {
    try {
      return JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${sourceGroup()}`) || "{}") || {};
    } catch {
      return {};
    }
  }

  function writeState(patch) {
    localStorage.setItem(`${STORAGE_PREFIX}${sourceGroup()}`, JSON.stringify({ ...readState(), ...patch }));
  }

  function sourceGroup() {
    return document.body.dataset.sourceGroup || "live";
  }

  function normalize(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeNumber(value) {
    return normalize(value)
      .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
      .replace(/\s+/g, "");
  }

  function absoluteUrl(value) {
    try {
      return new URL(value, location.href).href;
    } catch {
      return "";
    }
  }
})();
