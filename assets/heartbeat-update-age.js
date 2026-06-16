(function () {
  let generatedAt = null;
  let statusInfo = null;

  ready(() => {
    installStyle();
    loadData();
    [300, 1000, 2500, 5000, 9000].forEach((delay) => setTimeout(refresh, delay));
    setInterval(refresh, 60000);
  });

  function loadData() {
    Promise.all([
      fetch("data/youtube-ranking.json")
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null),
      fetch(`data/youtube-ranking-status.json?ts=${Date.now()}`)
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null),
    ]).then(([data, status]) => {
      generatedAt = data?.generatedAt ? new Date(data.generatedAt) : null;
      statusInfo = normalizeStatus(status);
      refresh();
    });
  }

  function refresh() {
    const chips = document.querySelectorAll(".filter-chip.meta");
    if (!chips.length || !generatedAt || !Number.isFinite(generatedAt.getTime())) return;
    const ageMinutes = Math.max(0, Math.floor((Date.now() - generatedAt.getTime()) / 60000));
    const failed = statusInfo?.status === "failed" && statusInfo.attemptedAt && statusInfo.attemptedAt > generatedAt;
    const statusAge = statusInfo?.attemptedAt ? Math.max(0, Math.floor((Date.now() - statusInfo.attemptedAt.getTime()) / 60000)) : null;
    chips.forEach((chip) => {
      chip.textContent = failed
        ? `更新 ${formatShortDate(generatedAt)} · ${ageLabel(ageMinutes)} · 抓取失败 ${ageLabel(statusAge)}`
        : `更新 ${formatShortDate(generatedAt)} · ${ageLabel(ageMinutes)}`;
      chip.title = failed
        ? `最后成功 ${formatFullDate(generatedAt)}；最近抓取失败 ${formatFullDate(statusInfo.attemptedAt)}：${statusInfo.message || "质量检查未通过"}`
        : `最后更新 ${formatFullDate(generatedAt)}`;
      chip.classList.toggle("is-stale-update", ageMinutes >= 45);
      chip.classList.toggle("is-old-update", ageMinutes >= 90);
      chip.classList.toggle("is-failed-update", failed);
    });
  }

  function ageLabel(minutes) {
    if (minutes == null) return "刚刚";
    if (minutes < 1) return "刚刚";
    if (minutes < 60) return `${minutes}分钟前`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours < 24) return rest ? `${hours}小时${rest}分钟前` : `${hours}小时前`;
    const days = Math.floor(hours / 24);
    return `${days}天前`;
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
    if (document.getElementById("hb-update-age-style")) return;
    const style = document.createElement("style");
    style.id = "hb-update-age-style";
    style.textContent = `
      .active-filter-chips .filter-chip.meta.is-stale-update {
        border-color: rgba(245, 158, 11, 0.4) !important;
        background: rgba(255, 251, 235, 0.95) !important;
        color: #92400e !important;
      }
      .active-filter-chips .filter-chip.meta.is-old-update {
        border-color: rgba(239, 68, 68, 0.38) !important;
        background: rgba(254, 242, 242, 0.95) !important;
        color: #991b1b !important;
      }
      .active-filter-chips .filter-chip.meta.is-failed-update {
        border-color: rgba(239, 68, 68, 0.42) !important;
        background: rgba(255, 247, 237, 0.98) !important;
        color: #9a3412 !important;
      }
    `;
    document.head.append(style);
  }

  function normalizeStatus(value) {
    if (!value || typeof value !== "object") return null;
    const attemptedAt = value.attemptedAt ? new Date(value.attemptedAt) : null;
    return {
      status: value.status || "",
      attemptedAt: attemptedAt && Number.isFinite(attemptedAt.getTime()) ? attemptedAt : null,
      message: value.message || "",
    };
  }

  function ready(fn) {
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn();
  }
})();
