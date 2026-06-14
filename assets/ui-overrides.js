(function () {
  const STORAGE_PREFIX = "ytb-ranking-state-v1:";
  const VALID_LAYOUTS = new Set(["auto", "two", "three"]);
  const LAYOUT_LABELS = {
    auto: "自动",
    two: "2列",
    three: "3列",
  };

  let filterPanelOpen = false;
  let cardObserver = null;

  setBodyLayout(getLayoutMode());

  document.addEventListener("click", handleEarlyClick, true);
  document.addEventListener("error", handleThumbnailError, true);
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
    prepareThumbnails();
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

  function observeCards() {
    const root = document.getElementById("ranking-sections");
    if (!root) {
      window.requestAnimationFrame(observeCards);
      return;
    }

    if (cardObserver) cardObserver.disconnect();
    cardObserver = new MutationObserver(() => window.requestAnimationFrame(prepareThumbnails));
    cardObserver.observe(root, { childList: true, subtree: true });
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
