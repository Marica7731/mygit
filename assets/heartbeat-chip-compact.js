(function () {
  ready(() => {
    if (document.getElementById("hb-chip-compact-style")) return;
    const style = document.createElement("style");
    style.id = "hb-chip-compact-style";
    style.textContent = `
      .thumbnail .hb-thumb-chip,
      .thumbnail .hotfix-thumb-badge {
        inset: auto !important;
        width: auto !important;
        height: auto !important;
        min-width: 0 !important;
        min-height: 0 !important;
        max-width: calc(50% - 10px) !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        padding: 2px 5px !important;
        border-radius: 5px !important;
        background: rgba(15, 23, 42, 0.72) !important;
        color: #fff !important;
        font-size: 10px !important;
        font-weight: 850 !important;
        line-height: 1.1 !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        pointer-events: none !important;
      }
      .thumbnail .hb-keyword,
      .thumbnail .hotfix-thumb-keyword {
        left: 5px !important;
        right: auto !important;
        bottom: 5px !important;
        top: auto !important;
      }
      .thumbnail .hb-duration,
      .thumbnail .hotfix-thumb-duration {
        right: 5px !important;
        left: auto !important;
        bottom: 5px !important;
        top: auto !important;
      }
    `;
    document.head.append(style);
  });

  function ready(fn) {
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn();
  }
})();
