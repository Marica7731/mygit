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
    scrubCardNoise();
    normalizeMetaRows();
    hideEmptyAvatars();
  }

  function compactToolbarLabels() {
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

  function scrubCardNoise() {
    document
      .querySelectorAll(".original-rank,.rank-line .rank-metric,.hotfix-rank-metric,.meta-list,.id-line,.status-pill.video")
      .forEach((node) => node.remove());
  }

  function normalizeMetaRows() {
    document.querySelectorAll(".video-card").forEach((card) => {
      const meta = card.querySelector(".hb-meta");
      if (!meta) return;
      const title = card.querySelector("h3");
      const channel = card.querySelector(".channel");
      if (title && meta.previousElementSibling !== title) title.insertAdjacentElement("afterend", meta);
      const text = localizeTimeText(meta.textContent);
      if (text && meta.textContent !== text) meta.textContent = text;
      meta.hidden = !text;
      if (channel) channel.classList.add("hb-channel");
    });
  }

  function localizeTimeText(value) {
    return clean(value)
      .replace(/(\d+(?:\.\d+)?)\s*時間前(?:\s*に配信済み)?/g, "$1小时前")
      .replace(/(\d+(?:\.\d+)?)\s*分前(?:\s*に配信済み)?/g, "$1分钟前")
      .replace(/(\d+(?:\.\d+)?)\s*日前(?:\s*に配信済み)?/g, "$1天前")
      .replace(/(\d+(?:\.\d+)?)\s*週間前(?:\s*に配信済み)?/g, "$1周前")
      .replace(/(\d+(?:\.\d+)?)\s*(?:か月|ヶ月)前(?:\s*に配信済み)?/g, "$1个月前")
      .replace(/(\d+(?:\.\d+)?)\s*年前(?:\s*に配信済み)?/g, "$1年前")
      .replace(/\s*に配信済み/g, "")
      .replace(/\s*·\s*/g, " · ");
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
        padding: 0 1px !important;
        border: 0 !important;
        border-radius: 0 !important;
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
        box-shadow: none !important;
        filter: none !important;
        color: #fff !important;
        font-size: 10px !important;
        font-weight: 950 !important;
        line-height: 1.08 !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        pointer-events: none !important;
        text-shadow:
          0 1px 2px rgba(15, 23, 42, 0.78),
          0 0 2px rgba(15, 23, 42, 0.62) !important;
      }
      .thumbnail .hb-keyword,
      .thumbnail .hotfix-thumb-keyword {
        left: 5px !important;
        right: auto !important;
        bottom: 5px !important;
        top: auto !important;
        color: #1f6792 !important;
        text-shadow:
          0 1px 0 rgba(255, 255, 255, 0.95),
          1px 0 0 rgba(255, 255, 255, 0.95),
          -1px 0 0 rgba(255, 255, 255, 0.95),
          0 -1px 0 rgba(255, 255, 255, 0.95),
          0 1px 2px rgba(15, 23, 42, 0.3) !important;
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
        display: block !important;
        flex: 0 0 100% !important;
        grid-column: 1 / -1 !important;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 8em !important;
        min-height: 15px !important;
        margin: -1px 0 0 !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        color: #64748b !important;
        font-size: 11.5px !important;
        font-weight: 750 !important;
        line-height: 1.2 !important;
      }
      .video-card .hb-channel,
      .video-card .channel {
        min-width: 0 !important;
        max-width: 100% !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
      }
      .video-card .card-body {
        min-width: 0 !important;
      }
      body[data-layout-mode="two"] .hb-meta,
      body[data-layout-mode="three"] .hb-meta {
        min-width: 0 !important;
        font-size: 11px !important;
      }
      @media (max-width: 520px) {
        .hb-meta {
          font-size: 11px !important;
          min-height: 14px !important;
        }
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
