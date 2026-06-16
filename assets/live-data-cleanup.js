(function () {
  const GROUP = document.body.dataset.sourceGroup || "live";
  if (GROUP !== "live") return;

  const DURATION_RE = /\b(?:\d{1,3}:)?\d{1,2}:\d{2}\b/;
  const DIRTY_VIDEO_IDS = new Set(["Q549p5qmepE"]);
  const DIRTY_CHANNELS = ["みかんとボーカルノート"];
  const DIRTY_TITLE_RE = [/24\s*時間\s*配信へようこそ/i];

  installStyle();
  patchRankingFetch();
  ready(() => {
    cleanupDom();
    [250, 900, 1800, 3600, 7000, 12000].forEach((delay) => setTimeout(cleanupDom, delay));
    setInterval(cleanupDom, 1600);
    new MutationObserver(scheduleCleanup).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });

  let cleanupTimer = 0;
  function scheduleCleanup() {
    clearTimeout(cleanupTimer);
    cleanupTimer = setTimeout(cleanupDom, 80);
  }

  function patchRankingFetch() {
    if (window.__YTB_LIVE_DATA_CLEANUP_FETCH__) return;
    window.__YTB_LIVE_DATA_CLEANUP_FETCH__ = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function patchedFetch(input, init) {
      const response = await originalFetch(input, init);
      if (!isRankingDataRequest(input)) return response;
      try {
        const payload = await response.clone().json();
        const cleaned = cleanPayload(payload);
        const headers = new Headers(response.headers);
        headers.set("content-type", "application/json; charset=utf-8");
        headers.delete("content-length");
        headers.delete("content-encoding");
        return new Response(JSON.stringify(cleaned), {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch {
        return response;
      }
    };
  }

  function isRankingDataRequest(input) {
    const value = typeof input === "string" ? input : input?.url || "";
    try {
      return new URL(value, location.href).pathname.endsWith("/data/youtube-ranking.json");
    } catch {
      return String(value).includes("data/youtube-ranking.json");
    }
  }

  function cleanPayload(payload) {
    const group = payload?.groups?.live;
    if (!group) return payload;

    const removed = [];
    let clearedDuration = 0;
    const filterItems = (items) =>
      (Array.isArray(items) ? items : []).filter((item) => {
        if (isExplicitDirtyLiveItem(item)) {
          removed.push({
            videoId: item.videoId || "",
            title: clean(item.title).slice(0, 120),
            channelName: clean(item.channelName),
            durationText: clean(item.durationText),
            durationSeconds: Number(item.durationSeconds) || null,
          });
          return false;
        }
        if (item?.sourceGroup === "live") {
          if (hasDuration(item)) clearedDuration += 1;
          item.durationText = "";
          item.durationSeconds = null;
        }
        return true;
      });

    if (group.keywords && typeof group.keywords === "object") {
      for (const [keyword, items] of Object.entries(group.keywords)) {
        group.keywords[keyword] = filterItems(items).map((item, index) => ({ ...item, visibleRank: index + 1 }));
      }
      group.items = Object.values(group.keywords).flat().map((item, index) => ({ ...item, visibleRank: index + 1 }));
    } else {
      group.items = filterItems(group.items).map((item, index) => ({ ...item, visibleRank: index + 1 }));
    }

    const counts = new Map();
    for (const item of group.items || []) {
      const key = item.keyword || item.group || "";
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const source of group.sources || []) {
      source.itemCount = counts.get(source.keyword) || 0;
    }

    payload.liveDurationPostProcess = {
      ...(payload.liveDurationPostProcess || {}),
      frontendFiltered: true,
      clearedLiveDurationItems: clearedDuration,
      removedExplicitDirtyLiveItems: removed.length,
      removedExplicitDirtyLiveSamples: removed.slice(0, 8),
    };
    return payload;
  }

  function isExplicitDirtyLiveItem(item) {
    if (!item || item.sourceGroup !== "live") return false;
    if (DIRTY_VIDEO_IDS.has(clean(item.videoId))) return true;
    const title = clean(item.title);
    const channel = clean(item.channelName);
    if (DIRTY_CHANNELS.some((value) => channel.includes(value))) return true;
    return DIRTY_TITLE_RE.some((pattern) => pattern.test(title));
  }

  function hasDuration(item) {
    if (Number(item?.durationSeconds) > 0) return true;
    return DURATION_RE.test(clean(item?.durationText));
  }

  function cleanupDom() {
    document.querySelectorAll(".video-card").forEach((card) => {
      if (isDirtyDomCard(card)) {
        card.hidden = true;
        card.classList.add("is-live-duration-dirty");
        card.setAttribute("aria-hidden", "true");
        return;
      }
      card.querySelectorAll(".thumb-duration,.corner-time,.hb-duration,.hotfix-thumb-duration").forEach((node) => node.remove());
    });
    renumberVisibleCards();
  }

  function isDirtyDomCard(card) {
    const text = clean(card.textContent);
    return text.includes("みかんとボーカルノート") || /24\s*時間\s*配信へようこそ/i.test(text);
  }

  function renumberVisibleCards() {
    let rank = 1;
    document.querySelectorAll(".video-card").forEach((card) => {
      if (card.hidden || getComputedStyle(card).display === "none") return;
      card.dataset.currentRank = String(rank);
      card.querySelectorAll(".thumb-rank,.corner-rank").forEach((node) => {
        node.textContent = `#${rank}`;
      });
      rank += 1;
    });
  }

  function installStyle() {
    if (document.getElementById("live-data-cleanup-style")) return;
    const style = document.createElement("style");
    style.id = "live-data-cleanup-style";
    style.textContent = `
      body[data-source-group="live"] .thumb-duration,
      body[data-source-group="live"] .corner-time,
      body[data-source-group="live"] .hb-duration,
      body[data-source-group="live"] .hotfix-thumb-duration,
      body[data-source-group="live"] .video-card.is-live-duration-dirty {
        display: none !important;
      }
    `;
    document.head.append(style);
  }

  function ready(fn) {
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn();
  }

  function clean(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }
})();
