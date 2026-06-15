import { Router } from "express";
import { mutation, route } from "@/core/adapter";
import { ApiError } from "@/core/errors";
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
import { createBriefVersion, getProject } from "@/lib/api/v1/store";
import { parseBrief } from "@/lib/api/v1/schemas";
import { runOrchestratorToCompletion, resumeOrchestratorRun } from "@/lib/orchestrator/engine";
import {
  GENERATION_STAGE_LABELS,
  GENERATION_STAGE_ORDER,
  GATEABLE_GENERATION_STAGE_TYPES,
  type GateableGenerationStageType,
  type GenerationRun,
  type GenerationRunStatus,
  type GenerationStage,
  type GenerationStageItem,
  type GenerationStageType,
} from "@popcorn/shared/v1/types";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export const orchestratorRunsRouter = Router();

interface GenerationRunDetail {
  run: GenerationRun;
  stages: GenerationStage[];
  stageItems: GenerationStageItem[];
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

function budgetUsd(body: unknown): number | undefined {
  if (!isRecord(body) || body.budgetUsd === undefined) return undefined;
  const parsed = Number(body.budgetUsd);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
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

function runStatus(status: OrchestratorRun["status"]): GenerationRunStatus {
  if (status === "waiting") return "running";
  return status;
}

function actionStatus(status: string): GenerationRunStatus {
  if (status === "applied") return "succeeded";
  if (status === "failed") return "failed";
  if (status === "running") return "running";
  return "queued";
}

function runMessage(run: OrchestratorRun): string {
  switch (run.status) {
    case "queued":
      return "Generation is queued.";
    case "running":
      return "The orchestrator is choosing and running tools.";
    case "waiting":
      return "Generation is waiting for a job or approval gate.";
    case "succeeded":
      return "Generation completed.";
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
  const reachedGate = gates.find((gate) => gate.status === "reached");
  const reviewGate = reachedGate
    ? {
        stageType: toolStage(reachedGate.stage) as GateableGenerationStageType,
        stageId: stageId(run.id, toolStage(reachedGate.stage)),
        state: "awaiting_review" as const,
        enteredAt: reachedGate.updatedAt,
      }
    : null;
  const latestAction = [...actions].reverse().find((action) => action.status === "running");
  const currentStageType = reviewGate?.stageType ?? (latestAction ? toolStage(latestAction.tool) : undefined);

  return {
    runId: run.id,
    projectId: run.projectId,
    status: runStatus(run.status),
    reviewGates: gates.map((gate) => toolStage(gate.stage) as GateableGenerationStageType),
    reviewGate,
    currentStageType,
    progressPercent: run.status === "succeeded" ? 100 : run.status === "queued" ? 0 : 50,
    message: runMessage(run),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    error: toErrorSummary(run.error),
  };
}

function projectStages(run: OrchestratorRun, actions: RunActionSummary[]): GenerationStage[] {
  const grouped = new Map<GenerationStageType, RunActionSummary[]>();
  for (const action of actions) {
    const type = toolStage(action.tool);
    grouped.set(type, [...(grouped.get(type) ?? []), action]);
  }

  return [...grouped.entries()]
    .map(([type, stageActions]) => {
      const latest = stageActions.at(-1);
      const failed = stageActions.find((action) => action.status === "failed");
      const status = failed ? "failed" : latest ? actionStatus(latest.status) : "queued";
      return {
        stageId: stageId(run.id, type),
        runId: run.id,
        type,
        label: GENERATION_STAGE_LABELS[type],
        order: GENERATION_STAGE_ORDER[type],
        status,
        progressPercent: status === "succeeded" ? 100 : status === "running" ? 50 : 0,
        message: latest ? `${latest.tool} ${latest.status}.` : undefined,
        startedAt: stageActions[0]?.createdAt,
        completedAt: status === "succeeded" || status === "failed" ? latest?.createdAt : undefined,
        jobIds: stageActions.flatMap((action) => action.jobIds),
        artifactIds: stageActions.flatMap((action) => action.outputAssetIds),
        createdAt: stageActions[0]?.createdAt ?? run.createdAt,
        updatedAt: latest?.createdAt ?? run.updatedAt,
        error: toErrorSummary(failed?.error),
      };
    })
    .sort((a, b) => a.order - b.order);
}

function projectStageItems(run: OrchestratorRun, actions: RunActionSummary[]): GenerationStageItem[] {
  return actions.flatMap((action) => {
    const type = toolStage(action.tool);
    return action.outputAssetIds.map((assetId, index) => ({
      itemId: `${action.id}:${assetId}`,
      stageId: stageId(run.id, type),
      kind: type === "audio_generation" ? "audio" : type === "export" ? "export" : "image",
      label: `${action.tool} output ${index + 1}`,
      status: actionStatus(action.status),
      assetId,
      artifactId: assetId,
      createdAt: action.createdAt,
      updatedAt: action.createdAt,
    }));
  });
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
  return {
    run: projectRun(run, gates, actions),
    stages: projectStages(run, actions),
    stageItems: projectStageItems(run, actions),
  };
}

function startRun(workspaceId: string, runId: string): void {
  void runOrchestratorToCompletion(runId, { workspaceId }).catch((err) => {
    console.error("orchestrator run failed", err);
  });
}

orchestratorRunsRouter.post(
  "/projects/:projectId/generation-entrypoints/prompt",
  mutation(async ({ auth, body }, params) => {
    const projectId = requireParam(params, "projectId");
    await requireProjectAccess(auth.workspaceId, projectId);
    const brief = promptBriefFromBody(body);
    await createBriefVersion(auth.workspaceId, projectId, brief);
    const run = await createOrchestratorRun({
      projectId,
      inputSummary: brief.goal,
      gates: requestedGates(body),
      budgetUsd: budgetUsd(body),
    });
    startRun(auth.workspaceId, run.id);
    return { status: 202, body: { runId: run.id } };
  })
);

orchestratorRunsRouter.post(
  "/projects/:projectId/generation-entrypoints/uploaded-footage",
  mutation(async ({ auth, body }, params) => {
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
    const summary = body.prompt ? String(body.prompt) : `Generate from ${assetIds.length} uploaded assets.`;
    const run = await createOrchestratorRun({
      projectId,
      inputSummary: summary,
      gates: requestedGates(body),
      budgetUsd: budgetUsd(body),
    });
    startRun(auth.workspaceId, run.id);
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
      runs.map(async (run) => projectRun(run, await listRunGates(run.id)))
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
    const gates = await listRunGates(runId);
    const gate = gates.find((candidate) => candidate.status === "reached");
    if (gate) {
      await resolveGate(gate.id, "approved");
      await resumeOrchestratorRun(runId, { workspaceId: auth.workspaceId });
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
    const gates = await listRunGates(runId);
    const gate = gates.find((candidate) => candidate.status === "reached");
    if (gate) {
      await resolveGate(gate.id, "rejected");
      await resumeOrchestratorRun(runId, { workspaceId: auth.workspaceId });
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
    await updateOrchestratorRun(runId, {
      status: "canceled",
      completedAt: new Date().toISOString(),
    });
    return { status: 200, body: await assembleRunDetail(runId, projectId) };
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
