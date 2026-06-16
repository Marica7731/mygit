(function () {
  const byVideoId = new Map();
  let loaded = false;

  ready(() => {
    loadData();
    [500, 1500, 3500, 7000, 12000].forEach((delay) => setTimeout(applyLinks, delay));
    setInterval(applyLinks, 5000);
    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, { childList: true, subtree: true });
  });

  function loadData() {
    fetch(`data/youtube-ranking.json?channelLink=${Date.now()}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        Object.values(data?.groups || {}).forEach((group) => {
          const items = Array.isArray(group) ? group : group?.items || [];
          items.forEach((item) => {
            if (item?.videoId) byVideoId.set(String(item.videoId), item);
          });
        });
        loaded = true;
        applyLinks();
      })
      .catch(() => {
        loaded = true;
      });
  }

  let timer = 0;
  function scheduleApply() {
    clearTimeout(timer);
    timer = setTimeout(applyLinks, 120);
  }

  function applyLinks() {
    if (!loaded && !byVideoId.size) return;
    document.querySelectorAll("article.video-card").forEach((card) => {
      const channel = card.querySelector(".channel");
      if (!channel || channel.querySelector("a[href]") || channel.matches("a[href]")) return;
      const text = clean(channel.textContent);
      if (!text) return;

      const id = videoId(card);
      const item = id ? byVideoId.get(id) : null;
      const href = channelHref(item);
      if (!href) return;

      const link = document.createElement("a");
      link.className = "channel-link-fallback";
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = text;
      channel.textContent = "";
      channel.append(link);
    });
  }

  function channelHref(item) {
    const url = clean(item?.channelUrl);
    if (url) return new URL(url, location.href).href;
    const channelId = clean(item?.channelId);
    if (channelId) return `https://www.youtube.com/channel/${encodeURIComponent(channelId)}`;
    return "";
  }

  function videoId(card) {
    const link = card.querySelector(".thumbnail[href], h3 a[href], a[href*='watch'], a[href*='/shorts/']");
    try {
      const url = new URL(link?.href || "", location.href);
      return url.searchParams.get("v") || url.pathname.match(/\/(?:shorts|embed|vi|vi_webp)\/([^/?#]+)/)?.[1] || "";
    } catch {
      return "";
    }
  }

  function ready(fn) {
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn();
  }

  function clean(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }
})();
