(function () {
  ready(() => {
    installStyle();
    scrub();
    [300, 900, 1800, 3500, 6000].forEach((delay) => setTimeout(scrub, delay));
  });

  function scrub() {
    document.querySelectorAll(".hotfix-rank-metric,.rank-line .rank-metric").forEach((node) => node.remove());
  }

  function installStyle() {
    if (document.getElementById("hb-hotfix-v3-style")) return;
    const style = document.createElement("style");
    style.id = "hb-hotfix-v3-style";
    style.textContent = ".hotfix-rank-metric,.rank-line .rank-metric{display:none!important}";
    document.head.append(style);
  }

  function ready(fn) {
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn();
  }
})();
