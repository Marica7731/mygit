#!/usr/bin/env node
const assert = require("node:assert/strict");
const { formatDate, startOfRollingMonth } = require("./lib/ranking-window");

function check(input, timeZone, expected) {
  const start = startOfRollingMonth(Date.parse(input), timeZone);
  assert.equal(formatDate(start, timeZone), expected, `${input} in ${timeZone}`);
}

function main() {
  check("2026-10-04T23:59:59+08:00", "Asia/Taipei", "2026-09-04 00:00");
  check("2026-03-31T12:00:00+08:00", "Asia/Taipei", "2026-02-28 00:00");
  check("2026-01-15T12:00:00+08:00", "Asia/Taipei", "2025-12-15 00:00");
  check("2026-07-01T00:00:00+08:00", "Asia/Taipei", "2026-06-01 00:00");
  check("2026-04-01T12:00:00-04:00", "America/New_York", "2026-03-01 00:00");
  check("2026-03-01T12:00:00-05:00", "America/New_York", "2026-02-01 00:00");
  console.log("[verify-ranking-window] passed");
}

main();
