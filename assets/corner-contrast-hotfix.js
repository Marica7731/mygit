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
        background: transparent !important;
        border: 0 !important;
        box-shadow: none !important;
        text-shadow:
          0 1px 2px rgba(15, 23, 42, 0.78),
          0 0 2px rgba(15, 23, 42, 0.62) !important;
        -webkit-text-stroke: 0 !important;
        pointer-events: none !important;
      }
      .thumbnail.corner-layout-ready .corner-keyword {
        color: #1f6792 !important;
        text-shadow:
          0 1px 0 rgba(255, 255, 255, 0.95),
          1px 0 0 rgba(255, 255, 255, 0.95),
          -1px 0 0 rgba(255, 255, 255, 0.95),
          0 -1px 0 rgba(255, 255, 255, 0.95),
          0 1px 2px rgba(15, 23, 42, 0.3) !important;
      }
      .thumbnail.corner-layout-ready .corner-metric {
        color: #c73636 !important;
        text-shadow:
          0 1px 0 rgba(255, 255, 255, 0.95),
          1px 0 0 rgba(255, 255, 255, 0.95),
          -1px 0 0 rgba(255, 255, 255, 0.95),
          0 -1px 0 rgba(255, 255, 255, 0.95),
          0 1px 2px rgba(15, 23, 42, 0.36) !important;
      }
      body[data-source-group="live"] .thumbnail.corner-layout-ready .corner-metric {
        color: #3159ad !important;
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
      body[data-layout-mode="three"] .thumbnail.corner-layout-ready .corner-badge {
        font-size: 10px !important;
        line-height: 1 !important;
        min-height: 12px !important;
        padding: 0 1px !important;
      }
      body[data-layout-mode="three"] .thumbnail.corner-layout-ready .corner-rank,
      body[data-layout-mode="three"] .thumbnail.corner-layout-ready .corner-metric,
      body[data-layout-mode="three"] .thumbnail.corner-layout-ready .corner-keyword,
      body[data-layout-mode="three"] .thumbnail.corner-layout-ready .corner-time {
        display: inline-flex !important;
      }
      body[data-layout-mode="three"] .thumbnail.corner-layout-ready .corner-rank {
        max-width: 28% !important;
      }
      body[data-layout-mode="three"] .thumbnail.corner-layout-ready .corner-metric {
        max-width: 52% !important;
      }
      body[data-layout-mode="three"] .thumbnail.corner-layout-ready .corner-keyword {
        max-width: 38% !important;
      }
      body[data-layout-mode="three"] .thumbnail.corner-layout-ready .corner-time {
        max-width: 52% !important;
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
