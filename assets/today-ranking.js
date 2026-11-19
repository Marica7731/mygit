(() => {
  "use strict";

  const PAGE_SIZE = 24;
  const TODAY_URL = "data/today-view.json";
  const SNAPSHOT_INDEX_URL = "data/today-history.json";
  const SNAPSHOT_ROOT = "https://raw.githubusercontent.com/Marica7731/mygit/main/data/today-snapshots/";
  const SNAPSHOT_ID = /^\d{8}T\d{6}Z$/;
  const STATE_KEY = "ytb-ranking-state-v1:today";
  const BLACKLIST_KEY = "ytb-ranking-blacklist-v1";
  const VIEWS_KEY = "ytb-ranking-min-views-v1:today";
  const timeFormat = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "short", hourCycle: "h23",
  });
  const numberFormat = new Intl.NumberFormat("zh-CN");
  const collator = new Intl.Collator(["ja", "zh", "en"], { numeric: true, sensitivity: "base" });

  const byId = (id) => document.getElementById(id);
  const form = byId("ranking-form");
  const cards = byId("ranking-sections");
  const search = byId("ranking-search");
  const sort = byId("ranking-sort");
  const minViews = byId("min-views-filter");
  const minDuration = byId("min-duration");
  const time = byId("time-filter");
  const blacklist = byId("ranking-blacklist");
  const dialog = byId("snapshot-dialog");
  const snapshotDay = byId("snapshot-day");
  const snapshotTime = byId("snapshot-time");
  const sortFields = {
    views: "viewCount", published: "publishedTimestamp", duration: "durationSeconds",
    title: "title", channel: "channelName", liveViewers: "liveMetric",
  };

  const blocked = createBlocklist();
  const allowOtherTitles = readStorage("ytb-ranking-default-title-filter-disabled-v1:today") === "1";
  let ranking = null;
  let visible = [];
  let page = 1;
  let rankingRequest;
  let latestRequested = "";
  let snapshotDays;
  let catalogRequest;
  let inputTimer;
  let noticeTimer;
  let exportBusy = false;

  function readStorage(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function writeStorage(key, value) {
    try { localStorage.setItem(key, value); } catch { /* Controls still work in private mode. */ }
  }

  function savedState() {
    try { return JSON.parse(readStorage(STATE_KEY)) || {}; } catch { return {}; }
  }

  function normalized(value) {
    return String(value ?? "").normalize("NFKC").trim().toLowerCase();
  }

  function youtubeUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(url.hostname)) return "";
      return url.href;
    } catch { return ""; }
  }

  function channelKey(value) {
    const url = youtubeUrl(value);
    if (!url) return "";
    const [section, id] = new URL(url).pathname.split("/").filter(Boolean);
    if (!section) return "";
    if (section.startsWith("@")) return normalized(section);
    if (section === "channel" && id) return id;
    return normalized("/" + [section, id].filter(Boolean).join("/"));
  }

  function createBlocklist() {
    const ids = new Set();
    const handles = new Set();
    const urls = new Set();
    const names = new Set();
    const titles = new Set();
    for (const entry of window.BlockedVtuberChannels?.entries || []) {
      if (entry.status !== "blocked") continue;
      for (const id of entry.channelIds || []) ids.add(id);
      for (const handle of entry.handles || []) handles.add("@" + normalized(handle).replace(/^@/, ""));
      for (const url of entry.channelUrls || []) urls.add(channelKey(url));
      for (const name of [entry.name, ...(entry.aliases || [])]) names.add(normalized(name));
      for (const alias of entry.titleAliases || []) titles.add(normalized(alias));
    }
    for (const group of [handles, urls, names, titles]) group.delete("");
    const titleAliases = [...titles];
    const legacy = ["そびたんねる", "Piero Soubi", "Unmanned Japanese", "niY6C3ag-BY", "きよき一瓢"].map(normalized);
    return (item) => {
      const keys = [item.channelUrl, item.authorUrl, item.ownerUrl].map(channelKey);
      const itemHandles = [item.channelHandle, item.handle, item.ownerHandle].filter(Boolean)
        .map((handle) => "@" + normalized(handle).replace(/^@/, ""));
      const title = normalized(item.title);
      const text = normalized([item.channelName, item.channelId, item.channelUrl, item.title, item.videoId, item.watchUrl, item.searchableText].join(" "));
      return [item.channelId, item.authorChannelId, item.ownerChannelId].some((id) => ids.has(id)) ||
        keys.some((url) => urls.has(url) || handles.has(url)) ||
        itemHandles.some((handle) => handles.has(handle)) ||
        [item.channelName, item.ownerText, item.longBylineText, item.shortBylineText].some((name) => names.has(normalized(name))) ||
        titleAliases.some((alias) => title.includes(alias)) ||
        legacy.some((alias) => text.includes(alias));
    };
  }

  function compactNumber(value) {
    const match = normalized(value).replace(/,/g, "").match(/^(\d+(?:\.\d+)?)\s*([万萬亿億千kmb])?$/);
    if (!match) return null;
    const units = { 万: 1e4, 萬: 1e4, 亿: 1e8, 億: 1e8, 千: 1e3, k: 1e3, m: 1e6, b: 1e9 };
    const result = Number(match[1]) * (units[match[2]] || 1);
    return Number.isFinite(result) ? Math.round(result) : null;
  }

  function prepareRanking(payload, snapshot) {
    const group = payload.groups?.today;
    const timestamp = Date.parse(group?.updatedAt || group?.collectedAt || payload.generatedAt);
    if (!Array.isArray(group?.items) || !Number.isFinite(timestamp) || (snapshot && payload.snapshotId !== snapshot)) {
      throw new Error("今日榜数据格式不正确");
    }
    const items = group.items.filter((item) => {
      return item && ["歌枠", "弾き語り"].includes(item.keyword || item.group) && !blocked(item) &&
        (allowOtherTitles || (/歌枠|弾き語/u.test(item.title) && !/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u.test(item.title)));
    }).map((item, index) => {
      const parsed = compactNumber(normalized(item.viewText).match(/([\d,.]+(?:\s*[万萬亿億千kmb])?)\s*(?:回視聴|視聴回数|views?|次观看|次觀看|播放)/u)?.[1]);
      const current = Number(item.viewCount) || 0;
      const corrected = parsed != null && (current <= 0 ||
        (Math.abs(current - parsed) >= 1000 && Math.max(current, parsed) >= 10 * Math.max(1, Math.min(current, parsed))));
      const watchUrl = youtubeUrl(item.watchUrl);
      const id = /^[A-Za-z0-9_-]{11}$/.test(item.videoId) ? item.videoId : "";
      const channel = normalized([item.title, item.channelName].join(" "));
      const isLive = ["live", "upcoming"].includes(item.statusType) ||
        (item.liveViewerCount != null && /同時視聴|視聴中|watching/i.test(item.liveViewerText || ""));
      return {
        ...item, id, isLive, keyword: item.keyword || item.group, viewCount: corrected ? parsed : item.viewCount,
        liveMetric: item.subscriberCount ?? item.liveViewerCount ?? item.likeCount,
        rank: item.originalRank || item.rank || index + 1, index, channel,
        searchText: normalized([item.title, item.channelName, item.videoId, item.watchUrl].join(" ")),
        watchUrl: watchUrl || (id ? "https://www.youtube.com/watch?v=" + id : ""),
        channelUrl: youtubeUrl(item.channelUrl || item.authorUrl || item.ownerUrl),
      };
    });
    return { timestamp, items, snapshot };
  }

  async function readJson(url, signal, cache = "no-cache") {
    const response = await fetch(url, { signal, cache });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  }

  function snapshotFromLocation() {
    return new URLSearchParams(location.search).get("snapshot") || "";
  }

  function writeSnapshotLocation(snapshot) {
    const url = new URL(location.href);
    if (snapshot) url.searchParams.set("snapshot", snapshot);
    else url.searchParams.delete("snapshot");
    if (url.href !== location.href) history.pushState(null, "", url);
  }

  async function loadRanking(snapshot, updateUrl = false) {
    latestRequested = snapshot;
    rankingRequest?.abort();
    const request = new AbortController();
    rankingRequest = request;
    byId("retry-ranking").hidden = true;
    byId("clear-ranking").hidden = true;
    cards.setAttribute("aria-busy", "true");
    byId("ranking-status").textContent = snapshot ? "正在加载历史快照…" : "正在加载今日榜…";

    try {
      if (snapshot && !SNAPSHOT_ID.test(snapshot)) throw new Error("快照编号无效");
      const payload = await readJson(snapshot ? SNAPSHOT_ROOT + snapshot + ".json" : TODAY_URL,
        AbortSignal.any([request.signal, AbortSignal.timeout(15000)]), snapshot ? "default" : "no-cache");
      if (rankingRequest !== request) return;
      ranking = prepareRanking(payload, snapshot);
      if (updateUrl) writeSnapshotLocation(snapshot);
      const updated = byId("ranking-updated");
      updated.dateTime = new Date(ranking.timestamp).toISOString();
      updated.textContent = (snapshot ? "快照 " : "更新 ") + timeFormat.format(ranking.timestamp) + "（台北）";
      byId("latest-ranking").textContent = snapshot ? "返回最新" : "刷新榜单";
      byId("latest-ranking").hidden = false;
      page = 1;
      render();
    } catch (error) {
      if (rankingRequest !== request) return;
      byId("ranking-status").textContent = (snapshot ? "历史快照加载失败" : "今日榜加载失败") + "（" +
        (error.name === "TimeoutError" ? "请求超时" : error.message) + "）" +
        (ranking ? "，仍显示上一次加载的榜单。" : "。");
      byId("retry-ranking").hidden = false;
      byId("latest-ranking").textContent = snapshot ? "返回最新" : "刷新榜单";
      byId("latest-ranking").hidden = false;
    } finally {
      if (rankingRequest === request) {
        rankingRequest = null;
        cards.removeAttribute("aria-busy");
      }
    }
  }

  function calculateItems() {
    const category = form.elements.keyword.value;
    const query = normalized(search.value);
    const terms = blacklist.value.split(/\r?\n/).map(normalized).filter(Boolean);
    const views = compactNumber(minViews.value);
    const seconds = Math.max(0, Number(minDuration.value)) * 60;
    const cutoff = time.value === "all" ? null : ranking.timestamp - Number(time.value) * 3600000;
    const order = sort.value;
    const field = sortFields[order.replace(/(?:Asc|Desc)$/, "")];
    const direction = order.endsWith("Desc") ? -1 : 1;
    const results = ranking.items.filter((item) => {
      return (category === "all" || item.keyword === category) &&
        (!query || item.searchText.includes(query)) &&
        (!terms.length || !terms.some((term) => item.channel.includes(term))) &&
        (views == null || (item.viewCount != null && item.viewCount >= views)) &&
        (!seconds || item.durationSeconds >= seconds) &&
        (cutoff == null || item.publishedTimestamp >= cutoff) &&
        (!order.startsWith("views") || !item.isLive) &&
        (!order.startsWith("liveViewers") || item.isLive);
    });
    return results.sort((a, b) => {
      const fallback = a.rank - b.rank || a.index - b.index;
      if (!field) return fallback;
      const first = a[field];
      const second = b[field];
      if (first == null || second == null) return (first == null) - (second == null) || fallback;
      return (typeof first === "string" ? collator.compare(first, second) : first - second) * direction || fallback;
    });
  }

  function render() {
    if (!ranking) return;
    visible = calculateItems();
    const songCount = visible.reduce((total, item) => total + Number(item.keyword === "歌枠"), 0);
    const filtered = ranking.items.length - visible.length;
    byId("source-chip-bar").textContent = "歌枠 / 弾き語り" + (filtered ? " / 过滤" : "") + " = " +
      [songCount, visible.length - songCount, ...(filtered ? [filtered] : [])].join(" / ");
    window.__YTB_RANKING_TOTAL_ITEM_COUNT__ = ranking.items.length;
    window.__YTB_RANKING_VISIBLE_ITEMS__ = visible;
    if (byId("retry-ranking").hidden) {
      byId("ranking-status").textContent = visible.length ? "" : "当前条件下没有结果。";
    }
    byId("clear-ranking").hidden = visible.length !== 0 || !filtered;
    renderPage();
  }

  function renderPage() {
    const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
    page = Math.min(page, pageCount);
    const start = (page - 1) * PAGE_SIZE;
    const fragment = document.createDocumentFragment();
    visible.slice(start, start + PAGE_SIZE).forEach((item, index) => {
      fragment.append(makeCard(item, start + index + 1, index));
    });
    cards.replaceChildren(fragment);
    for (const id of ["pagination-top", "pagination-bottom"]) {
      const nav = byId(id);
      nav.hidden = pageCount <= 1;
      if (nav.hidden) continue;
      if (!nav.firstElementChild) {
        nav.innerHTML = '<button type="button" data-step="-1">上一页</button>' +
          '<select class="ranking-pagination-text" aria-label="跳到页码"></select>' +
          '<button type="button" data-step="1">下一页</button>';
        nav.children[1].addEventListener("change", (event) => {
          page = Number(event.target.value);
          renderPage();
          if (id === "pagination-bottom") focusResults();
        });
      }
      const picker = nav.children[1];
      if (picker.options.length !== pageCount) {
        picker.replaceChildren(...Array.from({ length: pageCount }, (_, index) => {
          return new Option((index + 1) + " / " + pageCount, index + 1);
        }));
      }
      nav.firstElementChild.disabled = page === 1;
      nav.lastElementChild.disabled = page === pageCount;
      picker.value = page;
    }
  }

  function focusResults() {
    cards.focus({ preventScroll: true });
    cards.scrollIntoView({ block: "start" });
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function link(className, text, href) {
    const node = element(href ? "a" : "span", className, text);
    if (href) {
      node.href = href;
      node.target = "_blank";
      node.rel = "noopener";
    }
    return node;
  }

  function imageCandidates(item) {
    const url = item.id ? "https://i.ytimg.com/vi/" + item.id + "/" : "";
    if (url) return [url + "mqdefault.jpg", url + "hqdefault.jpg"];
    try {
      const original = new URL(item.thumbnailUrl);
      if (original.protocol === "https:" && /(^|\.)ytimg\.com$/i.test(original.hostname)) return [original.href];
    } catch { /* The thumbnail area remains usable as a video link. */ }
    return [];
  }

  function durationLabel(value) {
    const seconds = Math.floor(value);
    if (!seconds || seconds < 0) return "";
    const minutes = Math.floor(seconds / 60);
    const suffix = String(seconds % 60).padStart(2, "0");
    return minutes < 60 ? minutes + ":" + suffix :
      Math.floor(minutes / 60) + ":" + String(minutes % 60).padStart(2, "0") + ":" + suffix;
  }

  function makeCard(item, rank, index) {
    const card = element("article", "video-card");
    card.dataset.videoId = item.id;
    const thumbnail = link("thumbnail", null, item.watchUrl);
    if (item.watchUrl) thumbnail.setAttribute("aria-label", "在 YouTube 打开 " + item.title);
    const candidates = imageCandidates(item);
    if (candidates.length) {
      const image = element("img");
      image.width = 320;
      image.height = 180;
      image.alt = "";
      image.decoding = "async";
      image.loading = index < 4 ? "eager" : "lazy";
      image.referrerPolicy = "no-referrer";
      if (index === 0) image.fetchPriority = "high";
      let next = 1;
      const fallback = () => {
        if (next < candidates.length) image.src = candidates[next++];
        else image.remove();
      };
      image.onerror = fallback;
      image.onload = () => { if (image.naturalWidth < 160) fallback(); };
      image.src = candidates[0];
      thumbnail.append(image);
    }
    const duration = durationLabel(item.durationSeconds);
    if (duration) thumbnail.append(element("span", "cover-label", duration));
    const body = element("div", "card-body");
    const title = element("h2", "card-title");
    title.append(link("", item.title || "无标题", item.watchUrl));
    const channel = element("p", "channel");
    channel.append(link("", item.channelName || "未知频道", item.channelUrl));
    const metrics = element("p", "metrics");
    if (item.isLive) metrics.append(element("span", "", item.statusType === "upcoming" ? "预约" : "直播中"));
    if (item.viewCount != null) metrics.append(element("span", "", numberFormat.format(item.viewCount) + " 播放"));
    if (item.publishedTimestamp > 0) {
      const published = element("time", "", timeFormat.format(item.publishedTimestamp).slice(5));
      published.dateTime = new Date(item.publishedTimestamp).toISOString();
      published.title = "台北时间";
      metrics.append(published);
    }
    body.append(element("span", "card-rank", "#" + rank + " · " + item.keyword), title, channel, metrics);
    card.append(thumbnail, body);
    return card;
  }

  function resetAndRender() {
    clearTimeout(inputTimer);
    page = 1;
    if (!rankingRequest) render();
  }

  function persistFilters() {
    writeStorage(STATE_KEY, JSON.stringify({ sortOrder: sort.value, minDurationMinutes: minDuration.value }));
    writeStorage(BLACKLIST_KEY, blacklist.value);
    writeStorage(VIEWS_KEY, minViews.value);
  }

  async function loadCatalog() {
    if (snapshotDays || catalogRequest) return;
    const status = byId("snapshot-status");
    status.textContent = "正在加载历史日期…";
    byId("retry-snapshots").hidden = true;
    catalogRequest = readJson(SNAPSHOT_INDEX_URL, AbortSignal.timeout(12000));
    try {
      const data = await catalogRequest;
      if (!Array.isArray(data.snapshots)) throw new Error("快照索引格式不正确");
      const days = new Map();
      for (const id of data.snapshots) {
        if (!SNAPSHOT_ID.test(id)) continue;
        const date = Date.parse(id.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, "$1-$2-$3T$4:$5:$6Z"));
        if (!Number.isFinite(date)) continue;
        const [day, clock] = timeFormat.format(date).split(" ");
        if (!days.has(day)) days.set(day, []);
        days.get(day).push([id, clock]);
      }
      if (!days.size) {
        status.textContent = "暂无历史快照。";
        return;
      }
      snapshotDays = days;
      snapshotDay.replaceChildren(...Array.from(days.keys(), (day) => new Option(day, day)));
      byId("snapshot-fields").hidden = false;
      status.textContent = "";
    } catch (error) {
      status.textContent = "快照列表加载失败" + (error.name === "TimeoutError" ? "（请求超时）。" : "。");
      byId("retry-snapshots").hidden = false;
    } finally {
      catalogRequest = null;
    }
  }

  function showSnapshotOptions() {
    if (!snapshotDays) return;
    const current = ranking?.snapshot;
    const currentDay = current && Array.from(snapshotDays).find(([, entries]) => entries.some(([id]) => id === current))?.[0];
    snapshotDay.value = currentDay || snapshotDays.keys().next().value;
    renderSnapshotTimes();
    if (currentDay) snapshotTime.value = current;
  }

  function renderSnapshotTimes() {
    const times = snapshotDays.get(snapshotDay.value) || [];
    snapshotTime.replaceChildren(...times.map(([id, clock]) => new Option(clock, id)));
  }

  function notify(message) {
    clearTimeout(noticeTimer);
    byId("action-status").textContent = message;
    noticeTimer = setTimeout(() => { byId("action-status").textContent = ""; }, 4200);
  }

  function download(blob, extension, timestamp) {
    const url = URL.createObjectURL(blob);
    const anchor = element("a");
    anchor.href = url;
    anchor.download = "youtube-today-" + timeFormat.format(timestamp).slice(0, 10) + "." + extension;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportRow(item, index) {
    const { id, title, channelName, watchUrl, channelUrl, keyword, viewCount, publishedTimestamp, durationSeconds, statusType } = item;
    return { rank: index + 1, videoId: id, title, channelName, watchUrl, channelUrl, keyword, viewCount, publishedTimestamp, durationSeconds, statusType };
  }

  async function exportResults(type) {
    if (exportBusy) return;
    if (!visible.length) return notify("当前没有可导出的结果。");
    const items = visible;
    const exportTimestamp = ranking.timestamp;
    exportBusy = true;
    try {
      if (type === "png") {
        notify("正在生成当前页图片…");
        const start = (page - 1) * PAGE_SIZE;
        const { exportPng } = await import("./today-export.js?v=1");
        const blob = await exportPng(items.slice(start, start + PAGE_SIZE), start, timeFormat.format(exportTimestamp), imageCandidates);
        download(blob, "png", exportTimestamp);
      } else {
        const rows = items.map(exportRow);
        if (type === "json") {
          download(new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }), "json", exportTimestamp);
        } else {
          const keys = Object.keys(rows[0]);
          const cell = (value) => {
            const text = String(value ?? "").replace(/[\r\n\t]/g, " ");
            return /^[=+\-@]/.test(text) ? "'" + text : text;
          };
          await navigator.clipboard.writeText([keys.join("\t"), ...rows.map((row) => keys.map((key) => cell(row[key])).join("\t"))].join("\n"));
        }
      }
      notify(type === "tsv" ? "已复制 TSV。" : "已生成下载。");
    } catch (error) {
      notify("导出失败（" + error.message + "）。");
    } finally {
      exportBusy = false;
    }
  }

  const stored = savedState();
  if (Array.from(sort.options).some((option) => option.value === stored.sortOrder)) sort.value = stored.sortOrder;
  minDuration.value = stored.minDurationMinutes || "";
  minViews.value = readStorage(VIEWS_KEY) || "";
  blacklist.value = readStorage(BLACKLIST_KEY) || stored.blacklist || "";
  document.body.dataset.layoutMode = "auto";

  form.addEventListener("submit", (event) => { event.preventDefault(); resetAndRender(); });
  form.addEventListener("input", (event) => {
    if (event.isComposing || !event.target.matches("input:not([type=radio]), textarea")) return;
    clearTimeout(inputTimer);
    inputTimer = setTimeout(() => { persistFilters(); resetAndRender(); }, 100);
  });
  search.addEventListener("compositionend", resetAndRender);
  form.addEventListener("change", (event) => {
    if (event.target.matches("select, input[type=radio]")) {
      persistFilters();
      resetAndRender();
    }
  });
  form.addEventListener("reset", () => {
    queueMicrotask(() => { persistFilters(); resetAndRender(); });
  });
  form.addEventListener("click", (event) => {
    const control = event.target.closest("[data-export]");
    if (control) {
      const menu = byId("export-menu");
      menu.open = false;
      menu.firstElementChild.focus();
      exportResults(control.dataset.export);
    }
  });
  document.addEventListener("click", (event) => {
    for (const menu of form.querySelectorAll("details[open]")) {
      if (!menu.contains(event.target)) menu.open = false;
    }
    const button = event.target.closest("[data-step]");
    if (!button || button.disabled) return;
    page += Number(button.dataset.step);
    renderPage();
    if (button.closest("#pagination-bottom")) {
      focusResults();
    } else if (button.disabled) {
      byId("pagination-top").querySelector("button:not(:disabled)")?.focus();
    }
  });
  form.addEventListener("keydown", (event) => {
    const menu = event.target.closest("details[open]");
    if (menu && event.key === "Escape") {
      menu.open = false;
      menu.firstElementChild.focus();
    }
  });
  byId("clear-ranking").onclick = () => form.reset();
  byId("retry-ranking").onclick = () => loadRanking(latestRequested, true);
  byId("latest-ranking").onclick = () => loadRanking("", true);
  byId("open-snapshots").onclick = async () => {
    dialog.showModal();
    await loadCatalog();
    showSnapshotOptions();
  };
  byId("retry-snapshots").onclick = async () => {
    await loadCatalog();
    showSnapshotOptions();
  };
  snapshotDay.onchange = renderSnapshotTimes;
  byId("apply-snapshot").onclick = () => {
    if (!snapshotTime.value) return;
    dialog.close();
    loadRanking(snapshotTime.value, true);
  };
  window.addEventListener("popstate", () => {
    const snapshot = snapshotFromLocation();
    if (ranking?.snapshot !== snapshot || rankingRequest) loadRanking(snapshot);
  });
  loadRanking(snapshotFromLocation());
})();
