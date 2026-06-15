(function () {
  ready(() => {
    installStyle();
  });

  function installStyle() {
    if (document.getElementById("corner-contrast-hotfix-style")) return;
    const style = document.createElement("style");
    style.id = "corner-contrast-hotfix-style";
    style.textContent = `
      .thumbnail.corner-layout-ready .corner-badge {
        background: rgba(3, 7, 18, 0.42) !important;
        border-color: rgba(255, 255, 255, 0.26) !important;
        box-shadow:
          0 0 0 1px rgba(2, 6, 23, 0.28),
          0 1px 4px rgba(0, 0, 0, 0.34) !important;
      }
      .thumbnail.corner-layout-ready .corner-keyword {
        background: rgba(6, 78, 59, 0.46) !important;
      }
      .thumbnail.corner-layout-ready .corner-metric {
        background: rgba(127, 29, 29, 0.48) !important;
      }
      body[data-source-group="live"] .thumbnail.corner-layout-ready .corner-metric {
        background: rgba(30, 58, 138, 0.46) !important;
      }
    `;
    document.head.append(style);
  }

  function ready(fn) {
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn();
  }
})();
