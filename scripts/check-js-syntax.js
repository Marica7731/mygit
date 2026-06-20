#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const TARGET_DIRS = ["scripts", "assets"];

function listJavaScriptFiles(dir) {
  const absoluteDir = path.join(ROOT_DIR, dir);
  if (!fs.existsSync(absoluteDir)) return [];

  return fs
    .readdirSync(absoluteDir, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = path.join(dir, entry.name);
      const absolutePath = path.join(ROOT_DIR, relativePath);
      if (entry.isDirectory()) return listJavaScriptFiles(relativePath);
      return entry.isFile() && entry.name.endsWith(".js") ? [absolutePath] : [];
    })
    .sort();
}

function main() {
  const files = TARGET_DIRS.flatMap(listJavaScriptFiles);
  const failed = [];

  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], {
      cwd: ROOT_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (result.status !== 0) {
      failed.push({
        file: path.relative(ROOT_DIR, file),
        output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
      });
    }
  }

  if (failed.length) {
    console.error("[check-js] syntax check failed:");
    for (const item of failed) {
      console.error(`- ${item.file}`);
      if (item.output) console.error(item.output);
    }
    process.exit(1);
  }

  console.log(`[check-js] checked ${files.length} JavaScript files`);
}

main();
