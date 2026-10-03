#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const GROUPS = ["live", "today", "week", "month"];
const PAGES = [
  { file: "index.html", group: "live", navHref: null },
  { file: "live.html", group: "live", navHref: "live.html" },
  { file: "today.html", group: "today", navHref: "today.html" },
  { file: "week.html", group: "week", navHref: "week.html" },
  { file: "month.html", group: "month", navHref: "month.html" },
];
const ASSET_REF_PATTERN = /(?:src|href)="([^"]+)"/g;

const errors = [];

function main() {
  const appSource = readText("assets/youtube-ranking.source.js");
  const controlsSource = readText("assets/ranking-controls.js");

  for (const group of GROUPS) {
    if (!appSource.includes(`    ${group}: {`)) {
      errors.push(`assets/youtube-ranking.source.js is missing PAGE_CONFIG.${group}`);
    }
    if (!fs.existsSync(path.join(ROOT_DIR, "data", `youtube-ranking-${group}.json`))) {
      errors.push(`data/youtube-ranking-${group}.json is missing`);
    }
    if (!controlsSource.includes(`"${group}"`)) {
      errors.push(`assets/ranking-controls.js does not know about group ${group}`);
    }
  }

  for (const page of PAGES) {
    if (!fs.existsSync(path.join(ROOT_DIR, page.file))) {
      errors.push(`${page.file} is missing`);
      continue;
    }
    const html = readText(page.file);
    const sourceGroup = html.match(/<body[^>]*data-source-group="([^"]+)"/)?.[1];
    if (sourceGroup !== page.group) {
      errors.push(`${page.file}: data-source-group must be ${page.group}, got ${sourceGroup || "(missing)"}`);
    }
    if (html.includes("assets/youtube-ranking.source.js")) {
      errors.push(`${page.file} must not load assets/youtube-ranking.source.js directly`);
    }

    for (const match of html.matchAll(ASSET_REF_PATTERN)) {
      const ref = match[1];
      if (/^(?:https?:|data:|#|mailto:)/.test(ref)) continue;
      const cleanRef = ref.split("?")[0].split("#")[0];
      if (!cleanRef) continue;
      if (!fs.existsSync(path.join(ROOT_DIR, cleanRef))) {
        errors.push(`${page.file} references missing asset ${cleanRef}`);
      }
    }
  }

  for (const page of PAGES) {
    if (!page.navHref) continue;
    const expected = `navLink("${page.navHref}", "${page.group}",`;
    if (!appSource.includes(expected)) {
      errors.push(`assets/youtube-ranking.source.js is missing nav link for ${page.navHref}`);
    }
  }

  const generatedAssets = fs
    .readdirSync(path.join(ROOT_DIR, "assets"))
    .filter((name) => /^youtube-ranking\.chunk\d+\.js$/.test(name));
  if (generatedAssets.length !== 11) {
    errors.push(`expected 11 generated chunk files, found ${generatedAssets.length}`);
  }

  if (errors.length) {
    console.error("[verify-pages] page wiring check failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`[verify-pages] checked ${PAGES.length} pages, ${GROUPS.length} groups, ${generatedAssets.length} chunks`);
}

function readText(relativePath) {
  const filePath = path.join(ROOT_DIR, relativePath);
  if (!fs.existsSync(filePath)) {
    errors.push(`${relativePath} is missing`);
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

main();
