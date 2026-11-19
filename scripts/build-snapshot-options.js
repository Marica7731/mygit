#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = path.join(__dirname, "..", "data");
const GROUPS = ["live", "today", "week", "month"];

function snapshotOptions(group) {
  const filename = path.join(DATA_DIR, group + "-snapshots", "index.json");
  const { snapshots } = JSON.parse(fs.readFileSync(filename, "utf8"));
  if (!Array.isArray(snapshots)) throw new Error("Invalid snapshot index: " + filename);
  return snapshots.map(({ id, label }) => {
    if (typeof id !== "string" || !/^[a-z0-9._-]+$/i.test(id)) throw new Error("Invalid snapshot ID: " + filename);
    return { id, label: label || id };
  });
}

if (require.main === module) {
  for (const group of GROUPS) {
    const text = JSON.stringify({ snapshots: snapshotOptions(group) }) + "\n";
    fs.writeFileSync(path.join(DATA_DIR, group + "-snapshot-options.json"), text);
    console.log("[snapshot-options] " + group + " " + Buffer.byteLength(text, "utf8") + " bytes");
  }
}

module.exports = { snapshotOptions };
