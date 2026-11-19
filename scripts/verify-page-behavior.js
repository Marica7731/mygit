#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");
const { startOfRollingMonth } = require("./lib/ranking-window");
const { snapshotOptions } = require("./build-snapshot-options");

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
    await checkRankingPageLoads(browser, origin);
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
  const monthStartMs = Date.parse(month.start || "");
  const monthEndMs = Date.parse(month.end || "");
  const expectedMonthStartMs = Number.isFinite(monthEndMs)
    ? startOfRollingMonth(monthEndMs, month.timeZone || "Asia/Taipei")
    : NaN;
  if (
    month.kind !== "rolling-month" ||
    !Number.isFinite(monthStartMs) ||
    monthStartMs !== expectedMonthStartMs ||
    Number(month.durationMs) !== monthEndMs - monthStartMs
  ) {
    failures.push(
      `month window must start one calendar month before its end, got ${month.start}..${month.end} (${month.kind})`,
    );
  }
  if (week.kind !== "rolling" || Number(week.durationMs) !== 7 * 24 * 60 * 60 * 1000) {
    failures.push(`week window must be a rolling 168h window, got ${JSON.stringify(week)}`);
  }
}

async function checkRankingPageLoads(browser, origin) {
  for (const group of ["live", "today", "week", "month"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      const requests = [];
      const errors = [];
      page.on("request", (request) => requests.push(request.url()));
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/https:\/\/(?:i\.[^/]*ytimg\.com|yt3\.[^/]+)\//, (route) => route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="orange"/></svg>',
      }));
      if (group === "month") {
        // Exercise multiple append batches without polling several thousand DOM
        // cards in Chromium. checkDataWindows validates the full ranking.
        await page.route("**/data/youtube-ranking-month.json", async (route) => {
          const response = await route.fetch();
          const data = await response.json();
          data.groups.month.items = data.groups.month.items.slice(0, 480);
          await route.fulfill({ json: data });
        });
      }
      if (group === "live") {
        await page.route("**/assets/sort-hotfix.js?*", async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 150));
          await route.continue();
        });
      }
      await page.route("**/assets/youtube-ranking.js?*", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        await route.continue();
      });
      await page.goto(origin + "/" + group + ".html");
      await page.waitForFunction(() => {
        const options = document.querySelector("#snapshot-filter")?.options;
        return options?.length > 1 && window.__YTB_RANKING_TOTAL_ITEM_COUNT__ > 0 &&
          document.querySelector(".video-card") && document.querySelector(".source-summary-chip");
      }).catch(async (error) => {
        const state = await page.evaluate(() => ({
          options: document.querySelector("#snapshot-filter")?.options.length,
          total: window.__YTB_RANKING_TOTAL_ITEM_COUNT__,
          cards: document.querySelectorAll(".video-card").length,
          summary: document.querySelector("#source-chip-bar")?.textContent.trim(),
        }));
        throw new Error(group + ": page did not settle: " + JSON.stringify({ state, errors }) + " " + error.message);
      });
      const state = await page.evaluate(async () => {
        const first = window.ytbRankingData.load();
        const second = window.ytbRankingData.load();
        const data = await first;
        const group = document.body.dataset.sourceGroup;
        const items = data.groups[group].items;
        return {
          shared: first === second && data === await second,
          total: window.__YTB_RANKING_TOTAL_ITEM_COUNT__,
          count: items.length,
          invalidTitles: items.filter((item) => !/歌枠|弾き語/u.test(item.title) ||
            /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u.test(item.title)).length,
          labels: [...document.querySelector("#snapshot-filter").options].slice(1).map((option) => [option.value, option.text]),
          active: document.querySelector(".page-nav [aria-current]")?.getAttribute("href"),
        };
      });
      if (!state.shared || state.active !== group + ".html" || state.count !== state.total || state.invalidTitles) {
        throw new Error(group + ": ranking or single-load state is inconsistent " + JSON.stringify({ ...state, labels: undefined }));
      }
      const options = snapshotOptions(group);
      if (JSON.stringify(state.labels) !== JSON.stringify(options.map(({ id, label }) => [id, label]))) {
        throw new Error(group + ": snapshot options changed");
      }
      const primary = requests.filter((url) => /\/data\/youtube-ranking(?:-(?:today|live|week|month))?\.json(?:\?|$)/.test(url));
      if (primary.length !== 1 || !primary[0].endsWith("youtube-ranking-" + group + ".json")) {
        throw new Error(group + ": ranking request count is " + JSON.stringify(primary));
      }

      if (group !== "live" && state.total > 99) {
        const next = page.locator('#ranking-pagination [data-page-action="next"]');
        await next.waitFor();
        await page.waitForFunction(() => {
          const cards = [...document.querySelectorAll(".video-card")];
          if (cards.length !== window.__YTB_RANKING_VISIBLE_ITEMS__.length) return false;
          const eligible = cards.filter((card) => !card.hidden && !card.matches(
            ".is-duplicate-video,.is-live-duration-dirty,.is-thumbnail-missing,[data-time-hidden],[data-view-hidden]",
          )).length;
          const range = document.querySelector("#ranking-pagination .pagination-range")?.textContent || "";
          return eligible > 99 && (range === "1-99 / " + eligible || range === "1-98 / " + eligible);
        }, undefined, { polling: 250, timeout: TIMEOUT_MS });
        const last = page.locator('#ranking-pagination [data-page-target]').last();
        const lastPage = await last.getAttribute("data-page-target");
        if (Number(lastPage) < 3) throw new Error(group + ": expected later data batches in pagination");
        await last.click();
        await page.waitForFunction((target) =>
          document.querySelector('#ranking-pagination [aria-current="page"]')?.getAttribute("data-page-target") === target,
        lastPage);
        await page.locator('#ranking-pagination [data-page-target="1"]').click();
        await next.click();
        await page.waitForFunction(() => /^(99|100)-\d+/.test(document.querySelector("#ranking-pagination .pagination-range")?.textContent || ""));
      }
      if (errors.length) throw new Error(group + ": " + errors.join(", "));
      console.log("[verify-page-behavior] " + group + " shared payload, pagination and " + options.length + " snapshot labels verified");
    } finally {
      await context.close();
    }
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
  const options = new Map(["live", "today", "week", "month"].map((group) => [
    "data/" + group + "-snapshot-options.json", JSON.stringify({ snapshots: snapshotOptions(group) }),
  ]));
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
    if (options.has(relative)) {
      response.writeHead(200, { "content-type": CONTENT_TYPES[".json"], "cache-control": "no-store" });
      response.end(options.get(relative));
      return;
    }
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
