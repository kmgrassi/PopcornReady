import { createHash } from "crypto";
import { Router } from "express";
import { mutation, route } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import { runIdempotent } from "@/lib/api/v1/idempotency";
import {
  createOrchestratorRun,
  getOrchestratorRun,
  listRunActions,
  listRunGates,
  listOrchestratorRunsForProject,
  resolveGate,
  updateOrchestratorRun,
  type OrchestratorRun,
  type OrchestratorRunGate,
  type RunActionSummary,
} from "@/lib/api/v1/orchestrator-store";
import { createAction, createBriefVersion, getProject } from "@/lib/api/v1/store";
import { startPosterGenerationInBackground } from "@/lib/api/v1/poster-background";
import { parseBrief } from "@/lib/api/v1/schemas";
import { runOrchestratorToCompletion, resumeOrchestratorRun } from "@/lib/orchestrator/engine";
import {
  GENERATION_STAGE_LABELS,
  GENERATION_STAGE_ORDER,
  GATEABLE_GENERATION_STAGE_TYPES,
  type GateableGenerationStageType,
  type BoardRevisionTarget,
  type GenerationRun,
  type GenerationRunStatus,
  type GenerationStage,
  type GenerationStageItem,
  type GenerationStageItemKind,
  type GenerationStageItemPurpose,
  type GenerationStageType,
} from "@popcorn/shared/v1/types";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const BOARD_FEEDBACK_TOOL = "board_feedback";

export const orchestratorRunsRouter = Router();

interface GenerationRunDetail {
  run: GenerationRun;
  stages: GenerationStage[];
  stageItems: GenerationStageItem[];
  resultArtifacts?: Array<{
    kind: GenerationStageItem["kind"];
    purpose: GenerationStageItem["purpose"];
    artifactId: string;
    assetId?: string;
    stageId: string;
  }>;
}

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

function optionalStringField(
  input: Record<string, unknown>,
  key: keyof BoardRevisionTarget
): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseBoardRevisionTarget(body: unknown, runId: string): BoardRevisionTarget {
  if (!isRecord(body)) {
    throw new ApiError("validation_failed", "Request body must be an object.");
  }
  const target = isRecord(body.target) ? body.target : {};
  const scope = target.scope === "board" || target.scope === "tile" ? target.scope : undefined;
  if (!scope) {
    throw new ApiError("validation_failed", "target.scope must be board or tile.", {
      fields: [{ path: "target.scope", message: "Expected board or tile." }],
    });
  }

  const parsed: BoardRevisionTarget = { scope, runId };
  for (const key of [
    "stageId",
    "itemId",
    "storyboardId",
    "sceneId",
    "beatId",
    "panelId",
    "keyframeAssetId",
    "clipAssetId",
    "assetId",
    "artifactId",
    "label",
  ] as const) {
    const value = optionalStringField(target, key);
    if (value) parsed[key] = value;
  }
  return parsed;
}

function parseBoardRevisionRequest(body: unknown, runId: string) {
  if (!isRecord(body)) {
    throw new ApiError("validation_failed", "Request body must be an object.");
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    throw new ApiError("validation_failed", "A feedback message is required.", {
      fields: [{ path: "message", message: "Required." }],
    });
  }
  return {
    message,
    target: parseBoardRevisionTarget(body, runId),
  };
}

function generationActions(actions: RunActionSummary[]): RunActionSummary[] {
  return actions.filter((action) => action.tool !== BOARD_FEEDBACK_TOOL);
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

function requestedGates(body: unknown): GateableGenerationStageType[] {
  if (!isRecord(body)) return [];
  const raw = stringArray(body.reviewGates ?? body.gates);
  return raw.filter((stage): stage is GateableGenerationStageType =>
    GATEABLE_GENERATION_STAGE_TYPES.includes(stage as GateableGenerationStageType)
  );
}

function requestedGateTools(body: unknown): string[] {
  const tools = requestedGates(body).flatMap((stage) => {
    switch (stage) {
      case "brief_intake":
        return ["create_or_load_brief"];
      case "creative_plan":
        return ["develop_story_blueprint", "draft_script", "plan_shots", "plan_visual_anchors"];
      case "storyboard":
        return ["generate_storyboard"];
      case "asset_generation":
        return ["generate_anchor", "generate_keyframe", "generate_clip"];
      case "audio_generation":
        return ["generate_audio"];
      case "timeline_assembly":
        return ["assemble_timeline"];
      case "quality_review":
        return ["critique_timeline", "request_approval"];
      case "export":
        return ["export_video"];
    }
  });
  return [...new Set(tools)];
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
}): Promise<{ run: OrchestratorRun; replayed: boolean }> {
  if (!args.idempotencyKey) {
    return {
      run: await createOrchestratorRun({
        projectId: args.projectId,
        inputSummary: args.inputSummary,
        gates: args.gates,
        budgetUsd: args.budgetUsd,
      }),
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
      const run = await createOrchestratorRun({
        projectId: args.projectId,
        inputSummary: args.inputSummary,
        gates: args.gates,
        budgetUsd: args.budgetUsd,
      });
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

function toolStage(tool: string): GenerationStageType {
  switch (tool) {
    case "create_or_load_brief":
      return "brief_intake";
    case "generate_storyboard":
      return "storyboard";
    case "generate_anchor":
    case "generate_keyframe":
    case "generate_clip":
      return "asset_generation";
    case "generate_audio":
      return "audio_generation";
    case "assemble_timeline":
      return "timeline_assembly";
    case "critique_timeline":
    case "request_approval":
      return "quality_review";
    case "export_video":
      return "export";
    default:
      return "creative_plan";
  }
}

function toolItemKind(tool: string): GenerationStageItemKind {
  switch (tool) {
    case "generate_clip":
      return "video";
    case "generate_audio":
      return "audio";
    case "assemble_timeline":
      return "timeline";
    case "export_video":
      return "export";
    default:
      return "image";
  }
}

function toolItemPurpose(tool: string): GenerationStageItemPurpose {
  switch (tool) {
    case "create_or_load_brief":
      return "brief";
    case "develop_story_blueprint":
    case "draft_script":
    case "plan_shots":
    case "plan_visual_anchors":
      return "plan";
    case "generate_storyboard":
      return "storyboard_frame";
    case "generate_anchor":
      return "visual_anchor";
    case "generate_keyframe":
      return "keyframe";
    case "generate_clip":
      return "shot";
    case "generate_audio":
      return "audio";
    case "assemble_timeline":
      return "timeline";
    case "critique_timeline":
    case "request_approval":
      return "quality_review";
    case "export_video":
      return "export";
    default:
      return "unknown";
  }
}

function runStatus(status: OrchestratorRun["status"]): GenerationRunStatus {
  if (status === "waiting") return "running";
  return status;
}

function hasFinishedVideo(actions: RunActionSummary[]): boolean {
  return generationActions(actions).some(
    (action) =>
      action.tool === "export_video" &&
      action.status === "applied" &&
      action.outputAssetIds.length > 0
  );
}

function projectedRunStatus(
  run: OrchestratorRun,
  actions: RunActionSummary[]
): GenerationRunStatus {
  if (run.status !== "succeeded") return runStatus(run.status);
  return hasFinishedVideo(actions) ? "succeeded" : "running";
}

function actionStatus(status: string): GenerationRunStatus {
  if (status === "applied") return "succeeded";
  if (status === "failed") return "failed";
  if (status === "running") return "running";
  return "queued";
}

function runMessage(run: OrchestratorRun, actions: RunActionSummary[]): string {
  switch (run.status) {
    case "queued":
      return "Generation is queued.";
    case "running":
      return "The orchestrator is choosing and running tools.";
    case "waiting":
      return "Generation is waiting for a job or approval gate.";
    case "succeeded":
      return hasFinishedVideo(actions)
        ? "Generation completed."
        : "The orchestrator completed the currently available tools, but no video export is ready yet.";
    case "failed":
      return "Generation failed.";
    case "canceled":
      return "Generation was canceled.";
  }
}

function stageId(runId: string, type: GenerationStageType): string {
  return `${runId}:${type}`;
}

function toErrorSummary(error: Record<string, unknown> | undefined) {
  if (!error) return undefined;
  return {
    code: typeof error.kind === "string" ? error.kind : "orchestrator_error",
    message: typeof error.message === "string" ? error.message : "The orchestrator run failed.",
    retryable: error.recoverable === true,
  };
}

function projectRun(
  run: OrchestratorRun,
  gates: OrchestratorRunGate[],
  actions: RunActionSummary[] = []
): GenerationRun {
  const status = projectedRunStatus(run, actions);
  const reachedGate = gates.find((gate) => gate.status === "reached");
  const reviewGate = reachedGate
    ? {
        stageType: toolStage(reachedGate.stage) as GateableGenerationStageType,
        stageId: stageId(run.id, toolStage(reachedGate.stage)),
        state: "awaiting_review" as const,
        enteredAt: reachedGate.updatedAt,
      }
    : null;
  const projectedActions = generationActions(actions);
  const latestRunningAction = [...projectedActions]
    .reverse()
    .find((action) => action.status === "running");
  const latestAction = [...projectedActions].reverse()[0];
  const currentStageType =
    status === "succeeded"
      ? "ready"
      : reviewGate?.stageType ??
        (latestRunningAction
          ? toolStage(latestRunningAction.tool)
          : latestAction
            ? toolStage(latestAction.tool)
            : undefined);

  return {
    runId: run.id,
    projectId: run.projectId,
    status,
    reviewGates: gates.map((gate) => toolStage(gate.stage) as GateableGenerationStageType),
    reviewGate,
    currentStageType,
    progressPercent: status === "succeeded" ? 100 : run.status === "queued" ? 0 : 50,
    message: runMessage(run, actions),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    error: toErrorSummary(run.error),
  };
}

function projectResultArtifacts(
  run: OrchestratorRun,
  actions: RunActionSummary[]
): GenerationRunDetail["resultArtifacts"] {
  return actions
    .filter((action) => action.tool === "export_video" && action.status === "applied")
    .flatMap((action) =>
      action.outputAssetIds.map((assetId) => ({
        kind: "export" as const,
        purpose: "export" as const,
        artifactId: assetId,
        assetId,
        stageId: stageId(run.id, "export"),
      }))
    );
}

function projectStages(run: OrchestratorRun, actions: RunActionSummary[]): GenerationStage[] {
  const grouped = new Map<GenerationStageType, RunActionSummary[]>();
  for (const action of generationActions(actions)) {
    const type = toolStage(action.tool);
    grouped.set(type, [...(grouped.get(type) ?? []), action]);
  }

  return [...grouped.entries()]
    .map(([type, stageActions]) => {
      const latest = stageActions.at(-1);
      const latestByTool = new Map<string, RunActionSummary>();
      for (const action of stageActions) {
        latestByTool.set(action.tool, action);
      }
      const latestFailed = [...stageActions]
        .reverse()
        .find(
          (action) =>
            action.status === "failed" && latestByTool.get(action.tool)?.id === action.id
        );
      const status = latestFailed
        ? "failed"
        : latest
          ? actionStatus(latest.status)
          : "queued";
      const statusAction = latestFailed ?? latest;
      return {
        stageId: stageId(run.id, type),
        runId: run.id,
        type,
        label: GENERATION_STAGE_LABELS[type],
        order: GENERATION_STAGE_ORDER[type],
        status,
        progressPercent: status === "succeeded" ? 100 : status === "running" ? 50 : 0,
        message: statusAction ? `${statusAction.tool} ${statusAction.status}.` : undefined,
        startedAt: stageActions[0]?.createdAt,
        completedAt:
          status === "succeeded" || status === "failed" ? statusAction?.createdAt : undefined,
        jobIds: stageActions.flatMap((action) => action.jobIds),
        artifactIds: stageActions.flatMap((action) => action.outputAssetIds),
        createdAt: stageActions[0]?.createdAt ?? run.createdAt,
        updatedAt: latest?.createdAt ?? run.updatedAt,
        error: latestFailed ? toErrorSummary(latestFailed.error) : undefined,
      };
    })
    .sort((a, b) => a.order - b.order);
}

function projectStageItems(run: OrchestratorRun, actions: RunActionSummary[]): GenerationStageItem[] {
  return generationActions(actions).flatMap((action) => {
    const type = toolStage(action.tool);
    return action.outputAssetIds.map((assetId, index) => ({
      itemId: `${action.id}:${assetId}`,
      stageId: stageId(run.id, type),
      kind: toolItemKind(action.tool),
      purpose: toolItemPurpose(action.tool),
      label: `${action.tool} output ${index + 1}`,
      status: actionStatus(action.status),
      assetId,
      artifactId: assetId,
      createdAt: action.createdAt,
      updatedAt: action.createdAt,
    }));
  });
}

export function projectRunDetailFromParts(
  run: OrchestratorRun,
  gates: OrchestratorRunGate[],
  actions: RunActionSummary[]
): GenerationRunDetail {
  return {
    run: projectRun(run, gates, actions),
    stages: projectStages(run, actions),
    stageItems: projectStageItems(run, actions),
    resultArtifacts: projectResultArtifacts(run, actions),
  };
}

async function assembleRunDetail(runId: string, projectId: string): Promise<GenerationRunDetail> {
  const [run, gates, actions] = await Promise.all([
    getOrchestratorRun(runId),
    listRunGates(runId),
    listRunActions(runId),
  ]);
  if (run.projectId !== projectId) {
    throw new ApiError("not_found", `Generation run not found: ${runId}`);
  }
  return projectRunDetailFromParts(run, gates, actions);
}

async function requireProjectRun(runId: string, projectId: string): Promise<OrchestratorRun> {
  const run = await getOrchestratorRun(runId);
  if (run.projectId !== projectId) {
    throw new ApiError("not_found", `Generation run not found: ${runId}`);
  }
  return run;
}

function startRun(workspaceId: string, runId: string, actorId: string): void {
  void runOrchestratorToCompletion(runId, {
    workspaceId,
    actorId,
    agentId: "orchestrator",
  }).catch((err) => {
    console.error("orchestrator run failed", err);
  });
}

export function resumeRunInBackground(
  workspaceId: string,
  runId: string,
  resume: typeof resumeOrchestratorRun = resumeOrchestratorRun,
  logError: typeof console.error = console.error
): void {
  void resume(runId, {
    workspaceId,
    agentId: "orchestrator",
  }).catch((err) => {
    logError("orchestrator resume failed", err);
  });
}

orchestratorRunsRouter.post(
  "/projects/:projectId/generation-entrypoints/prompt",
  mutation(async ({ auth, body, req }, params) => {
    const projectId = requireParam(params, "projectId");
    await requireProjectAccess(auth.workspaceId, projectId);
    const brief = promptBriefFromBody(body);
    await createBriefVersion(auth.workspaceId, projectId, brief);
    const gates = requestedGateTools(body);
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
    });
    if (!replayed) {
      startPosterGenerationInBackground(auth, projectId, {
        provider: requestedProvider(body),
      });
      startRun(auth.workspaceId, run.id, auth.actor.id);
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
    const summaryParts = [
      body.prompt ? String(body.prompt) : `Generate from ${assetIds.length} uploaded assets.`,
      `briefVersionId=${briefVersionId}`,
      `selectedAssetIds=${assetIds.join(",")}`,
    ];
    const gates = requestedGateTools(body);
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
    });
    if (!replayed) startRun(auth.workspaceId, run.id, auth.actor.id);
    return { status: 202, body: { runId: run.id } };
  })
);

orchestratorRunsRouter.get(
  "/projects/:projectId/generation-runs",
  route(async ({ auth }, params) => {
    const projectId = requireParam(params, "projectId");
    await requireProjectAccess(auth.workspaceId, projectId);
    const runs = await listOrchestratorRunsForProject(projectId);
    const bodies = await Promise.all(
      runs.map(async (run) =>
        projectRun(run, await listRunGates(run.id), await listRunActions(run.id))
      )
    );
    return { status: 200, body: { runs: bodies }, headers: NO_STORE_HEADERS };
  })
);

orchestratorRunsRouter.get(
  "/projects/:projectId/generation-runs/:runId",
  route(async ({ auth }, params) => {
    const projectId = requireParam(params, "projectId");
    const runId = requireParam(params, "runId");
    await requireProjectAccess(auth.workspaceId, projectId);
    return { status: 200, body: await assembleRunDetail(runId, projectId), headers: NO_STORE_HEADERS };
  })
);

orchestratorRunsRouter.post(
  "/projects/:projectId/generation-runs/:runId/approve",
  mutation(async ({ auth }, params) => {
    const projectId = requireParam(params, "projectId");
    const runId = requireParam(params, "runId");
    await requireProjectAccess(auth.workspaceId, projectId);
    await requireProjectRun(runId, projectId);
    const gates = await listRunGates(runId);
    const gate = gates.find((candidate) => candidate.status === "reached");
    if (gate) {
      await resolveGate(gate.id, "approved");
      resumeRunInBackground(auth.workspaceId, runId);
    }
    return { status: 202, body: await assembleRunDetail(runId, projectId) };
  })
);

orchestratorRunsRouter.post(
  "/projects/:projectId/generation-runs/:runId/reject",
  mutation(async ({ auth }, params) => {
    const projectId = requireParam(params, "projectId");
    const runId = requireParam(params, "runId");
    await requireProjectAccess(auth.workspaceId, projectId);
    await requireProjectRun(runId, projectId);
    const gates = await listRunGates(runId);
    const gate = gates.find((candidate) => candidate.status === "reached");
    if (gate) {
      await resolveGate(gate.id, "rejected");
      resumeRunInBackground(auth.workspaceId, runId);
    }
    return { status: 202, body: await assembleRunDetail(runId, projectId) };
  })
);

orchestratorRunsRouter.post(
  "/projects/:projectId/generation-runs/:runId/cancel",
  mutation(async ({ auth }, params) => {
    const projectId = requireParam(params, "projectId");
    const runId = requireParam(params, "runId");
    await requireProjectAccess(auth.workspaceId, projectId);
    await requireProjectRun(runId, projectId);
    await updateOrchestratorRun(runId, {
      status: "canceled",
      completedAt: new Date().toISOString(),
    });
    return { status: 200, body: await assembleRunDetail(runId, projectId) };
  })
);

orchestratorRunsRouter.post(
  "/projects/:projectId/generation-runs/:runId/board-revisions",
  mutation(async ({ auth, body }, params) => {
    const projectId = requireParam(params, "projectId");
    const runId = requireParam(params, "runId");
    await requireProjectAccess(auth.workspaceId, projectId);
    const run = await requireProjectRun(runId, projectId);
    if (run.status === "failed" || run.status === "canceled") {
      throw new ApiError(
        "validation_failed",
        "Board feedback cannot revise a failed or canceled generation run."
      );
    }
    const request = parseBoardRevisionRequest(body, runId);
    const action = await createAction({
      projectId,
      orchestratorRunId: runId,
      tool: BOARD_FEEDBACK_TOOL,
      status: "applied",
      params: {
        schemaVersion: "board_revision_request.v1",
        message: request.message,
        target: request.target,
      },
      inputAssetIds: [
        request.target.clipAssetId,
        request.target.keyframeAssetId,
        request.target.assetId,
      ].filter((id): id is string => Boolean(id)),
      rationale: "User requested an AI-mediated board or tile revision.",
      proposal: {
        message: request.message,
        target: request.target,
      },
    });
    if (run.status === "queued" || run.status === "succeeded") {
      await updateOrchestratorRun(runId, {
        status: "running",
        startedAt: run.startedAt ?? new Date().toISOString(),
      });
    }
    resumeRunInBackground(auth.workspaceId, runId);

    return {
      status: 202,
      body: {
        revision: {
          id: action.id,
          message: request.message,
          target: request.target,
          createdAt: action.createdAt,
        },
      },
    };
  })
);

orchestratorRunsRouter.post(
  "/projects/:projectId/generation-runs/:runId/retry",
  mutation(async () => {
    throw new ApiError("not_implemented", "Retry is not supported for orchestrator runs yet.", {
      supported: false,
      action: "retry",
    });
  })
);
