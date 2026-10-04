#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT_DIR = path.resolve(__dirname, "..");
const TIMEOUT_MS = 60000;
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function main() {
  const server = await startServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const failures = [];

  try {
    await checkMonthResetsStaleTimeFilter(browser, origin, failures);
    await checkSummaryInvariant(browser, origin, "month.html", { "ytb-ranking-min-views-v1:month": "100000" }, failures);
    await checkWeekTab(browser, origin, failures);
    await checkMobileNavLayout(browser, origin, failures);
    await checkDataWindows(failures);
  } finally {
    await browser.close();
    await closeServer(server);
  }

  if (failures.length) {
    console.error("[verify-page-behavior] failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("[verify-page-behavior] passed");
}

async function checkMonthResetsStaleTimeFilter(browser, origin, failures) {
  const storage = { "ytb-ranking-time-filter-v1:month": "168", "ytb-ranking-time-filter-v1:week": "24" };
  const page = await openPage(browser, origin, "month.html", storage, failures);
  let stable = false;
  try {
    await page.waitForFunction(() => {
      const summary = document.getElementById("source-chip-bar")?.innerText.trim() || "";
      const timeFilter = document.getElementById("time-filter")?.value;
      const nav = [...document.querySelectorAll(".page-nav a")].map((node) => node.textContent).join(",");
      const ready = timeFilter === "all" && nav === "直播,今日,7天,本月" &&
        /^歌枠 \/ 弾き語り = \d+ \/ \d+$/.test(summary);
      const previous = window.__YTB_STABLE_SUMMARY__;
      const count = ready && previous === summary ? Number(window.__YTB_STABLE_SUMMARY_COUNT__ || 0) + 1 : 0;
      window.__YTB_STABLE_SUMMARY__ = summary;
      window.__YTB_STABLE_SUMMARY_COUNT__ = count;
      return count >= 3;
    }, null, { timeout: TIMEOUT_MS, polling: 200 });
    stable = true;
  } catch {
    // Fall through to the detailed state check below.
  }

  const state = await page.evaluate(() => ({
    timeFilter: document.getElementById("time-filter")?.value,
    summary: document.getElementById("source-chip-bar")?.innerText.trim() || "",
    nav: [...document.querySelectorAll(".page-nav a")].map((node) => node.textContent).join(","),
    stableCount: Number(window.__YTB_STABLE_SUMMARY_COUNT__ || 0),
    persisted: (() => {
      try {
        return {
          month: localStorage.getItem("ytb-ranking-time-filter-v1:month"),
          week: localStorage.getItem("ytb-ranking-time-filter-v1:week"),
        };
      } catch {
        return {};
      }
    })(),
  }));
  if (!stable) {
    failures.push(`month.html summary did not stabilize: ${JSON.stringify(state)}`);
  }
  if (state.timeFilter !== "all") {
    failures.push(`month.html restored a stale time filter (${state.timeFilter}); expected "all"`);
  }
  if (state.persisted.month !== null || state.persisted.week !== null) {
    failures.push("legacy localStorage time-filter keys were not cleared");
  }
  if (state.nav !== "直播,今日,7天,本月") {
    failures.push(`month.html nav must be 直播,今日,7天,本月, got ${state.nav}`);
  }
  if (!/歌枠 \/ 弾き語り = \d+ \/ \d+$/.test(state.summary)) {
    failures.push(`month.html with no filters must not report 过滤, got "${state.summary}"`);
  }
  await page.close();
}

async function checkSummaryInvariant(browser, origin, fileName, storage, failures) {
  const page = await openPage(browser, origin, fileName, storage, failures);
  let ready = false;
  try {
    await page.waitForFunction(() => {
      const summary = document.getElementById("source-chip-bar")?.innerText.trim() || "";
      const total = window.__YTB_RANKING_TOTAL_ITEM_COUNT__;
      if (!Number.isInteger(total) || total <= 0 || !summary.includes("=")) return false;
      const numbers = (summary.split("=")[1] || "").split("/").map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value));
      return numbers.reduce((value, sum) => sum + value, 0) === total;
    }, null, { timeout: TIMEOUT_MS, polling: 200 });
    ready = true;
  } catch {
    // Fall through to the detailed invariant check below.
  }
  const state = await page.evaluate(() => ({
    summary: document.getElementById("source-chip-bar")?.innerText.trim() || "",
    total: window.__YTB_RANKING_TOTAL_ITEM_COUNT__,
    visible: (window.__YTB_RANKING_VISIBLE_ITEMS__ || []).length,
  }));
  const numbers = (state.summary.split("=")[1] || "")
    .split("/")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));
  const sum = numbers.reduce((value, total) => total + value, 0);
  if (!ready) failures.push(`${fileName}: summary invariant did not stabilize within timeout ("${state.summary}")`);
  if (!Number.isInteger(state.total) || sum !== state.total) {
    failures.push(`${fileName}: summary numbers total ${sum}, expected app total ${state.total} ("${state.summary}")`);
  }
  if (state.total > 0 && sum < state.total && !state.summary.includes("过滤")) {
    failures.push(`${fileName}: ${state.total - sum} item(s) are filtered out but the chip omits 过滤 ("${state.summary}")`);
  }
  await page.close();
}

async function checkWeekTab(browser, origin, failures) {
  const page = await openPage(browser, origin, "week.html", {}, failures);
  let ready = false;
  try {
    await page.waitForFunction(() => {
      const summary = document.getElementById("source-chip-bar")?.innerText.trim() || "";
      const total = window.__YTB_RANKING_TOTAL_ITEM_COUNT__;
      const cards = document.querySelectorAll(".video-card").length;
      const active = document.querySelector(".page-nav a[aria-current]")?.textContent || "";
      const timeFilter = document.getElementById("time-filter")?.value;
      if (!Number.isInteger(total) || total <= 0 || cards === 0 || active !== "7天" || timeFilter !== "all" ||
          summary.includes("过滤")) return false;
      const numbers = (summary.split("=")[1] || "").split("/").map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value));
      return numbers.reduce((value, sum) => sum + value, 0) === total;
    }, null, { timeout: TIMEOUT_MS, polling: 200 });
    ready = true;
  } catch {
    // Fall through to the detailed checks below.
  }
  const state = await page.evaluate(() => ({
    summary: document.getElementById("source-chip-bar")?.innerText.trim() || "",
    total: window.__YTB_RANKING_TOTAL_ITEM_COUNT__,
    cards: document.querySelectorAll(".video-card").length,
    active: document.querySelector(".page-nav a[aria-current]")?.textContent || "",
    timeFilter: document.getElementById("time-filter")?.value,
  }));
  const numbers = (state.summary.split("=")[1] || "")
    .split("/")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));
  const sum = numbers.reduce((value, total) => total + value, 0);
  if (!ready) failures.push(`week.html summary invariant did not stabilize within timeout ("${state.summary}")`);
  if (state.active !== "7天") failures.push(`week.html active nav must be 7天, got ${state.active}`);
  if (!Number.isInteger(state.total)) failures.push(`week.html app did not publish a total item count`);
  if (state.total > 0 && state.cards === 0) failures.push(`week.html rendered no cards (total=${state.total})`);
  if (sum !== state.total) failures.push(`week.html summary total ${sum} != app total ${state.total} ("${state.summary}")`);
  if (state.summary.includes("过滤")) failures.push(`week.html without filters must not report 过滤, got "${state.summary}"`);
  if (state.timeFilter !== "all") failures.push(`week.html must start with time filter "all", got ${state.timeFilter}`);
  await page.close();
}

async function checkDataWindows(failures) {
  const payload = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "data", "youtube-ranking.json"), "utf8"));
  const windows = payload.rankingWindows || {};
  const month = windows.month || {};
  const week = windows.week || {};
  const monthStart = new Date(month.start || 0);
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: month.timeZone || "Asia/Taipei",
    day: "2-digit",
  }).format(monthStart);
  if (month.kind !== "calendar-month" || day !== "01") {
    failures.push(`month window must start on day 01 of the calendar month, got ${month.start} (${month.kind})`);
  }
  if (week.kind !== "rolling" || Number(week.durationMs) !== 7 * 24 * 60 * 60 * 1000) {
    failures.push(`week window must be a rolling 168h window, got ${JSON.stringify(week)}`);
  }
}

async function openPage(browser, origin, fileName, storage, failures) {
  const context = await browser.newContext();
  await context.addInitScript((items) => {
    for (const [key, value] of Object.entries(items)) {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Storage may be unavailable; the page must still behave correctly.
      }
    }
  }, storage);
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT_MS);
  page.on("pageerror", (error) => failures.push(`${fileName}: page error ${error.message}`));
  await page.goto(`${origin}/${fileName}`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  return page;
}

function startServer() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
    const filePath = path.join(ROOT_DIR, relative);
    if (!filePath.startsWith(ROOT_DIR) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(fs.readFileSync(filePath));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

main().catch((error) => {
  console.error("[verify-page-behavior] crashed:", error);
  process.exit(1);
});

async function checkMobileNavLayout(browser, origin, failures) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT_MS);
  page.on("pageerror", (error) => failures.push(`month.html mobile: page error ${error.message}`));
  try {
    await page.goto(`${origin}/month.html`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
    await page.waitForTimeout(1200);
    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, height: box.height, left: box.left, right: box.right };
      };
      const items = [...document.querySelectorAll(".page-nav a")].map((element) => {
        const box = element.getBoundingClientRect();
        return { label: element.textContent, top: box.top, bottom: box.bottom };
      });
      return {
        header: rect(".site-header"),
        toolbar: rect(".filter-toolbar"),
        items,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    if (layout.items.length !== 4 || new Set(layout.items.map((item) => Math.round(item.top))).size !== 1) {
      failures.push(`mobile month nav must keep 4 items on one row: ${JSON.stringify(layout.items)}`);
    }
    if (!layout.header || !layout.toolbar || layout.header.bottom > layout.toolbar.top) {
      failures.push(`mobile header overlaps filter toolbar: ${JSON.stringify({ header: layout.header, toolbar: layout.toolbar })}`);
    }
    if (layout.overflow > 1) failures.push(`mobile page has horizontal overflow: ${layout.overflow}px`);
  } finally {
    await context.close();
  }
}
