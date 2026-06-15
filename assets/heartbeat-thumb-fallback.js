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
          if (img.naturalWidth > 8 && img.naturalHeight > 8) img.dataset.hbThumbOk = "1";
        });
      }
      if (img.complete && !img.dataset.hbThumbOk && (img.naturalWidth <= 8 || img.naturalHeight <= 8)) {
        fallback(img);
      }
    });
  }

  function fallback(img) {
    const videoId = getVideoId(img);
    const card = img.closest(".video-card");
    if (!videoId) {
      if (card) card.hidden = true;
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
      if (card) card.hidden = true;
      return;
    }

    img.dataset.hbThumbFallbackIndex = String(index + 1);
    img.dataset.hbThumbOk = "";
    img.src = candidates[index];
    img.removeAttribute("srcset");
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

  function ready(fn) {
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn();
  }
})();
