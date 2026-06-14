(function () {
  ready(() => {
    installStyle();
    refresh();
    [250, 800, 1600, 3200, 6500].forEach((delay) => setTimeout(refresh, delay));
    document.addEventListener("click", scheduleRefresh, true);
    document.addEventListener("change", scheduleRefresh, true);
    document.addEventListener("input", scheduleRefresh, true);
    window.addEventListener("resize", scheduleRefresh, { passive: true });
    new MutationObserver(scheduleRefresh).observe(document.body, { childList: true, subtree: true });
  });

  let timer = 0;
  function scheduleRefresh() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 120);
  }

  function refresh() {
    document.querySelectorAll(".thumbnail.corner-layout-ready").forEach((thumb) => {
      removeLegacyLayers(thumb);
      const three = isMobileThreeColumn();
      thumb.classList.toggle("corner-transparent-three", three);
      if (three) mergeThreeColumnLine(thumb);
    });
  }

  function mergeThreeColumnLine(thumb) {
    const rank = clean(thumb.querySelector(".corner-rank")?.textContent);
    const metric = shortMetric(thumb.querySelector(".corner-metric")?.textContent);
    const time = clean(thumb.querySelector(".corner-time")?.textContent).replace(/\s+#\d+.*$/, "");
    const line = [time, rank, metric].filter(Boolean).join(" ");
    const timeNode = thumb.querySelector(".corner-time");
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
    return clean(value).replace(/播放/g, "播").replace(/粉丝/g, "粉");
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
      .thumbnail.corner-layout-ready .corner-metric {
        color: #fff4f4 !important;
      }
      body[data-source-group="live"] .thumbnail.corner-layout-ready .corner-metric {
        color: #eff6ff !important;
      }
      @media (max-width: 640px) {
        body[data-layout-mode="three"] .thumbnail.corner-transparent-three .corner-rank,
        body[data-layout-mode="three"] .thumbnail.corner-transparent-three .corner-metric {
          display: none !important;
        }
        body[data-layout-mode="three"] .thumbnail.corner-transparent-three .corner-time {
          right: 4px !important;
          bottom: 4px !important;
          max-width: calc(100% - 8px) !important;
          font-size: 9px !important;
        }
        body[data-layout-mode="three"] .thumbnail.corner-transparent-three .corner-keyword {
          left: 4px !important;
          bottom: 4px !important;
          max-width: 42% !important;
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
