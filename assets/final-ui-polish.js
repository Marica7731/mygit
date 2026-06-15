(function () {
  const GROUP = document.body.dataset.sourceGroup || "live";
  let byId = new Map();

  ready(() => {
    installStyle();
    fetch(`data/youtube-ranking.json?finalUi=${Date.now()}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        byId = new Map((data?.groups?.[GROUP]?.items || []).filter((item) => item.videoId).map((item) => [item.videoId, item]));
        refresh();
      })
      .catch(() => {});
    refresh();
    [250, 900, 1800, 3600, 7000, 12000].forEach((delay) => setTimeout(refresh, delay));
    const observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    document.addEventListener("click", scheduleRefresh, true);
    document.addEventListener("change", scheduleRefresh, true);
    document.addEventListener("input", scheduleRefresh, true);
    window.addEventListener("resize", scheduleRefresh, { passive: true });
  });

  let timer = 0;
  function scheduleRefresh() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 120);
  }

  function refresh() {
    hideDefaultFilterChips();
    document.querySelectorAll(".video-card").forEach((card) => {
      if (card.hidden || getComputedStyle(card).display === "none") return;
      scrubBodyDuplicates(card);
      ensureCornerTime(card);
      ensureChannelLink(card);
    });
  }

  function hideDefaultFilterChips() {
    document.querySelectorAll(".active-filter-chips .filter-chip").forEach((chip) => {
      const text = clean(chip.textContent);
      if (/^标题:\s*歌枠\s*\/\s*弾き語り/.test(text) || text.includes("排除韩文")) {
        chip.hidden = true;
        chip.setAttribute("aria-hidden", "true");
        chip.classList.add("default-title-chip");
      }
    });
  }

  function scrubBodyDuplicates(card) {
    card.querySelectorAll(".rank-line,.keyword-pill,.status-pill,.rank-metric,.hotfix-rank-metric,.hb-metric,.compact-meta,.meta-list,.id-line").forEach((node) => {
      if (node.classList.contains("hb-meta")) return;
      node.remove();
    });

    const meta = card.querySelector(".hb-meta");
    if (meta) {
      const text = stripDuplicateDuration(meta.textContent);
      meta.textContent = text;
      meta.hidden = !text || /^20\d{2}年前$/.test(text);
    }
  }

  function ensureCornerTime(card) {
    const thumb = card.querySelector(".thumbnail");
    if (!thumb || thumb.querySelector(".corner-time")) return;
    const item = byId.get(videoId(card.querySelector('a[href*="watch"],a[href*="/shorts/"],.thumbnail')?.href || ""));
    const value = duration(item?.durationText) || formatDuration(item?.durationSeconds);
    if (!value) return;
    const node = document.createElement("span");
    node.className = "corner-badge corner-time";
    node.textContent = value;
    thumb.classList.add("corner-layout-ready");
    thumb.append(node);
  }

  function ensureChannelLink(card) {
    const channel = card.querySelector(".channel");
    if (!channel || channel.querySelector("a[href]")) return;
    const item = byId.get(videoId(card.querySelector('a[href*="watch"],a[href*="/shorts/"],.thumbnail')?.href || ""));
    const text = clean(channel.textContent) || clean(item?.channelName);
    if (!text) return;
    const href = channelHref(item, text);
    if (!href) return;
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = text;
    channel.textContent = "";
    channel.append(link);
  }

  function channelHref(item, fallbackName) {
    const url = clean(item?.channelUrl);
    if (url) return new URL(url, location.href).href;
    if (item?.channelId) return `https://www.youtube.com/channel/${encodeURIComponent(item.channelId)}`;
    return fallbackName ? `https://www.youtube.com/results?search_query=${encodeURIComponent(fallbackName)}` : "";
  }

  function duration(value) {
    const match = clean(value).match(/\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/);
    return match ? match[0] : "";
  }

  function formatDuration(seconds) {
    const number = Number(seconds);
    if (!Number.isFinite(number) || number <= 0) return "";
    const total = Math.round(number);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainSeconds = total % 60;
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainSeconds).padStart(2, "0")}`;
    return `${minutes}:${String(remainSeconds).padStart(2, "0")}`;
  }

  function stripDuplicateDuration(value) {
    const text = clean(value)
      .replace(/\s*·\s*(?:\d{1,2}:)?\d{1,2}:\d{2}\s*$/g, "")
      .replace(/\s+(?:\d{1,2}:)?\d{1,2}:\d{2}\s*$/g, "");
    const match = text.match(/(\d+(?:\.\d+)?)\s*(秒前|分钟前|小时前|天前|周前|个月前|年前)/);
    return match ? `${match[1]}${match[2]}` : text;
  }

  function videoId(value) {
    try {
      const url = new URL(value, location.href);
      return url.searchParams.get("v") || url.pathname.match(/\/(?:shorts|embed|vi|vi_webp)\/([^/?#]+)/)?.[1] || "";
    } catch {
      return "";
    }
  }

  function installStyle() {
    if (document.getElementById("final-ui-polish-style")) return;
    const style = document.createElement("style");
    style.id = "final-ui-polish-style";
    style.textContent = `
      .active-filter-chips .default-title-chip,
      .video-card .rank-line,
      .video-card .keyword-pill,
      .video-card .status-pill,
      .video-card .rank-metric,
      .video-card .hotfix-rank-metric,
      .video-card .hb-metric,
      .video-card .compact-meta,
      .video-card .meta-list,
      .video-card .id-line {
        display: none !important;
      }
      .cards,
      body[data-layout-mode="auto"] .cards,
      body[data-layout-mode="two"] .cards,
      body[data-layout-mode="three"] .cards {
        align-items: start !important;
      }
      .video-card {
        height: auto !important;
        min-height: 0 !important;
        align-self: start !important;
        grid-template-rows: auto auto !important;
      }
      .video-card .card-body {
        display: grid !important;
        grid-template-rows: auto auto auto !important;
        align-content: start !important;
        gap: 5px !important;
        min-height: 0 !important;
        padding-bottom: 8px !important;
      }
      .video-card h3 {
        height: auto !important;
        min-height: 0 !important;
        max-height: calc(1.27em * 3) !important;
        margin: 0 !important;
        overflow: hidden !important;
        line-height: 1.27 !important;
      }
      .video-card h3 a {
        display: -webkit-box !important;
        max-height: inherit !important;
        overflow: hidden !important;
        -webkit-box-orient: vertical !important;
        -webkit-line-clamp: 3 !important;
      }
      .video-card .hb-meta {
        margin: 0 !important;
        color: #526173 !important;
        font-size: 12px !important;
        line-height: 1.2 !important;
        white-space: nowrap !important;
      }
      .video-card .channel-metric-row,
      .video-card .channel {
        min-height: 0 !important;
      }
      .thumbnail.corner-layout-ready .corner-badge {
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
        backdrop-filter: none !important;
        border: 0 !important;
        box-shadow: none !important;
        filter: none !important;
        padding: 0 1px !important;
        border-radius: 0 !important;
        pointer-events: none !important;
      }
      .thumbnail .hb-thumb-chip,
      .thumbnail .hotfix-thumb-badge,
      .thumbnail .hb-thumb-meta,
      .thumbnail .thumb-badge,
      .thumbnail .thumb-chip {
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
        backdrop-filter: none !important;
        border: 0 !important;
        box-shadow: none !important;
        filter: none !important;
        padding: 0 1px !important;
        border-radius: 0 !important;
      }
      @media (max-width: 520px) {
        body[data-layout-mode="three"] .thumbnail.corner-layout-ready .corner-badge {
          font-size: 9px !important;
          line-height: 1.02 !important;
          min-height: 10px !important;
        }
        body[data-layout-mode="three"] .thumbnail.corner-layout-ready .corner-rank {
          max-width: 30% !important;
        }
        body[data-layout-mode="three"] .thumbnail.corner-layout-ready .corner-metric,
        body[data-layout-mode="three"] .thumbnail.corner-layout-ready .corner-time {
          max-width: 64% !important;
        }
        body[data-layout-mode="three"] .video-card .card-body {
          gap: 4px !important;
          padding: 6px !important;
        }
        body[data-layout-mode="three"] .video-card h3 {
          max-height: calc(1.2em * 3) !important;
          line-height: 1.2 !important;
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
