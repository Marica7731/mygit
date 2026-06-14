(function () {
  const GROUP = document.body.dataset.sourceGroup || "live";
  let byId = new Map();
  let byText = new Map();

  ready(() => {
    installStyle();
    fetch("data/youtube-ranking.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const rows = data?.groups?.[GROUP]?.items || [];
        byId = new Map(rows.filter((item) => item.videoId).map((item) => [item.videoId, item]));
        byText = new Map(rows.map((item) => [key(item.title, item.channelName), item]).filter(([value]) => value));
        refresh();
      })
      .catch(() => {});
    refresh();
    [250, 800, 1600, 3200, 6500, 11000].forEach((delay) => setTimeout(refresh, delay));
    document.addEventListener("click", scheduleRefresh, true);
    document.addEventListener("change", scheduleRefresh, true);
    document.addEventListener("input", scheduleRefresh, true);
  });

  let refreshTimer = 0;
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 180);
    setTimeout(refresh, 700);
  }

  function refresh() {
    const cards = visibleCards();
    cards.forEach((card, index) => {
      const item = findItem(card);
      card.dataset.currentRank = String(index + 1);
      scrubRepeatedBody(card);
      writeCorners(card, item, index + 1);
      writeBodyMeta(card, item);
    });
  }

  function visibleCards() {
    return Array.from(document.querySelectorAll(".video-card")).filter((card) => {
      if (card.hidden || card.classList.contains("is-duplicate-video")) return false;
      const style = getComputedStyle(card);
      return style.display !== "none" && style.visibility !== "hidden";
    });
  }

  function scrubRepeatedBody(card) {
    card.querySelectorAll(".rank-line,.keyword-pill,.status-pill,.hb-metric,.rank-metric,.hotfix-rank-metric,.original-rank,.meta-list,.id-line").forEach((node) => {
      node.setAttribute("aria-hidden", "true");
      node.hidden = true;
    });
  }

  function writeCorners(card, item, visibleRank) {
    const thumb = card.querySelector(".thumbnail");
    if (!thumb) return;
    thumb.classList.add("corner-layout-ready");
    setCorner(thumb, "rank", `#${visibleRank}`);
    setCorner(thumb, "metric", metricLabel(item, card));
    setCorner(thumb, "keyword", item?.keyword || item?.group || fallbackKeyword(card));
    setCorner(thumb, "time", durationLabel(item, card));
  }

  function setCorner(thumb, type, value) {
    let node = thumb.querySelector(`.corner-${type}`);
    const text = clean(value);
    if (!text) {
      node?.remove();
      return;
    }
    if (!node) {
      node = document.createElement("span");
      node.className = `corner-badge corner-${type}`;
      thumb.append(node);
    }
    if (node.textContent !== text) node.textContent = text;
  }

  function writeBodyMeta(card, item) {
    let meta = card.querySelector(".hb-meta");
    const published = shortTime(item?.publishedText) || publishedFromExisting(meta?.textContent);
    if (!published) {
      meta?.remove();
      return;
    }
    if (!meta) {
      meta = document.createElement("div");
      meta.className = "hb-meta";
      (card.querySelector("h3") || card.querySelector(".channel"))?.insertAdjacentElement("afterend", meta);
    }
    if (card.querySelector("h3") && meta.previousElementSibling !== card.querySelector("h3")) {
      card.querySelector("h3").insertAdjacentElement("afterend", meta);
    }
    meta.hidden = false;
    meta.removeAttribute("aria-hidden");
    if (meta.textContent !== published) meta.textContent = published;
  }

  function metricLabel(item, card) {
    if (GROUP === "live") {
      if (positive(item?.subscriberCount)) return `${compact(item.subscriberCount)}粉丝`;
      const text = clean(card.querySelector(".hb-metric")?.textContent || "");
      return /粉丝/.test(text) ? text : "";
    }
    if (item?.statusType === "live" || item?.statusType === "upcoming") return "";
    if (positive(item?.viewCount)) return `${compact(item.viewCount)}播放`;
    const text = clean(card.querySelector(".hb-metric")?.textContent || "");
    return /播放/.test(text) ? text : "";
  }

  function durationLabel(item, card) {
    const value = duration(item?.durationText) || clean(card.querySelector(".hb-duration,.hotfix-thumb-duration")?.textContent || "");
    return /^\d{1,2}:\d{2}(?::\d{2})?$/.test(value) ? value : "";
  }

  function findItem(card) {
    const id = videoId(card.querySelector('a[href*="watch"],a[href*="/shorts/"],.thumbnail')?.href || "");
    return (id && byId.get(id)) || byText.get(key(text(card, "h3"), text(card, ".channel"))) || null;
  }

  function fallbackKeyword(card) {
    const text = clean(card.textContent);
    if (text.includes("弾き語り")) return "弾き語り";
    if (text.includes("歌枠")) return "歌枠";
    return "";
  }

  function publishedFromExisting(value) {
    return clean(value)
      .replace(/\s*·\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/, "")
      .replace(/\s*(?:\d{1,2}:)?\d{1,2}:\d{2}\s*$/, "");
  }

  function shortTime(value) {
    const match = clean(value).match(/(\d+(?:\.\d+)?)\s*(秒|分|時間|日|週間|か月|ヶ月|年)/);
    if (!match) return "";
    return `${match[1]}${({ 秒: "秒前", 分: "分钟前", 時間: "小时前", 日: "天前", 週間: "周前", "か月": "个月前", "ヶ月": "个月前", 年: "年前" }[match[2]] || "前")}`;
  }

  function duration(value) {
    const text = clean(value).replace(/\s*(?:再生中|正在播放|配信済み).*$/i, "");
    return /^\d{1,2}:\d{2}(?::\d{2})?$/.test(text) ? text : "";
  }

  function compact(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    if (number >= 1e8) return `${trim(number / 1e8)}亿`;
    if (number >= 1e4) return `${trim(number / 1e4)}万`;
    return String(Math.round(number));
  }

  function trim(value) {
    return value.toFixed(value >= 10 ? 0 : 1).replace(/\.0$/, "");
  }

  function positive(value) {
    return Number.isFinite(Number(value)) && Number(value) > 0;
  }

  function videoId(value) {
    try {
      const url = new URL(value, location.href);
      return url.searchParams.get("v") || url.pathname.match(/\/(?:shorts|embed|vi|vi_webp)\/([^/?#]+)/)?.[1] || "";
    } catch {
      return "";
    }
  }

  function text(root, selector) {
    return clean(root.querySelector(selector)?.textContent || "");
  }

  function key(title, channel) {
    const titleKey = clean(title).toLowerCase();
    return titleKey ? `${titleKey}|${clean(channel).toLowerCase()}` : "";
  }

  function installStyle() {
    if (document.getElementById("hb-corner-layout-style")) return;
    const style = document.createElement("style");
    style.id = "hb-corner-layout-style";
    style.textContent = `
      .video-card .rank-line,
      .video-card .keyword-pill,
      .video-card .status-pill,
      .video-card .hb-metric,
      .video-card .rank-metric,
      .video-card .hotfix-rank-metric,
      .video-card .original-rank,
      .video-card .meta-list,
      .video-card .id-line {
        display: none !important;
      }
      .thumbnail.corner-layout-ready {
        position: relative !important;
      }
      .thumbnail.corner-layout-ready .hb-thumb-chip,
      .thumbnail.corner-layout-ready .hotfix-thumb-badge {
        display: none !important;
      }
      .corner-badge {
        position: absolute !important;
        z-index: 5 !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        grid-area: auto !important;
        place-self: auto !important;
        width: auto !important;
        height: auto !important;
        max-width: calc(56% - 10px) !important;
        min-width: 0 !important;
        min-height: 18px !important;
        padding: 2px 6px !important;
        border-radius: 6px !important;
        background: rgba(15, 23, 42, 0.74) !important;
        color: #fff !important;
        font-size: 11px !important;
        font-weight: 900 !important;
        line-height: 1.1 !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        pointer-events: none !important;
        box-shadow: 0 2px 8px rgba(15, 23, 42, 0.18) !important;
      }
      .corner-rank {
        top: 5px !important;
        right: auto !important;
        bottom: auto !important;
        left: 5px !important;
        min-width: 30px !important;
        background: rgba(248, 250, 252, 0.94) !important;
        color: #0f172a !important;
      }
      .corner-metric {
        top: 5px !important;
        right: 5px !important;
        bottom: auto !important;
        left: auto !important;
        background: rgba(255, 241, 242, 0.94) !important;
        color: #9f2f2f !important;
      }
      body[data-source-group="live"] .corner-metric {
        background: rgba(239, 246, 255, 0.94) !important;
        color: #254479 !important;
      }
      .corner-keyword {
        top: auto !important;
        right: auto !important;
        bottom: 5px !important;
        left: 5px !important;
      }
      .corner-time {
        top: auto !important;
        right: 5px !important;
        bottom: 5px !important;
        left: auto !important;
      }
      .video-card h3 {
        margin-top: 0 !important;
      }
      .video-card .hb-meta {
        margin-top: -1px !important;
        white-space: nowrap !important;
      }
      @media (max-width: 520px) {
        .corner-badge {
          min-height: 16px !important;
          padding: 2px 5px !important;
          border-radius: 5px !important;
          font-size: 10px !important;
        }
        .corner-rank {
          min-width: 26px !important;
        }
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
