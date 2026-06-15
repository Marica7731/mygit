(function () {
  ready(() => {
    installStyle();
    refresh();
    [250, 900, 1800, 3600, 7000].forEach((delay) => setTimeout(refresh, delay));
    document.addEventListener("click", scheduleRefresh, true);
    document.addEventListener("change", scheduleRefresh, true);
    document.addEventListener("input", scheduleRefresh, true);
    window.addEventListener("resize", scheduleRefresh, { passive: true });
    const observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.body, { childList: true, subtree: true });
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-layout-mode"] });
  });

  let timer = 0;
  let trailingTimer = 0;
  function scheduleRefresh() {
    clearTimeout(timer);
    clearTimeout(trailingTimer);
    timer = setTimeout(refresh, 100);
    trailingTimer = setTimeout(refresh, 700);
  }

  function refresh() {
    hideDefaultFilterChips();
    document.querySelectorAll(".thumbnail").forEach((thumb) => {
      removeLegacyLayers(thumb);
      const three = isMobileThreeColumn();
      thumb.classList.toggle("corner-transparent-three", three);
      if (three) mergeThreeColumnLine(thumb);
    });
  }

  function hideDefaultFilterChips() {
    document.querySelectorAll(".active-filter-chips .filter-chip").forEach((chip) => {
      const text = clean(chip.textContent);
      if (/^标题:\s*歌枠\s*\/\s*弾き語り/.test(text) || text.includes("排除韩文")) {
        chip.classList.add("default-title-chip");
        chip.hidden = true;
        chip.setAttribute("aria-hidden", "true");
      }
    });
  }

  function mergeThreeColumnLine(thumb) {
    const rank = clean(thumb.querySelector(".corner-rank")?.textContent);
    const metric = shortMetric(thumb.querySelector(".corner-metric")?.textContent);
    const time = clean(thumb.querySelector(".corner-time")?.textContent).replace(/(?:^|\s)#\d+.*$/, "");
    const suffix = [rank, metric].filter(Boolean).join(" ");
    const line = [time, suffix].filter(Boolean).join(" ");
    let timeNode = thumb.querySelector(".corner-time");
    if (!timeNode && line) {
      timeNode = document.createElement("span");
      timeNode.className = "corner-badge corner-time";
      thumb.append(timeNode);
    }
    if (timeNode && line && timeNode.textContent !== line) timeNode.textContent = line;
  }

  function removeLegacyLayers(thumb) {
    thumb.querySelectorAll(":scope > *").forEach((node) => {
      if (node.matches("img,picture,source,.corner-badge,.thumbnail-placeholder")) return;
      if (node.matches(".hb-thumb-chip,.hotfix-thumb-badge,.hb-thumb-meta,.thumb-badge,.thumb-chip,[class*='thumb'],[class*='badge'],[class*='duration'],[class*='keyword'],[class*='metric']")) {
        node.remove();
      }
    });
  }

  function isMobileThreeColumn() {
    return document.body.dataset.layoutMode === "three" && window.matchMedia("(max-width: 640px)").matches;
  }

  function shortMetric(value) {
    return clean(value);
  }

  function installStyle() {
    if (document.getElementById("hb-corner-transparent-style")) return;
    const style = document.createElement("style");
    style.id = "hb-corner-transparent-style";
    style.textContent = `
      .thumbnail.corner-layout-ready .hb-thumb-chip,
      .thumbnail.corner-layout-ready .hotfix-thumb-badge,
      .thumbnail.corner-layout-ready .hb-thumb-meta,
      .thumbnail.corner-layout-ready .thumb-badge,
      .thumbnail.corner-layout-ready .thumb-chip,
      .thumbnail.corner-layout-ready > [class*="duration"]:not(.corner-badge),
      .thumbnail.corner-layout-ready > [class*="keyword"]:not(.corner-badge),
      .thumbnail.corner-layout-ready > [class*="metric"]:not(.corner-badge),
      .thumbnail.corner-layout-ready > [class*="badge"]:not(.corner-badge) {
        display: none !important;
      }
      .active-filter-chips .default-title-chip {
        display: none !important;
      }
      .thumbnail.corner-layout-ready .corner-badge {
        position: absolute !important;
        inset: auto !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: auto !important;
        height: auto !important;
        min-width: 0 !important;
        min-height: 0 !important;
        padding: 1px 3px !important;
        border: 1px solid rgba(255, 255, 255, 0.22) !important;
        border-radius: 4px !important;
        background: rgba(3, 7, 18, 0.28) !important;
        box-shadow:
          0 0 0 1px rgba(3, 7, 18, 0.2),
          0 1px 3px rgba(0, 0, 0, 0.28) !important;
        color: #fff !important;
        font-weight: 950 !important;
        line-height: 1.08 !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        text-shadow:
          0 1px 2px rgba(0, 0, 0, 1),
          0 0 4px rgba(0, 0, 0, 0.98),
          1px 0 1px rgba(0, 0, 0, 0.95),
          -1px 0 1px rgba(0, 0, 0, 0.95),
          0 1px 1px rgba(0, 0, 0, 0.95),
          0 -1px 1px rgba(0, 0, 0, 0.9) !important;
        -webkit-text-stroke: 0.35px rgba(7, 10, 18, 0.92) !important;
      }
      .thumbnail.corner-layout-ready .corner-time {
        justify-content: flex-end !important;
        text-align: right !important;
      }
      .thumbnail.corner-layout-ready .corner-metric {
        background: rgba(127, 29, 29, 0.34) !important;
        color: #fff4f4 !important;
      }
      body[data-source-group="live"] .thumbnail.corner-layout-ready .corner-metric {
        background: rgba(30, 58, 138, 0.32) !important;
        color: #eff6ff !important;
      }
      .thumbnail.corner-layout-ready .corner-keyword {
        background: rgba(6, 78, 59, 0.32) !important;
        color: #ecfeff !important;
      }
      @media (max-width: 640px) {
        body:not([data-layout-mode="three"]) .thumbnail.corner-layout-ready .corner-time {
          max-width: calc(100% - 12px) !important;
        }
        body:not([data-layout-mode="three"]) .thumbnail.corner-layout-ready .corner-keyword {
          max-width: 42% !important;
        }
        body[data-layout-mode="three"] .thumbnail.corner-layout-ready .corner-rank,
        body[data-layout-mode="three"] .thumbnail.corner-layout-ready .corner-metric,
        body[data-layout-mode="three"] .thumbnail.corner-transparent-three .corner-rank,
        body[data-layout-mode="three"] .thumbnail.corner-transparent-three .corner-metric {
          display: none !important;
        }
        body[data-layout-mode="three"] .thumbnail.corner-layout-ready .corner-time,
        body[data-layout-mode="three"] .thumbnail.corner-transparent-three .corner-time {
          right: 4px !important;
          bottom: 4px !important;
          left: auto !important;
          max-width: calc(100% - 8px) !important;
          font-size: 8.8px !important;
          justify-content: flex-end !important;
          text-align: right !important;
        }
        body[data-layout-mode="three"] .thumbnail.corner-layout-ready .corner-keyword,
        body[data-layout-mode="three"] .thumbnail.corner-transparent-three .corner-keyword {
          left: 4px !important;
          bottom: 4px !important;
          max-width: 28% !important;
          font-size: 9px !important;
        }
      }
      @media (min-width: 900px) {
        .cards,
        body[data-layout-mode="auto"] .cards,
        body[data-layout-mode="two"] .cards,
        body[data-layout-mode="three"] .cards {
          align-items: start !important;
        }
        .video-card {
          align-self: start !important;
          height: auto !important;
          min-height: 0 !important;
        }
        .card-body {
          min-height: 0 !important;
          padding-bottom: 8px !important;
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
