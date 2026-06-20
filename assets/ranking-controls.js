(function () {
  const GROUP = document.body.dataset.sourceGroup || "live";
  const DATA_URL = "data/youtube-ranking.json";
  const SNAPSHOT_INDEX_URL = "data/live-snapshots/index.json";
  const STATE_PREFIX = "ytb-ranking-state-v1:";
  const SNAPSHOT_PARAM = "snapshot";
  const PAGE_SIZE = 99;
  const TWO_COLUMN_PAGE_SIZE = 98;
  const TIME_FILTER_KEY = `ytb-ranking-time-filter-v1:${GROUP}`;

  const rawFetch = window.fetch.bind(window);
  const selectedSnapshot = snapshotFromUrl();
  let currentPage = 1;
  let itemByVideoId = new Map();
  let rankingReferenceMs = NaN;
  let snapshotIndex = null;
  let controlsReady = false;
  let updateQueued = false;

  sanitizeState();
  patchStatePersistence();
  patchSnapshotFetch();
  installStyle();
  ready(boot);

  function boot() {
    lockAutoLayout();
    installControlBar();
    loadRankingData().finally(() => scheduleUpdate());
    loadSnapshotIndex().finally(() => scheduleUpdate());
    observeApp();
    ["click", "change", "input"].forEach((eventName) => {
      document.addEventListener(eventName, handleControlEvent, true);
    });
    window.addEventListener("resize", scheduleUpdate, { passive: true });
    [250, 800, 1600, 3200, 6400].forEach((delay) => setTimeout(scheduleUpdate, delay));
  }

  function sanitizeState() {
    const key = stateKey();
    const state = readState(key);
    if (!state) return;
    delete state.search;
    state.layoutMode = "auto";
    localStorage.setItem(key, JSON.stringify(state));
  }

  function patchStatePersistence() {
    if (window.__YTB_RANKING_STATE_PATCHED__) return;
    window.__YTB_RANKING_STATE_PATCHED__ = true;
    const nativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function patchedSetItem(key, value) {
      if (typeof key === "string" && key.startsWith(STATE_PREFIX)) {
        try {
          const state = JSON.parse(String(value || "{}")) || {};
          delete state.search;
          state.layoutMode = "auto";
          return nativeSetItem.call(this, key, JSON.stringify(state));
        } catch {
          // Fall through to native storage for malformed values.
        }
      }
      return nativeSetItem.call(this, key, value);
    };
  }

  function patchSnapshotFetch() {
    if (GROUP !== "live" || !selectedSnapshot) return;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input?.url || "";
      if (isRankingRequest(url)) {
        return rawFetch(`data/live-snapshots/${encodeURIComponent(selectedSnapshot)}.json`, {
          ...(init || {}),
          cache: "no-store",
        });
      }
      return rawFetch(input, init);
    };
  }

  function installControlBar() {
    const toolbar = document.querySelector(".filter-toolbar");
    const panel = document.getElementById("filter-panel");
    const toggle = document.getElementById("toggle-filters");
    const sections = document.getElementById("ranking-sections");
    if (!toolbar || !panel || !toggle || !sections) {
      requestAnimationFrame(installControlBar);
      return;
    }

    lockAutoLayout();
    moveSearchControl(toolbar, toggle);
    installTimeFilter(toolbar);
    installSnapshotFilter(toolbar);
    ensurePagination(sections);
    controlsReady = true;
    scheduleUpdate();
  }

  function moveSearchControl(toolbar, toggle) {
    const searchInput = document.querySelector('input[data-state="search"]');
    const searchLabel = searchInput?.closest("label");
    if (!searchInput || !searchLabel || searchLabel.dataset.externalSearch === "1") return;
    searchLabel.dataset.externalSearch = "1";
    searchLabel.classList.add("external-search-field");
    searchInput.value = "";
    toggle.insertAdjacentElement("afterend", searchLabel);
  }

  function installTimeFilter(toolbar) {
    if (GROUP === "live" || toolbar.querySelector("#time-filter")) return;
    const label = document.createElement("label");
    label.className = "time-filter-field";
    label.innerHTML = `
      <span>时间</span>
      <select id="time-filter" aria-label="发布时间筛选">
        ${timeOptions()
          .map((option) => `<option value="${option.value}">${option.label}</option>`)
          .join("")}
      </select>
    `;
    toolbar.append(label);
    const select = label.querySelector("select");
    select.value = localStorage.getItem(TIME_FILTER_KEY) || "all";
    select.addEventListener("change", () => {
      localStorage.setItem(TIME_FILTER_KEY, select.value);
      currentPage = 1;
      scheduleUpdate();
    });
  }

  function installSnapshotFilter(toolbar) {
    if (GROUP !== "live" || toolbar.querySelector("#snapshot-filter")) return;
    const label = document.createElement("label");
    label.className = "snapshot-filter-field";
    label.hidden = true;
    label.innerHTML = `
      <span>快照</span>
      <select id="snapshot-filter" aria-label="直播快照">
        <option value="">最新直播</option>
      </select>
    `;
    toolbar.append(label);
    label.querySelector("select").addEventListener("change", (event) => {
      const next = event.target.value;
      const url = new URL(location.href);
      if (next) url.searchParams.set(SNAPSHOT_PARAM, next);
      else url.searchParams.delete(SNAPSHOT_PARAM);
      location.href = url.href;
    });
  }

  function ensurePagination(sections) {
    if (document.getElementById("ranking-pagination")) return;
    const top = document.createElement("nav");
    top.id = "ranking-pagination";
    top.className = "ranking-pagination";
    top.setAttribute("aria-label", "分页");
    sections.insertAdjacentElement("beforebegin", top);
  }

  function scheduleUpdate() {
    if (updateQueued) return;
    updateQueued = true;
    requestAnimationFrame(() => {
      updateQueued = false;
      lockAutoLayout();
      updateSnapshotOptions();
      applyTimeFilterAndPagination();
    });
  }

  function handleControlEvent(event) {
    const target = event.target;
    const isPager = target?.closest?.("#ranking-pagination");
    const changesFilter =
      target?.matches?.('[data-state="search"], #time-filter, #snapshot-filter, [data-blacklist-input], [data-state]');
    if (changesFilter && !isPager) currentPage = 1;
    scheduleUpdate();
  }

  function applyTimeFilterAndPagination() {
    if (!controlsReady) return;
    const cards = Array.from(document.querySelectorAll(".video-card"));
    if (!cards.length) return;

    for (const card of cards) {
      delete card.dataset.pageHidden;
      delete card.dataset.timeHidden;
    }

    const maxAgeMs = currentTimeLimitMs();
    for (const card of cards) {
      const item = itemByVideoId.get(videoIdFromCard(card));
      if (maxAgeMs != null && !matchesTimeFilter(item, maxAgeMs)) {
        card.dataset.timeHidden = "1";
      }
    }

    const eligibleCards = cards.filter(isPaginationEligible);
    const pageSize = pageSizeForCards(eligibleCards);
    const pageCount = Math.max(1, Math.ceil(eligibleCards.length / pageSize));
    currentPage = Math.min(Math.max(1, currentPage), pageCount);

    eligibleCards.forEach((card, index) => {
      const pageIndex = Math.floor(index / pageSize) + 1;
      if (pageIndex !== currentPage) card.dataset.pageHidden = "1";
    });

    renderPagination(eligibleCards.length, pageCount, pageSize);
  }

  function renderPagination(total, pageCount, pageSize) {
    const root = document.getElementById("ranking-pagination");
    if (!root) return;
    if (total <= pageSize) {
      root.hidden = true;
      root.innerHTML = "";
      return;
    }

    root.hidden = false;
    const start = (currentPage - 1) * pageSize + 1;
    const end = Math.min(total, currentPage * pageSize);
    root.innerHTML = `
      <button type="button" data-page-action="prev" ${currentPage <= 1 ? "disabled" : ""}>上一页</button>
      <span>${start}-${end} / ${total}</span>
      <button type="button" data-page-action="next" ${currentPage >= pageCount ? "disabled" : ""}>下一页</button>
    `;
    root.querySelector('[data-page-action="prev"]')?.addEventListener("click", () => {
      currentPage -= 1;
      scheduleUpdate();
      scrollToTopOfCards();
    });
    root.querySelector('[data-page-action="next"]')?.addEventListener("click", () => {
      currentPage += 1;
      scheduleUpdate();
      scrollToTopOfCards();
    });
  }

  function isPaginationEligible(card) {
    if (card.dataset.timeHidden === "1") return false;
    if (card.hidden || card.classList.contains("is-duplicate-video") || card.classList.contains("is-live-duration-dirty")) {
      return false;
    }
    const style = getComputedStyle(card);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function matchesTimeFilter(item, maxAgeMs) {
    if (!item) return false;
    const timestamp = Number(item.publishedTimestamp) || parsePublishedText(item.publishedText);
    if (!Number.isFinite(timestamp)) return false;
    const ageMs = referenceTimeMs() - timestamp;
    return ageMs >= 0 && ageMs <= maxAgeMs;
  }

  function currentTimeLimitMs() {
    if (GROUP === "live") return null;
    const value = document.getElementById("time-filter")?.value || "all";
    if (value === "all") return null;
    const hours = Number(value);
    return Number.isFinite(hours) && hours > 0 ? hours * 60 * 60 * 1000 : null;
  }

  function timeOptions() {
    const base = [
      { value: "all", label: "全部时间" },
      { value: "1", label: "1小时内" },
      { value: "3", label: "3小时内" },
      { value: "6", label: "6小时内" },
      { value: "12", label: "12小时内" },
      { value: "24", label: "24小时内" },
    ];
    if (GROUP === "month") {
      base.push(
        { value: "72", label: "3天内" },
        { value: "168", label: "1周内" },
        { value: "672", label: "4周内" },
      );
    }
    return base;
  }

  function parsePublishedText(value) {
    const text = normalizeDigits(clean(value));
    const match = text.match(
      /(\d+(?:\.\d+)?)\s*(秒|分|時間|日|週間|か月|ヶ月|月|年|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|小时前|天前|周前|月前|年前)/i,
    );
    if (!match) return NaN;
    const amount = Number.parseFloat(match[1]);
    if (!Number.isFinite(amount)) return NaN;
    const unit = match[2];
    let hours = 0;
    if (/秒|seconds?|secs?/i.test(unit)) hours = amount / 3600;
    else if (/分|minutes?|mins?/i.test(unit)) hours = amount / 60;
    else if (/時間|hours?|hrs?|小时前/i.test(unit)) hours = amount;
    else if (/日|days?|天前/i.test(unit)) hours = amount * 24;
    else if (/週間|weeks?|周前/i.test(unit)) hours = amount * 24 * 7;
    else if (/か月|ヶ月|月|months?|月前/i.test(unit)) hours = amount * 24 * 30;
    else if (/年|years?|年前/i.test(unit)) hours = amount * 24 * 365;
    return hours > 0 ? referenceTimeMs() - hours * 60 * 60 * 1000 : NaN;
  }

  async function loadRankingData() {
    try {
      const response = await fetch(DATA_URL, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      const group = data?.groups?.[GROUP] || {};
      rankingReferenceMs = Date.parse(group.updatedAt || group.collectedAt || data?.generatedAt || data?.collectedAt || "");
      const items = group.items || [];
      itemByVideoId = new Map(items.filter((item) => item.videoId).map((item) => [item.videoId, item]));
    } catch {
      rankingReferenceMs = NaN;
      itemByVideoId = new Map();
    }
  }

  function pageSizeForCards(cards) {
    if (document.body.dataset.layoutMode === "two") return TWO_COLUMN_PAGE_SIZE;
    const columnCount = effectiveColumnCount(cards);
    return columnCount === 2 ? TWO_COLUMN_PAGE_SIZE : PAGE_SIZE;
  }

  function effectiveColumnCount(cards) {
    const visible = cards.filter((card) => !card.dataset.pageHidden).slice(0, 12);
    if (visible.length < 2) return 0;
    const firstTop = Math.round(visible[0].getBoundingClientRect().top);
    const firstRowLefts = [];
    for (const card of visible) {
      const rect = card.getBoundingClientRect();
      if (Math.abs(Math.round(rect.top) - firstTop) > 4) break;
      firstRowLefts.push(Math.round(rect.left));
    }
    return new Set(firstRowLefts).size;
  }

  function referenceTimeMs() {
    return Number.isFinite(rankingReferenceMs) ? rankingReferenceMs : Date.now();
  }

  async function loadSnapshotIndex() {
    if (GROUP !== "live") return;
    try {
      const response = await rawFetch(`${SNAPSHOT_INDEX_URL}?ts=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return;
      snapshotIndex = await response.json();
    } catch {
      snapshotIndex = null;
    }
  }

  function updateSnapshotOptions() {
    if (GROUP !== "live") return;
    const label = document.querySelector(".snapshot-filter-field");
    const select = document.getElementById("snapshot-filter");
    const snapshots = Array.isArray(snapshotIndex?.snapshots) ? snapshotIndex.snapshots : [];
    if (!label || !select || !snapshots.length) return;
    const options = snapshots
      .map((snapshot) => `<option value="${escapeHtml(snapshot.id)}">${escapeHtml(snapshot.label || snapshot.id)}</option>`)
      .join("");
    const nextHtml = `<option value="">最新直播</option>${options}`;
    if (select.innerHTML !== nextHtml) select.innerHTML = nextHtml;
    select.value = selectedSnapshot || "";
    label.hidden = false;
  }

  function lockAutoLayout() {
    document.body.dataset.layoutMode = "auto";
    document.querySelectorAll(".layout-toggle").forEach((node) => {
      node.hidden = true;
      node.setAttribute("aria-hidden", "true");
    });
  }

  function observeApp() {
    const root = document.getElementById("app") || document.body;
    new MutationObserver(scheduleUpdate).observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "class"],
    });
  }

  function scrollToTopOfCards() {
    document.getElementById("ranking-sections")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function isRankingRequest(value) {
    try {
      return new URL(value, location.href).pathname.endsWith("/data/youtube-ranking.json");
    } catch {
      return String(value || "").includes("data/youtube-ranking.json");
    }
  }

  function snapshotFromUrl() {
    const value = new URL(location.href).searchParams.get(SNAPSHOT_PARAM) || "";
    return /^[a-z0-9._-]+$/i.test(value) ? value : "";
  }

  function videoIdFromCard(card) {
    const href = card.querySelector('a[href*="watch"],a[href*="/shorts/"],.thumbnail')?.href || "";
    try {
      const url = new URL(href, location.href);
      return url.searchParams.get("v") || url.pathname.match(/\/(?:shorts|embed|vi|vi_webp)\/([^/?#]+)/)?.[1] || "";
    } catch {
      return "";
    }
  }

  function readState(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "{}") || {};
    } catch {
      return null;
    }
  }

  function stateKey() {
    return `${STATE_PREFIX}${GROUP}`;
  }

  function installStyle() {
    if (document.getElementById("ranking-controls-style")) return;
    const style = document.createElement("style");
    style.id = "ranking-controls-style";
    style.textContent = `
      .layout-toggle,
      .video-card[data-page-hidden="1"],
      .video-card[data-time-hidden="1"] {
        display: none !important;
      }
      .external-search-field,
      .time-filter-field,
      .snapshot-filter-field {
        display: inline-flex !important;
        flex: 0 1 260px !important;
        align-items: center !important;
        gap: 6px !important;
        min-width: 180px !important;
        max-width: min(360px, 52vw) !important;
      }
      .external-search-field input,
      .time-filter-field select,
      .snapshot-filter-field select {
        min-width: 0 !important;
        width: 100% !important;
      }
      .time-filter-field,
      .snapshot-filter-field {
        flex-basis: 150px !important;
        min-width: 132px !important;
        max-width: 220px !important;
      }
      .ranking-pagination {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        margin: 8px 0 10px;
        color: #526173;
        font-size: 13px;
        font-weight: 800;
      }
      .ranking-pagination[hidden] {
        display: none !important;
      }
      .ranking-pagination button {
        min-width: 68px;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 8px;
        background: #ffffff;
        color: #0f766e;
        font: inherit;
        padding: 5px 10px;
        cursor: pointer;
      }
      .ranking-pagination button:disabled {
        cursor: default;
        opacity: 0.42;
      }
      @media (max-width: 760px) {
        .external-search-field {
          order: 9;
          flex: 1 0 100% !important;
          max-width: 100% !important;
        }
        .time-filter-field,
        .snapshot-filter-field {
          flex: 1 0 132px !important;
        }
      }
    `;
    document.head.append(style);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function clean(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function normalizeDigits(value) {
    return String(value || "").replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  }

  function ready(fn) {
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn();
  }
})();
