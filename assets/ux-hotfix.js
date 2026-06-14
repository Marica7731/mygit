(function () {
  const GROUP = document.body.dataset.sourceGroup || "live";
  let items = new Map();
  let queued = false;

  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot) : boot();
  document.addEventListener("click", onExportPng, true);

  function boot() {
    installStyle();
    fetch("data/youtube-ranking.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        items = new Map((data?.groups?.[GROUP]?.items || []).filter((item) => item.videoId).map((item) => [item.videoId, item]));
        refresh();
      })
      .catch(() => {});
    refresh();
    for (let i = 1; i <= 12; i += 1) setTimeout(refresh, i * 350);
    new MutationObserver(queueRefresh).observe(document.body, { childList: true, subtree: true });
  }

  function queueRefresh() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      refresh();
    });
  }

  function refresh() {
    simplifySourceChips();
    const seen = new Set();
    document.querySelectorAll(".video-card").forEach((card) => {
      const videoId = videoIdFromCard(card);
      if (videoId && seen.has(videoId)) {
        card.hidden = true;
        card.classList.add("is-duplicate-video");
        return;
      }
      if (videoId) seen.add(videoId);
      card.hidden = false;
      card.classList.remove("is-duplicate-video");
      card.querySelectorAll(".rank-line .rank-metric").forEach((node) => node.remove());
      addMetric(card, items.get(videoId));
      linkChannelTargets(card, items.get(videoId));
    });
  }

  function simplifySourceChips() {
    const seen = new Set();
    document.querySelectorAll(".source-chip").forEach((chip) => {
      if (chip.dataset.simple !== "1") {
        const text = clean(chip.textContent);
        const keyword = text.includes("弾き語り") ? "弾き語り" : text.includes("歌枠") ? "歌枠" : "";
        const count = text.match(/([0-9０-９][0-9０-９,，]*)\s*条/)?.[1];
        if (keyword && count) {
          chip.textContent = `${keyword} ${normalizeNumber(count)}条`;
          chip.dataset.simple = "1";
        }
      }
      const key = clean(chip.textContent);
      chip.hidden = key ? seen.has(key) : false;
      if (key) seen.add(key);
    });
  }

  function addMetric(card, item) {
    const line = card.querySelector(".rank-line");
    if (!line || line.querySelector(".hotfix-rank-metric") || !item) return;
    const metric = metricFor(item);
    if (!metric) return;
    const node = document.createElement("span");
    node.className = `hotfix-rank-metric metric-${metric.type}`;
    node.textContent = metric.text;
    line.append(node);
  }

  function metricFor(item) {
    if (GROUP === "live") {
      if (Number(item.subscriberCount) > 0) return { type: "subscriber", text: `${compact(item.subscriberCount)}粉丝` };
      if (hasSubText(item.subscriberText)) return { type: "subscriber", text: localMetric(item.subscriberText) };
      return null;
    }
    if (item.statusType === "live" || item.statusType === "upcoming") return null;
    if (Number(item.viewCount) > 0) return { type: "view", text: `${compact(item.viewCount)}播放` };
    if (hasViewText(item.viewText)) return { type: "view", text: localMetric(item.viewText) };
    return null;
  }

  function linkChannelTargets(card, item) {
    const href = channelHref(item) || card.querySelector(".channel a[href]")?.href || "";
    if (!href) return;
    const channel = card.querySelector(".channel");
    if (channel && !channel.querySelector("a[href]")) {
      const text = clean(channel.textContent) || clean(item?.channelName);
      if (text) {
        const link = document.createElement("a");
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = text;
        channel.textContent = "";
        channel.append(link);
      }
    }
    const avatar = card.querySelector(".channel-avatar");
    if (avatar && !avatar.querySelector("a.channel-avatar-link")) {
      const link = document.createElement("a");
      link.className = "channel-avatar-link";
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      while (avatar.firstChild) link.append(avatar.firstChild);
      avatar.append(link);
    } else if (avatar) {
      avatar.querySelector("a.channel-avatar-link").href = href;
    }
  }

  async function onExportPng(event) {
    const button = event.target?.closest?.("#export-png");
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      const canvas = drawPng();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      const name = `youtube-ranking-${GROUP}-${Date.now()}.png`;
      const file = blob && typeof File !== "undefined" ? new File([blob], name, { type: "image/png" }) : null;
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        toast("已打开系统分享");
        return;
      }
      const url = blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/png");
      if (matchMedia("(max-width: 760px)").matches) return showPreview(url, name);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      toast("已下载 PNG");
    } catch {
      toast("PNG 导出失败");
    }
  }

  function drawPng() {
    const cards = visibleCards().slice(0, 120);
    const width = matchMedia("(max-width: 760px)").matches ? 760 : 1100;
    const rowHeight = 86;
    const height = 96 + Math.max(1, cards.length) * rowHeight;
    const scale = Math.min(devicePixelRatio || 1, 1.5);
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = "#f6f8fb";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#111827";
    ctx.font = "800 28px system-ui,-apple-system,BlinkMacSystemFont,sans-serif";
    ctx.fillText(`${document.title.replace(/ - .*/, "") || "YouTube 排行"}`, 24, 40);
    ctx.font = "14px system-ui,-apple-system,BlinkMacSystemFont,sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText(`当前视图 ${visibleCards().length} 条 · ${new Date().toLocaleString()}`, 24, 66);
    cards.forEach((card, index) => {
      const y = 92 + index * rowHeight;
      ctx.fillStyle = "#fff";
      round(ctx, 18, y, width - 36, rowHeight - 10, 8);
      ctx.fill();
      ctx.strokeStyle = "#d8e0ea";
      ctx.stroke();
      ctx.fillStyle = "#0f766e";
      ctx.font = "800 16px system-ui,-apple-system,BlinkMacSystemFont,sans-serif";
      ctx.fillText(clean(card.querySelector(".rank-line")?.textContent).slice(0, 36), 34, y + 25);
      ctx.fillStyle = "#111827";
      ctx.font = "800 15px system-ui,-apple-system,BlinkMacSystemFont,sans-serif";
      ctx.fillText(cut(ctx, clean(card.querySelector("h3")?.textContent), width - 70), 34, y + 49);
      ctx.fillStyle = "#64748b";
      ctx.font = "13px system-ui,-apple-system,BlinkMacSystemFont,sans-serif";
      ctx.fillText(cut(ctx, clean(card.querySelector(".channel")?.textContent), width - 70), 34, y + 68);
    });
    return canvas;
  }

  function visibleCards() {
    return Array.from(document.querySelectorAll(".video-card")).filter((card) => !card.hidden && getComputedStyle(card).display !== "none");
  }

  function showPreview(url, name) {
    document.getElementById("png-preview-overlay")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "png-preview-overlay";
    overlay.innerHTML = `<div class="png-preview-panel"><div class="png-preview-actions"><strong>PNG 已生成</strong><a href="${url}" download="${esc(name)}">下载</a><button type="button">关闭</button></div><img src="${url}" alt="${esc(name)}"></div>`;
    overlay.querySelector("button").addEventListener("click", () => overlay.remove());
    document.body.append(overlay);
    toast("已打开 PNG 预览");
  }

  function installStyle() {
    const style = document.createElement("style");
    style.id = "ux-hotfix-style";
    style.textContent = `
      .video-card.is-duplicate-video,.video-card[hidden],.source-chip[hidden]{display:none!important}
      .rank-line .rank-metric,.meta-list,.id-line{display:none!important}
      .hotfix-rank-metric{flex:0 0 auto!important;max-width:none!important}
      body[data-layout-mode="three"] .hotfix-rank-metric{padding-inline:5px!important;font-size:10.5px!important}
      .channel a{color:inherit!important;text-decoration:none!important}.channel a:hover{color:#0f766e!important;text-decoration:underline!important}
      .channel-avatar-link{display:block;width:100%;height:100%;border-radius:999px;overflow:hidden}.channel-avatar-link img{display:block;width:100%;height:100%;object-fit:cover}
      #png-preview-overlay{position:fixed;inset:0;z-index:90;overflow:auto;background:rgba(15,23,42,.86);padding:12px}.png-preview-panel{width:min(960px,100%);margin:0 auto;overflow:hidden;border-radius:10px;background:#fff}.png-preview-actions{position:sticky;top:0;z-index:1;display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px;background:#101827;color:#fff}.png-preview-actions a,.png-preview-actions button{border:1px solid rgba(255,255,255,.35);border-radius:8px;background:transparent;color:#fff;font:inherit;font-weight:800;padding:6px 10px;text-decoration:none}.png-preview-panel img{display:block;width:100%;height:auto}
      @media (min-width:900px){main{width:min(2240px,100%)!important;padding:8px clamp(8px,1.2vw,22px) 42px!important}.cards,body[data-layout-mode="auto"] .cards{grid-template-columns:repeat(auto-fill,minmax(min(100%,216px),1fr))!important;gap:10px!important}.ranking-sections{gap:14px!important}.video-card{min-height:0!important;border-radius:8px!important;box-shadow:0 5px 14px rgba(26,36,54,.055)!important}.thumbnail{aspect-ratio:16/7.6!important}.card-body{gap:4px!important;padding:8px!important}.rank-line{min-height:21px!important;gap:4px!important}.video-card h3{min-height:55px!important;max-height:55px!important;margin:0!important;line-height:1.28!important}.channel-metric-row{gap:5px!important}}`;
    document.getElementById("ux-hotfix-style")?.remove();
    document.head.append(style);
  }

  function videoIdFromCard(card) {
    return getVideoId(card.querySelector('a[href*="watch"],a[href*="/shorts/"],.thumbnail')?.href || "");
  }
  function getVideoId(value) {
    try {
      const url = new URL(value, location.href);
      return url.searchParams.get("v") || url.pathname.match(/\/(?:shorts|embed|vi|vi_webp)\/([^/?#]+)/)?.[1] || "";
    } catch {
      return "";
    }
  }
  function channelHref(item) {
    const url = clean(item?.channelUrl);
    if (url) return new URL(url, location.href).href;
    return item?.channelId ? `https://www.youtube.com/channel/${encodeURIComponent(item.channelId)}` : "";
  }
  function localMetric(text) {
    const value = clean(text);
    const num = "([0-9０-９][0-9０-９,，.．]*(?:\\s*(?:億|亿|万|萬|千|K|M|B))?)";
    const view = value.match(new RegExp(`${num}\\s*(?:回視聴|視聴回数|views?|次观看|次觀看|播放)`, "i"));
    if (view) return `${normalizeNumber(view[1])}播放`;
    const sub = value.match(new RegExp(`${num}\\s*(?:登録者|subscribers?|subscriber|订阅者|訂閱者|粉丝)`, "i"));
    return sub ? `${normalizeNumber(sub[1])}粉丝` : value;
  }
  function hasViewText(text) {
    return /[0-9０-９][0-9０-９,，.．]*\s*(?:億|亿|万|萬|千|K|M|B)?\s*(?:回視聴|視聴回数|views?|次观看|次觀看|播放)/i.test(clean(text));
  }
  function hasSubText(text) {
    return /[0-9０-９][0-9０-９,，.．]*\s*(?:億|亿|万|萬|千|K|M|B)?\s*(?:登録者|subscribers?|subscriber|订阅者|訂閱者|粉丝)/i.test(clean(text));
  }
  function compact(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    if (n >= 1e8) return `${trim(n / 1e8)}亿`;
    if (n >= 1e4) return `${trim(n / 1e4)}万`;
    return String(Math.round(n));
  }
  function trim(n) {
    return n.toFixed(n >= 10 ? 0 : 1).replace(/\.0$/, "");
  }
  function normalizeNumber(value) {
    return clean(value).replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/\s+/g, "");
  }
  function clean(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }
  function cut(ctx, text, maxWidth) {
    let out = text || "";
    while (out && ctx.measureText(`${out}...`).width > maxWidth) out = out.slice(0, -1);
    return out === text ? out : `${out}...`;
  }
  function round(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function esc(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }
  function toast(message) {
    const node = document.getElementById("toast");
    if (!node) return;
    node.textContent = message;
    node.classList.add("is-visible");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove("is-visible"), 2400);
  }
})();
