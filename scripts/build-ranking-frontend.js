#!/usr/bin/env node
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const ASSET_DIR = path.join(ROOT_DIR, "assets");
const SOURCE_FILE = path.join(ASSET_DIR, "youtube-ranking.source.js");
const LOADER_FILE = path.join(ASSET_DIR, "youtube-ranking.js");
const CHUNK_COUNT = 11;
const CHECK_ONLY = process.argv.includes("--check");

const CHUNK_HEADER = "window.__YTB_RANKING_CHUNKS = window.__YTB_RANKING_CHUNKS || [];\n";
const CHUNK_CALL_PREFIX = "window.__YTB_RANKING_CHUNKS.push('";
const CHUNK_CALL_SUFFIX = "');\n";

const LOADER = `(function () {
  const chunks = window.__YTB_RANKING_CHUNKS || [];
  const bytes = Uint8Array.from(atob(chunks.join("")), (char) => char.charCodeAt(0));
  const source = new TextDecoder().decode(bytes);
  (0, eval)(source + "\\n//# sourceURL=ytb-ranking-app.js");
})();
`;

function readSource() {
  return fs.readFileSync(SOURCE_FILE, "utf8");
}

// Split on UTF-8 byte boundaries, rounding each piece down to a multiple of 3 so
// every chunk base64-encodes without padding and the chunks concatenate cleanly.
function chooseChunkSize(byteLength) {
  let size = Math.max(3, Math.ceil(byteLength / CHUNK_COUNT));
  size = Math.ceil(size / 3) * 3;

  let count = Math.ceil(byteLength / size);
  while (count > CHUNK_COUNT) {
    size += 3;
    count = Math.ceil(byteLength / size);
  }
  while (count < CHUNK_COUNT && size > 3) {
    size -= 3;
    count = Math.ceil(byteLength / size);
  }
  return size;
}

function buildChunkFiles(source) {
  const bytes = Buffer.from(source, "utf8");
  const chunkSize = chooseChunkSize(bytes.length);
  const pieces = [];

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    pieces.push(bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }

  if (pieces.length !== CHUNK_COUNT) {
    throw new Error(`expected ${CHUNK_COUNT} chunks, produced ${pieces.length} for ${bytes.length} bytes`);
  }

  const encoded = pieces.map((piece) => piece.toString("base64"));
  const joined = Buffer.from(encoded.join(""), "base64").toString("utf8");
  if (joined !== source) {
    throw new Error("chunk round trip does not reproduce the source file");
  }

  return encoded.map(
    (payload, index) => `${CHUNK_HEADER}${CHUNK_CALL_PREFIX}${payload}${CHUNK_CALL_SUFFIX}`,
  );
}

function main() {
  const source = readSource();
  const chunkFiles = buildChunkFiles(source);
  const outputs = chunkFiles.map((text, index) => ({
    file: path.join(ASSET_DIR, `youtube-ranking.chunk${index}.js`),
    text,
  }));
  outputs.push({ file: LOADER_FILE, text: LOADER });

  const stale = [];
  for (const output of outputs) {
    // Generated assets must stay parseable JavaScript; otherwise a broken chunk
    // would only fail in the browser at runtime.
    try {
      new vm.Script(output.text, { filename: path.relative(ROOT_DIR, output.file) });
    } catch (error) {
      throw new Error(`${path.relative(ROOT_DIR, output.file)} is not valid JavaScript: ${error.message}`);
    }
    const current = fs.existsSync(output.file) ? fs.readFileSync(output.file, "utf8") : null;
    if (current === output.text) continue;
    stale.push(path.relative(ROOT_DIR, output.file));
    if (CHECK_ONLY) continue;
    fs.writeFileSync(output.file, output.text, "utf8");
    console.log(`[build-frontend] wrote ${path.relative(ROOT_DIR, output.file)}`);
  }

  if (CHECK_ONLY) {
    if (stale.length) {
      console.error("[build-frontend] generated frontend assets are out of date:");
      for (const file of stale) console.error(`- ${file}`);
      console.error("Run: npm run build:frontend");
      process.exit(1);
    }
    console.log(`[build-frontend] checked ${outputs.length} generated asset(s) against source`);
    return;
  }

  if (!stale.length) console.log("[build-frontend] generated assets already up to date");
  console.log(`[build-frontend] source=${Buffer.byteLength(source, "utf8")} bytes, chunks=${CHUNK_COUNT}`);
}

main();
