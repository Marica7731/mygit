(function () {
  let generatedAt = null;

  ready(() => {
    installStyle();
    applyUiFixes();
    fetch("data/youtube-ranking.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        generatedAt = data?.generatedAt ? new Date(data.generatedAt) : null;
        applyUiFixes();
      })
      .catch(() => {});
    [300, 900, 1800, 3500, 6000].forEach((delay) => setTimeout(applyUiFixes, delay));
  });

  function applyUiFixes() {
    compactToolbarLabels();
    hideEmptyAvatars();
  }

  function compactToolbarLabels() {
    const meta = document.querySelector(".filter-chip.meta");
    if (meta) {
      const date = generatedAt || parseUpdateDate(meta.textContent);
      if (date && Number.isFinite(date.getTime())) {
        meta.textContent = `更新 ${formatShortDate(date)}`;
        meta.title = `最后更新 ${formatFullDate(date)}`;
      }
    }

    document.querySelectorAll(".filter-chip.sort").forEach((chip) => {
      const text = clean(chip.textContent);
      const next = {
        "直播观看人数降序": "粉丝降序",
        "直播观看人数升序": "粉丝升序",
        "播放量降序": "播放降序",
        "播放量升序": "播放升序",
        "发布时间从新到旧": "新到旧",
        "发布时间从旧到新": "旧到新",
      }[text];
      if (next) chip.textContent = next;
    });
  }

  function hideEmptyAvatars() {
    document.querySelectorAll(".channel-avatar").forEach((avatar) => {
      const img = avatar.querySelector("img[src]");
      const hasRealImage = Boolean(img && img.getAttribute("src") && (!img.complete || img.naturalWidth > 8));
      avatar.hidden = !hasRealImage;
      avatar.classList.toggle("is-empty-avatar", !hasRealImage);
    });
  }

  function parseUpdateDate(text) {
    const raw = clean(text).replace(/^更新\s*/, "");
    const parsed = raw ? new Date(raw) : null;
    return parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  function formatShortDate(date) {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${month}/${day} ${hour}:${minute}`;
  }

  function formatFullDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    const second = String(date.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  }

  function installStyle() {
    let style = document.getElementById("hb-chip-compact-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "hb-chip-compact-style";
      document.head.append(style);
    }
    style.textContent = `
      .thumbnail .hb-thumb-chip,
      .thumbnail .hotfix-thumb-badge {
        inset: auto !important;
        width: auto !important;
        height: auto !important;
        min-width: 0 !important;
        min-height: 0 !important;
        max-width: calc(50% - 10px) !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        padding: 2px 5px !important;
        border-radius: 5px !important;
        background: rgba(15, 23, 42, 0.72) !important;
        color: #fff !important;
        font-size: 10px !important;
        font-weight: 850 !important;
        line-height: 1.1 !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        pointer-events: none !important;
      }
      .thumbnail .hb-keyword,
      .thumbnail .hotfix-thumb-keyword {
        left: 5px !important;
        right: auto !important;
        bottom: 5px !important;
        top: auto !important;
      }
      .thumbnail .hb-duration,
      .thumbnail .hotfix-thumb-duration {
        right: 5px !important;
        left: auto !important;
        bottom: 5px !important;
        top: auto !important;
      }
      .active-filter-chips .filter-chip.meta,
      .active-filter-chips .filter-chip.sort {
        flex: 0 0 auto !important;
        width: auto !important;
        max-width: none !important;
        min-width: max-content !important;
        overflow: visible !important;
        text-overflow: clip !important;
        white-space: nowrap !important;
      }
      .channel-avatar.is-empty-avatar,
      .channel-avatar[hidden] {
        display: none !important;
      }
      .channel-metric-row {
        grid-template-columns: minmax(0, 1fr) !important;
      }
      .channel-metric-row.has-avatar:has(.channel-avatar:not([hidden])) {
        grid-template-columns: 23px minmax(0, 1fr) !important;
      }
      .hb-meta {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
      }
    `;
  }

  function ready(fn) {
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn();
  }

  function clean(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }
})();
