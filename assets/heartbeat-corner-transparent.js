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
    document.querySelectorAll(".thumbnail").forEach((thumb) => {
      removeLegacyLayers(thumb);
      const three = isMobileThreeColumn();
      thumb.classList.toggle("corner-transparent-three", three);
      if (three) mergeThreeColumnLine(thumb);
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
      .thumbnail.corner-layout-ready .corner-badge {
        min-width: 0 !important;
        min-height: 0 !important;
        padding: 0 2px !important;
        border-radius: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
        color: #fff !important;
        text-shadow:
          0 1px 2px rgba(0, 0, 0, 0.95),
          0 0 3px rgba(0, 0, 0, 0.9),
          1px 0 1px rgba(0, 0, 0, 0.75),
          -1px 0 1px rgba(0, 0, 0, 0.75) !important;
        -webkit-text-stroke: 0.2px rgba(15, 23, 42, 0.7) !important;
      }
      .thumbnail.corner-layout-ready .corner-time {
        justify-content: flex-end !important;
        text-align: right !important;
      }
      .thumbnail.corner-layout-ready .corner-metric {
        color: #fff4f4 !important;
      }
      body[data-source-group="live"] .thumbnail.corner-layout-ready .corner-metric {
        color: #eff6ff !important;
      }
      @media (max-width: 640px) {
        body:not([data-layout-mode="three"]) .thumbnail.corner-layout-ready .corner-time {
          max-width: 72% !important;
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
          max-width: 68% !important;
          font-size: 9px !important;
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
