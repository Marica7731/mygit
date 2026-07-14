#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_BLOCKLIST_PATH,
  DEFAULT_GENERATED_ASSET_PATH,
  blocklistHash,
  createBlockedSourceMatcher,
  loadBlocklist,
  validateBlocklist,
} = require("./blocked-vtuber-utils");

const ROOT_DIR = path.resolve(__dirname, "..");
const HTML_FILES = ["index.html", "live.html", "today.html", "month.html"].map((name) => path.join(ROOT_DIR, name));

function main() {
  const blocklist = loadBlocklist(DEFAULT_BLOCKLIST_PATH);
  const validation = validateBlocklist(blocklist, { requireGeneratedAsset: true, assetPath: DEFAULT_GENERATED_ASSET_PATH });
  const errors = [...validation.errors];
  const hash = blocklistHash(blocklist);
  const matchBlockedSource = createBlockedSourceMatcher(blocklist);

  assertEntry(blocklist, errors, "小雪Yukichan Ch.", "UCQymE4njJ-t9oahwX9-iC8w", "@yukichanch");
  assertEntry(blocklist, errors, "羅妲 Rhoda", "UC3zo1jR17JMM53_Ru7yDjfA", "@rhoda1126");
  assertEntry(blocklist, errors, "綽貓喵", "UCW8G8aeRjbIOlL-Fgms8hEQ", "@CheukCat_hkvtuber");
  assertUnsafe(blocklist, errors, "Narrator");
  assertUnsafe(blocklist, errors, "HKVtuber");
  assertHtmlReferences(errors, hash);
  assertMatcherSamples(errors, matchBlockedSource);
  assertSourceAndClientUseGeneratedList(errors);

  if (errors.length) fail(errors.join("\n"));
  const counts = regionCounts(blocklist);
  console.log(
    `TAIWAN_VTUBER_BLOCKLIST_OK entries=${blocklist.entries.length} tw=${counts.TW} hk=${counts.HK} legacy=${counts.LEGACY_REVIEW} hash=${hash}`,
  );
}

function assertEntry(blocklist, errors, name, channelId, handle) {
  const normalizedHandle = handle.toLocaleLowerCase();
  const entry = blocklist.entries.find((item) => item.name === name);
  if (!entry) {
    errors.push(`missing entry ${name}`);
    return;
  }
  if (!entry.channelIds.includes(channelId)) errors.push(`${name}: missing channelId ${channelId}`);
  if (!entry.handles.some((value) => value.toLocaleLowerCase() === normalizedHandle)) errors.push(`${name}: missing handle ${handle}`);
}

function assertUnsafe(blocklist, errors, value) {
  const inRuntime = blocklist.entries.some((entry) => (entry.aliases || []).includes(value) || (entry.titleAliases || []).includes(value));
  if (inRuntime) errors.push(`${value} must not be runtime alias/titleAlias`);
  const inUnsafe = blocklist.entries.some((entry) => (entry.unsafeBroadAliases || []).includes(value));
  if (!inUnsafe) errors.push(`${value} should be retained only in unsafeBroadAliases`);
}

function assertHtmlReferences(errors, hash) {
  const expectedAsset = `assets/blocked-vtuber-channels.js?v=${hash.slice(0, 12)}`;
  for (const file of HTML_FILES) {
    const html = fs.readFileSync(file, "utf8");
    if (!html.includes(expectedAsset)) errors.push(`${path.basename(file)} missing ${expectedAsset}`);
    if (!html.includes("assets/blocked-vtuber-channels.js") || !html.includes("assets/ranking-controls.js")) {
      errors.push(`${path.basename(file)} missing blocklist or ranking controls asset`);
    }
    if (html.indexOf("assets/blocked-vtuber-channels.js") > html.indexOf("assets/ranking-controls.js")) {
      errors.push(`${path.basename(file)} must load blocked-vtuber-channels.js before ranking-controls.js`);
    }
  }
}

function assertMatcherSamples(errors, matchBlockedSource) {
  const blockedSamples = [
    ["Yukichan channelId", { channelId: "UCQymE4njJ-t9oahwX9-iC8w", channelName: "Japanese Channel", title: "歌枠" }],
    ["Yukichan handle", { channelHandle: "@yukichanch", channelName: "Japanese Channel", title: "歌枠" }],
    ["Yukichan channelUrl", { channelUrl: "https://www.youtube.com/@yukichanch", channelName: "Japanese Channel", title: "歌枠" }],
    ["Rhoda channelId", { channelId: "UC3zo1jR17JMM53_Ru7yDjfA", channelName: "Japanese Channel", title: "歌枠" }],
    ["Rhoda handle", { channelHandle: "@rhoda1126", channelName: "Japanese Channel", title: "歌枠" }],
    ["HK exact id", { channelId: "UCW8G8aeRjbIOlL-Fgms8hEQ", channelName: "Japanese Channel", title: "歌枠" }],
    ["HK exact handle", { channelHandle: "@CheukCat_hkvtuber", channelName: "Japanese Channel", title: "歌枠" }],
  ];
  for (const [name, sample] of blockedSamples) {
    if (!matchBlockedSource(sample)) errors.push(`blocked sample did not match: ${name}`);
  }

  const allowedSamples = [
    ["Taiwan travel title", { channelName: "日本旅行チャンネル", title: "台湾旅行 vlog 歌枠" }],
    ["Hong Kong live title", { channelName: "日本音楽チャンネル", title: "香港ライブ" }],
    ["VTuber channel word", { channelName: "VTuber Music", title: "歌枠" }],
    ["Narrator Music", { channelName: "Narrator Music", title: "歌枠" }],
    ["HKVtuber title only", { channelName: "Japanese Channel", title: "HKVtuber discussion" }],
    ["collaboration title only", { channelName: "Japanese Channel", title: "今日は小雪Yukichan Ch. とコラボ" }],
    ["individual word", { channelName: "個人勢 Music", title: "歌枠" }],
  ];
  for (const [name, sample] of allowedSamples) {
    if (matchBlockedSource(sample)) errors.push(`false positive sample matched: ${name}`);
  }
}

function assertSourceAndClientUseGeneratedList(errors) {
  const sourceText = fs.readFileSync(path.join(ROOT_DIR, "scripts", "update-youtube-ranking.js"), "utf8");
  const clientText = fs.readFileSync(path.join(ROOT_DIR, "assets", "ranking-controls.js"), "utf8");
  for (const [label, text] of [
    ["source", sourceText],
    ["client", clientText],
  ]) {
    if (/TAIWAN_VTUBER_BLOCKED_TERMS/u.test(text)) errors.push(`${label}: duplicate TAIWAN_VTUBER_BLOCKED_TERMS remains`);
    if (/DEFAULT_BLOCKED_REGEXPS/u.test(text)) errors.push(`${label}: broad DEFAULT_BLOCKED_REGEXPS hard filter remains`);
  }
  if (!sourceText.includes("blocked-vtuber-matcher")) errors.push("source matcher must import blocked-vtuber-matcher");
  if (!clientText.includes("BlockedVtuberChannels")) errors.push("client matcher must use generated BlockedVtuberChannels");
}

function regionCounts(blocklist) {
  const counts = { TW: 0, HK: 0, LEGACY_REVIEW: 0 };
  for (const entry of blocklist.entries || []) {
    for (const region of entry.regions || []) counts[region] = (counts[region] || 0) + 1;
  }
  return counts;
}

function fail(message) {
  console.error(`TAIWAN_VTUBER_BLOCKLIST_FAIL ${message}`);
  process.exit(1);
}

if (require.main === module) main();
