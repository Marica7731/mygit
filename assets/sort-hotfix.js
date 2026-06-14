(function () {
  const STORAGE_PREFIX = "ytb-ranking-state-v1:";
  const DEFAULT_TITLE_TERMS = ["歌枠", "弾き語り"];
  const KOREAN_TEXT_PATTERN = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;
  const DEFAULT_TITLE_DISABLED_PREFIX = "ytb-ranking-default-title-filter-disabled-v1:";
  const originalFetch = window.fetch.bind(window);
  let localizeQueued = false;
  let itemByVideoId = new Map();

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
    const desc = (field) => (a, b) => compareMetric(metric(b.item, field), metric(a.item, field), a, b);
    const asc = (field) => (a, b) => compareMetric(metric(a.item, field), metric(b.item, field), a, b);

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

    function compareMetric(aValue, bValue, a, b) {
      if (aValue == null && bValue == null) return originalOrder(a, b);
      if (aValue == null) return 1;
      if (bValue == null) return -1;
      return aValue - bValue || originalOrder(a, b);
    }
  }

  function localizeCards() {
    installSortOptions();
    reconcileRankMetrics();
    document.querySelectorAll(".rank-metric, .meta-list span").forEach((node) => {
      const nextText = localizeMetric(node.textContent || "");
      if (node.textContent !== nextText) node.textContent = nextText;
    });
    document.querySelectorAll(".thumbnail img").forEach((img) => {
      if (img.complete && (img.naturalWidth === 0 || isLikelyPlaceholder(img))) useNextThumbnail(img);
    });
  }

  function reconcileRankMetrics() {
    document.querySelectorAll(".video-card").forEach((card) => {
      const rankLine = card.querySelector(".rank-line");
      if (!rankLine) return;

      const metric = getPrimaryMetric(card);
      let node = rankLine.querySelector(".rank-metric");
      if (!metric) {
        if (node) node.remove();
        card.classList.remove("has-rank-metric", "has-primary-metric");
        return;
      }

      if (!node) {
        node = document.createElement("span");
        rankLine.append(node);
      }
      const className = `rank-metric metric-${metric.type}`;
      const text = localizeMetric(metric.text);
      if (node.className !== className) node.className = className;
      if (node.textContent !== text) node.textContent = text;
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
    if (img instanceof HTMLImageElement && img.closest(".thumbnail") && isLikelyPlaceholder(img)) useNextThumbnail(img);
  }

  function isLikelyPlaceholder(img) {
    const src = absoluteUrl(img.currentSrc || img.src);
    if (!src || img.hidden || !img.complete || img.naturalWidth === 0) return false;
    if (img.naturalWidth > 160 || img.naturalHeight > 120) return false;
    return /\/(?:hq720|maxresdefault|sddefault|hqdefault)\.jpg(?:[?#]|$)/.test(src);
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
