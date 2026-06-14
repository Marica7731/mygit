(function () {
  const GROUP = document.body.dataset.sourceGroup || "live";
  let byId = new Map();
  let byText = new Map();

  ready(() => {
    installStyle();
    fetch("data/youtube-ranking.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const rows = data?.groups?.[GROUP]?.items || [];
        byId = new Map(rows.filter((item) => item.videoId).map((item) => [item.videoId, item]));
        byText = new Map(rows.map((item) => [key(item.title, item.channelName), item]).filter(([value]) => value));
        refresh();
      })
      .catch(() => {});
    refresh();
    [350, 900, 1800, 3200, 5200].forEach((delay) => setTimeout(refresh, delay));
  });

  function refresh() {
    simplifySourceChips();
    const seen = new Set();
    document.querySelectorAll(".video-card").forEach((card) => {
      const item = findItem(card);
      const cardKey = item?.videoId ? `v:${item.videoId}` : key(item?.title || text(card, "h3"), item?.channelName || text(card, ".channel"));
      if (cardKey && seen.has(cardKey)) return hide(card);
      if (cardKey) seen.add(cardKey);
      card.hidden = false;
      card.classList.remove("is-duplicate-video");
      card.removeAttribute("aria-hidden");
      card.querySelectorAll(".rank-line .rank-metric,.original-rank,.meta-list,.id-line,.status-pill.video").forEach((node) => node.remove());
      if (!item) return;
      upsertMetric(card, item);
      upsertMeta(card, item);
      upsertThumbChips(card, item);
      linkChannel(card, item);
    });
  }

  function simplifySourceChips() {
    const seen = new Set();
    document.querySelectorAll(".source-chip").forEach((chip) => {
      if (!chip.dataset.hbSimple) {
        const value = clean(chip.textContent);
        const keyword = value.includes("弾き語り") ? "弾き語り" : value.includes("歌枠") ? "歌枠" : "";
        const count = value.match(/([0-9０-９][0-9０-９,，]*)\s*条/)?.[1];
        if (keyword && count) chip.textContent = `${keyword} ${num(count)}条`;
        chip.dataset.hbSimple = "1";
      }
      const value = clean(chip.textContent);
      chip.hidden = Boolean(value && seen.has(value));
      if (value) seen.add(value);
    });
  }

  function findItem(card) {
    const id = videoId(card.querySelector('a[href*="watch"],a[href*="/shorts/"],.thumbnail')?.href || "");
    return (id && byId.get(id)) || byText.get(key(text(card, "h3"), text(card, ".channel"))) || null;
  }

  function upsertMetric(card, item) {
    const line = card.querySelector(".rank-line");
    if (!line) return;
    const metric = metricText(item);
    let node = card.querySelector(".hb-metric");
    if (!metric) {
      node?.remove();
      return;
    }
    if (!node) {
      node = document.createElement("span");
      line.append(node);
    }
    node.className = `hb-metric hb-${metric.type}`;
    if (node.textContent !== metric.text) node.textContent = metric.text;
  }

  function metricText(item) {
    if (GROUP === "live") {
      if (Number(item.subscriberCount) > 0) return { type: "sub", text: `${compact(item.subscriberCount)}粉丝` };
      return null;
    }
    if (item.statusType === "live" || item.statusType === "upcoming") return null;
    if (Number(item.viewCount) > 0) return { type: "view", text: `${compact(item.viewCount)}播放` };
    return null;
  }

  function upsertMeta(card, item) {
    const values = [shortTime(item.publishedText), duration(item.durationText)].filter(Boolean);
    let node = card.querySelector(".hb-meta");
    if (!values.length) {
      node?.remove();
      return;
    }
    if (!node) {
      node = document.createElement("div");
      node.className = "hb-meta";
      (card.querySelector(".channel") || card.querySelector("h3"))?.insertAdjacentElement("afterend", node);
    }
    const value = values.join(" · ");
    if (node.textContent !== value) node.textContent = value;
  }

  function upsertThumbChips(card, item) {
    const thumb = card.querySelector(".thumbnail");
    if (!thumb) return;
    setThumbChip(thumb, "keyword", item.keyword || item.group || "");
    setThumbChip(thumb, "duration", duration(item.durationText));
  }

  function setThumbChip(thumb, type, value) {
    let node = thumb.querySelector(`.hb-${type}`);
    if (!value) {
      node?.remove();
      return;
    }
    if (!node) {
      node = document.createElement("span");
      node.className = `hb-thumb-chip hb-${type}`;
      thumb.append(node);
    }
    if (node.textContent !== value) node.textContent = value;
  }

  function linkChannel(card, item) {
    const href = clean(item.channelUrl) || (item.channelId ? `https://www.youtube.com/channel/${encodeURIComponent(item.channelId)}` : "");
    if (!href) return;
    const channel = card.querySelector(".channel");
    if (channel && !channel.querySelector("a[href]")) {
      const label = clean(channel.textContent) || clean(item.channelName);
      if (label) {
        const link = document.createElement("a");
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = label;
        channel.textContent = "";
        channel.append(link);
      }
    }
    const avatar = card.querySelector(".channel-avatar");
    if (avatar && !avatar.querySelector("a.hb-avatar-link")) {
      const link = document.createElement("a");
      link.className = "hb-avatar-link";
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      while (avatar.firstChild) link.append(avatar.firstChild);
      avatar.append(link);
    }
  }

  function installStyle() {
    if (document.getElementById("hb-hotfix-style")) return;
    const style = document.createElement("style");
    style.id = "hb-hotfix-style";
    style.textContent = `
      .video-card.is-duplicate-video,.video-card[hidden],.source-chip[hidden]{display:none!important}
      .rank-line .rank-metric,.rank-line .original-rank,.meta-list,.id-line,.status-pill.video{display:none!important}
      body[data-source-group="live"] .rank-line strong{display:none!important}
      .hb-metric{flex:0 1 auto;max-width:94px;margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:999px;padding:2px 7px;background:#fff1ed;color:#9f2f2f;font-size:11px;font-weight:850;line-height:1.2}
      .hb-sub{background:#eef4ff;color:#254479}.hb-meta{min-height:14px;overflow:hidden;color:#64748b;font-size:11.5px;font-weight:700;line-height:1.2;text-overflow:ellipsis;white-space:nowrap}
      .thumbnail{position:relative!important;aspect-ratio:16/8.2!important}.hb-thumb-chip{position:absolute;z-index:2;max-width:56%;padding:2px 5px;border-radius:6px;background:rgba(15,23,42,.72);color:#fff;font-size:10.5px;font-weight:850;line-height:1.1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none}.hb-keyword{left:5px;bottom:5px}.hb-duration{right:5px;bottom:5px}
      .channel a{color:inherit!important;text-decoration:none!important}.channel a:hover{color:#0f766e!important;text-decoration:underline!important}.hb-avatar-link{display:block;width:100%;height:100%;border-radius:999px;overflow:hidden}.hb-avatar-link img{display:block;width:100%;height:100%;object-fit:cover}
      @media(max-width:520px){body[data-layout-mode="three"] .hb-metric{max-width:52px;padding-inline:5px;font-size:10.5px}.hb-meta{font-size:11px}.thumbnail{aspect-ratio:16/8.8!important}}
      @media(min-width:900px){main{width:min(2240px,100%)!important;padding:8px clamp(8px,1.2vw,22px) 42px!important}.cards,body[data-layout-mode="auto"] .cards{grid-template-columns:repeat(auto-fill,minmax(min(100%,216px),1fr))!important;gap:10px!important}.video-card{border-radius:8px!important;box-shadow:0 5px 14px rgba(26,36,54,.055)!important}.card-body{gap:4px!important;padding:8px!important}.video-card h3{min-height:55px!important;max-height:55px!important;line-height:1.28!important}}
    `;
    document.head.append(style);
  }

  function hide(card) {
    card.hidden = true;
    card.classList.add("is-duplicate-video");
    card.setAttribute("aria-hidden", "true");
  }
  function ready(fn) {
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn();
  }
  function text(root, selector) {
    return clean(root.querySelector(selector)?.textContent);
  }
  function key(title, channel) {
    const t = clean(title).toLowerCase();
    return t ? `${t}|${clean(channel).toLowerCase()}` : "";
  }
  function videoId(value) {
    try {
      const url = new URL(value, location.href);
      return url.searchParams.get("v") || url.pathname.match(/\/(?:shorts|embed|vi|vi_webp)\/([^/?#]+)/)?.[1] || "";
    } catch {
      return "";
    }
  }
  function duration(value) {
    const text = clean(value).replace(/\s*(?:再生中|正在播放|配信済み).*$/i, "");
    return /^\d{1,2}:\d{2}(?::\d{2})?$/.test(text) ? text : "";
  }
  function shortTime(value) {
    const match = clean(value).match(/(\d+(?:\.\d+)?)\s*(秒|分|時間|日|週間|か月|ヶ月|年)/);
    if (!match) return "";
    return `${match[1]}${({ 秒: "秒前", 分: "分钟前", 時間: "小时前", 日: "天前", 週間: "周前", "か月": "个月前", "ヶ月": "个月前", 年: "年前" }[match[2]] || "前")}`;
  }
  function compact(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    if (n >= 1e8) return `${trim(n / 1e8)}亿`;
    if (n >= 1e4) return `${trim(n / 1e4)}万`;
    return String(Math.round(n));
  }
  function trim(value) {
    return value.toFixed(value >= 10 ? 0 : 1).replace(/\.0$/, "");
  }
  function num(value) {
    return clean(value).replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/\s+/g, "");
  }
  function clean(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }
})();
