#!/usr/bin/env node
const assert = require("node:assert/strict");
const test = require("node:test");
const { recoverChain, recoverPages, recoverUpdate } = require("./reconcile-ranking");

const quiet = { delay: async () => {}, log: () => {}, warn: () => {} };
const time = Date.parse("2026-11-25T19:00:00Z");
const statusFile = (status) => ({ content: Buffer.from(JSON.stringify(status)).toString("base64") });

function pagesApi(deploymentState, dispatch) {
  return async (path, body) => {
    if (path === "git/ref/heads/main") return { object: { sha: "current-main" } };
    if (path.startsWith("deployments?")) {
      assert.equal(new URLSearchParams(path.split("?")[1]).get("sha"), "current-main");
      return [{ id: 17 }];
    }
    if (path === "deployments/17/statuses?per_page=1") return [{ state: deploymentState }];
    return dispatch(path, body);
  };
}

test("a failed Pages deployment is retried after 500 without re-grabbing ranking data", async () => {
  let reads = 0;
  let posts = 0;
  const api = pagesApi("failure", async (path, body) => {
    if (path.includes("/runs?")) {
      reads++;
      assert.ok(path.includes("head_sha=current-main"));
      return { workflow_runs: [{ head_sha: "current-main", status: "completed", conclusion: "failure" }] };
    }
    assert.equal(path, "actions/workflows/pages.yml/dispatches");
    assert.deepEqual(body, { ref: "main", inputs: { recovery: "true" } });
    if (++posts === 1) throw Object.assign(new Error("500"), { status: 500 });
  });
  assert.equal(await recoverPages(api, quiet), "dispatched");
  assert.equal(reads, 2);
  assert.equal(posts, 2);
});

test("a successful real Pages deployment stops reconciliation without another dispatch", async () => {
  const api = pagesApi("success", () => assert.fail("unexpected workflow API call"));
  assert.equal(await recoverPages(api, quiet), "current");
});

test("a Pages dispatch accepted despite a 502 does not create a duplicate", async () => {
  let posts = 0;
  const api = pagesApi("failure", async (path) => {
    if (path.includes("/runs?")) {
      return { workflow_runs: posts ? [{ id: 40, status: "in_progress", head_sha: "current-main" }] : [] };
    }
    posts++;
    throw Object.assign(new Error("502"), { status: 502 });
  });
  assert.equal(await recoverPages(api, quiet), "active");
  assert.equal(posts, 1);
});

test("recovery replaces a long-stuck pending Pages run and dry-run only reports", async () => {
  const api = pagesApi("failure", async (path) => {
    assert.ok(path.includes("/runs?"));
    return { workflow_runs: [{ status: "queued", head_sha: "current-main", created_at: "2020-01-01T00:00:00Z" }] };
  });
  assert.equal(await recoverPages(api, { ...quiet, dryRun: true }), "missing");
});

test("a completed update gets its missing exact chain tick after a transient failure", async () => {
  let posts = 0;
  const api = async (path, body) => {
    if (path.includes("/runs?")) return { workflow_runs: [{ id: 12, status: "completed", conclusion: "success" }] };
    assert.equal(path, "actions/workflows/youtube-ranking-chain.yml/dispatches");
    assert.deepEqual(body, { ref: "main", inputs: { trigger_run_id: "12" } });
    if (++posts === 1) throw Object.assign(new Error("502"), { status: 502 });
  };
  assert.equal(await recoverChain(api, { id: 12 }, quiet), "dispatched");
  assert.equal(posts, 2);
});

test("a visible chain tick or a newer update prevents redundant continuation", async () => {
  assert.equal(await recoverChain(async () => ({
    workflow_runs: [{ display_title: "Chain after update 12", status: "in_progress" }],
  }), { id: 12 }, quiet), "current");
  assert.equal(await recoverChain(async (path) => ({
    workflow_runs: path.includes("youtube-ranking.yml/") ? [{ id: 13, status: "completed" }] : [],
  }), { id: 12 }, quiet), "superseded");
});

test("scheduled dispatch retries after 502, rechecks the queue and respects failure cooldown", async () => {
  let posts = 0;
  const api = async (path) => {
    if (path.includes("/runs?")) return { workflow_runs: posts ? [{ status: "in_progress" }] : [] };
    if (path.startsWith("contents/")) return statusFile({ status: "success" });
    assert.equal(path, "actions/workflows/youtube-ranking.yml/dispatches");
    posts++;
    throw Object.assign(new Error("502"), { status: 502 });
  };
  assert.equal(await recoverUpdate(api, { ...quiet, now: () => time }), "active");
  assert.equal(posts, 1);
  assert.equal(await recoverUpdate(async (path) => {
    if (path.includes("/runs?")) return { workflow_runs: [] };
    assert.ok(path.startsWith("contents/"));
    return statusFile({ status: "failed", attemptedAt: "2026-11-25T18:57:00Z" });
  }, { ...quiet, now: () => time }), "cooldown");
});

test("chain failure can resume despite the triggering run's recent completion", async () => {
  const api = async (path, body) => {
    if (path.includes("/runs?")) {
      return { workflow_runs: [{ id: 12, status: "completed", updated_at: "2026-11-25T18:59:00Z" }] };
    }
    if (path.startsWith("contents/")) return statusFile({ status: "success" });
    assert.equal(path, "actions/workflows/youtube-ranking.yml/dispatches");
    assert.deepEqual(body, { ref: "main" });
  };
  assert.equal(await recoverUpdate(api, { ...quiet, now: () => time }), "active");
  assert.equal(await recoverUpdate(api, { ...quiet, now: () => time, ignoreRecentId: "12" }), "dispatched");
});

test("retry budget is finite, and permission errors fail immediately", async () => {
  for (const [status, expected] of [[502, 4], [403, 1]]) {
    let calls = 0;
    await assert.rejects(recoverPages(async () => {
      calls++;
      throw Object.assign(new Error(String(status)), { status });
    }, quiet), { status });
    assert.equal(calls, expected);
  }
});
