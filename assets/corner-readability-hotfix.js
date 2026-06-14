(function () {
  ready(() => {
    installStyle();
  });

  function installStyle() {
    if (document.getElementById("corner-readability-hotfix-style")) return;
    const style = document.createElement("style");
    style.id = "corner-readability-hotfix-style";
    style.textContent = `
      .active-filter-chips .default-title-chip {
        display: none !important;
      }

      .thumbnail.corner-layout-ready .corner-badge {
        background: transparent !important;
        box-shadow: none !important;
        color: #fff !important;
        font-weight: 950 !important;
        text-shadow:
          0 1px 2px rgba(0, 0, 0, 1),
          0 0 5px rgba(0, 0, 0, 1),
          1px 0 1px rgba(0, 0, 0, 0.98),
          -1px 0 1px rgba(0, 0, 0, 0.98),
          0 1px 1px rgba(0, 0, 0, 0.98),
          0 -1px 1px rgba(0, 0, 0, 0.95) !important;
        -webkit-text-stroke: 0.35px rgba(5, 10, 20, 0.95) !important;
      }

      .thumbnail.corner-layout-ready .corner-metric,
      body[data-source-group="live"] .thumbnail.corner-layout-ready .corner-metric {
        color: #fff !important;
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
})();
