const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repo = process.env.GITHUB_REPOSITORY || "";
const runId = process.env.GITHUB_RUN_ID || "";
const statusPath = path.join("data", "youtube-ranking-status.json");

const forcedFailureMessage = process.env.YTB_RANKING_FORCE_FAILURE || "";
const failure = getFailureInfo() || (forcedFailureMessage ? { name: forcedFailureMessage } : null);
const ranking = readJson(path.join("data", "youtube-ranking.json")) || {};
const failedCandidate = (forcedFailureMessage && readJson(process.env.YTB_RANKING_FAILURE_DATA || "")) || ranking;
const details = failedCandidate.metricDetailPostProcess || null;
const today = (failedCandidate.groups?.today?.items || [])
  .filter((item) => item.statusType !== "live" && item.statusType !== "upcoming");
const todayWithViews = today.filter((item) => Number(item.viewCount) > 0).length;
const failureDiagnostics = failure ? {
  rateLimited: Boolean(details?.rateLimited),
  rateLimitSource: details?.rateLimitSource || "",
  retryAfter: details?.retryAfter || "",
  blockedUntil: details?.blockedUntil || "",
  youtubeRequestsStarted: details?.youtubeRequestsStarted ?? null,
  candidateGeneratedAt: failedCandidate.generatedAt || "",
  todayVideos: today.length,
  todayWithViews,
  todayMissingViews: today.length - todayWithViews,
} : null;
const status = {
  status: failure ? "failed" : "success",
  attemptedAt: new Date().toISOString(),
  runId,
  runUrl: repo && runId ? `https://github.com/${repo}/actions/runs/${runId}` : "",
  eventName: process.env.GITHUB_EVENT_NAME || "",
  headSha: process.env.GITHUB_SHA || "",
  message: failure
    ? `${failure.name} failed${details?.rateLimited ? " (YouTube HTTP 429; circuit opened)" : ""}${today.length && todayWithViews < 240 ? `; today viewCount ${todayWithViews}/${today.length} (<240)` : ""}`
    : "ranking update passed",
  failedStep: failure ? failure.name : "",
  lastSuccessfulGeneratedAt: ranking.generatedAt || "",
  metricDetailPostProcess: details,
  failureDiagnostics,
  liveDetailPostProcess: ranking.liveDetailPostProcess || null,
  liveDurationPostProcess: ranking.liveDurationPostProcess || null,
};

fs.mkdirSync(path.dirname(statusPath), { recursive: true });
fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);
console.log(`[status] wrote ${statusPath}: ${status.status} ${status.message}`);

function getFailureInfo() {
  if (!repo || !runId) return null;
  try {
    const raw = execFileSync(
      "gh",
      ["api", "--method", "GET", `repos/${repo}/actions/runs/${runId}/jobs`, "-f", "per_page=100"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    );
    const jobs = JSON.parse(raw).jobs || [];
    const job = jobs.find((candidate) => candidate.name === "update-ranking") || jobs[0];
    const steps = job?.steps || [];
    return (
      steps.find((step) => step.conclusion === "failure" && !/Queue next|Update run status|Post |Complete job/.test(step.name || "")) ||
      null
    );
  } catch (error) {
    console.warn(`[status] unable to inspect workflow job: ${error.message}`);
    return null;
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
