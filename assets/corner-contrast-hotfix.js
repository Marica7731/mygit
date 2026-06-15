(function () {
  ready(() => {
    installStyle();
    scrubBodyDuration();
    [250, 900, 1800, 3600].forEach((delay) => setTimeout(scrubBodyDuration, delay));
    new MutationObserver(scrubBodyDuration).observe(document.body, { childList: true, subtree: true });
  });

  function scrubBodyDuration() {
    document.querySelectorAll(".compact-meta,.hb-meta").forEach((node) => {
      const nextText = clean(node.textContent).replace(/\s*·\s*(?:\d{1,2}:)?\d{1,2}:\d{2}\s*$/, "");
      if (nextText && node.textContent !== nextText) node.textContent = nextText;
      node.hidden = !nextText;
    });
  }

  function installStyle() {
    if (document.getElementById("corner-contrast-hotfix-style")) return;
    const style = document.createElement("style");
    style.id = "corner-contrast-hotfix-style";
    style.textContent = `
      .thumbnail.corner-layout-ready .corner-badge {
        color: #fff !important;
        background: rgba(3, 7, 18, 0.56) !important;
        border-color: rgba(255, 255, 255, 0.44) !important;
        box-shadow:
          0 0 0 1px rgba(2, 6, 23, 0.44),
          0 1px 5px rgba(0, 0, 0, 0.5) !important;
        text-shadow:
          0 1px 2px rgba(0, 0, 0, 0.86),
          0 0 4px rgba(0, 0, 0, 0.58) !important;
        -webkit-text-stroke: 0.12px rgba(0, 0, 0, 0.55);
        pointer-events: none !important;
      }
      .thumbnail.corner-layout-ready .corner-keyword {
        background: rgba(6, 78, 59, 0.62) !important;
      }
      .thumbnail.corner-layout-ready .corner-metric {
        background: rgba(127, 29, 29, 0.64) !important;
      }
      body[data-source-group="live"] .thumbnail.corner-layout-ready .corner-metric {
        background: rgba(30, 58, 138, 0.62) !important;
      }
      .thumbnail.corner-layout-ready .corner-rank {
        top: 4px !important;
        right: auto !important;
        bottom: auto !important;
        left: 4px !important;
      }
      .thumbnail.corner-layout-ready .corner-metric {
        top: 4px !important;
        right: 4px !important;
        bottom: auto !important;
        left: auto !important;
      }
      .thumbnail.corner-layout-ready .corner-keyword {
        top: auto !important;
        right: auto !important;
        bottom: 4px !important;
        left: 4px !important;
      }
      .thumbnail.corner-layout-ready .corner-time {
        top: auto !important;
        right: 4px !important;
        bottom: 4px !important;
        left: auto !important;
      }
      body[data-layout-mode="three"] .thumbnail.corner-layout-ready .corner-rank,
      body[data-layout-mode="three"] .thumbnail.corner-layout-ready .corner-metric {
        display: none !important;
      }
      body[data-layout-mode="three"] .thumbnail.corner-layout-ready .corner-badge {
        font-size: 10px !important;
        line-height: 1 !important;
        min-height: 12px !important;
        padding: 1px 3px !important;
      }
      body[data-layout-mode="three"] .thumbnail.corner-layout-ready .corner-time {
        max-width: calc(100% - 42px) !important;
        white-space: nowrap !important;
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
