#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DEFAULT_API_URL = "https://popcornready-production.up.railway.app";
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_POLL_MS = 5000;

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const apiUrl = trimTrailingSlash(args.apiUrl || process.env.POPCORNREADY_API_URL || DEFAULT_API_URL);
const prompt = readRequiredPrompt(args);
const token = args.dryRun ? "dry-run-token" : readRequiredToken(args);
const projectName = args.projectName || projectNameFromPrompt(prompt);
const timeoutMs = positiveNumber(args.timeoutMs, DEFAULT_TIMEOUT_MS, "--timeout-ms");
const pollMs = positiveNumber(args.pollMs, DEFAULT_POLL_MS, "--poll-ms");
const idempotencyKey = args.idempotencyKey || `storyboard-cli:${Date.now()}`;

const brief = {
  goal: prompt,
  targetLengthSec: positiveNumber(args.targetLengthSec, 30, "--target-length-sec"),
  aspectRatio: args.aspectRatio || "16:9",
  style: args.style || "cinematic storyboard previsualization",
};

const runPayload = {
  ...brief,
  gates: ["asset_generation"],
};

if (args.budgetUsd) runPayload.budgetUsd = positiveNumber(args.budgetUsd, 0, "--budget-usd");

if (args.dryRun) {
  log("dry_run", {
    apiUrl,
    projectName,
    createProject: { name: projectName },
    promptEntrypoint: runPayload,
    idempotencyKey,
  });
  process.exit(0);
}

await main().catch((error) => {
  log("failed", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});

async function main() {
  log("started", {
    apiUrl,
    projectName,
    targetLengthSec: brief.targetLengthSec,
    aspectRatio: brief.aspectRatio,
    gate: "asset_generation",
  });

  const me = await jsonRequest("/api/v1/me");
  log("authenticated", {
    workspaceId: me.workspaceId,
    actor: {
      id: me.actor?.id,
      type: me.actor?.type,
      email: maskEmail(me.actor?.email),
    },
  });

  const project = await createProject();
  const runId = await startPromptRun(project.id);
  const result = await pollRun({ projectId: project.id, runId });

  log("completed", {
    projectId: project.id,
    runId,
    storyboardId: result.storyboardId,
    storyboardPanelCount: result.storyboardPanelCount,
    storyboardFrameAssetIds: result.storyboardFrameAssetIds,
    projectUrl: `https://popcornready.ai/projects/${project.id}`,
    runUrl: `https://popcornready.ai/projects/${project.id}/runs/${runId}`,
  });
}

async function createProject() {
  const body = await jsonRequest("/api/v1/projects", {
    method: "POST",
    body: { name: projectName },
  });
  if (!body.project?.id) {
    throw new Error("Create project response did not include project.id.");
  }
  log("project_created", { projectId: body.project.id, name: body.project.name });
  return body.project;
}

async function startPromptRun(projectId) {
  const body = await jsonRequest(
    `/api/v1/projects/${encodeURIComponent(projectId)}/generation-entrypoints/prompt`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: runPayload,
    }
  );
  if (!body.runId) {
    throw new Error("Prompt entrypoint response did not include runId.");
  }
  log("run_started", { projectId, runId: body.runId });
  return body.runId;
}

async function pollRun({ projectId, runId }) {
  const deadline = Date.now() + timeoutMs;
  let lastSignature = "";
  let directStoryboardRequested = false;

  while (Date.now() < deadline) {
    const detail = await jsonRequest(
      `/api/v1/projects/${encodeURIComponent(projectId)}/generation-runs/${encodeURIComponent(runId)}`
    );
    const storyboardSummary = await storyboardStatus(projectId);
    const storyboardFrameAssetIds = storyboardFrameItems(detail).map((item) => item.assetId);
    const signature = JSON.stringify({
      runStatus: detail.run?.status,
      currentStageType: detail.run?.currentStageType,
      reviewGate: detail.run?.reviewGate?.stageType,
      stages: stageSummary(detail),
      storyboardPanelCount: storyboardSummary.panelCount,
      storyboardFrameAssetIds,
    });

    if (signature !== lastSignature) {
      log("poll", {
        runStatus: detail.run?.status,
        currentStageType: detail.run?.currentStageType,
        reviewGate: detail.run?.reviewGate ?? null,
        stages: stageSummary(detail),
        storyboardId: storyboardSummary.storyboardId,
        storyboardPanelCount: storyboardSummary.panelCount,
        storyboardFrameAssetIds,
      });
      lastSignature = signature;
    }

    const reviewGateStage = detail.run?.reviewGate?.stageType;
    if (reviewGateStage === "asset_generation") {
      if (storyboardSummary.panelCount > 0 || storyboardFrameAssetIds.length > 0) {
        return {
          storyboardId: storyboardSummary.storyboardId,
          storyboardPanelCount: storyboardSummary.panelCount,
          storyboardFrameAssetIds,
        };
      }
      if (!directStoryboardRequested) {
        directStoryboardRequested = true;
        await generateStoryboardFromActivePlan(projectId, runId);
      }
    }

    if (detail.run?.status === "failed" || detail.run?.status === "canceled") {
      throw new Error(`Run ended with status ${detail.run.status}: ${detail.run.error?.message ?? "no error message"}`);
    }

    await sleep(pollMs);
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for storyboard generation.`);
}

async function generateStoryboardFromActivePlan(projectId, runId) {
  const body = await jsonRequest(
    `/api/v1/projects/${encodeURIComponent(projectId)}/storyboards/generate`,
    {
      method: "POST",
      headers: { "Idempotency-Key": `${idempotencyKey}:storyboard:${runId}` },
    }
  );
  log("direct_storyboard_started", {
    projectId,
    runId,
    jobId: body.job?.id ?? null,
    jobStatus: body.job?.status ?? null,
  });
}

async function storyboardStatus(projectId) {
  const body = await jsonRequest(`/api/v1/projects/${encodeURIComponent(projectId)}/storyboards`);
  const storyboards = Array.isArray(body.storyboards) ? body.storyboards : [];
  const listedStoryboard = storyboards[0] ?? null;
  const storyboard = listedStoryboard?.id
    ? (
        await jsonRequest(
          `/api/v1/projects/${encodeURIComponent(projectId)}/storyboards/${encodeURIComponent(listedStoryboard.id)}`
        )
      ).storyboard
    : null;
  return {
    storyboardId: storyboard?.id ?? null,
    panelCount: countPanels(storyboard),
  };
}

function storyboardFrameItems(detail) {
  const items = Array.isArray(detail.stageItems) ? detail.stageItems : [];
  return items.filter(
    (item) => item?.purpose === "storyboard_frame" && typeof item.assetId === "string"
  );
}

function stageSummary(detail) {
  const stages = Array.isArray(detail.stages) ? detail.stages : [];
  return stages.map((stage) => ({
    type: stage.type,
    status: stage.status,
    message: stage.message,
    artifactIds: stage.artifactIds ?? [],
    jobIds: stage.jobIds ?? [],
  }));
}

function countPanels(storyboard) {
  if (!storyboard || !Array.isArray(storyboard.scenes)) return 0;
  let count = 0;
  for (const scene of storyboard.scenes) {
    for (const beat of scene.beats ?? []) {
      count += Array.isArray(beat.panels) ? beat.panels.length : 0;
    }
  }
  return count;
}

async function jsonRequest(path, options = {}) {
  const url = `${apiUrl}${path}`;
  const headers = {
    accept: "application/json",
    authorization: `Bearer ${token}`,
    ...(options.body ? { "content-type": "application/json" } : {}),
    ...(options.headers ?? {}),
  };
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const body = text ? parseJson(text, url) : {};
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${url} failed ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--token-from-clipboard") {
      parsed.tokenFromClipboard = true;
      continue;
    }
    const key = arg.startsWith("--") ? arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : null;
    if (!key) throw new Error(`Unknown positional argument: ${arg}`);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    parsed[key] = value;
    i += 1;
  }
  return parsed;
}

function readRequiredPrompt(parsed) {
  if (parsed.prompt && parsed.promptFile) {
    throw new Error("Use --prompt or --prompt-file, not both.");
  }
  if (parsed.promptFile) return readFileSync(parsed.promptFile, "utf8").trim();
  if (parsed.prompt) return parsed.prompt.trim();
  throw new Error("Missing prompt. Use --prompt or --prompt-file.");
}

function readRequiredToken(parsed) {
  if (parsed.tokenFile) return normalizeToken(readFileSync(parsed.tokenFile, "utf8"));
  if (parsed.token) return normalizeToken(parsed.token);
  if (parsed.tokenFromClipboard) {
    return normalizeToken(execFileSync("pbpaste", { encoding: "utf8" }));
  }
  if (process.env.POPCORNREADY_ACCESS_TOKEN) {
    return normalizeToken(process.env.POPCORNREADY_ACCESS_TOKEN);
  }
  throw new Error(
    "Missing bearer token. Use --token-from-clipboard, --token-file, --token, or POPCORNREADY_ACCESS_TOKEN."
  );
}

function normalizeToken(value) {
  const token = String(value).trim().replace(/^Bearer\s+/i, "").trim();
  if (token.length < 50) throw new Error("Bearer token is empty or too short.");
  return token;
}

function projectNameFromPrompt(value) {
  const firstWords = value
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 8)
    .join(" ");
  return `Storyboard seed - ${firstWords || new Date().toISOString()}`;
}

function positiveNumber(value, fallback, label) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return parsed;
}

function parseJson(text, url) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${url}, received: ${text.slice(0, 200)}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function maskEmail(email) {
  if (!email) return null;
  return String(email).replace(/^(.).+(@.*)$/, "$1***$2");
}

function log(event, payload) {
  console.log(JSON.stringify({ event, ...payload }, null, 2));
}

function printHelp() {
  console.log(`Usage:
  node scripts/start-storyboard-from-prompt.mjs --token-from-clipboard --prompt "..."

Creates a production project, starts generation from a prompt, and gates the run
at asset_generation so storyboard images can be generated without keyframes,
clips, audio, timeline assembly, or export.

Token options:
  --token-from-clipboard        Read a Supabase access token from pbpaste.
  --token-file <path>           Read a Supabase access token from a file.
  --token <token>               Use the provided token.
  POPCORNREADY_ACCESS_TOKEN     Environment fallback.

Generation options:
  --prompt <text>               Prompt/goal for the project.
  --prompt-file <path>          Read prompt from a file.
  --project-name <name>         Project name. Defaults from the prompt.
  --target-length-sec <number>  Defaults to 30.
  --aspect-ratio <ratio>        Defaults to 16:9.
  --style <text>                Defaults to cinematic storyboard previsualization.
  --budget-usd <number>         Optional run budget.

Runtime options:
  --api-url <url>               Defaults to production API.
  --poll-ms <number>            Defaults to 5000.
  --timeout-ms <number>         Defaults to 1200000.
  --idempotency-key <key>       Optional stable idempotency key.
  --dry-run                     Print the requests without calling the API.

Note: the production prompt entrypoint may also create a project poster in the
background. The asset_generation gate blocks heavier media tools such as
generate_anchor, generate_keyframe, and generate_clip.`);
}
