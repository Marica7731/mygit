(function () {
  ready(() => {
    installStyle();
    scrubDefaultChips();
    tuneImages();
    setTimeout(scrubDefaultChips, 250);
    setTimeout(tuneImages, 1000);
    setTimeout(scrubDefaultChips, 1000);
    setTimeout(tuneImages, 3000);
    setTimeout(scrubDefaultChips, 3000);
    new MutationObserver(scrubDefaultChips).observe(document.body, { childList: true, subtree: true });
  });

  function scrubDefaultChips() {
    document.querySelectorAll(".active-filter-chips .filter-chip").forEach((chip) => {
      const text = clean(chip.textContent);
      if (/^标题:\s*歌枠\s*\/\s*弾き語り/.test(text) || text.includes("排除韩文")) {
        chip.classList.add("default-title-chip");
        chip.hidden = true;
        chip.setAttribute("aria-hidden", "true");
      }
    });
  }

  function installStyle() {
    if (document.getElementById("corner-readability-hotfix-style")) return;
    const style = document.createElement("style");
    style.id = "corner-readability-hotfix-style";
    style.textContent = `
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
        max-width: calc(100% - 10px) !important;
        min-width: 0 !important;
        min-height: 0 !important;
        overflow: hidden !important;
        border: 1px solid rgba(255, 255, 255, 0.2) !important;
        border-radius: 4px !important;
        background: rgba(3, 7, 18, 0.3) !important;
        box-shadow:
          0 0 0 1px rgba(2, 6, 23, 0.2),
          0 1px 4px rgba(0, 0, 0, 0.28) !important;
        color: #fff !important;
        font-weight: 950 !important;
        font-variant-numeric: tabular-nums !important;
        letter-spacing: 0 !important;
        line-height: 1.06 !important;
        opacity: 0.98 !important;
        padding: 1px 3px !important;
        text-overflow: ellipsis !important;
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
        background: rgba(6, 78, 59, 0.34) !important;
        color: #ecfeff !important;
      }

      .thumbnail.corner-layout-ready .corner-metric {
        background: rgba(127, 29, 29, 0.34) !important;
        color: #fff7f7 !important;
      }

      body[data-source-group="live"] .thumbnail.corner-layout-ready .corner-metric {
        background: rgba(30, 58, 138, 0.34) !important;
        color: #f8fbff !important;
      }

      .thumbnail.corner-layout-ready .corner-time {
        max-width: calc(100% - 10px) !important;
      }

      @media (max-width: 640px) {
        body[data-layout-mode="three"] .thumbnail.corner-layout-ready .corner-time,
        body[data-layout-mode="three"] .thumbnail.corner-transparent-three .corner-time {
          max-width: calc(100% - 8px) !important;
          font-size: 8.8px !important;
          line-height: 1.05 !important;
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

  function clean(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }
})();
