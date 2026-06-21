const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const DATA_FILE = path.join(ROOT, "data", "youtube-ranking.json");
const GROUPS = ["live", "today", "month"];
const CHECK_ONLY = process.argv.includes("--check");
const FRONTEND_OMIT_ITEM_FIELDS = ["searchableText"];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function stringifyJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function writeJson(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

function groupPayload(payload, groupName) {
  const group = compactFrontendGroup(payload.groups?.[groupName]);
  if (!group || typeof group !== "object") {
    throw new Error(`data/youtube-ranking.json does not contain groups.${groupName}`);
  }

  return {
    ...payload,
    groups: {
      [groupName]: group,
    },
  };
}

function compactFrontendGroup(group) {
  if (!group || typeof group !== "object") return group;
  const nextGroup = {
    ...group,
    items: compactItems(group.items),
  };
  if (group.keywords && typeof group.keywords === "object") {
    nextGroup.keywords = {};
    for (const [keyword, items] of Object.entries(group.keywords)) {
      nextGroup.keywords[keyword] = compactItems(items);
    }
  }
  return nextGroup;
}

function compactItems(items) {
  if (!Array.isArray(items)) return items;
  return items.map((item) => {
    if (!item || typeof item !== "object") return item;
    const nextItem = { ...item };
    for (const field of FRONTEND_OMIT_ITEM_FIELDS) delete nextItem[field];
    return nextItem;
  });
}

function main() {
  const payload = readJson(DATA_FILE);
  let checked = 0;
  for (const groupName of GROUPS) {
    const outputPath = path.join(ROOT, "data", `youtube-ranking-${groupName}.json`);
    const value = groupPayload(payload, groupName);
    const text = stringifyJson(value);
    const relativePath = path.relative(ROOT, outputPath);

    if (CHECK_ONLY) {
      const existing = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
      if (existing !== text) {
        throw new Error(`${relativePath} is not up to date; run node scripts/write-ranking-groups.js`);
      }
      checked += 1;
      continue;
    }

    writeJson(outputPath, text);
    const bytes = Buffer.byteLength(text, "utf8");
    console.log(`[write-ranking-groups] ${relativePath} ${bytes} bytes`);
  }

  if (CHECK_ONLY) {
    console.log(`[write-ranking-groups] checked ${checked} group files`);
  }
}

main();
