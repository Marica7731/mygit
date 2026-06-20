(function () {
  const failedByImage = new WeakMap();
  let sweepQueued = false;
  let cleanupQueued = false;

  document.addEventListener("DOMContentLoaded", boot);
  document.addEventListener("load", handleImageLoad, true);
  document.addEventListener("error", handleImageError, true);

  function boot() {
    installStyle();
    cleanupCards();
    sweep();
    for (let index = 1; index <= 10; index += 1) {
      setTimeout(sweep, index * 450);
      setTimeout(cleanupCards, index * 450 + 80);
    }
    window.addEventListener("scroll", sweep, { passive: true });
    window.addEventListener("resize", sweep, { passive: true });
    document.addEventListener("click", scheduleCleanup, true);
    document.addEventListener("change", scheduleCleanup, true);
    document.addEventListener("input", scheduleCleanup, true);
  }

  function handleImageLoad(event) {
    const img = event.target;
    if (isThumbnailImage(img) && isBadLoadedImage(img)) {
      tryNextThumbnail(img);
    }
  }

  function handleImageError(event) {
    const img = event.target;
    if (isThumbnailImage(img)) tryNextThumbnail(img);
  }

  function sweep() {
    if (sweepQueued) return;
    sweepQueued = true;
    requestAnimationFrame(() => {
      sweepQueued = false;
      document.querySelectorAll(".thumbnail img").forEach((img) => {
        if (!isThumbnailImage(img) || !isNearViewport(img)) return;
        if (img.complete && isBadLoadedImage(img)) tryNextThumbnail(img);
      });
    });
  }

  function scheduleCleanup() {
    if (cleanupQueued) return;
    cleanupQueued = true;
    requestAnimationFrame(() => {
      cleanupQueued = false;
      cleanupCards();
      sweep();
    });
  }

  function cleanupCards() {
    removeDuplicateMetricChips();
    hideDuplicateVideoCards();
  }

  function removeDuplicateMetricChips() {
    document.querySelectorAll(".rank-line").forEach((rankLine) => {
      const hotfixMetric = rankLine.querySelector(".hotfix-rank-metric");
      if (!hotfixMetric) return;
      rankLine.querySelectorAll(".rank-metric").forEach((node) => node.remove());
    });
  }

  function hideDuplicateVideoCards() {
    const seen = new Set();
    document.querySelectorAll(".video-card").forEach((card) => {
      const videoId = getVideoId(card.querySelector('a[href*="watch"], a[href*="/shorts/"], .thumbnail')?.href || "");
      if (!videoId) {
        restoreDuplicateCard(card);
        return;
      }
      if (seen.has(videoId)) {
        card.hidden = true;
        card.classList.add("is-duplicate-video");
        card.setAttribute("aria-hidden", "true");
        return;
      }
      seen.add(videoId);
      restoreDuplicateCard(card);
    });
  }

  function restoreDuplicateCard(card) {
    if (!card.classList.contains("is-duplicate-video")) return;
    card.hidden = false;
    card.classList.remove("is-duplicate-video");
    card.removeAttribute("aria-hidden");
  }

  function isThumbnailImage(value) {
    return value instanceof HTMLImageElement && Boolean(value.closest(".thumbnail"));
  }

  function isNearViewport(element) {
    const rect = element.getBoundingClientRect();
    const margin = Math.max(900, window.innerHeight || 800);
    return rect.bottom >= -margin && rect.top <= (window.innerHeight || 800) + margin;
  }

  function isBadLoadedImage(img) {
    if (!img.complete) return false;
    if (!img.naturalWidth || !img.naturalHeight) return true;
    return img.naturalWidth < 160 || img.naturalHeight < 90;
  }

  function tryNextThumbnail(img) {
    const current = absoluteUrl(img.currentSrc || img.src);
    const failed = failedByImage.get(img) || new Set();
    if (current) failed.add(current);
    failedByImage.set(img, failed);

    const next = getThumbnailCandidates(img).find((candidate) => !failed.has(candidate) && candidate !== current);
    if (!next) {
      markThumbnailMissing(img);
      return;
    }

    img.removeAttribute("srcset");
    img.src = next;
  }

  function getThumbnailCandidates(img) {
    const href = img.closest(".thumbnail")?.href || img.src || "";
    const videoId = getVideoId(href) || getVideoId(img.currentSrc || img.src);
    const values = [];
    if (videoId) {
      values.push(
        `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/default.jpg`,
      );
    }
    values.push(img.dataset.originalThumbnailSrc, img.getAttribute("src"), img.currentSrc, img.src);
    return Array.from(new Set(values.map(absoluteUrl).filter(Boolean)));
  }

  function getVideoId(value) {
    try {
      const url = new URL(value, location.href);
      return (
        url.searchParams.get("v") ||
        (url.pathname.match(/\/(?:shorts|embed|vi|vi_webp)\/([^/?#]+)/) || [])[1] ||
        ""
      );
    } catch {
      return "";
    }
  }

  function markThumbnailMissing(img) {
    const card = img.closest(".video-card");
    if (card) card.classList.add("is-thumbnail-missing");
  }

  function installStyle() {
    if (document.getElementById("thumbnail-hotfix-style")) return;
    const style = document.createElement("style");
    style.id = "thumbnail-hotfix-style";
    style.textContent = `
      .video-card.is-duplicate-video,
      .video-card[hidden] {
        display: none !important;
      }
      .rank-line .rank-metric {
        display: none !important;
      }
      .hotfix-rank-metric {
        flex: 0 0 auto !important;
        max-width: none !important;
      }
      body[data-layout-mode="three"] .hotfix-rank-metric {
        padding-inline: 5px !important;
        font-size: 10.5px !important;
      }
    `;
    document.head.append(style);
  }

  function absoluteUrl(value) {
    try {
      return new URL(value, location.href).href;
    } catch {
      return "";
    }
  }
})();
