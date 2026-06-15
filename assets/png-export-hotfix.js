(function () {
  const GROUP = document.body.dataset.sourceGroup || "live";
  const MAX_CARDS = 100;
  const COLUMNS = 8;
  const MAX_BYTES = 10 * 1024 * 1024;
  let byId = new Map();

  window.__YTB_RANKING_PNG_HOTFIX = true;

  ready(() => {
    installStyle();
    fetch(`data/youtube-ranking.json?png=${Date.now()}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        byId = new Map((data?.groups?.[GROUP]?.items || []).filter((item) => item.videoId).map((item) => [item.videoId, item]));
      })
      .catch(() => {});
    document.addEventListener("click", handleExportClick, true);
  });

  async function handleExportClick(event) {
    const button = event.target?.closest?.("#export-png");
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (button.dataset.exporting === "1") return;
    button.dataset.exporting = "1";
    button.disabled = true;
    toast("正在生成前 100 缩略图 PNG");

    try {
      const cards = visibleCards().slice(0, MAX_CARDS).map(readCard);
      if (!cards.length) throw new Error("empty view");
      const images = await mapLimit(cards, 10, (card) => loadImage(card.imageUrl));
      let canvas = drawGrid(cards, images, { tileWidth: 180, tileHeight: 150, thumbHeight: 101, gap: 8, padding: 16 });
      let blob = await canvasToBlob(canvas);
      if (blob.size > MAX_BYTES) {
        canvas = drawGrid(cards, images, { tileWidth: 160, tileHeight: 136, thumbHeight: 90, gap: 7, padding: 14 });
        blob = await canvasToBlob(canvas);
      }
      const name = `youtube-ranking-${GROUP}-${dateStamp()}.png`;
      const url = URL.createObjectURL(blob);
      triggerDownload(url, name);
      if (matchMedia("(max-width: 760px)").matches) {
        showPreview(url, name, blob);
      } else {
        setTimeout(() => URL.revokeObjectURL(url), 45000);
      }
      toast(blob.size > MAX_BYTES ? "PNG 已生成，体积偏大" : "PNG 已生成");
    } catch (error) {
      console.warn("[png-export]", error);
      toast("PNG 导出失败");
    } finally {
      button.disabled = false;
      button.dataset.exporting = "";
    }
  }

  function drawGrid(cards, images, options) {
    const { tileWidth, tileHeight, thumbHeight, gap, padding } = options;
    const headerHeight = 88;
    const rows = Math.ceil(cards.length / COLUMNS);
    const width = padding * 2 + COLUMNS * tileWidth + (COLUMNS - 1) * gap;
    const height = headerHeight + rows * tileHeight + Math.max(0, rows - 1) * gap + padding;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });

    ctx.fillStyle = "#f6f8fb";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#111827";
    ctx.font = "800 24px system-ui,-apple-system,BlinkMacSystemFont,sans-serif";
    ctx.fillText(pageTitle(), padding, 32);
    ctx.fillStyle = "#526173";
    ctx.font = "700 13px system-ui,-apple-system,BlinkMacSystemFont,sans-serif";
    ctx.fillText(`前 ${Math.min(MAX_CARDS, cards.length)} 条 · 每行 ${COLUMNS} 个 · ${updateText()}`, padding, 56);
    ctx.fillText(activeFilterText(), padding, 76);

    cards.forEach((card, index) => {
      const row = Math.floor(index / COLUMNS);
      const column = index % COLUMNS;
      const x = padding + column * (tileWidth + gap);
      const y = headerHeight + row * (tileHeight + gap);
      drawTile(ctx, card, images[index], x, y, tileWidth, tileHeight, thumbHeight);
    });

    return canvas;
  }

  function drawTile(ctx, card, image, x, y, width, height, thumbHeight) {
    ctx.save();
    roundRect(ctx, x, y, width, height, 8);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#d8e0ea";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.clip();

    if (image) {
      drawImageCover(ctx, image, x, y, width, thumbHeight);
    } else {
      const gradient = ctx.createLinearGradient(x, y, x + width, y + thumbHeight);
      gradient.addColorStop(0, "#dbe6ef");
      gradient.addColorStop(1, "#eef3f7");
      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, width, thumbHeight);
      ctx.fillStyle = "#64748b";
      ctx.font = "800 13px system-ui,-apple-system,BlinkMacSystemFont,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No thumbnail", x + width / 2, y + thumbHeight / 2 + 4);
      ctx.textAlign = "left";
    }

    drawOverlayText(ctx, card.rank, x + 5, y + 13, "#ffffff", "left");
    drawOverlayText(ctx, card.metric, x + width - 5, y + 13, card.metricType === "subscriber" ? "#3159ad" : "#c73636", "right", "#ffffff");
    drawOverlayText(ctx, card.keyword, x + 5, y + thumbHeight - 7, "#1f6792", "left", "#ffffff");
    drawOverlayText(ctx, card.time, x + width - 5, y + thumbHeight - 7, "#ffffff", "right");

    const bodyY = y + thumbHeight + 14;
    ctx.fillStyle = "#111827";
    ctx.font = "800 11px system-ui,-apple-system,BlinkMacSystemFont,sans-serif";
    drawTextLines(ctx, card.title, x + 7, bodyY, width - 14, 2, 13);
    ctx.fillStyle = "#526173";
    ctx.font = "700 10px system-ui,-apple-system,BlinkMacSystemFont,sans-serif";
    const meta = [card.published, card.channel].filter(Boolean).join("  ");
    ctx.fillText(truncate(ctx, meta, width - 14), x + 7, y + height - 9);
    ctx.restore();
  }

  function readCard(card, index) {
    const thumb = card.querySelector(".thumbnail");
    const img = thumb?.querySelector("img");
    const id = videoId(thumb?.href || img?.currentSrc || img?.src || "");
    const item = byId.get(id) || {};
    const metric = cornerText(card, "metric") || metricLabel(item);
    return {
      rank: cornerText(card, "rank") || `#${index + 1}`,
      metric,
      metricType: GROUP === "live" ? "subscriber" : "view",
      keyword: cornerText(card, "keyword") || item.keyword || item.group || "",
      time: cornerText(card, "time") || duration(item.durationText) || formatDuration(item.durationSeconds),
      title: clean(item.title) || clean(card.querySelector("h3")?.textContent),
      channel: clean(item.channelName) || clean(card.querySelector(".channel")?.textContent),
      published: shortTime(item.publishedText) || clean(card.querySelector(".hb-meta")?.textContent),
      imageUrl: bestImageUrl(item, img, id),
    };
  }

  function visibleCards() {
    return Array.from(document.querySelectorAll(".video-card")).filter((card) => {
      if (card.hidden || card.classList.contains("is-duplicate-video") || card.classList.contains("is-thumbnail-missing")) return false;
      const style = getComputedStyle(card);
      return style.display !== "none" && style.visibility !== "hidden";
    });
  }

  function bestImageUrl(item, img, id) {
    const values = [img?.currentSrc, img?.src, item?.thumbnailUrl];
    if (id) {
      values.push(
        `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
        `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        `https://i.ytimg.com/vi/${id}/sddefault.jpg`,
        `https://i.ytimg.com/vi/${id}/default.jpg`,
      );
    }
    return values.map(absoluteUrl).find(Boolean) || "";
  }

  function loadImage(url) {
    return new Promise((resolve) => {
      if (!url) {
        resolve(null);
        return;
      }
      const img = new Image();
      const timer = setTimeout(() => resolve(null), 4000);
      img.crossOrigin = "anonymous";
      img.referrerPolicy = "no-referrer";
      img.onload = () => {
        clearTimeout(timer);
        resolve(img.naturalWidth && img.naturalHeight ? img : null);
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      img.src = url;
    });
  }

  async function mapLimit(values, limit, fn) {
    const output = new Array(values.length);
    let index = 0;
    async function worker() {
      while (index < values.length) {
        const current = index;
        index += 1;
        output[current] = await fn(values[current], current);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
    return output;
  }

  function drawImageCover(ctx, image, x, y, width, height) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  }

  function drawOverlayText(ctx, text, x, y, fill, align, stroke) {
    if (!text) return;
    ctx.save();
    ctx.font = "950 11px system-ui,-apple-system,BlinkMacSystemFont,sans-serif";
    ctx.textAlign = align || "left";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = stroke ? 3 : 3.6;
    ctx.strokeStyle = stroke || "rgba(15,23,42,.78)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill || "#ffffff";
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawTextLines(ctx, text, x, y, maxWidth, maxLines, lineHeight) {
    const lines = wrapText(ctx, clean(text), maxWidth, maxLines);
    lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
  }

  function wrapText(ctx, text, maxWidth, maxLines) {
    const chars = Array.from(text);
    const lines = [];
    let line = "";
    for (const char of chars) {
      const next = line + char;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = char;
        if (lines.length === maxLines) break;
      } else {
        line = next;
      }
    }
    if (lines.length < maxLines && line) lines.push(line);
    if (lines.length === maxLines && chars.join("") !== lines.join("")) {
      lines[maxLines - 1] = truncate(ctx, lines[maxLines - 1], maxWidth);
    }
    return lines;
  }

  function truncate(ctx, text, maxWidth) {
    let value = clean(text);
    if (ctx.measureText(value).width <= maxWidth) return value;
    while (value && ctx.measureText(`${value}...`).width > maxWidth) value = value.slice(0, -1);
    return value ? `${value}...` : "";
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("empty blob"))), "image/png");
    });
  }

  function triggerDownload(url, name) {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
  }

  function showPreview(url, name, blob) {
    document.getElementById("png-preview-overlay")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "png-preview-overlay";
    overlay.innerHTML = `
      <div class="png-preview-panel">
        <div class="png-preview-actions">
          <strong>PNG 已生成</strong>
          <span>${Math.round(blob.size / 1024)} KB</span>
          <a href="${url}" download="${escapeHtml(name)}">下载</a>
          <button type="button" data-close>关闭</button>
        </div>
        <img src="${url}" alt="${escapeHtml(name)}">
      </div>`;
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-close]")) {
        overlay.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    });
    document.body.append(overlay);
  }

  function metricLabel(item) {
    if (GROUP === "live") {
      if (Number(item?.subscriberCount) > 0) return `${compact(item.subscriberCount)}粉丝`;
      return "";
    }
    if (item?.statusType === "live" || item?.statusType === "upcoming") return "";
    if (Number(item?.viewCount) > 0) return `${compact(item.viewCount)}播放`;
    return "";
  }

  function shortTime(value) {
    const text = clean(value);
    const chinese = text.match(/(\d+(?:\.\d+)?)\s*(秒前|分钟前|小时前|天前|周前|个月前|年前)/);
    if (chinese) return `${chinese[1]}${chinese[2]}`;
    const match = text.match(/(\d+(?:\.\d+)?)\s*(秒|分|時間|日|週間|か月|ヶ月|年)/);
    if (!match) return "";
    return `${match[1]}${
      {
        秒: "秒前",
        分: "分钟前",
        時間: "小时前",
        日: "天前",
        週間: "周前",
        か月: "个月前",
        ヶ月: "个月前",
        年: "年前",
      }[match[2]] || "前"
    }`;
  }

  function duration(value) {
    const match = clean(value).match(/\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/);
    return match ? match[0] : "";
  }

  function formatDuration(seconds) {
    const number = Number(seconds);
    if (!Number.isFinite(number) || number <= 0) return "";
    const total = Math.round(number);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainSeconds = total % 60;
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainSeconds).padStart(2, "0")}`;
    return `${minutes}:${String(remainSeconds).padStart(2, "0")}`;
  }

  function compact(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    if (number >= 1e8) return `${trim(number / 1e8)}亿`;
    if (number >= 1e4) return `${trim(number / 1e4)}万`;
    return String(Math.round(number));
  }

  function trim(value) {
    return value.toFixed(value >= 10 ? 0 : 1).replace(/\.0$/, "");
  }

  function pageTitle() {
    if (GROUP === "today") return "今日热度";
    if (GROUP === "month") return "本月热度";
    return "直播 / 预约";
  }

  function updateText() {
    return clean(document.querySelector(".filter-chip.meta")?.textContent || document.querySelector(".filter-chip[data-kind='updated']")?.textContent || "");
  }

  function activeFilterText() {
    const chips = Array.from(document.querySelectorAll(".active-filter-chips .filter-chip"))
      .filter((chip) => !chip.hidden && getComputedStyle(chip).display !== "none")
      .map((chip) => clean(chip.textContent))
      .filter((text) => text && !/^标题:\s*歌枠\s*\/\s*弾き語り/.test(text) && !text.includes("排除韩文"));
    return chips.join(" · ").slice(0, 120);
  }

  function cornerText(card, name) {
    return clean(card.querySelector(`.corner-${name}`)?.textContent || "");
  }

  function videoId(value) {
    try {
      const url = new URL(value, location.href);
      return url.searchParams.get("v") || url.pathname.match(/\/(?:shorts|embed|vi|vi_webp)\/([^/?#]+)/)?.[1] || "";
    } catch {
      return "";
    }
  }

  function absoluteUrl(value) {
    try {
      return new URL(value, location.href).href;
    } catch {
      return "";
    }
  }

  function dateStamp() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }

  function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function installStyle() {
    if (document.getElementById("png-export-hotfix-style")) return;
    const style = document.createElement("style");
    style.id = "png-export-hotfix-style";
    style.textContent = `
      #png-preview-overlay {
        position: fixed;
        inset: 0;
        z-index: 120;
        overflow: auto;
        padding: 12px;
        background: rgba(15, 23, 42, 0.82);
      }
      .png-preview-panel {
        width: min(1120px, 100%);
        margin: 0 auto;
        overflow: hidden;
        border-radius: 10px;
        background: #fff;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.32);
      }
      .png-preview-actions {
        position: sticky;
        top: 0;
        z-index: 1;
        display: flex;
        gap: 10px;
        align-items: center;
        justify-content: space-between;
        padding: 10px;
        background: #111827;
        color: #fff;
        font-size: 13px;
      }
      .png-preview-actions a,
      .png-preview-actions button {
        border: 1px solid rgba(255, 255, 255, 0.36);
        border-radius: 8px;
        background: transparent;
        color: #fff;
        font: inherit;
        font-weight: 850;
        padding: 6px 10px;
        text-decoration: none;
      }
      .png-preview-panel img {
        display: block;
        width: 100%;
        height: auto;
        background: #fff;
      }
    `;
    document.head.append(style);
  }

  function toast(message) {
    const node = document.getElementById("toast");
    if (!node) return;
    node.textContent = message;
    node.classList.add("is-visible");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove("is-visible"), 2400);
  }

  function ready(fn) {
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn();
  }

  function clean(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }
})();
