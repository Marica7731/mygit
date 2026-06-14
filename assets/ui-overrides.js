(function () {
  const STORAGE_PREFIX = "ytb-ranking-state-v1:";
  const DEFAULT_TITLE_TERMS = ["歌枠", "弾き語り"];
  const KOREAN_TEXT_PATTERN = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;
  const DEFAULT_TITLE_DISABLED_PREFIX = "ytb-ranking-default-title-filter-disabled-v1:";
  const VALID_LAYOUTS = new Set(["auto", "two", "three"]);
  const LAYOUT_LABELS = {
    auto: "自动",
    two: "2列",
    three: "3列",
  };

  const nativeFetch = window.fetch.bind(window);
  let filterPanelOpen = false;
  let cardObserver = null;
  let rankingItemsByVideoId = new Map();

  setBodyLayout(getLayoutMode());

  patchRankingFetch();
  document.addEventListener("click", handleEarlyClick, true);
  document.addEventListener("error", handleThumbnailError, true);
  document.addEventListener("error", handleAvatarError, true);
  document.addEventListener("DOMContentLoaded", boot);
  window.addEventListener("resize", () => {
    window.requestAnimationFrame(() => {
      setBodyLayout(getLayoutMode());
      setFilterPanel(filterPanelOpen);
    });
  });

  function boot() {
    installControls();
    setFilterPanel(false);
    loadRankingData().then(enhanceCards).catch(() => {});
    enhanceCards();
    observeCards();
  }

  function handleEarlyClick(event) {
    const layoutButton = event.target.closest("button[data-layout-mode]");
    if (layoutButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setLayoutMode(layoutButton.dataset.layoutMode);
      return;
    }

    const toggleButton = event.target.closest("#toggle-filters");
    if (toggleButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setFilterPanel(!filterPanelOpen);
      return;
    }

    const closeButton = event.target.closest("#close-filters");
    if (closeButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setFilterPanel(false);
      return;
    }

    const defaultTitleChip = event.target.closest(".default-title-chip");
    if (defaultTitleChip) {
      event.preventDefault();
      event.stopImmediatePropagation();
      localStorage.setItem(`${DEFAULT_TITLE_DISABLED_PREFIX}${getSourceGroup()}`, "1");
      window.location.reload();
    }
  }

  function installControls() {
    const toolbar = document.querySelector(".filter-toolbar");
    const toggleButton = document.getElementById("toggle-filters");
    if (!toolbar || !toggleButton) {
      window.requestAnimationFrame(installControls);
      return;
    }

    compactFilterButton(toggleButton);
    ensureLayoutToggle(toolbar, toggleButton);
    updateLayoutButtons(getLayoutMode());
  }

  function compactFilterButton(toggleButton) {
    const count = document.getElementById("filter-count");
    toggleButton.textContent = "筛选";
    if (count) {
      toggleButton.append(" ");
      toggleButton.append(count);
    }
  }

  function ensureLayoutToggle(toolbar, toggleButton) {
    let group = toolbar.querySelector(".layout-toggle");
    if (!group) {
      group = document.createElement("div");
      group.className = "layout-toggle";
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", "卡片列数");

      for (const [mode, label] of Object.entries(LAYOUT_LABELS)) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.layoutMode = mode;
        button.textContent = label;
        group.append(button);
      }

      toggleButton.insertAdjacentElement("afterend", group);
    }
  }

  function setFilterPanel(open) {
    filterPanelOpen = Boolean(open);
    const panel = document.getElementById("filter-panel");
    const toggle = document.getElementById("toggle-filters");
    if (!panel || !toggle) return;

    panel.classList.toggle("is-open", filterPanelOpen);
    toggle.setAttribute("aria-expanded", String(filterPanelOpen));
    if (filterPanelOpen) document.body.classList.remove("compact-ui-hidden");
  }

  function getLayoutMode() {
    const state = readState();
    return VALID_LAYOUTS.has(state.layoutMode) ? state.layoutMode : "auto";
  }

  function setLayoutMode(mode) {
    const nextMode = VALID_LAYOUTS.has(mode) ? mode : "auto";
    setBodyLayout(nextMode);
    updateLayoutButtons(nextMode);
    writeState({ layoutMode: nextMode });
  }

  function setBodyLayout(mode) {
    document.body.dataset.layoutMode = VALID_LAYOUTS.has(mode) ? mode : "auto";
  }

  function updateLayoutButtons(mode) {
    document.querySelectorAll("button[data-layout-mode]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.layoutMode === mode));
    });
  }

  function readState() {
    try {
      return JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${getSourceGroup()}`) || "{}") || {};
    } catch {
      return {};
    }
  }

  function writeState(patch) {
    const state = { ...readState(), ...patch };
    localStorage.setItem(`${STORAGE_PREFIX}${getSourceGroup()}`, JSON.stringify(state));
  }

  function getSourceGroup() {
    return document.body.dataset.sourceGroup || "live";
  }

  function patchRankingFetch() {
    window.fetch = async (input, init) => {
      const response = await nativeFetch(input, init);
      const url = typeof input === "string" ? input : input?.url || "";
      if (!isDefaultTitleFilterActive() || !url.includes("data/youtube-ranking.json")) {
        return response;
      }

      try {
        const data = await response.clone().json();
        const filtered = filterRankingDataByTitle(data);
        return new Response(JSON.stringify(filtered), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } catch {
        return response;
      }
    };
  }

  function isDefaultTitleFilterActive() {
    return localStorage.getItem(`${DEFAULT_TITLE_DISABLED_PREFIX}${getSourceGroup()}`) !== "1";
  }

  function filterRankingDataByTitle(data) {
    if (!data?.groups?.[getSourceGroup()]) return data;
    const cloned = JSON.parse(JSON.stringify(data));
    const group = cloned.groups[getSourceGroup()];
    const matchesTitle = (item) => {
      const title = String(item.title || "");
      return DEFAULT_TITLE_TERMS.some((term) => title.includes(term)) && !KOREAN_TEXT_PATTERN.test(title);
    };

    group.items = (group.items || []).filter(matchesTitle);
    if (group.keywords) {
      for (const key of Object.keys(group.keywords)) {
        group.keywords[key] = (group.keywords[key] || []).filter(matchesTitle);
      }
    }
    return cloned;
  }

  function observeCards() {
    const root = document.getElementById("ranking-sections");
    if (!root) {
      window.requestAnimationFrame(observeCards);
      return;
    }

    if (cardObserver) cardObserver.disconnect();
    cardObserver = new MutationObserver(() => window.requestAnimationFrame(enhanceCards));
    cardObserver.observe(root, { childList: true, subtree: true });
  }

  function enhanceCards() {
    prepareThumbnails();
    prepareMetricChips();
    prepareRankMetrics();
    prepareChannelRows();
    prepareStatusPills();
    renderDefaultTitleChip();
  }

  function prepareThumbnails() {
    document.querySelectorAll(".thumbnail img").forEach((img, index) => {
      const candidates = getThumbnailCandidates(img);
      img.dataset.thumbnailFallbacks = JSON.stringify(candidates);
      img.dataset.thumbnailIndex = "0";
      img.referrerPolicy = "no-referrer";
      img.decoding = "async";
      img.loading = index < 12 ? "eager" : "lazy";

      const placeholder = ensurePlaceholder(img.closest(".thumbnail"));
      if (placeholder) placeholder.hidden = true;
      img.hidden = false;

      if (img.complete && img.naturalWidth === 0) {
        useNextThumbnail(img);
      }
    });
  }

  function prepareMetricChips() {
    document.querySelectorAll(".video-card").forEach((card) => {
      const spans = Array.from(card.querySelectorAll(".meta-list span"));
      let hasPrimaryMetric = false;
      for (const span of spans) {
        const type = classifyMetric(span.textContent || "");
        if (type === "view" || type === "live") hasPrimaryMetric = true;
        span.classList.toggle("metric-view", type === "view");
        span.classList.toggle("metric-live", type === "live");
        span.classList.toggle("metric-duration", type === "duration");
        span.classList.toggle("metric-published", type === "published");
      }
      card.classList.toggle("has-primary-metric", hasPrimaryMetric);
    });
  }

  function prepareRankMetrics() {
    document.querySelectorAll(".video-card").forEach((card) => {
      const rankLine = card.querySelector(".rank-line");
      const item = rankingItemsByVideoId.get(getCardVideoId(card));
      const metric = pickRankMetric(card, item);
      if (!rankLine) return;

      let promoted = rankLine.querySelector(".rank-metric");
      if (!metric) {
        if (promoted) promoted.remove();
        card.classList.remove("has-rank-metric");
        return;
      }

      if (!promoted) {
        promoted = document.createElement("span");
        promoted.className = "rank-metric";
        rankLine.append(promoted);
      }

      promoted.className = "rank-metric";
      promoted.classList.add(`metric-${metric.type}`);
      promoted.textContent = metric.text || "";
      metric.element?.classList.add("is-promoted-metric");
      card.classList.add("has-rank-metric");
    });
  }

  function pickRankMetric(card, item) {
    const live = card.querySelector(".meta-list span.metric-live");
    if (live) return { element: live, text: live.textContent || "", type: "live" };

    const view = card.querySelector(".meta-list span.metric-view");
    if (view) return { element: view, text: view.textContent || "", type: "view" };

    if (item?.liveViewerText || item?.liveViewerCount != null) {
      return { text: item.liveViewerText || `${formatCount(item.liveViewerCount)} 观看中`, type: "live" };
    }
    if (item?.subscriberText || item?.subscriberCount != null) {
      return { text: item.subscriberText || `${formatCount(item.subscriberCount)} 订阅`, type: "subscriber" };
    }
    if (item?.likeText || item?.likeCount != null) {
      return { text: item.likeText || `${formatCount(item.likeCount)} 赞`, type: "like" };
    }

    const duration = card.querySelector(".meta-list span.metric-duration");
    if (duration) return { element: duration, text: duration.textContent || "", type: "duration" };

    return null;
  }

  async function loadRankingData() {
    const response = await fetch("data/youtube-ranking.json", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    const items = data?.groups?.[getSourceGroup()]?.items || [];
    rankingItemsByVideoId = new Map(items.filter((item) => item.videoId).map((item) => [item.videoId, item]));
  }

  function prepareChannelRows() {
    document.querySelectorAll(".video-card").forEach((card) => {
      const body = card.querySelector(".card-body");
      const channel = card.querySelector(".channel");
      const meta = card.querySelector(".meta-list");
      if (!body || !channel || !meta) return;

      let row = card.querySelector(".channel-metric-row");
      if (!row) {
        row = document.createElement("div");
        row.className = "channel-metric-row";
        channel.insertAdjacentElement("beforebegin", row);
      }

      let avatar = row.querySelector(".channel-avatar");
      if (!avatar) {
        avatar = document.createElement("span");
        avatar.className = "channel-avatar";
        row.append(avatar);
      }

      if (channel.parentElement !== row) row.append(channel);
      if (meta.parentElement === row) row.insertAdjacentElement("afterend", meta);

      const item = rankingItemsByVideoId.get(getCardVideoId(card));
      updateChannelAvatar(row, avatar, item);
    });
  }

  function prepareStatusPills() {
    document.querySelectorAll(".status-pill.live").forEach((pill) => {
      pill.textContent = "LIVE";
    });
  }

  function renderDefaultTitleChip() {
    const chipBar = document.getElementById("active-filter-chips");
    if (!chipBar || !isDefaultTitleFilterActive()) return;
    if (chipBar.querySelector(".default-title-chip")) return;

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "filter-chip allow default-title-chip";
    chip.textContent = `标题: ${DEFAULT_TITLE_TERMS.join(" / ")}，排除韩文 ×`;
    chip.title = "点击移除默认标题规则";
    chipBar.append(chip);
  }

  function updateChannelAvatar(row, avatar, item) {
    const avatarUrl = item?.channelAvatarUrl || "";

    if (avatarUrl) {
      if (avatar.dataset.avatarSrc !== avatarUrl) {
        avatar.dataset.avatarSrc = avatarUrl;
        avatar.innerHTML = "";
        const img = document.createElement("img");
        img.src = avatarUrl;
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";
        avatar.append(img);
      }
      avatar.hidden = false;
      row.classList.add("has-avatar");
      return;
    }

    if (avatar.dataset.avatarSrc) avatar.dataset.avatarSrc = "";
    avatar.innerHTML = "";
    avatar.hidden = true;
    row.classList.remove("has-avatar");
  }

  function handleAvatarError(event) {
    const img = event.target;
    const avatar = img instanceof HTMLImageElement ? img.closest(".channel-avatar") : null;
    if (!avatar) return;
    const row = avatar.closest(".channel-metric-row");
    avatar.dataset.avatarSrc = "";
    avatar.innerHTML = "";
    avatar.hidden = true;
    row?.classList.remove("has-avatar");
  }

  function getCardVideoId(card) {
    const href =
      card.querySelector(".thumbnail")?.href ||
      card.querySelector('a[href*="/watch?v="]')?.href ||
      card.querySelector('a[href*="/shorts/"]')?.href ||
      "";
    const fromUrl = getVideoId(href);
    if (fromUrl) return fromUrl;
    return (card.querySelector(".id-line span")?.textContent || "").trim();
  }

  function classifyMetric(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    if (/(watching|視聴中|人が視聴|观看中|觀看中|直播中|正在观看|正在觀看|시청 중|명 시청)/i.test(text)) {
      return "live";
    }
    if (/(views?|回視聴|視聴回数|次观看|次觀看|조회수|회 시청)/i.test(text)) {
      return "view";
    }
    if (/(subscribers?|登録者|订阅者|訂閱者)/i.test(text)) {
      return "subscriber";
    }
    if (/(likes?|高く評価|いいね|赞|讚)/i.test(text)) {
      return "like";
    }
    if (/\b(\d{1,2}:)?\d{1,2}:\d{2}\b/.test(text)) {
      return "duration";
    }
    if (/(ago|前|昨日|streamed|配信済み|premiere|秒|分|時間|日|週間|か月|ヶ月|年|小时前|天前|周前|月前|年前)/i.test(text)) {
      return "published";
    }
    return "";
  }

  function formatCount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number).toLocaleString("ja-JP") : "";
  }

  function handleThumbnailError(event) {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.closest(".thumbnail")) return;
    useNextThumbnail(img);
  }

  function useNextThumbnail(img) {
    const candidates = parseFallbacks(img);
    const currentIndex = Number(img.dataset.thumbnailIndex || "0");
    const currentSrc = absoluteUrl(img.currentSrc || img.src);

    for (let index = currentIndex + 1; index < candidates.length; index += 1) {
      if (absoluteUrl(candidates[index]) !== currentSrc) {
        img.dataset.thumbnailIndex = String(index);
        img.src = candidates[index];
        return;
      }
    }

    const thumbnail = img.closest(".thumbnail");
    const placeholder = ensurePlaceholder(thumbnail);
    img.hidden = true;
    thumbnail?.classList.add("is-thumbnail-broken");
    if (placeholder) placeholder.hidden = false;
  }

  function parseFallbacks(img) {
    try {
      const list = JSON.parse(img.dataset.thumbnailFallbacks || "[]");
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function getThumbnailCandidates(img) {
    const thumbnail = img.closest(".thumbnail");
    const videoId = getVideoId(thumbnail?.href || img.src || "");
    const candidates = [img.getAttribute("src"), img.currentSrc, img.src].filter(Boolean);

    if (videoId) {
      candidates.push(
        `https://i.ytimg.com/vi/${videoId}/hq720.jpg`,
        `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/default.jpg`,
      );
    }

    return uniqueUrls(candidates);
  }

  function getVideoId(value) {
    try {
      const url = new URL(value, window.location.href);
      const byQuery = url.searchParams.get("v");
      if (byQuery) return byQuery;

      const match = url.pathname.match(/\/(?:shorts|embed|vi|watch)\/([^/?#]+)/);
      if (match) return match[1];

      const imageMatch = url.pathname.match(/\/vi(?:_webp)?\/([^/?#]+)/);
      return imageMatch ? imageMatch[1] : "";
    } catch {
      return "";
    }
  }

  function uniqueUrls(values) {
    const seen = new Set();
    return values
      .map((value) => absoluteUrl(value))
      .filter((value) => {
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return true;
      });
  }

  function absoluteUrl(value) {
    try {
      return new URL(value, window.location.href).href;
    } catch {
      return "";
    }
  }

  function ensurePlaceholder(thumbnail) {
    if (!thumbnail) return null;
    let placeholder = thumbnail.querySelector(".thumbnail-placeholder");
    if (!placeholder) {
      placeholder = document.createElement("span");
      placeholder.className = "thumbnail-placeholder";
      placeholder.hidden = true;
      placeholder.textContent = "封面";
      thumbnail.append(placeholder);
    }
    return placeholder;
  }
})();
