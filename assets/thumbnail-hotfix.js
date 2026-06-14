(function () {
  const failedByImage = new WeakMap();
  let sweepQueued = false;

  document.addEventListener("DOMContentLoaded", boot);
  document.addEventListener("load", handleImageLoad, true);
  document.addEventListener("error", handleImageError, true);

  function boot() {
    sweep();
    for (let index = 1; index <= 12; index += 1) {
      setTimeout(sweep, index * 350);
    }
    window.addEventListener("scroll", sweep, { passive: true });
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
    return img.naturalWidth < 240 || img.naturalHeight < 135;
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
        `https://i.ytimg.com/vi/${videoId}/hq720.jpg`,
        `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
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

  function absoluteUrl(value) {
    try {
      return new URL(value, location.href).href;
    } catch {
      return "";
    }
  }
})();
