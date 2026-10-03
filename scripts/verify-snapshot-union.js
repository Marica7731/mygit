#!/usr/bin/env node
const assert = require("node:assert");
const {
  loadSnapshotBatches,
  loadSnapshotUnion,
  snapshotItemKey,
  unionWindowItems,
} = require("./lib/snapshot-union");

function main() {
  const current = {
    videoId: "current",
    title: "current",
    publishedTimestamp: 150,
    viewCount: 0,
    viewText: "",
  };
  const snapshotDuplicate = {
    videoId: "current",
    title: "current",
    publishedTimestamp: 150,
    viewCount: 42,
    viewText: "42 views",
  };
  const oldOnly = {
    videoId: "old",
    title: "old",
    publishedTimestamp: 90,
    viewCount: 7,
    viewText: "7 views",
  };
  const outside = {
    videoId: "outside",
    title: "outside",
    publishedTimestamp: 250,
  };

  const result = unionWindowItems(
    [
      { source: "current", items: [current, outside] },
      { source: "snapshot", items: [snapshotDuplicate, oldOnly] },
    ],
    0,
    200,
  );

  assert.strictEqual(result.length, 2, "window union must keep both in-window videos");
  assert.strictEqual(new Set(result.map(snapshotItemKey)).size, 2, "union must deduplicate by video identity");
  const currentResult = result.find((item) => item.videoId === "current");
  assert.strictEqual(currentResult.viewCount, 42, "missing metrics should be filled from snapshots");
  assert.ok(!result.some((item) => item.videoId === "outside"), "out-of-window videos must be excluded");

  const uncappedItems = Array.from({ length: 1500 }, (_, index) => ({
    videoId: `uncapped-${index}`,
    publishedTimestamp: 100 + index,
  }));
  const uncapped = unionWindowItems([{ source: "history", items: uncappedItems }], 0, 2000);
  assert.strictEqual(uncapped.length, 1500, "formal snapshot union must not apply an output cap");

  const emptyDir = require("node:fs").mkdtempSync(require("node:os").tmpdir() + "/ytb-snapshot-union-");
  const loaded = loadSnapshotBatches(emptyDir);
  assert.strictEqual(loaded.filesRead, 0, "missing snapshot directories must be tolerated");
  require("node:fs").rmSync(emptyDir, { recursive: true, force: true });

  const fixtureDir = require("node:fs").mkdtempSync(require("node:os").tmpdir() + "/ytb-snapshot-union-load-");
  const snapshotDir = require("node:path").join(fixtureDir, "month-snapshots");
  require("node:fs").mkdirSync(snapshotDir, { recursive: true });
  require("node:fs").writeFileSync(
    require("node:path").join(snapshotDir, "index.json"),
    JSON.stringify({
      snapshots: [{ id: "20261001T000000Z", file: "20261001T000000Z.json" }],
    }),
  );
  require("node:fs").writeFileSync(
    require("node:path").join(snapshotDir, "20261001T000000Z.json"),
    JSON.stringify({ groups: { month: { items: [oldOnly] } } }),
  );
  const loadedFixture = loadSnapshotBatches(fixtureDir, ["month"]);
  assert.strictEqual(loadedFixture.filesRead, 1, "indexed snapshot files must be loaded");
  assert.deepStrictEqual(loadedFixture.sourceGroups, ["month"], "loaded snapshot source groups must be reported");
  assert.strictEqual(loadedFixture.itemsScanned, 1, "loaded snapshot item totals must be reported");
  const currentEntry = JSON.parse(
    require("node:fs").readFileSync(require("node:path").join(snapshotDir, "index.json"), "utf8"),
  ).snapshots[0];
  const olderEntry = {
    ...currentEntry,
    id: "20260930T000000Z",
    file: "20260930T000000Z.json",
    capturedAt: "1970-01-01T00:00:00.000Z",
  };
  currentEntry.capturedAt = "2026-10-01T00:00:00.000Z";
  require("node:fs").writeFileSync(
    require("node:path").join(snapshotDir, "index.json"),
    JSON.stringify({ snapshots: [currentEntry, olderEntry] }),
  );
  require("node:fs").writeFileSync(
    require("node:path").join(snapshotDir, olderEntry.file),
    JSON.stringify({ groups: { month: { items: [{ videoId: "too-old", publishedTimestamp: 1 }] } } }),
  );
  const unionLoaded = loadSnapshotUnion(fixtureDir, {
    groups: ["month"],
    start: 1,
    end: Date.parse("2026-11-01T00:00:00.000Z"),
  });
  assert.strictEqual(unionLoaded.filesRead, 1, "snapshots captured before the window must be skipped");
  assert.strictEqual(unionLoaded.skippedBeforeWindow, 1, "pre-window skips must be reported");
  assert.strictEqual(unionLoaded.items.length, 1, "streaming snapshot union must retain only in-window deduped items");
  assert.strictEqual(unionLoaded.items[0].videoId, "old", "streaming snapshot union must keep the indexed item");
  require("node:fs").rmSync(fixtureDir, { recursive: true, force: true });

  console.log("[verify-snapshot-union] passed");
}

main();
