(function () {
  const chunks = window.__YTB_RANKING_CHUNKS || [];
  const bytes = Uint8Array.from(atob(chunks.join("")), (char) => char.charCodeAt(0));
  const source = new TextDecoder()
    .decode(bytes)
    .replace("const RENDER_BATCH_SIZE = 120;", "const RENDER_BATCH_SIZE = 48;")
    .replace("const RENDER_BATCH_DELAY_MS = 16;", "const RENDER_BATCH_DELAY_MS = 32;");
  (0, eval)(source + "\n//# sourceURL=ytb-ranking-app.js");
})();
