(function () {
  const PAGE_CONFIG = {
    live: {
      title: "直播 / 预约",
      heading: "YouTube 歌枠 / 弾き語り直播与预约",
      description: "保留 YouTube 搜索页中的直播、即将开始和预约结果。",
    },
    today: {
      title: "今日热度",
      heading: "今日歌枠 / 弾き語り热度排行",
      description: "按 YouTube 今日筛选结果展示，默认保持页面原始顺序。",
    },
    week: {
      title: "近7天热度",
      heading: "近7天歌枠 / 弾き語り热度排行",
      description: "按发布时间落在最近 7 天（168 小时）内的结果展示。",
    },
    month: {
      title: "本月热度",
      heading: "本月歌枠 / 弾き語り热度排行",
      description: "按当前自然月（月初至今）筛选发布时间，而不是滚动 30 天。",
    },
  };

  const KEYWORDS = ["歌枠", "弾き語り"];
  const DATA_URL = "data/youtube-ranking.json";
  const STORAGE_PREFIX = "ytb-ranking-state-v1:";
  const BLACKLIST_KEY = "ytb-ranking-blacklist-v1";
  const INITIAL_RENDER_LIMIT = 120;
  const RENDER_BATCH_SIZE = 48;
  const RENDER_BATCH_START_DELAY_MS = 800;
  const RENDER_BATCH_DELAY_MS = 32;

  const DEFAULT_STATE = {
    search: "",
    keywordFilter: "all",
    groupFilter: "all",
    statusFilter: "all",
    hasViews: "all",
    hasLiveViewers: "all",
    sortOrder: "original",
    minDurationMinutes: "",
    maxDurationMinutes: "",
    blacklist: "",
  };

  const STATUS_LABELS = {
    live: "直播中",
    upcoming: "预约",
    video: "普通视频",
    unknown: "未知",
  };

  const SORT_LABELS = {
    original: "YouTube 原始顺序",
    viewsDesc: "播放量降序",
    liveViewersDesc: "直播观看人数降序",
    publishedDesc: "发布时间从新到旧",
    durationDesc: "时长从长到短",
    durationAsc: "时长从短到长",
    titleAsc: "标题 A-Z",
    channelAsc: "频道名 A-Z",
  };

  const app = {
    data: null,
    sourceGroup: document.body.dataset.sourceGroup || "live",
    state: null,
    visibleItems: [],
    filtersOpen: window.matchMedia("(min-width: 761px)").matches,
    renderBatchToken: 0,
    renderBatchHandle: 0,
  };

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    app.state = loadState(app.sourceGroup);
    renderShell();
    bindControls();
    syncControls();

    try {
      const response = await fetch(DATA_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      app.data = await response.json();
      render();
    } catch (error) {
      renderError(`无法读取 ${DATA_URL}: ${error.message}`);
    }
  }

  function loadState(sourceGroup) {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${sourceGroup}`);
    let state = { ...DEFAULT_STATE };
    if (raw) {
      try {
        state = { ...state, ...JSON.parse(raw) };
      } catch {
        state = { ...DEFAULT_STATE };
      }
    }

    const globalBlacklist = localStorage.getItem(BLACKLIST_KEY);
    if (globalBlacklist != null) state.blacklist = globalBlacklist;
    state.keywordFilter = "all";
    state.groupFilter = "all";
    state.statusFilter = "all";
    state.hasViews = "all";
    state.hasLiveViewers = "all";
    state.maxDurationMinutes = "";
    return state;
  }

  function saveState() {
    localStorage.setItem(`${STORAGE_PREFIX}${app.sourceGroup}`, JSON.stringify(app.state));
    localStorage.setItem(BLACKLIST_KEY, app.state.blacklist || "");
  }

  function renderShell() {
    const page = PAGE_CONFIG[app.sourceGroup] || PAGE_CONFIG.live;
    document.title = `${page.title} - YouTube 歌枠 / 弾き語り排行`;
    const root = document.getElementById("app");
    root.innerHTML = `
      <header class="site-header">
        <nav class="page-nav" aria-label="页面导航">
          ${navLink("live.html", "live", "直播")}
          ${navLink("today.html", "today", "今日")}
          ${navLink("week.html", "week", "7天")}
          ${navLink("month.html", "month", "本月")}
        </nav>
      </header>

      <main>
        <h1 class="visually-hidden">${page.heading}</h1>

        <section class="filter-toolbar" aria-label="当前视图操作">
          <button type="button" id="toggle-filters" aria-expanded="false" aria-controls="filter-panel">
            筛选条件
            <span id="filter-count">0</span>
          </button>
          <div class="active-filter-chips" id="active-filter-chips"></div>
        </section>

        <section class="controls" id="filter-panel" aria-label="筛选和导出">
          <div class="controls-heading">
            <div>
              <strong>筛选</strong>
              <span id="filter-brief">默认原始顺序</span>
            </div>
            <button type="button" id="close-filters">收起</button>
          </div>
          <div class="control-grid">
            <label>
              <span>搜索</span>
              <input data-state="search" type="search" placeholder="标题、频道、视频 ID、URL">
            </label>
            <label>
              <span>排序</span>
              <select data-state="sortOrder">
                <option value="original">YouTube 原始顺序</option>
                <option value="viewsDesc">播放量降序</option>
                <option value="liveViewersDesc">直播观看人数降序</option>
                <option value="publishedDesc">发布时间从新到旧</option>
                <option value="durationDesc">时长从长到短</option>
                <option value="durationAsc">时长从短到长</option>
                <option value="titleAsc">标题 A-Z</option>
                <option value="channelAsc">频道名 A-Z</option>
              </select>
            </label>
            <label>
              <span>最小时长（分钟）</span>
              <input data-state="minDurationMinutes" type="number" inputmode="decimal" min="0" step="1">
            </label>
          </div>

          <label class="blacklist-field">
            <span>黑名单（每行一个词，按标题和频道名过滤）</span>
            <textarea data-state="blacklist" rows="2" placeholder="例：切り抜き&#10;clips"></textarea>
          </label>

          <div class="actions">
            <button type="button" id="reset-filters">清空</button>
            <button type="button" id="copy-tsv">复制 TSV</button>
            <button type="button" id="download-json">下载 JSON</button>
            <button type="button" id="export-png">导出 PNG</button>
          </div>
        </section>

        <section class="source-chip-bar" id="source-chip-bar" aria-label="来源状态"></section>
        <section class="ranking-sections" id="ranking-sections"></section>
      </main>
      <div class="toast" id="toast" role="status" aria-live="polite"></div>
    `;
  }

  function navLink(href, group, label) {
    const active = app.sourceGroup === group ? ' aria-current="page"' : "";
    return `<a href="${href}"${active}>${label}</a>`;
  }

  function bindControls() {
    const toggleFilters = document.getElementById("toggle-filters");
    const closeFilters = document.getElementById("close-filters");
    app.filtersOpen = window.matchMedia("(min-width: 761px)").matches;

    toggleFilters.addEventListener("click", () => {
      app.filtersOpen = !app.filtersOpen;
      updateFilterPanelVisibility();
    });

    closeFilters.addEventListener("click", () => {
      app.filtersOpen = false;
      updateFilterPanelVisibility();
    });

    window.addEventListener("resize", () => {
      if (window.matchMedia("(min-width: 761px)").matches) {
        app.filtersOpen = true;
      }
      updateFilterPanelVisibility();
    });

    bindHeaderAutoHide();
    updateFilterPanelVisibility();

    document.querySelectorAll("[data-state]").forEach((control) => {
      const eventName = control.tagName === "SELECT" ? "change" : "input";
      control.addEventListener(eventName, () => {
        app.state[control.dataset.state] = control.value;
        saveState();
        render();
      });
    });

    document.getElementById("reset-filters").addEventListener("click", () => {
      app.state = { ...DEFAULT_STATE, blacklist: "" };
      saveState();
      syncControls();
      if (window.matchMedia("(max-width: 760px)").matches) {
        app.filtersOpen = false;
        updateFilterPanelVisibility();
      }
      render();
    });

    document.getElementById("copy-tsv").addEventListener("click", copyTsv);
    document.getElementById("download-json").addEventListener("click", downloadJson);
    document.getElementById("export-png").addEventListener("click", exportPng);
  }

  function bindHeaderAutoHide() {
    const header = document.querySelector(".site-header");
    if (!header) return;

    let lastY = window.scrollY || 0;
    let ticking = false;

    const setChromeHidden = (hidden) => {
      header.classList.toggle("is-hidden", hidden);
      document.body.classList.toggle("compact-ui-hidden", hidden);
    };

    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(() => {
          const currentY = window.scrollY || 0;
          const goingDown = currentY > lastY + 8;
          const goingUp = currentY < lastY - 8;

          if (currentY < 80 || goingUp) {
            setChromeHidden(false);
          } else if (goingDown) {
            const filtersAreOpen = document.getElementById("filter-panel")?.classList.contains("is-open");
            setChromeHidden(!filtersAreOpen);
          }

          lastY = currentY;
          ticking = false;
        });
      },
      { passive: true },
    );
  }

  function updateFilterPanelVisibility() {
    const panel = document.getElementById("filter-panel");
    const toggle = document.getElementById("toggle-filters");
    if (!panel || !toggle) return;

    const isDesktop = window.matchMedia("(min-width: 761px)").matches;
    const isOpen = isDesktop || app.filtersOpen;
    panel.classList.toggle("is-open", isOpen);
    toggle.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) document.body.classList.remove("compact-ui-hidden");
  }

  function syncControls() {
    document.querySelectorAll("[data-state]").forEach((control) => {
      control.value = app.state[control.dataset.state] ?? "";
    });
  }

  function renderError(message) {
    renderFilterChips([{ label: message, tone: "meta" }], 0, 0, "暂无数据");
    document.getElementById("source-chip-bar").innerHTML = "";
    window.__YTB_RANKING_VISIBLE_ITEMS__ = [];
    window.__YTB_RANKING_TOTAL_ITEM_COUNT__ = 0;
    document.getElementById("ranking-sections").innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  }

  function render() {
    if (!app.data) return;

    const group = getCurrentGroup();
    const allItems = group.items || [];
    const allVisibleItems = sortItems(allItems.filter(matchesFilters)).map((item, index) => ({
      ...item,
      visibleRank: index + 1,
    }));

    app.visibleItems = allVisibleItems;
    // Expose the full filtered item set so the control layer can summarize from data
    // instead of the progressively rendered card DOM.
    window.__YTB_RANKING_VISIBLE_ITEMS__ = allVisibleItems;
    window.__YTB_RANKING_TOTAL_ITEM_COUNT__ = allItems.length;
    renderSummary(group, allItems.length, allVisibleItems.length);
    renderSections(allVisibleItems);
  }

  function getCurrentGroup() {
    return (app.data && app.data.groups && app.data.groups[app.sourceGroup]) || {
      items: [],
      sources: [],
      updatedAt: app.data ? app.data.generatedAt : "",
    };
  }

  function matchesFilters(item) {
    const search = normalize(app.state.search).toLocaleLowerCase();
    if (search) {
      const haystack = normalize(
        item.searchableText || [item.title, item.channelName, item.videoId, item.watchUrl].join(" "),
      ).toLocaleLowerCase();
      if (!haystack.includes(search)) return false;
    }

    const blacklistTerms = getBlacklistTerms();
    if (blacklistTerms.length) {
      const blacklistHaystack = normalize([item.title, item.channelName].join(" ")).toLocaleLowerCase();
      if (blacklistTerms.some((term) => blacklistHaystack.includes(term))) return false;
    }

    const minSeconds = minutesToSeconds(app.state.minDurationMinutes);
    if (minSeconds != null) {
      if (item.durationSeconds == null) return false;
      if (minSeconds != null && item.durationSeconds < minSeconds) return false;
    }

    return true;
  }

  function sortItems(items) {
    const withIndex = items.map((item, index) => ({ item, index }));
    const collator = new Intl.Collator(["ja", "zh", "en"], { numeric: true, sensitivity: "base" });

    const compareNullableDesc = (field) => (a, b) => {
      const av = a.item[field];
      const bv = b.item[field];
      if (av == null && bv == null) return originalOrder(a, b);
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av || originalOrder(a, b);
    };

    const compareNullableAsc = (field) => (a, b) => {
      const av = a.item[field];
      const bv = b.item[field];
      if (av == null && bv == null) return originalOrder(a, b);
      if (av == null) return 1;
      if (bv == null) return -1;
      return av - bv || originalOrder(a, b);
    };

    const originalOrder = (a, b) =>
      (a.item.originalRank || a.item.rank || a.index) - (b.item.originalRank || b.item.rank || b.index) ||
      a.index - b.index;

    const order = app.state.sortOrder;
    withIndex.sort((a, b) => {
      if (order === "viewsDesc") return compareNullableDesc("viewCount")(a, b);
      if (order === "liveViewersDesc") return compareNullableDesc("liveViewerCount")(a, b);
      if (order === "publishedDesc") return compareNullableDesc("publishedTimestamp")(a, b);
      if (order === "durationDesc") return compareNullableDesc("durationSeconds")(a, b);
      if (order === "durationAsc") return compareNullableAsc("durationSeconds")(a, b);
      if (order === "titleAsc") return collator.compare(a.item.title || "", b.item.title || "") || originalOrder(a, b);
      if (order === "channelAsc") {
        return collator.compare(a.item.channelName || "", b.item.channelName || "") || originalOrder(a, b);
      }
      return originalOrder(a, b);
    });

    return withIndex.map((entry) => entry.item);
  }

  function renderSummary(group, originalCount, visibleCount) {
    const updatedAt = group.updatedAt || group.collectedAt || app.data.generatedAt || "";
    const updatedLabel = updatedAt ? new Date(updatedAt).toLocaleString() : "暂无数据";

    const activeChips = getActiveFilterChips();
    renderFilterChips(activeChips, visibleCount, originalCount, updatedLabel);
    renderSourceChips(group);
  }

  function renderFilterChips(activeChips, visibleCount, originalCount, updatedLabel) {
    const chipContainer = document.getElementById("active-filter-chips");
    const filterCount = document.getElementById("filter-count");
    const filterBrief = document.getElementById("filter-brief");
    if (!chipContainer || !filterCount || !filterBrief) return;

    const count = activeChips.length;
    filterCount.textContent = String(count);
    filterBrief.textContent = count ? activeChips.map((chip) => chip.label).join(" / ") : "默认原始顺序";

    const chips = [];

    if (originalCount > 0) {
      chips.push({ label: `${visibleCount}/${originalCount}`, tone: "count" });
    }

    if (updatedLabel && updatedLabel !== "暂无数据") {
      chips.push({ label: `更新 ${updatedLabel}`, tone: "meta" });
    }

    if (app.state.sortOrder !== "original") {
      chips.push({ label: SORT_LABELS[app.state.sortOrder] || SORT_LABELS.original, tone: "sort" });
    }

    activeChips.forEach((chip) => chips.push(chip));
    chipContainer.innerHTML = chips
      .map((chip) => `<span class="filter-chip ${chip.tone}">${escapeHtml(chip.label)}</span>`)
      .join("");
  }

  function renderSourceChips(group) {
    const container = document.getElementById("source-chip-bar");
    if (!container) return;

    container.innerHTML = KEYWORDS.map((keyword) => {
      const source = (group.sources || []).find((item) => item.keyword === keyword);
      if (!source) {
        return `
          <span class="source-chip muted">
            <strong>${keyword}</strong>
            <span>暂无来源数据</span>
          </span>
        `;
      }

      return `
        <a class="source-chip" href="${escapeAttribute(source.sourceUrl)}" target="_blank" rel="noopener">
          <strong>${keyword}</strong>
          ${renderSourceStatus(source)}
        </a>
      `;
    }).join("");
  }

  function renderSections(visibleItems) {
    const container = document.getElementById("ranking-sections");
    cancelPendingCardBatch();
    app.renderBatchToken += 1;
    const token = app.renderBatchToken;
    const shouldBatch = visibleItems.length > INITIAL_RENDER_LIMIT;
    const initialItems = shouldBatch ? visibleItems.slice(0, INITIAL_RENDER_LIMIT) : visibleItems;
    container.innerHTML = `
      <section class="ranking-section" aria-label="排行结果">
        <div class="cards">
          ${
            initialItems.length
              ? initialItems.map(renderCard).join("")
              : `<div class="empty-state">当前筛选下没有结果</div>`
          }
        </div>
      </section>
    `;

    if (shouldBatch) {
      const cards = container.querySelector(".cards");
      scheduleAppendCards(cards, visibleItems, initialItems.length, token);
    }
  }

  function cancelPendingCardBatch() {
    if (!app.renderBatchHandle) return;
    cancelCardBatch(app.renderBatchHandle);
    app.renderBatchHandle = 0;
  }

  function scheduleAppendCards(cards, visibleItems, startIndex, token) {
    let nextIndex = startIndex;
    const appendBatch = () => {
      app.renderBatchHandle = 0;
      if (token !== app.renderBatchToken || !cards || !cards.isConnected) return;
      const endIndex = Math.min(nextIndex + RENDER_BATCH_SIZE, visibleItems.length);
      const batchHtml = visibleItems
        .slice(nextIndex, endIndex)
        .map((item) => renderCard(item).replace('<article class="video-card"', '<article class="video-card" data-page-hidden="1"'))
        .join("");
      cards.insertAdjacentHTML("beforeend", batchHtml);
      nextIndex = endIndex;
      document.dispatchEvent(new CustomEvent("ytb-ranking-cards-appended", {
        detail: { rendered: nextIndex, total: visibleItems.length },
      }));
      if (nextIndex < visibleItems.length && token === app.renderBatchToken) {
        app.renderBatchHandle = scheduleCardBatch(appendBatch);
      }
    };
    app.renderBatchHandle = window.setTimeout(appendBatch, RENDER_BATCH_START_DELAY_MS);
  }

  function scheduleCardBatch(callback) {
    return window.setTimeout(callback, RENDER_BATCH_DELAY_MS);
  }

  function cancelCardBatch(handle) {
    window.clearTimeout(handle);
  }

  function renderSourceStatus(source) {
    return `
      <span class="badge ${source.reachedBottom ? "ok" : "muted"}">${source.reachedBottom ? "已到底" : "未到底"}</span>
      <span class="badge ${source.truncatedByLimit ? "warn" : "ok"}">${source.truncatedByLimit ? "500 上限截断" : "未截断"}</span>
      <span class="badge muted">${source.itemCount || 0} 条</span>
    `;
  }

  function renderCard(item) {
    const statusType = item.statusType || "unknown";
    const metrics = [
      item.viewText || (item.viewCount != null ? `${formatNumber(item.viewCount)} 播放` : ""),
      item.liveViewerText || (item.liveViewerCount != null ? `${formatNumber(item.liveViewerCount)} 观看中` : ""),
      item.publishedText,
      item.durationText,
    ].filter(Boolean);

    return `
      <article class="video-card" data-status="${escapeAttribute(statusType)}">
        <a class="thumbnail" href="${escapeAttribute(item.watchUrl)}" target="_blank" rel="noopener">
          ${
            item.thumbnailUrl
              ? `<img src="${escapeAttribute(item.thumbnailUrl)}" alt="" loading="lazy">`
              : `<span>No thumbnail</span>`
          }
          <span class="corner-badge corner-rank">#${item.visibleRank}</span>
          <span class="corner-badge corner-keyword">${escapeHtml(item.keyword || item.group || "")}</span>
        </a>
        <div class="card-body">
          <div class="rank-line">
            <strong>#${item.visibleRank}</strong>
            <span>原始 #${item.originalRank || item.rank}</span>
            <span class="keyword-pill">${escapeHtml(item.keyword || item.group || "")}</span>
            <span class="status-pill ${escapeAttribute(statusType)}">${escapeHtml(STATUS_LABELS[statusType] || "未知")}</span>
          </div>
          <h3><a href="${escapeAttribute(item.watchUrl)}" target="_blank" rel="noopener">${escapeHtml(item.title || "无标题")}</a></h3>
          <p class="channel">${escapeHtml(item.channelName || "未知频道")}</p>
          <div class="meta-list">${metrics.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div>
          <div class="id-line">
            <span>${escapeHtml(item.videoId || "")}</span>
            <a href="${escapeAttribute(item.watchUrl)}" target="_blank" rel="noopener">YouTube</a>
          </div>
        </div>
      </article>
    `;
  }

  function describeFilters() {
    return getActiveFilterChips()
      .map((chip) => chip.label)
      .join("；");
  }

  function getActiveFilterChips() {
    const parts = [];
    if (app.state.search) parts.push({ label: `白名单: ${app.state.search}`, tone: "allow" });
    const blacklistTerms = getBlacklistTerms();
    if (blacklistTerms.length) parts.push({ label: `黑名单: ${blacklistTerms.join("、")}`, tone: "deny" });
    if (app.state.minDurationMinutes) parts.push({ label: `最短: ${app.state.minDurationMinutes} 分钟`, tone: "filter" });
    return parts;
  }

  function getBlacklistTerms() {
    return String(app.state.blacklist || "")
      .replace(/\u00a0/g, " ")
      .split(/\r?\n/)
      .map((line) => normalize(line).toLocaleLowerCase())
      .filter(Boolean);
  }

  async function copyTsv() {
    const fields = [
      "visibleRank",
      "originalRank",
      "sourceGroup",
      "keyword",
      "statusType",
      "title",
      "channelName",
      "videoId",
      "watchUrl",
      "viewText",
      "viewCount",
      "liveViewerText",
      "liveViewerCount",
      "publishedText",
      "durationText",
      "durationSeconds",
      "sourceUrl",
    ];
    const lines = [fields.join("\t")].concat(
      app.visibleItems.map((item) => fields.map((field) => tsvCell(item[field])).join("\t")),
    );
    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    showToast(`已复制 ${app.visibleItems.length} 条 TSV`);
  }

  function downloadJson() {
    const payload = {
      exportedAt: new Date().toISOString(),
      sourceGroup: app.sourceGroup,
      filters: { ...app.state },
      count: app.visibleItems.length,
      items: app.visibleItems,
    };
    downloadBlob(
      JSON.stringify(payload, null, 2),
      `youtube-ranking-${app.sourceGroup}-${dateStamp()}.json`,
      "application/json",
    );
    showToast(`已下载 ${app.visibleItems.length} 条 JSON`);
  }

  function exportPng() {
    const items = app.visibleItems;
    const page = PAGE_CONFIG[app.sourceGroup] || PAGE_CONFIG.live;
    const filters = describeFilters() || "无";
    const updatedAt = getCurrentGroup().updatedAt || app.data.generatedAt || "";
    const sourceLines = (getCurrentGroup().sources || []).map((source) => {
      const bottom = source.reachedBottom ? "已到底" : "未到底";
      const truncated = source.truncatedByLimit ? "500 上限截断" : "未截断";
      return `${source.keyword}: ${source.itemCount || 0} 条 / ${bottom} / ${truncated}`;
    });

    const cardWidth = 360;
    const gap = 16;
    const padding = 32;
    const rowHeight = 150;
    const headerHeight = 220 + sourceLines.length * 24;
    const maxRowsPerColumn = 170;
    const columns = Math.max(1, Math.min(6, Math.ceil(Math.max(items.length, 1) / maxRowsPerColumn)));
    const rows = Math.max(1, Math.ceil(Math.max(items.length, 1) / columns));
    const width = padding * 2 + columns * cardWidth + (columns - 1) * gap;
    const height = headerHeight + rows * (rowHeight + gap) + padding;
    const dpr = height > 16000 ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#f6f8fb";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#121826";
    ctx.font = "700 30px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(page.heading, padding, 48);
    ctx.font = "15px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "#526070";
    ctx.fillText(`最后更新时间：${updatedAt ? new Date(updatedAt).toLocaleString() : "暂无"}`, padding, 78);
    ctx.fillText(`当前命中：${items.length} 条`, padding, 102);
    wrapCanvasText(ctx, `筛选条件：${filters}`, padding, 126, width - padding * 2, 20, 3);

    let sourceY = 190;
    ctx.fillStyle = "#334155";
    sourceLines.forEach((line) => {
      ctx.fillText(line, padding, sourceY);
      sourceY += 24;
    });

    if (!items.length) {
      ctx.font = "600 22px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = "#64748b";
      ctx.fillText("当前视图没有结果", padding, sourceY + 32);
      finishCanvasDownload(canvas);
      return;
    }

    ctx.font = "14px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    items.forEach((item, index) => {
      const column = Math.floor(index / rows);
      const row = index % rows;
      const x = padding + column * (cardWidth + gap);
      const y = headerHeight + row * (rowHeight + gap);
      drawExportCard(ctx, item, x, y, cardWidth, rowHeight);
    });

    finishCanvasDownload(canvas);
  }

  function drawExportCard(ctx, item, x, y, width, height) {
    roundRect(ctx, x, y, width, height, 10);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#d9e2ec";
    ctx.stroke();

    ctx.fillStyle = "#e2e8f0";
    roundRect(ctx, x + 12, y + 14, 82, 62, 8);
    ctx.fill();
    ctx.fillStyle = "#334155";
    ctx.font = "700 18px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(`#${item.visibleRank}`, x + 24, y + 50);

    ctx.fillStyle = "#0f172a";
    ctx.font = "700 14px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    wrapCanvasText(ctx, item.title || "无标题", x + 108, y + 28, width - 122, 18, 2);

    ctx.fillStyle = "#475569";
    ctx.font = "13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(truncateCanvasText(ctx, item.channelName || "未知频道", width - 122), x + 108, y + 78);

    ctx.fillStyle = "#64748b";
    const line1 = [
      `原始 #${item.originalRank || item.rank}`,
      STATUS_LABELS[item.statusType] || "未知",
      item.viewText || item.liveViewerText || "",
    ]
      .filter(Boolean)
      .join(" / ");
    ctx.fillText(truncateCanvasText(ctx, line1, width - 28), x + 14, y + 110);

    const line2 = [item.publishedText, item.durationText, item.videoId].filter(Boolean).join(" / ");
    ctx.fillText(truncateCanvasText(ctx, line2, width - 28), x + 14, y + 132);
  }

  function finishCanvasDownload(canvas) {
    canvas.toBlob((blob) => {
      if (!blob) {
        const dataUrl = canvas.toDataURL("image/png");
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = `youtube-ranking-${app.sourceGroup}-${dateStamp()}.png`;
        link.click();
        showToast("已导出 PNG");
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `youtube-ranking-${app.sourceGroup}-${dateStamp()}.png`;
      link.click();
      URL.revokeObjectURL(url);
      showToast("已导出 PNG");
    }, "image/png");
  }

  function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    const value = String(text || "");
    const lines = [];
    let current = "";
    for (const char of value) {
      const next = current + char;
      if (ctx.measureText(next).width > maxWidth && current) {
        lines.push(current);
        current = char;
        if (lines.length === maxLines - 1) break;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);

    lines.slice(0, maxLines).forEach((line, index) => {
      const suffix = index === maxLines - 1 && lines.length > maxLines ? "..." : "";
      ctx.fillText(line + suffix, x, y + index * lineHeight);
    });
  }

  function truncateCanvasText(ctx, text, maxWidth) {
    const value = String(text || "");
    if (ctx.measureText(value).width <= maxWidth) return value;
    let output = value;
    while (output.length > 1 && ctx.measureText(`${output}...`).width > maxWidth) {
      output = output.slice(0, -1);
    }
    return `${output}...`;
  }

  function roundRect(ctx, x, y, width, height, radius) {
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, radius);
      return;
    }
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
  }

  function minutesToSeconds(value) {
    if (value === "" || value == null) return null;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed * 60 : null;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat().format(value);
  }

  function dateStamp() {
    return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  }

  function normalize(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tsvCell(value) {
    return String(value == null ? "" : value).replace(/\t/g, " ").replace(/\r?\n/g, " ");
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }
})();
