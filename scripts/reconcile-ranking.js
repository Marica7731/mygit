#!/usr/bin/env node
const { readFileSync } = require("node:fs");
const { setTimeout: sleep } = require("node:timers/promises");

const UPDATE = "youtube-ranking.yml";
const CHAIN = "youtube-ranking-chain.yml";
const PAGES = "pages.yml";
const QUEUE_GRACE = 20 * 60 * 1000;
const RETRY_DELAYS = [15000, 45000, 90000];

function isActive(run, now = Date.now()) {
  if (run.status === "in_progress" || run.status === "waiting") return true;
  if (!["queued", "pending", "requested"].includes(run.status)) return false;
  const created = Date.parse(run.created_at);
  return !Number.isFinite(created) || now - created < QUEUE_GRACE;
}

function retryable(error) {
  return error.status === 429 || (error.status >= 500 && error.status <= 599) ||
    error.name === "TimeoutError" || error.cause?.code != null;
}

async function retry(operation, { delay = sleep, warn = console.warn } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!retryable(error) || attempt === RETRY_DELAYS.length) throw error;
      warn("Temporary GitHub API failure. Rechecking state before retry: " + error.message);
      await delay(RETRY_DELAYS[attempt]);
    }
  }
}

function createApi(base, repo, token) {
  return async (path, body) => {
    const response = await fetch(base + "/repos/" + repo + "/" + path, {
      method: body ? "POST" : "GET",
      headers: {
        "authorization": "Bearer " + token,
        "accept": "application/vnd.github+json",
        "content-type": "application/json",
      },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const error = new Error(response.status + " " + path);
      error.status = response.status;
      throw error;
    }
    if (body) return;
    return response.json();
  };
}

async function listRuns(api, workflow, filters = {}) {
  const query = new URLSearchParams({ branch: "main", per_page: "20", ...filters });
  return (await api("actions/workflows/" + workflow + "/runs?" + query)).workflow_runs;
}

async function recoverPages(api, { dryRun = false, log = console.log, ...options } = {}) {
  return retry(async () => {
    const { object: { sha } } = await api("git/ref/heads/main");
    const query = new URLSearchParams({ sha, environment: "github-pages", per_page: "10" });
    const deployments = await api("deployments?" + query);
    const latest = deployments[0];
    if (latest) {
      const [status] = await api("deployments/" + latest.id + "/statuses?per_page=1");
      if (status?.state === "success") {
        log("Pages already has a successful deployment for " + sha + " (deployment " + latest.id + ").");
        return "current";
      }
    }
    const active = (await listRuns(api, PAGES, { head_sha: sha })).find((run) =>
      run.head_sha === sha && isActive(run));
    if (active) {
      log("Pages run " + active.id + " is already active for " + sha + ".");
      return "active";
    }
    log((dryRun ? "Would dispatch" : "Dispatching") + " Pages recovery for " + sha + ".");
    if (!dryRun) await api("actions/workflows/" + PAGES + "/dispatches", {
      ref: "main", inputs: { recovery: "true" },
    });
    return dryRun ? "missing" : "dispatched";
  }, options);
}

async function recoverChain(api, trigger, { dryRun = false, log = console.log, ...options } = {}) {
  return retry(async () => {
    const title = "Chain after update " + trigger.id;
    const chains = await listRuns(api, CHAIN);
    if (chains.some((run) => run.display_title === title &&
        (isActive(run) || run.conclusion === "success"))) {
      log("Update " + trigger.id + " already has a chain tick.");
      return "current";
    }
    const updates = await listRuns(api, UPDATE);
    if (updates.some((run) => Number(run.id) > Number(trigger.id) &&
        (isActive(run) || run.status === "completed"))) {
      log("A newer update already owns the chain.");
      return "superseded";
    }
    log((dryRun ? "Would dispatch" : "Dispatching") + " missing chain tick for update " + trigger.id + ".");
    if (!dryRun) await api("actions/workflows/" + CHAIN + "/dispatches", {
      ref: "main", inputs: { trigger_run_id: String(trigger.id) },
    });
    return dryRun ? "missing" : "dispatched";
  }, options);
}

async function recoverUpdate(api, {
  manual = false, ignoreRecentId, log = console.log, now = Date.now, ...options
} = {}) {
  return retry(async () => {
    const time = now();
    const updates = await listRuns(api, UPDATE);
    const busy = updates.some((run) => isActive(run, time) ||
      (String(run.id) !== ignoreRecentId && time - Date.parse(run.updated_at || run.created_at) < 3 * 60 * 1000));
    if (busy) {
      log("An active or recent ranking update already exists.");
      return "active";
    }
    if (!manual) {
      const file = await api("contents/data/youtube-ranking-status.json?ref=main");
      const status = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
      if (status.status === "failed" && time - Date.parse(status.attemptedAt) < 12 * 60 * 1000) {
        log("The previous ranking update is in its failure cooldown.");
        return "cooldown";
      }
    }
    log("Dispatching the next ranking update.");
    await api("actions/workflows/" + UPDATE + "/dispatches", { ref: "main" });
    return "dispatched";
  }, options);
}

async function main() {
  const { GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_EVENT_PATH, GH_TOKEN } = process.env;
  if (!GH_TOKEN || !GITHUB_REPOSITORY) throw new Error("Missing GitHub Actions context");
  const api = createApi(GITHUB_API_URL, GITHUB_REPOSITORY, GH_TOKEN);
  const event = JSON.parse(readFileSync(GITHUB_EVENT_PATH, "utf8"));
  const trigger = event.workflow_run;
  if (process.argv[2] === "update") {
    const ignoreRecentId = trigger?.display_title?.match(/^Chain after update (\d+)$/)?.[1];
    await recoverUpdate(api, { ignoreRecentId, manual: process.env.GITHUB_EVENT_NAME === "workflow_dispatch" });
    return;
  }
  const options = { dryRun: String(event.inputs?.check_only) === "true" };
  const jobs = [recoverPages(api, options)];
  if (trigger?.name === "Update YouTube ranking") jobs.push(recoverChain(api, trigger, options));
  const results = await Promise.allSettled(jobs);
  const errors = results.filter((result) => result.status === "rejected");
  if (errors.length) throw new Error(errors.map(({ reason }) => reason.message).join("\n"));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { recoverChain, recoverPages, recoverUpdate };
