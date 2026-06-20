(function () {
  const GROUP = document.body.dataset.sourceGroup || "live";
  const DATA_URL = "data/youtube-ranking.json";
  const SNAPSHOT_INDEX_URL = "data/live-snapshots/index.json";
  const STATE_PREFIX = "ytb-ranking-state-v1:";
  const SNAPSHOT_PARAM = "snapshot";
  const PAGE_SIZE = 99;
  const TWO_COLUMN_PAGE_SIZE = 98;
  const TIME_FILTER_KEY = `ytb-ranking-time-filter-v1:${GROUP}`;
  const MIN_VIEWS_FILTER_KEY = `ytb-ranking-min-views-v1:${GROUP}`;
  const DEFAULT_BLOCKED_PATTERNS = ["そびたんねる", "Piero Soubi", "Unmanned Japanese", "niY6C3ag-BY", "きよき一瓢"];

  const rawFetch = window.fetch.bind(window);
  const selectedSnapshot = snapshotFromUrl();
  let currentPage = 1;
  let itemByVideoId = new Map();
  let rankingReferenceMs = NaN;
  let originalKeywordCounts = new Map();
  let originalTotalCount = 0;
  let snapshotIndex = null;
  let controlsReady = false;
  let updateQueued = false;
  let timePopoverOpen = false;
  let toolbarCollapsed = false;
  let backTopButton = null;

  sanitizeState();
  patchStatePersistence();
  patchRankingFetch();
  installStyle();
  ready(boot);

  function boot() {
    lockAutoLayout();
    installControlBar();
    installBackToTopButton();
    loadRankingData().finally(() => scheduleUpdate());
    loadSnapshotIndex().finally(() => scheduleUpdate());
    observeApp();
    ["click", "change", "input"].forEach((eventName) => {
      document.addEventListener(eventName, handleControlEvent, true);
    });
    document.addEventListener("keydown", handleDocumentKeydown, true);
    window.addEventListener("resize", scheduleUpdate, { passive: true });
    [0, 500, 1500, 3500].forEach((delay) => setTimeout(refreshStyleOrder, delay));
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

  function patchRankingFetch() {
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input?.url || "";
      if (isRankingRequest(url)) {
        const rankingUrl =
          GROUP === "live" && selectedSnapshot
            ? `data/live-snapshots/${encodeURIComponent(selectedSnapshot)}.json`
            : input;
        const response = await rawFetch(rankingUrl, {
          ...(init || {}),
          cache: "no-store",
        });
        return filterRankingResponse(response);
      }
      return rawFetch(input, init);
    };
  }

  async function filterRankingResponse(response) {
    if (!response.ok) return response;
    try {
      const data = await response.clone().json();
      const filtered = filterDefaultBlockedItems(data);
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      return new Response(JSON.stringify(filtered), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return response;
    }
  }

  function filterDefaultBlockedItems(data) {
    const groups = data?.groups || {};
    for (const group of Object.values(groups)) {
      if (!group || typeof group !== "object") continue;
      if (Array.isArray(group.items)) group.items = group.items.filter((item) => !isDefaultBlockedItem(item));
      if (group.keywords && typeof group.keywords === "object") {
        for (const key of Object.keys(group.keywords)) {
          if (Array.isArray(group.keywords[key])) {
            group.keywords[key] = group.keywords[key].filter((item) => !isDefaultBlockedItem(item));
          }
        }
      }
      if (Array.isArray(group.sources)) {
        group.sources = group.sources.map((source) => {
          const keyword = source.keyword;
          const count =
            keyword && Array.isArray(group.keywords?.[keyword])
              ? group.keywords[keyword].length
              : Array.isArray(group.items)
                ? group.items.length
                : source.itemCount;
          return { ...source, itemCount: count };
        });
      }
    }
    return data;
  }

  function isDefaultBlockedItem(item) {
    const haystack = clean(
      [
        item?.channelName,
        item?.channelId,
        item?.title,
        item?.videoId,
        item?.watchUrl,
        item?.searchableText,
      ].join(" "),
    ).toLowerCase();
    return DEFAULT_BLOCKED_PATTERNS.some((pattern) => haystack.includes(pattern.toLowerCase()));
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
    installToolbarCollapseButton(toolbar);
    installTimeFilter();
    installMinViewsFilter(toolbar);
    installSnapshotFilter(toolbar);
    arrangeToolbarRows(toolbar);
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
    stripControlCaption(searchLabel);
    searchInput.value = "";
    searchInput.setAttribute("aria-label", searchInput.getAttribute("aria-label") || "搜索标题、频道、视频 ID");
    toggle.insertAdjacentElement("afterend", searchLabel);
  }

  function installToolbarCollapseButton(toolbar) {
    if (!toolbar || document.getElementById("toggle-toolbar-collapse")) return;
    const button = document.createElement("button");
    button.id = "toggle-toolbar-collapse";
    button.className = "toolbar-collapse-button";
    button.type = "button";
    toolbar.append(button);
    setToolbarCollapsed(false);
  }

  function installTimeFilter() {
    if (GROUP === "live" || document.getElementById("time-filter-popover")) return;
    const popover = document.createElement("div");
    popover.id = "time-filter-popover";
    popover.className = "time-filter-popover";
    popover.hidden = true;
    popover.innerHTML = `
      <input type="hidden" id="time-filter" value="all">
      <div class="time-filter-options" role="listbox" aria-label="发布时间筛选">
        ${timeOptions().map(timeOptionButton).join("")}
      </div>
    `;
    document.body.append(popover);
    setTimeFilterValue(localStorage.getItem(TIME_FILTER_KEY) || "all", { persist: false, update: false });
    popover.addEventListener("click", (event) => {
      const button = event.target.closest("[data-time-filter-value]");
      if (!button) return;
      setTimeFilterValue(button.dataset.timeFilterValue || "all");
      currentPage = 1;
      closeTimePopover();
      scheduleUpdate();
    });
  }

  function installMinViewsFilter(toolbar) {
    if (GROUP === "live" || toolbar.querySelector("#min-views-filter")) return;
    const label = document.createElement("label");
    label.className = "min-views-filter-field";
    label.innerHTML = `<input id="min-views-filter" type="text" inputmode="numeric" autocomplete="off" aria-label="最低播放量" placeholder="最低播放">`;
    const input = label.querySelector("input");
    input.value = localStorage.getItem(MIN_VIEWS_FILTER_KEY) || "";
    toolbar.append(label);
    input.addEventListener("input", () => {
      const value = clean(input.value);
      if (value) localStorage.setItem(MIN_VIEWS_FILTER_KEY, value);
      else localStorage.removeItem(MIN_VIEWS_FILTER_KEY);
      currentPage = 1;
      scheduleUpdate();
    });
    input.addEventListener("change", () => {
      input.value = formatMinViewsInput(input.value);
      if (input.value) localStorage.setItem(MIN_VIEWS_FILTER_KEY, input.value);
      else localStorage.removeItem(MIN_VIEWS_FILTER_KEY);
      scheduleUpdate();
    });
  }

  function installSnapshotFilter(toolbar) {
    if (GROUP !== "live" || toolbar.querySelector("#snapshot-filter")) return;
    const label = document.createElement("label");
    label.className = "snapshot-filter-field";
    label.hidden = true;
    label.innerHTML = `
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

  function arrangeToolbarRows(toolbar) {
    if (!toolbar) return;
    let searchRow = toolbar.querySelector(".toolbar-search-row");
    let metaRow = toolbar.querySelector(".toolbar-meta-row");
    if (!searchRow) {
      searchRow = document.createElement("div");
      searchRow.className = "toolbar-search-row";
      toolbar.prepend(searchRow);
    }
    if (!metaRow) {
      metaRow = document.createElement("div");
      metaRow.className = "toolbar-meta-row";
      searchRow.insertAdjacentElement("afterend", metaRow);
    }

    const search = toolbar.querySelector(".external-search-field");
    if (search && search.parentElement !== searchRow) searchRow.append(search);

    const collapseButton = document.getElementById("toggle-toolbar-collapse");
    if (collapseButton && collapseButton.parentElement !== searchRow) searchRow.append(collapseButton);

    const toggle = document.getElementById("toggle-filters");
    if (toggle && toggle.parentElement !== metaRow) metaRow.append(toggle);

    const minViews = document.querySelector(".min-views-filter-field");
    if (minViews && minViews.parentElement !== metaRow) metaRow.append(minViews);

    const sourceBar = document.getElementById("source-chip-bar");
    if (sourceBar && sourceBar.parentElement !== metaRow) metaRow.append(sourceBar);

    const activeChips = document.getElementById("active-filter-chips");
    if (activeChips && activeChips.parentElement !== metaRow) metaRow.append(activeChips);

    const snapshot = document.querySelector(".snapshot-filter-field");
    if (snapshot && snapshot.parentElement !== metaRow) metaRow.append(snapshot);

    hideInternalFilterChips();
  }

  function stripControlCaption(label) {
    for (const node of Array.from(label.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        node.textContent = "";
      } else if (node.nodeType === Node.ELEMENT_NODE && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/i.test(node.tagName)) {
        node.remove();
      }
    }
  }

  function ensurePagination(sections) {
    ensurePaginationRoot(sections, "ranking-pagination", "beforebegin", "顶部分页");
    ensurePaginationRoot(sections, "ranking-pagination-bottom", "afterend", "底部分页");
  }

  function ensurePaginationRoot(sections, id, position, label) {
    if (document.getElementById(id)) return;
    const root = document.createElement("nav");
    root.id = id;
    root.className = "ranking-pagination";
    root.dataset.paginationRoot = "1";
    root.setAttribute("aria-label", label);
    sections.insertAdjacentElement(position, root);
  }

  function scheduleUpdate() {
    if (updateQueued) return;
    updateQueued = true;
    requestAnimationFrame(() => {
      updateQueued = false;
      lockAutoLayout();
      arrangeToolbarRows(document.querySelector(".filter-toolbar"));
      hideInternalFilterChips();
      syncTimeFilterTrigger();
      syncToolbarCollapsed();
      updateSnapshotOptions();
      applyTimeFilterAndPagination();
    });
  }

  function handleControlEvent(event) {
    const target = event.target;
    const isPager = target?.closest?.(".ranking-pagination");
    const collapseButton = target?.closest?.("#toggle-toolbar-collapse");
    if (collapseButton && event.type === "click") {
      event.preventDefault();
      event.stopImmediatePropagation();
      setToolbarCollapsed(!toolbarCollapsed);
      return;
    }
    const trigger = target?.closest?.(".time-filter-trigger");
    if (trigger && event.type === "click") {
      event.preventDefault();
      toggleTimePopover(trigger);
      return;
    }
    if (event.type === "click" && timePopoverOpen && !target?.closest?.("#time-filter-popover")) {
      closeTimePopover();
    }
    const changesFilter =
      target?.matches?.('[data-state="search"], #time-filter, #min-views-filter, #snapshot-filter, [data-blacklist-input], [data-state]');
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
      delete card.dataset.viewHidden;
    }

    const maxAgeMs = currentTimeLimitMs();
    const minViews = currentMinViews();
    for (const card of cards) {
      const item = itemByVideoId.get(videoIdFromCard(card));
      if (maxAgeMs != null && !matchesTimeFilter(item, maxAgeMs)) {
        card.dataset.timeHidden = "1";
      }
      if (minViews != null && !matchesMinViewsFilter(item, minViews)) {
        card.dataset.viewHidden = "1";
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
    updateDataSummary(eligibleCards);
  }

  function renderPagination(total, pageCount, pageSize) {
    const roots = Array.from(document.querySelectorAll(".ranking-pagination"));
    if (!roots.length) return;
    if (total <= pageSize) {
      roots.forEach((root) => {
        root.hidden = true;
        root.innerHTML = "";
      });
      return;
    }

    const start = (currentPage - 1) * pageSize + 1;
    const end = Math.min(total, currentPage * pageSize);
    roots.forEach((root) => {
      root.hidden = false;
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
    });
  }

  function isPaginationEligible(card) {
    if (card.dataset.timeHidden === "1") return false;
    if (card.dataset.viewHidden === "1") return false;
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

  function currentMinViews() {
    if (GROUP === "live") return null;
    return parseCompactNumber(document.getElementById("min-views-filter")?.value);
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

  function timeOptionButton(option) {
    return `<button type="button" role="option" data-time-filter-value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</button>`;
  }

  function setTimeFilterValue(value, options = {}) {
    if (GROUP === "live") return;
    const validValues = new Set(timeOptions().map((option) => option.value));
    const next = validValues.has(String(value)) ? String(value) : "all";
    const input = document.getElementById("time-filter");
    if (input) input.value = next;
    if (options.persist !== false) localStorage.setItem(TIME_FILTER_KEY, next);
    document.querySelectorAll("[data-time-filter-value]").forEach((button) => {
      const selected = button.dataset.timeFilterValue === next;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-selected", String(selected));
    });
    if (options.update !== false) scheduleUpdate();
  }

  function matchesMinViewsFilter(item, minViews) {
    const views = Number(item?.viewCount);
    return Number.isFinite(views) && views >= minViews;
  }

  function parseCompactNumber(value) {
    const text = normalizeDigits(clean(value)).replace(/,/g, "");
    if (!text) return null;
    const match = text.match(/^(\d+(?:\.\d+)?)\s*(万|萬|亿|億|千|k|m)?$/i);
    if (!match) return null;
    const number = Number.parseFloat(match[1]);
    if (!Number.isFinite(number) || number <= 0) return null;
    const unit = (match[2] || "").toLowerCase();
    let multiplier = 1;
    if (unit === "万" || unit === "萬") multiplier = 1e4;
    else if (unit === "亿" || unit === "億") multiplier = 1e8;
    else if (unit === "千" || unit === "k") multiplier = 1e3;
    else if (unit === "m") multiplier = 1e6;
    return Math.floor(number * multiplier);
  }

  function formatMinViewsInput(value) {
    const number = parseCompactNumber(value);
    return number == null ? "" : String(number);
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
      originalKeywordCounts = sourceKeywordCounts(group, items);
      originalTotalCount = Array.from(originalKeywordCounts.values()).reduce((sum, value) => sum + value, 0);
    } catch {
      rankingReferenceMs = NaN;
      originalKeywordCounts = new Map();
      originalTotalCount = 0;
      itemByVideoId = new Map();
    }
  }

  function keywordCounts(items) {
    const counts = new Map();
    for (const item of items || []) {
      const keyword = normalizedKeyword(item?.keyword || item?.group);
      if (!keyword) continue;
      counts.set(keyword, (counts.get(keyword) || 0) + 1);
    }
    return counts;
  }

  function sourceKeywordCounts(group, fallbackItems) {
    const counts = new Map();
    if (group?.keywords && typeof group.keywords === "object") {
      for (const [key, rows] of Object.entries(group.keywords)) {
        const keyword = normalizedKeyword(key);
        if (!keyword || !Array.isArray(rows)) continue;
        counts.set(keyword, rows.length);
      }
    }
    if (!counts.size && Array.isArray(group?.sources)) {
      for (const source of group.sources) {
        const keyword = normalizedKeyword(source.keyword);
        if (!keyword) continue;
        counts.set(keyword, Number(source.itemCount) || 0);
      }
    }
    return counts.size ? counts : keywordCounts(fallbackItems);
  }

  function normalizedKeyword(value) {
    const text = clean(value);
    if (text.includes("弾き語り")) return "弾き語り";
    if (text.includes("歌枠")) return "歌枠";
    return text;
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

  function syncTimeFilterTrigger() {
    if (GROUP === "live") return;
    const chip = Array.from(document.querySelectorAll("#active-filter-chips .filter-chip.meta")).find((node) =>
      clean(node.textContent).startsWith("更新"),
    );
    if (!chip) return;
    chip.classList.add("time-filter-trigger");
    chip.setAttribute("role", "button");
    chip.setAttribute("tabindex", "0");
    chip.setAttribute("aria-controls", "time-filter-popover");
    chip.setAttribute("aria-expanded", String(timePopoverOpen));
    if (!chip.dataset.timeBaseTitle) chip.dataset.timeBaseTitle = chip.getAttribute("title") || clean(chip.textContent);
    chip.title = `${chip.dataset.timeBaseTitle} / 点击选择发布时间`;
    setTimeFilterValue(document.getElementById("time-filter")?.value || localStorage.getItem(TIME_FILTER_KEY) || "all", {
      persist: false,
      update: false,
    });
  }

  function toggleTimePopover(trigger) {
    timePopoverOpen ? closeTimePopover() : openTimePopover(trigger);
  }

  function openTimePopover(trigger) {
    const popover = document.getElementById("time-filter-popover");
    if (!popover || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const popoverWidth = Math.min(360, window.innerWidth - 16);
    popover.hidden = false;
    popover.style.top = `${Math.round(rect.bottom + 6)}px`;
    popover.style.left = `${Math.max(8, Math.round(Math.min(rect.left, window.innerWidth - popoverWidth - 8)))}px`;
    timePopoverOpen = true;
    trigger.setAttribute("aria-expanded", "true");
    popover.querySelector(".is-selected, [data-time-filter-value]")?.focus({ preventScroll: true });
  }

  function closeTimePopover() {
    const popover = document.getElementById("time-filter-popover");
    if (popover) popover.hidden = true;
    timePopoverOpen = false;
    document.querySelectorAll(".time-filter-trigger").forEach((node) => node.setAttribute("aria-expanded", "false"));
  }

  function handleDocumentKeydown(event) {
    const trigger = event.target?.closest?.(".time-filter-trigger");
    if (trigger && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      toggleTimePopover(trigger);
      return;
    }
    if (event.key === "Escape") closeTimePopover();
  }

  function syncToolbarCollapsed() {
    document.body.classList.toggle("toolbar-collapsed", toolbarCollapsed);
    const button = document.getElementById("toggle-toolbar-collapse");
    if (!button) return;
    button.textContent = toolbarCollapsed ? "⌄" : "⌃";
    button.title = toolbarCollapsed ? "展开顶部栏" : "收起顶部栏";
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-expanded", String(!toolbarCollapsed));
  }

  function setToolbarCollapsed(collapsed) {
    toolbarCollapsed = Boolean(collapsed);
    if (toolbarCollapsed) {
      closeTimePopover();
      document.getElementById("close-filters")?.click();
      document.getElementById("filter-panel")?.classList.remove("is-open");
      document.getElementById("toggle-filters")?.setAttribute("aria-expanded", "false");
    }
    syncToolbarCollapsed();
  }

  function updateDataSummary(eligibleCards) {
    const sourceBar = document.getElementById("source-chip-bar");
    if (!sourceBar) return;
    const countState = currentCountState();
    const hasActiveFilter = Boolean(
      currentTimeLimitMs() != null ||
        currentMinViews() != null ||
        clean(document.querySelector('[data-state="search"]')?.value) ||
        (countState && countState.visible !== countState.total),
    );
    const counts = new Map([
      ["歌枠", hasActiveFilter ? 0 : originalKeywordCounts.get("歌枠") || 0],
      ["弾き語り", hasActiveFilter ? 0 : originalKeywordCounts.get("弾き語り") || 0],
    ]);
    for (const card of eligibleCards || []) {
      if (!hasActiveFilter) break;
      const item = itemByVideoId.get(videoIdFromCard(card));
      const keyword = normalizedKeyword(item?.keyword || item?.group || card.textContent);
      if (!counts.has(keyword)) continue;
      counts.set(keyword, counts.get(keyword) + 1);
    }
    const currentTotal = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);
    const baselineTotal = countState?.total || originalTotalCount || currentTotal;
    const filtered = hasActiveFilter ? Math.max(0, baselineTotal - currentTotal) : 0;
    const parts = ["歌枠", "弾き語り"];
    const labels = filtered > 0 ? [...parts, "过滤"] : parts;
    const values = filtered > 0 ? [...parts.map((key) => counts.get(key) || 0), filtered] : parts.map((key) => counts.get(key) || 0);
    sourceBar.innerHTML = `<span class="source-summary-chip">${labels.join(" / ")} = ${values.join(" / ")}</span>`;
    document.querySelectorAll("#active-filter-chips .filter-chip.count").forEach((chip) => {
      chip.hidden = true;
      chip.setAttribute("aria-hidden", "true");
    });
    hideInternalFilterChips();
  }

  function hideInternalFilterChips() {
    document.querySelectorAll("#active-filter-chips .filter-chip").forEach((chip) => {
      const text = clean(chip.textContent);
      const isInternal =
        chip.classList.contains("default-title-chip") ||
        text.includes("排除韩文") ||
        /^标题:\s*(?:歌|歌枠)\s*\/\s*弾き語り(?:\s|，|,|×|$)/u.test(text);
      if (!isInternal) return;
      chip.hidden = true;
      chip.setAttribute("aria-hidden", "true");
      chip.classList.add("internal-filter-chip");
    });
  }

  function currentCountState() {
    const text = clean(document.querySelector("#active-filter-chips .filter-chip.count")?.textContent);
    const match = text.match(/(\d+)\s*\/\s*(\d+)/);
    if (!match) return null;
    return {
      visible: Number(match[1]) || 0,
      total: Number(match[2]) || 0,
    };
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

  function installBackToTopButton() {
    if (backTopButton || document.getElementById("back-to-top")) return;
    const button = document.createElement("button");
    button.id = "back-to-top";
    button.type = "button";
    button.hidden = true;
    button.setAttribute("aria-label", "返回顶部");
    button.textContent = "↑";
    document.body.append(button);
    button.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    window.addEventListener("scroll", updateBackToTopButton, { passive: true });
    backTopButton = button;
    updateBackToTopButton();
  }

  function updateBackToTopButton() {
    const button = backTopButton || document.getElementById("back-to-top");
    if (!button) return;
    button.hidden = window.scrollY < 640;
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
      .video-card[data-time-hidden="1"],
      .video-card[data-view-hidden="1"] {
        display: none !important;
      }
      .external-search-field,
      .min-views-filter-field,
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
      .min-views-filter-field input,
      .time-filter-field select,
      .snapshot-filter-field select {
        min-width: 0 !important;
        width: 100% !important;
      }
      .min-views-filter-field {
        flex: 0 0 112px !important;
        min-width: 104px !important;
        max-width: 124px !important;
      }
      .min-views-filter-field input {
        height: 30px !important;
        border-radius: 10px !important;
        padding: 4px 9px !important;
        font-size: 13px !important;
        line-height: 1.1 !important;
      }
      .time-filter-field,
      .snapshot-filter-field {
        flex-basis: 140px !important;
        min-width: 132px !important;
        max-width: 210px !important;
      }
      .filter-toolbar {
        display: flex !important;
        flex-direction: column !important;
        align-items: stretch !important;
        gap: 7px !important;
      }
      .toolbar-search-row {
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        width: 100% !important;
      }
      .toolbar-search-row .external-search-field {
        flex: 1 1 auto !important;
        min-width: 0 !important;
        max-width: none !important;
        width: 100% !important;
      }
      .toolbar-search-row .external-search-field input {
        height: 36px !important;
        border-radius: 10px !important;
      }
      .toolbar-collapse-button {
        flex: 0 0 34px !important;
        width: 34px !important;
        height: 34px !important;
        min-width: 34px !important;
        border: 1px solid rgba(15, 118, 110, 0.22) !important;
        border-radius: 10px !important;
        background: #ffffff !important;
        color: #0f766e !important;
        font-size: 19px !important;
        font-weight: 900 !important;
        line-height: 1 !important;
        cursor: pointer !important;
      }
      body.toolbar-collapsed .toolbar-search-row {
        justify-content: flex-end !important;
      }
      body.toolbar-collapsed .toolbar-search-row > :not(#toggle-toolbar-collapse),
      body.toolbar-collapsed .toolbar-meta-row {
        display: none !important;
      }
      .toolbar-meta-row {
        display: flex !important;
        flex-wrap: nowrap !important;
        align-items: center !important;
        gap: 6px !important;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        min-height: 30px !important;
        overflow-x: auto !important;
        overflow-y: hidden !important;
        overscroll-behavior-x: contain !important;
        scrollbar-width: none !important;
        white-space: nowrap !important;
      }
      .toolbar-meta-row::-webkit-scrollbar {
        display: none !important;
      }
      .toolbar-meta-row > * {
        flex: 0 0 auto !important;
      }
      #toggle-filters {
        height: 30px !important;
        min-height: 30px !important;
        padding: 4px 12px !important;
        border-radius: 10px !important;
        font-size: 13px !important;
        line-height: 1 !important;
      }
      #filter-count {
        min-width: 20px !important;
        height: 20px !important;
        margin-left: 4px !important;
        font-size: 12px !important;
        line-height: 20px !important;
      }
      #source-chip-bar {
        display: inline-flex !important;
        flex: 0 0 auto !important;
        align-items: center !important;
        gap: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
        overflow: visible !important;
      }
      .source-summary-chip,
      #active-filter-chips .filter-chip,
      .min-views-filter-field input,
      .snapshot-filter-field select {
        min-height: 30px !important;
        height: 30px !important;
        border-radius: 10px !important;
        font-size: 13px !important;
        line-height: 1.1 !important;
      }
      .source-summary-chip,
      #active-filter-chips .filter-chip {
        display: inline-flex !important;
        align-items: center !important;
        padding: 4px 10px !important;
        white-space: nowrap !important;
      }
      #active-filter-chips {
        display: inline-flex !important;
        flex: 0 0 auto !important;
        flex-wrap: nowrap !important;
        align-items: center !important;
        gap: 6px !important;
        min-width: 0 !important;
        overflow: visible !important;
      }
      #active-filter-chips .filter-chip.count[hidden],
      #active-filter-chips .filter-chip.internal-filter-chip,
      #active-filter-chips .filter-chip.default-title-chip {
        display: none !important;
      }
      #active-filter-chips .filter-chip.meta {
        cursor: pointer !important;
        user-select: none !important;
      }
      .snapshot-filter-field {
        flex: 0 1 170px !important;
        min-width: 150px !important;
        max-width: 220px !important;
      }
      .time-filter-popover {
        position: fixed;
        z-index: 1000;
        width: min(360px, calc(100vw - 16px));
        padding: 8px;
        border: 1px solid rgba(15, 23, 42, 0.14);
        border-radius: 10px;
        background: #ffffff;
        box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18);
      }
      .time-filter-popover[hidden] {
        display: none !important;
      }
      .time-filter-options {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px;
      }
      .time-filter-options button {
        min-width: 0;
        height: 32px;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 8px;
        background: #ffffff;
        color: #172033;
        font: inherit;
        font-size: 13px;
        font-weight: 800;
        cursor: pointer;
      }
      .time-filter-options button.is-selected {
        border-color: rgba(15, 118, 110, 0.48);
        background: #0f766e;
        color: #ffffff;
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
      #ranking-pagination-bottom {
        margin: 14px 0 2px;
      }
      #back-to-top {
        position: fixed;
        right: max(12px, env(safe-area-inset-right));
        bottom: max(14px, env(safe-area-inset-bottom));
        z-index: 80;
        display: inline-grid;
        width: 34px;
        height: 34px;
        place-items: center;
        border: 1px solid rgba(15, 118, 110, 0.25);
        border-radius: 999px;
        background: rgba(15, 118, 110, 0.92);
        color: #ffffff;
        box-shadow: 0 8px 18px rgba(15, 23, 42, 0.18);
        font-size: 18px;
        font-weight: 900;
        line-height: 1;
      }
      #back-to-top[hidden] {
        display: none !important;
      }
      .cards {
        align-items: stretch !important;
      }
      .video-card {
        align-self: stretch !important;
        grid-template-rows: auto 1fr !important;
        height: 100% !important;
      }
      .video-card .card-body {
        display: flex !important;
        flex-direction: column !important;
        align-content: start !important;
        gap: 3px !important;
        min-height: 0 !important;
        padding: 7px 8px 6px !important;
      }
      .video-card h3 {
        height: auto !important;
        min-height: 0 !important;
        max-height: calc(1.16em * 2) !important;
        margin: 0 !important;
        line-height: 1.16 !important;
      }
      .video-card h3 a {
        -webkit-line-clamp: 2 !important;
      }
      .video-card .hb-meta {
        align-self: start !important;
        flex: 0 0 auto !important;
        height: auto !important;
        min-height: 0 !important;
        max-height: calc(1.08em * 1) !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        font-size: 11.5px !important;
        line-height: 1.08 !important;
      }
      .video-card .channel-metric-row {
        align-self: stretch !important;
        gap: 3px !important;
        margin: 0 !important;
        min-height: 0 !important;
      }
      .video-card .channel {
        align-self: start !important;
        min-height: 0 !important;
        margin: 0 !important;
        line-height: 1.12 !important;
      }
      .video-card .channel-avatar {
        width: 20px !important;
        height: 20px !important;
      }
      @media (max-width: 760px) {
        .external-search-field {
          flex: 1 1 auto !important;
          max-width: 100% !important;
        }
        .min-views-filter-field {
          flex: 0 0 112px !important;
        }
        .time-filter-field,
        .snapshot-filter-field {
          flex: 0 0 132px !important;
        }
      }
    `;
    document.head.append(style);
  }

  function refreshStyleOrder() {
    const style = document.getElementById("ranking-controls-style");
    if (style) document.head.append(style);
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
