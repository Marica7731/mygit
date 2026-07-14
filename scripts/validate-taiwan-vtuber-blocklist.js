#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const SOURCE_FILE = path.join(ROOT_DIR, "scripts", "update-youtube-ranking.js");
const CLIENT_FILE = path.join(ROOT_DIR, "assets", "ranking-controls.js");
const HTML_FILES = ["index.html", "live.html", "today.html", "month.html"].map((name) => path.join(ROOT_DIR, name));
const EXPECTED_VERSION = "assets/ranking-controls.js?v=20260714-twblock4";

const REQUIRED_TERMS = [
  "小雪Yukichan Ch.",
  "小雪Yukichan",
  "Yukichan Ch.",
  "@yukichanch",
  "yukichanch",
  "youtube.com/@yukichanch",
  "UCQymE4njJ-t9oahwX9-iC8w",
  "羅妲 Rhoda",
  "羅妲",
  "@rhoda1126",
  "rhoda1126",
  "youtube.com/@rhoda1126",
  "UC3zo1jR17JMM53_Ru7yDjfA",
];

const DAILY_SYNC_TERMS = [
  "凝川眠",
  "蘇米",
  "Sumi Ch.",
  "CheukCat",
  "綽貓喵",
  "LutraLutra",
  "Olda",
  "Oumua",
  "Kumosuki",
  "Eisnebel",
  "Xxhacucoxx",
  "Moondogs",
  "Karasu",
  "Sotis",
  "Kururun",
  "Cray Ch.",
];

const UNSAFE_BROAD_TERMS = [
  "HKVtuber",
  "Narrator",
  "台灣Vtuber",
  "台湾Vtuber",
  "台V",
  "台v",
];

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function fail(message) {
  console.error(`TAIWAN_VTUBER_BLOCKLIST_FAIL ${message}`);
  process.exit(1);
}

function assertContains(text, term, file) {
  if (!text.includes(term)) fail(`${path.relative(ROOT_DIR, file)} missing ${term}`);
}

function assertNotQuoted(text, term, file) {
  if (text.includes(`"${term}"`)) fail(`${path.relative(ROOT_DIR, file)} contains unsafe broad term ${term}`);
}

function normalizeBlockedText(value) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFKC")
    .toLowerCase();
}

function isSampleBlocked(sample) {
  const haystack = normalizeBlockedText(
    [sample.channelName, sample.channelId, sample.channelUrl, sample.title, sample.videoId, sample.watchUrl, sample.searchableText].join(" "),
  );
  return REQUIRED_TERMS.some((term) => haystack.includes(normalizeBlockedText(term)));
}

const sourceText = readText(SOURCE_FILE);
const clientText = readText(CLIENT_FILE);

for (const term of [...REQUIRED_TERMS, ...DAILY_SYNC_TERMS]) {
  assertContains(sourceText, term, SOURCE_FILE);
  assertContains(clientText, term, CLIENT_FILE);
}

for (const term of UNSAFE_BROAD_TERMS) {
  assertNotQuoted(sourceText, term, SOURCE_FILE);
  assertNotQuoted(clientText, term, CLIENT_FILE);
}

if (!clientText.includes("item?.channelUrl")) fail("assets/ranking-controls.js must include channelUrl in default blocklist haystack");

for (const file of HTML_FILES) {
  const html = readText(file);
  assertContains(html, EXPECTED_VERSION, file);
}

const samples = [
  {
    channelName: "小雪Yukichan Ch.",
    channelId: "UCQymE4njJ-t9oahwX9-iC8w",
    channelUrl: "https://www.youtube.com/@yukichanch",
    title: "歌枠",
  },
  {
    channelName: "羅妲 Rhoda",
    channelId: "UC3zo1jR17JMM53_Ru7yDjfA",
    channelUrl: "https://www.youtube.com/@rhoda1126",
    title: "歌枠",
  },
  {
    channelName: "unknown",
    channelUrl: "https://www.youtube.com/@rhoda1126",
    title: "歌枠",
  },
  {
    channelName: "unknown",
    channelUrl: "https://www.youtube.com/@yukichanch",
    title: "歌枠",
  },
];

for (const sample of samples) {
  if (!isSampleBlocked(sample)) fail(`sample did not match blocklist: ${JSON.stringify(sample)}`);
}

console.log(`TAIWAN_VTUBER_BLOCKLIST_OK terms=${REQUIRED_TERMS.length} daily_sync_terms=${DAILY_SYNC_TERMS.length}`);
