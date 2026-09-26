(() => {
  "use strict";

  const STORAGE_KEY = "ytb-ranking-theme-v1";
  const root = document.documentElement;
  let button = null;
  let installAttempts = 0;

  function readTheme() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  }

  function writeTheme(theme) {
    try {
      if (theme === "dark") localStorage.setItem(STORAGE_KEY, "dark");
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage can be unavailable in privacy modes; the current page still switches.
    }
  }

  function applyTheme(theme, persist = false) {
    if (theme === "dark") root.dataset.theme = "dark";
    else root.removeAttribute("data-theme");
    if (persist) writeTheme(theme);
    syncButton(theme);
  }

  function syncButton(theme = readTheme()) {
    if (!button) return;
    const dark = theme === "dark";
    button.setAttribute("aria-pressed", String(dark));
    button.setAttribute("aria-label", dark ? "切换到浅色主题" : "切换到深色主题");
    button.title = dark ? "切换到浅色主题" : "切换到深色主题";
    button.querySelector(".theme-mode-icon").textContent = dark ? "☀" : "☾";
    button.querySelector(".theme-mode-label").textContent = dark ? "浅色" : "深色";
  }

  function ensureButton() {
    const row = document.querySelector(".toolbar-search-row");
    if (!row) {
      if (installAttempts++ < 240) requestAnimationFrame(ensureButton);
      return;
    }

    button = document.getElementById("theme-mode-toggle");
    if (!button) {
      button = document.createElement("button");
      button.id = "theme-mode-toggle";
      button.className = "theme-mode-toggle";
      button.type = "button";
      button.innerHTML =
        '<span class="theme-mode-icon" aria-hidden="true">☾</span><span class="theme-mode-label">深色</span>';
      button.addEventListener("click", () => {
        const next = root.dataset.theme === "dark" ? "light" : "dark";
        applyTheme(next, true);
      });
    }
    if (button.parentElement !== row) row.append(button);
    syncButton(root.dataset.theme === "dark" ? "dark" : "light");
  }

  applyTheme(readTheme(), false);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureButton, { once: true });
  } else {
    ensureButton();
  }

  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) applyTheme(event.newValue === "dark" ? "dark" : "light", false);
  });
})();
