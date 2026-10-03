(function () {
  const chunks = window.__YTB_RANKING_CHUNKS || [];
  const bytes = Uint8Array.from(atob(chunks.join("")), (char) => char.charCodeAt(0));
  const source = new TextDecoder().decode(bytes);
  (0, eval)(source + "\n//# sourceURL=ytb-ranking-app.js");
})();
