(function () {
  ready(() => {
    installStyle();
    normalizeRows();
    [250, 900, 1800, 3600, 7000, 12000].forEach((delay) => setTimeout(normalizeRows, delay));
    window.addEventListener("resize", scheduleNormalize, { passive: true });
    new MutationObserver(scheduleNormalize).observe(document.body, { childList: true, subtree: true, characterData: true });
  });

  let timer = 0;
  function scheduleNormalize() {
    clearTimeout(timer);
    timer = setTimeout(normalizeRows, 120);
  }

  function normalizeRows() {
    if (window.matchMedia("(max-width: 760px)").matches) {
      clearHeights();
      return;
    }

    const cards = visibleCards();
    clearHeights(cards);

    const rows = new Map();
    for (const card of cards) {
      const top = Math.round(card.getBoundingClientRect().top);
      if (!rows.has(top)) rows.set(top, []);
      rows.get(top).push(card);
    }

    for (const row of rows.values()) {
      if (row.length <= 1) continue;
      const maxHeight = Math.max(...row.map((card) => Math.ceil(card.getBoundingClientRect().height)));
      row.forEach((card) => {
        card.style.minHeight = `${maxHeight}px`;
      });
    }
  }

  function visibleCards() {
    return Array.from(document.querySelectorAll(".video-card")).filter((card) => {
      if (card.hidden) return false;
      const style = getComputedStyle(card);
      return style.display !== "none" && style.visibility !== "hidden";
    });
  }

  function clearHeights(cards = visibleCards()) {
    cards.forEach((card) => {
      card.style.minHeight = "";
    });
  }

  function installStyle() {
    if (document.getElementById("row-height-hotfix-style")) return;
    const style = document.createElement("style");
    style.id = "row-height-hotfix-style";
    style.textContent = `
      @media (min-width: 761px) {
        .cards,
        body[data-layout-mode="auto"] .cards,
        body[data-layout-mode="two"] .cards,
        body[data-layout-mode="three"] .cards {
          align-items: stretch !important;
        }

        .video-card {
          align-self: stretch !important;
          height: auto !important;
        }

        .video-card .card-body {
          align-content: start !important;
        }
      }
    `;
    document.head.append(style);
  }

  function ready(fn) {
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn();
  }
})();
