(function () {
  ready(() => {
    installStyle();
    tuneImages();
    setTimeout(tuneImages, 1000);
    setTimeout(tuneImages, 3000);
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
        font-variant-numeric: tabular-nums !important;
        letter-spacing: 0 !important;
        line-height: 1.06 !important;
        opacity: 0.98 !important;
        padding: 0 2px !important;
        white-space: nowrap !important;
        filter:
          drop-shadow(0 1px 1px rgba(0, 0, 0, 1))
          drop-shadow(0 0 2px rgba(0, 0, 0, 1))
          drop-shadow(0 0 5px rgba(0, 0, 0, 0.95)) !important;
        text-shadow:
          0 0 1px rgba(0, 0, 0, 1),
          0 0 2px rgba(0, 0, 0, 1),
          1px 1px 1px rgba(0, 0, 0, 1),
          -1px 1px 1px rgba(0, 0, 0, 1),
          1px -1px 1px rgba(0, 0, 0, 1),
          -1px -1px 1px rgba(0, 0, 0, 1),
          0 1px 2px rgba(0, 0, 0, 1),
          0 0 7px rgba(0, 0, 0, 1),
          1px 0 1px rgba(0, 0, 0, 1),
          -1px 0 1px rgba(0, 0, 0, 1),
          0 1px 1px rgba(0, 0, 0, 1),
          0 -1px 1px rgba(0, 0, 0, 1) !important;
        -webkit-text-stroke: 0.8px rgba(3, 7, 18, 0.98) !important;
      }

      .thumbnail.corner-layout-ready .corner-rank,
      .thumbnail.corner-layout-ready .corner-time {
        color: #fff !important;
      }

      .thumbnail.corner-layout-ready .corner-keyword {
        color: #ecfeff !important;
      }

      .thumbnail.corner-layout-ready .corner-metric {
        color: #fff7f7 !important;
      }

      body[data-source-group="live"] .thumbnail.corner-layout-ready .corner-metric {
        color: #f8fbff !important;
      }

      @media (max-width: 640px) {
        body[data-layout-mode="three"] .thumbnail.corner-layout-ready .corner-time,
        body[data-layout-mode="three"] .thumbnail.corner-transparent-three .corner-time {
          max-width: calc(100% - 8px) !important;
          font-size: 9.5px !important;
        }
      }

      .video-card {
        content-visibility: auto !important;
        contain-intrinsic-size: 280px 340px !important;
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

  function tuneImages() {
    document.querySelectorAll(".video-card img").forEach((img, index) => {
      img.decoding = "async";
      if (index < 12) {
        img.loading = "eager";
        img.fetchPriority = "auto";
      } else {
        img.loading = "lazy";
        img.fetchPriority = "low";
      }
    });
  }

  function ready(fn) {
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn();
  }
})();
