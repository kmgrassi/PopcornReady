import { createHash } from "crypto";
import { Router } from "express";
import { mutation, route } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import type { HandlerCtx } from "@/lib/api/v1/handler";
import { runIdempotent } from "@/lib/api/v1/idempotency";
import {
  assertCreativeDirectorHierarchyRoot,
  cancelOrchestratorRunFamily,
  createPendingApprovalGate,
  createReachedApprovalGate,
  createOrchestratorRun,
  createOrchestratorRunWithAnonymousQuota,
  getOrchestratorRun,
  listRunActions,
  listRunGates,
  listOrchestratorRunsForProject,
  resetGatesToPending,
  resolveGate,
  supersedeRunActions,
  updateOrchestratorRun,
  type OrchestratorRun,
  type OrchestratorRunGate,
  type RunActionSummary,
  type UpdateOrchestratorRunPatch,
} from "@/lib/api/v1/orchestrator-store";
import {
  createAction,
  createBriefVersion,
  getActiveProjectBrief,
  getAsset,
  getJob,
  getProject,
  recordProjectActivity,
} from "@/lib/api/v1/store";
import { startPosterGenerationInBackground } from "@/lib/api/v1/poster-background";
import { parseBrief } from "@/lib/api/v1/schemas";
import { enqueueOrchestratorDispatch } from "@/lib/orchestrator/recovery-worker";
import {
  GENERATION_STAGE_ORDER,
  GATEABLE_GENERATION_STAGE_TYPES,
  type GateableGenerationStageType,
  type BoardRevisionTarget,
  type GenerationStageType,
  type Job,
} from "@popcorn/shared/v1/types";
import {
  canViewOperatorDiagnostics,
  generationActions,
  isInsufficientCreditsFailure,
  runFailedForInsufficientCredits,
} from "./orchestrator-run-helpers.js";
import {
  projectRun,
  projectRunDetailFromParts,
  type GenerationRunDetail,
  type RunAssetPrompt,
} from "./orchestrator-run-projections.js";
import { getAgentSession, getRootRunFamily } from "@/lib/api/v1/domain-session-store";
import { projectCreatorRunHierarchy } from "./session-run-projection.js";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const ANONYMOUS_RUN_QUOTA_LIMIT = 1;
const ANONYMOUS_RUN_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
const AFTER_GATE_PREFIX = "after:";

export const orchestratorRunsRouter = Router();
export {
  canViewOperatorDiagnostics,
  isInsufficientCreditsFailure,
  runFailedForInsufficientCredits,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireParam(params: Record<string, string | undefined>, name: string): string {
  const value = params[name];
  if (!value) throw new ApiError("validation_failed", `${name} is required.`);
  return value;
}

async function requireProjectAccess(workspaceId: string, projectId: string): Promise<void> {
  await getProject(workspaceId, projectId);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function anonymousRunQuotaForAuth(auth: {
  actor: { isAnonymous?: boolean };
  workspaceId: string;
}): { windowStartIso: string; limit: number } | undefined {
  if (!auth.actor.isAnonymous) return undefined;
  return {
    windowStartIso: new Date(Date.now() - ANONYMOUS_RUN_QUOTA_WINDOW_MS).toISOString(),
    limit: ANONYMOUS_RUN_QUOTA_LIMIT,
  };
}


function promptBriefFromBody(body: unknown) {
  if (!isRecord(body)) {
    throw new ApiError("validation_failed", "Request body must be an object.");
  }
  const source = isRecord(body.brief)
    ? body.brief
    : {
        goal: body.goal,
        targetLengthSec: body.targetLengthSec ?? 30,
        aspectRatio: body.aspectRatio ?? "9:16",
        style: body.style ?? "fast-paced social ad",
        audience: body.audience,
        platform: body.platform,
        format: body.format,
        hookQuestion: body.hookQuestion,
        strongestVisual: body.strongestVisual,
        oneBigIdea: body.oneBigIdea,
        caveat: body.caveat,
        payoff: body.payoff,
        narration: body.narration,
        constraints: body.constraints,
      };
  return parseBrief(source, "brief");
}

export function stopAfterTools(body: unknown): string[] {
  if (!isRecord(body)) return [];
  if (body.runThrough === false && typeof body.stopAfter !== "string") {
    return ["generate_storyboard"];
  }
  if (typeof body.stopAfter !== "string") return [];
  switch (body.stopAfter) {
    case "brief_intake":
      return ["create_or_load_brief"];
    case "creative_plan":
      return ["plan_visual_anchors"];
    case "storyboard":
      return ["generate_storyboard"];
    case "asset_generation":
      return ["generate_keyframe"];
    case "audio_generation":
      return ["fit_audio_to_picture"];
    case "timeline_assembly":
      return ["assemble_timeline"];
    case "quality_review":
      return ["critique_timeline"];
    case "export":
      return ["export_video"];
    default:
      throw new ApiError("validation_failed", "stopAfter must be a gateable generation stage.", {
        fields: [{ path: "stopAfter", message: "Expected a gateable generation stage." }],
      });
  }
}

/**
 * Every newly started production run pauses after its complete storyboard.
 * This is server-owned policy: a client checkbox or an orchestrator decision
 * must never be able to skip the creator's first visual review.
 */
export function initialRunStopAfterTools(body: unknown): string[] {
  // `stopAfter` and review-gate payloads are legacy controls. An initial
  // production run has exactly one boundary: a complete storyboard. They are
  // deliberately ignored rather than becoming an earlier client-created stop.
  void body;
  return ["generate_storyboard"];
}

function afterGateTools(tools: string[]): string[] {
  return tools.map((tool) => `${AFTER_GATE_PREFIX}${tool}`);
}

/** The identical gate contract used by prompt and uploaded-footage entrypoints. */
export function initialRunGates(body: unknown): string[] {
  return afterGateTools(initialRunStopAfterTools(body));
}

/** Re-open a storyboard-complete run so approval can continue production. */
export function storyboardContinuationPatch(run: OrchestratorRun): UpdateOrchestratorRunPatch {
  return {
    status: "waiting",
    startedAt: run.startedAt ?? new Date().toISOString(),
    clearCompletedAt: true,
    clearError: true,
  };
}

export function isStoryboardAfterGate(gate: Pick<OrchestratorRunGate, "stage">): boolean {
  return gate.stage === `${AFTER_GATE_PREFIX}generate_storyboard`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value ?? null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function runIdempotencyScope(args: {
  workspaceId: string;
  actorId: string;
  projectId: string;
  entrypoint: string;
}): string {
  return [
    args.workspaceId,
    args.actorId,
    "POST",
    `/api/v1/projects/${args.projectId}/generation-entrypoints/${args.entrypoint}`,
    "orchestrator_run",
  ].join(":");
}

function runBodyHash(args: {
  inputSummary: string;
  gates: string[];
  budgetUsd?: number;
  body: unknown;
}): string {
  return sha256(
    JSON.stringify(
      canonicalize({
        inputSummary: args.inputSummary,
        gates: args.gates,
        budgetUsd: args.budgetUsd ?? null,
        body: isRecord(args.body) ? args.body : {},
      })
    )
  );
}

async function createEntrypointRun(args: {
  workspaceId: string;
  actorId: string;
  projectId: string;
  entrypoint: string;
  idempotencyKey: string | null;
  inputSummary: string;
  gates: string[];
  budgetUsd?: number;
  body: unknown;
  anonymousQuota?: { windowStartIso: string; limit: number };
}): Promise<{ run: OrchestratorRun; replayed: boolean }> {
  const createRun = () => {
    const input = {
      projectId: args.projectId,
      inputSummary: args.inputSummary,
      gates: args.gates,
      budgetUsd: args.budgetUsd,
    };
    return args.anonymousQuota
      ? createOrchestratorRunWithAnonymousQuota(input, args.anonymousQuota)
      : createOrchestratorRun(input);
  };

  if (!args.idempotencyKey) {
    return {
      run: await createRun(),
      replayed: false,
    };
  }

  let produced = false;
  const result = await runIdempotent(
    runIdempotencyScope(args),
    args.idempotencyKey,
    runBodyHash(args),
    async () => {
      produced = true;
      const run = await createRun();
      return { status: 202, body: { runId: run.id } };
    }
  );
  const body = isRecord(result.body) ? result.body : {};
  const runId = typeof body.runId === "string" ? body.runId : "";
  if (!runId) {
    throw new ApiError("internal_error", "Idempotent orchestrator run response was missing runId.");
  }
  return {
    run: await getOrchestratorRun(runId),
    replayed: !produced,
  };
}

function budgetUsd(body: unknown): number | undefined {
  if (!isRecord(body) || body.budgetUsd === undefined) return undefined;
  const parsed = Number(body.budgetUsd);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function requestedProvider(body: unknown): string | undefined {
  if (!isRecord(body) || typeof body.provider !== "string") return undefined;
  const trimmed = body.provider.trim();
  return trimmed || undefined;
}

async function requireReadyVisualAssets(input: {
  workspaceId: string;
  projectId: string;
  assetIds: string[];
}): Promise<void> {
  for (const assetId of input.assetIds) {
    let asset;
    try {
      asset = await getAsset(input.workspaceId, input.projectId, assetId);
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== "not_found") throw err;
      throw new ApiError("asset_invalid", `Asset not found in project: ${assetId}`, {
        fields: [{ path: "assetIds", message: `Unknown asset: ${assetId}` }],
      });
    }
    if (asset.status !== "ready") {
      throw new ApiError(
        "asset_not_ready",
        `Asset ${assetId} is not ready (status: ${asset.status}).`,
        { fields: [{ path: "assetIds", message: `Asset ${assetId} is ${asset.status}.` }] }
      );
    }
    if (asset.kind === "audio") {
      throw new ApiError("validation_failed", "Uploaded-footage runs need visual assets.", {
        fields: [{ path: "assetIds", message: `Asset ${assetId} is audio.` }],
      });
    }
  }
}

export type GenerationJobLoader = (
  workspaceId: string,
  projectId: string,
  jobId: string
) => Promise<Job>;

export async function loadRunJobsForProjection(input: {
  workspaceId: string;
  projectId: string;
  actions: RunActionSummary[];
  loadJob?: GenerationJobLoader;
}): Promise<Map<string, Job>> {
  const jobs = new Map<string, Job>();
  const jobIds = [...new Set(input.actions.flatMap((action) => action.jobIds))];
  const loadJob = input.loadJob ?? getJob;
  await Promise.all(
    jobIds.map(async (jobId) => {
      try {
        const job = await loadJob(input.workspaceId, input.projectId, jobId);
        jobs.set(jobId, job);
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "not_found") throw error;
        // Runs created before durable orchestrator jobs may reference a legacy
        // process-local id. Keep their detail pollable while omitting telemetry.
      }
    })
  );
  return jobs;
}

async function assembleRunDetail(
  runId: string,
  workspaceId: string,
  projectId: string,
  includeOperatorDiagnostics = false
): Promise<GenerationRunDetail> {
  const [run, gates, actions] = await Promise.all([
    getOrchestratorRun(runId),
    listRunGates(runId),
    listRunActions(runId),
  ]);
  if (run.projectId !== projectId) {
    throw new ApiError("not_found", `Generation run not found: ${runId}`);
  }
  const [assetPrompts, jobs] = await Promise.all([
    loadRunAssetMetadata(workspaceId, projectId, actions),
    loadRunJobsForProjection({ workspaceId, projectId, actions }),
  ]);
  const detail = projectRunDetailFromParts(run, gates, actions, assetPrompts, {
    jobs,
    includeOperatorDiagnostics,
  });
  if (run.agentRole === "creative_director") {
    const family = await getRootRunFamily(run.id);
    const childActions = await Promise.all(
      family.children.map(async (child) => [child.id, await listRunActions(child.id)] as const)
    );
    const childJobs = await Promise.all(
      childActions.map(async ([childRunId, childRunActions]) => [
        childRunId,
        await loadRunJobsForProjection({ workspaceId, projectId, actions: childRunActions }),
      ] as const)
    );
    const sessionRequests = family.children.reduce<Array<readonly [string, "visuals" | "audio"]>>(
      (requests, child) => {
        if (child.agentSessionId && (child.agentRole === "visuals" || child.agentRole === "audio")) {
          requests.push([child.agentSessionId, child.agentRole]);
        }
        return requests;
      },
      []
    );
    const sessions = await Promise.all(
      [...new Map(sessionRequests).entries()].map(async ([sessionId, domain]) =>
        [sessionId, await getAgentSession(projectId, domain)] as const
      )
    );
    detail.hierarchy = projectCreatorRunHierarchy({
      family,
      sessions: new Map(sessions.filter((entry): entry is [string, NonNullable<typeof entry[1]>] => Boolean(entry[1]))),
      actionsByRun: new Map(childActions),
      jobs: new Map(childJobs.flatMap(([, loaded]) => [...loaded.entries()])),
    });
  }
  return detail;
}

export interface GenerationRunDetailRouteDeps {
  requireProjectAccess: typeof requireProjectAccess;
  recordProjectActivity: typeof recordProjectActivity;
  canViewOperatorDiagnostics: typeof canViewOperatorDiagnostics;
  assembleRunDetail: typeof assembleRunDetail;
}

export async function generationRunDetailRoute(
  ctx: Pick<HandlerCtx, "auth">,
  params: Record<string, string | undefined>,
  deps: Partial<GenerationRunDetailRouteDeps> = {}
) {
  const projectId = requireParam(params, "projectId");
  const runId = requireParam(params, "runId");
  await (deps.requireProjectAccess ?? requireProjectAccess)(ctx.auth.workspaceId, projectId);
  await (deps.recordProjectActivity ?? recordProjectActivity)(ctx.auth.workspaceId, projectId);
  const includeOperatorDiagnostics = await (
    deps.canViewOperatorDiagnostics ?? canViewOperatorDiagnostics
  )(ctx.auth);
  return {
    status: 200,
    body: await (deps.assembleRunDetail ?? assembleRunDetail)(
      runId,
      ctx.auth.workspaceId,
      projectId,
      includeOperatorDiagnostics
    ),
    headers: NO_STORE_HEADERS,
  };
}

async function loadRunAssetMetadata(
  workspaceId: string,
  projectId: string,
  actions: RunActionSummary[]
): Promise<Map<string, RunAssetPrompt>> {
  const outputAssetIds = [
    ...new Set(actions.flatMap((action) => action.outputAssetIds)),
  ];
  const assetPrompts = new Map<string, RunAssetPrompt>();
  await Promise.all(
    outputAssetIds.map(async (assetId) => {
      try {
        const asset = await getAsset(workspaceId, projectId, assetId);
        const prompt = asset.provenance?.prompt?.trim();
        const description = asset.description?.trim();
        assetPrompts.set(assetId, {
            ...(prompt ? { prompt } : {}),
            ...(description ? { description } : {}),
            status: asset.status,
            kind: asset.kind,
            hasPlayableSource: Boolean(asset.remoteUrl || asset.storageKey),
          });
      } catch (err) {
        if (!(err instanceof ApiError) || err.code !== "not_found") throw err;
      }
    })
  );
  return assetPrompts;
}

async function requireProjectRun(runId: string, projectId: string): Promise<OrchestratorRun> {
  const run = await getOrchestratorRun(runId);
  if (run.projectId !== projectId) {
    throw new ApiError("not_found", `Generation run not found: ${runId}`);
  }
  return run;
}

function isTerminalRun(run: OrchestratorRun): boolean {
  return run.status === "succeeded" || run.status === "failed" || run.status === "canceled";
}

function latestActionWithStatus(
  actions: RunActionSummary[],
  status: "running" | "applied"
): RunActionSummary | undefined {
  return generationActions(actions)
    .slice()
    .reverse()
    .find((action) => action.status === status);
}

async function stopAfterCurrentStep(run: OrchestratorRun): Promise<void> {
  if (isTerminalRun(run)) return;

  const [gates, actions] = await Promise.all([listRunGates(run.id), listRunActions(run.id)]);
  const reachedGate = gates.find((gate) => gate.status === "reached");
  if (reachedGate) {
    await updateOrchestratorRun(run.id, {
      status: "canceled",
      completedAt: new Date().toISOString(),
    });
    return;
  }

  const runningAction = latestActionWithStatus(actions, "running");
  if (runningAction) {
    if (runningAction.jobIds.length > 0) {
      await createPendingApprovalGate({ runId: run.id, stage: runningAction.tool });
    } else {
      await createReachedApprovalGate({ runId: run.id, stage: runningAction.tool });
      await updateOrchestratorRun(run.id, { status: "waiting" });
    }
    return;
  }

  const appliedAction = latestActionWithStatus(actions, "applied");
  if (appliedAction) {
    await createReachedApprovalGate({ runId: run.id, stage: appliedAction.tool });
    await updateOrchestratorRun(run.id, { status: "waiting" });
    return;
  }

  await updateOrchestratorRun(run.id, {
    status: "canceled",
    completedAt: new Date().toISOString(),
  });
}

orchestratorRunsRouter.post(
  "/projects/:projectId/generation-entrypoints/prompt",
  mutation(async ({ auth, body, req }, params) => {
    const projectId = requireParam(params, "projectId");
    await requireProjectAccess(auth.workspaceId, projectId);
    const providedBriefVersionId =
      isRecord(body) && typeof body.briefVersionId === "string"
        ? body.briefVersionId.trim()
        : "";
    let brief: ReturnType<typeof promptBriefFromBody>;
    if (providedBriefVersionId) {
      const activeBrief = await getActiveProjectBrief(projectId);
      if (!activeBrief || activeBrief.assetId !== providedBriefVersionId) {
        throw new ApiError("not_found", `Brief version not found: ${providedBriefVersionId}`);
      }
      brief = activeBrief.brief;
    } else {
      brief = promptBriefFromBody(body);
      await createBriefVersion(auth.workspaceId, projectId, brief);
    }
    const gates = initialRunGates(body);
    const budget = budgetUsd(body);
    const { run, replayed } = await createEntrypointRun({
      workspaceId: auth.workspaceId,
      actorId: auth.actor.id,
      projectId,
      inputSummary: brief.goal,
      entrypoint: "prompt",
      idempotencyKey: req.header("Idempotency-Key"),
      gates,
      budgetUsd: budget,
      body,
      anonymousQuota: anonymousRunQuotaForAuth(auth),
    });
    if (!replayed) {
      await enqueueOrchestratorDispatch(run.id, auth.workspaceId);
      startPosterGenerationInBackground(auth, projectId, { provider: requestedProvider(body) });
    }
    return { status: 202, body: { runId: run.id } };
  })
);

orchestratorRunsRouter.post(
  "/projects/:projectId/generation-entrypoints/uploaded-footage",
  mutation(async ({ auth, body, req }, params) => {
    const projectId = requireParam(params, "projectId");
    await requireProjectAccess(auth.workspaceId, projectId);
    if (!isRecord(body)) {
      throw new ApiError("validation_failed", "Request body must be an object.");
    }
    const assetIds = stringArray(body.assetIds);
    if (assetIds.length === 0) {
      throw new ApiError("validation_failed", "assetIds is required.", {
        fields: [{ path: "assetIds", message: "Provide at least one ready visual asset." }],
      });
    }
    const briefVersionId = String(body.briefVersionId || "").trim();
    if (!briefVersionId) {
      throw new ApiError("brief_missing", "briefVersionId is required.", {
        fields: [{ path: "briefVersionId", message: "Required." }],
      });
    }
    await requireReadyVisualAssets({ workspaceId: auth.workspaceId, projectId, assetIds });
    const summaryParts = [
      body.prompt ? String(body.prompt) : `Generate from ${assetIds.length} uploaded assets.`,
      `briefVersionId=${briefVersionId}`,
      `selectedAssetIds=${assetIds.join(",")}`,
    ];
    const gates = initialRunGates(body);
    const budget = budgetUsd(body);
    const { run, replayed } = await createEntrypointRun({
      workspaceId: auth.workspaceId,
      actorId: auth.actor.id,
      projectId,
      inputSummary: summaryParts.join("\n"),
      entrypoint: "uploaded-footage",
      idempotencyKey: req.header("Idempotency-Key"),
      gates,
      budgetUsd: budget,
      body,
      anonymousQuota: anonymousRunQuotaForAuth(auth),
    });
    if (!replayed) {
      await enqueueOrchestratorDispatch(run.id, auth.workspaceId);
      startPosterGenerationInBackground(auth, projectId, { provider: requestedProvider(body) });
    }
    return { status: 202, body: { runId: run.id } };
  })
);

orchestratorRunsRouter.get(
  "/projects/:projectId/generation-runs",
  route(async ({ auth }, params) => {
    const projectId = requireParam(params, "projectId");
    await requireProjectAccess(auth.workspaceId, projectId);
    await recordProjectActivity(auth.workspaceId, projectId);
    const runs = await listOrchestratorRunsForProject(projectId);
    const bodies = await Promise.all(
      runs.map(async (run) => {
        const [gates, actions] = await Promise.all([
          listRunGates(run.id),
          listRunActions(run.id),
        ]);
        const assets = await loadRunAssetMetadata(
          auth.workspaceId,
          projectId,
          actions
        );
        return projectRun(run, gates, actions, assets);
      })
    );
    return { status: 200, body: { runs: bodies }, headers: NO_STORE_HEADERS };
  })
);

orchestratorRunsRouter.get(
  "/projects/:projectId/generation-runs/:runId",
  route((ctx, params) => generationRunDetailRoute(ctx, params))
);

orchestratorRunsRouter.post(
  "/projects/:projectId/generation-runs/:runId/approve",
  mutation(async ({ auth }, params) => {
    const projectId = requireParam(params, "projectId");
    const runId = requireParam(params, "runId");
    await requireProjectAccess(auth.workspaceId, projectId);
    const run = await requireProjectRun(runId, projectId);
    assertCreativeDirectorHierarchyRoot(run, "approve a gate");
    const gates = await listRunGates(runId);
    const gate = gates.find((candidate) => candidate.status === "reached");
    if (gate) {
      await resolveGate(gate.id, "approved");
      // An after-gate deliberately finishes the first review pass. Approval
      // turns that completed storyboard pass back into a resumable production
      // run so the orchestrator continues from its selected board assets.
      if (isStoryboardAfterGate(gate)) {
        await updateOrchestratorRun(runId, storyboardContinuationPatch(await getOrchestratorRun(runId)));
      }
      await enqueueOrchestratorDispatch(runId, auth.workspaceId);
    }
    return { status: 202, body: await assembleRunDetail(runId, auth.workspaceId, projectId) };
  })
);

orchestratorRunsRouter.post(
  "/projects/:projectId/generation-runs/:runId/cancel",
  mutation(async ({ auth }, params) => {
    const projectId = requireParam(params, "projectId");
    const runId = requireParam(params, "runId");
    await requireProjectAccess(auth.workspaceId, projectId);
    await requireProjectRun(runId, projectId);
    await cancelOrchestratorRunFamily({ projectId, runId });
    return { status: 200, body: await assembleRunDetail(runId, auth.workspaceId, projectId) };
  })
);

// Continue a terminal, credit-blocked run without discarding work that already
// succeeded before the account was funded.
orchestratorRunsRouter.post(
  "/projects/:projectId/generation-runs/:runId/retry-after-credit-update",
  mutation(async ({ auth }, params) => {
    const projectId = requireParam(params, "projectId");
    const runId = requireParam(params, "runId");
    await requireProjectAccess(auth.workspaceId, projectId);
    const run = await requireProjectRun(runId, projectId);
    assertCreativeDirectorHierarchyRoot(run, "retry after a credit update");
    if (run.status !== "failed") {
      throw new ApiError(
        "validation_failed",
        "Only a failed run can be continued after a credit update."
      );
    }

    const actions = await listRunActions(runId);
    const failedAction = [...actions].reverse().find((action) => action.status === "failed");
    const failedForInsufficientCredits =
      isInsufficientCreditsFailure(failedAction) || runFailedForInsufficientCredits(run);
    if (!failedForInsufficientCredits) {
      throw new ApiError(
        "validation_failed",
        "This run did not stop because its account ran out of credits."
      );
    }

    // Preserve the completed plan, keyframes, and active selections. Hiding
    // only the failed action lets the agent retry it without regenerating work.
    if (failedAction) {
      await supersedeRunActions([failedAction.id]);
    }
    await updateOrchestratorRun(runId, {
      status: "running",
      clearCompletedAt: true,
      clearError: true,
    });
    await enqueueOrchestratorDispatch(runId, auth.workspaceId);

    return { status: 202, body: await assembleRunDetail(runId, auth.workspaceId, projectId) };
  })
);
