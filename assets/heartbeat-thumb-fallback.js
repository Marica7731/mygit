(function () {
  ready(() => {
    repair();
    [500, 1500, 3500, 7000, 12000].forEach((delay) => setTimeout(repair, delay));
    window.addEventListener("scroll", scheduleRepair, { passive: true });
    window.addEventListener("resize", scheduleRepair, { passive: true });
  });

  let timer = 0;
  function scheduleRepair() {
    clearTimeout(timer);
    timer = setTimeout(repair, 120);
  }

  function repair() {
    document.querySelectorAll(".thumbnail img").forEach((img) => {
      if (!isNearViewport(img)) return;
      if (!img.dataset.hbThumbFallbackReady) {
        img.dataset.hbThumbFallbackReady = "1";
        img.addEventListener("error", () => fallback(img));
        img.addEventListener("load", () => {
          if (isStableThumbnail(img)) {
            img.dataset.hbThumbOk = "1";
            img.dataset.thumbnailFinal = "1";
          }
        });
      }
      if (img.dataset.thumbnailFinal === "1" && isStableThumbnail(img)) return;
      if (img.complete && !img.dataset.hbThumbOk && !isStableThumbnail(img)) {
        fallback(img);
      }
    });
  }

  function fallback(img) {
    const videoId = getVideoId(img);
    if (!videoId) {
      markThumbnailUnavailable(img);
      return;
    }

    const candidates = [
      `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`,
      `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`,
      `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/sddefault.jpg`,
      `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/default.jpg`,
    ];
    const current = stripQuery(img.currentSrc || img.src || "");
    let index = Number.parseInt(img.dataset.hbThumbFallbackIndex || "0", 10);
    while (index < candidates.length && stripQuery(candidates[index]) === current) index += 1;

    if (index >= candidates.length) {
      markThumbnailUnavailable(img);
      return;
    }

    img.dataset.hbThumbFallbackIndex = String(index + 1);
    img.dataset.hbThumbOk = "";
    img.dataset.thumbnailFinal = "";
    img.src = candidates[index];
    img.removeAttribute("srcset");
  }

  function markThumbnailUnavailable(img) {
    const card = img.closest(".video-card");
    const thumbnail = img.closest(".thumbnail");
    img.hidden = true;
    thumbnail?.classList.add("is-thumbnail-broken");
    thumbnail?.querySelector(".thumbnail-placeholder")?.setAttribute("hidden", "");
    if (card) {
      card.hidden = true;
      card.classList.add("is-thumbnail-missing");
      card.setAttribute("aria-hidden", "true");
      card.dispatchEvent(new CustomEvent("ytb-thumbnail-missing", { bubbles: true }));
    }
  }

  function getVideoId(img) {
    const card = img.closest(".video-card");
    const href = card?.querySelector('a[href*="watch?v="],a[href*="/shorts/"],.thumbnail')?.href || img.src || "";
    try {
      const url = new URL(href, location.href);
      return (
        url.searchParams.get("v") ||
        url.pathname.match(/\/(?:shorts|embed|vi|vi_webp)\/([^/?#]+)/)?.[1] ||
        img.src.match(/\/vi(?:_webp)?\/([^/]+)\//)?.[1] ||
        ""
      );
    } catch {
      return img.src.match(/\/vi(?:_webp)?\/([^/]+)\//)?.[1] || "";
    }
  }

  function isNearViewport(element) {
    const rect = element.getBoundingClientRect();
    const margin = Math.max(900, window.innerHeight || 800);
    return rect.bottom >= -margin && rect.top <= (window.innerHeight || 800) + margin;
  }

  function stripQuery(value) {
    return String(value || "").split("?")[0];
  }

  function isStableThumbnail(img) {
    try {
      return Boolean(
        img.complete &&
          img.naturalWidth >= 120 &&
          img.naturalHeight >= 90 &&
          /\/vi(?:_webp)?\/[^/]+\//i.test(new URL(img.currentSrc || img.src, location.href).pathname),
      );
    } catch {
      return false;
    }
  }

  function ready(fn) {
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn();
  }
})();
