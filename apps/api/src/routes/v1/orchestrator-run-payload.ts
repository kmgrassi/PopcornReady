import {
  GENERATION_STAGE_LABELS,
  type GateableGenerationStageType,
  type GenerationRun,
  type GenerationStage,
  type GenerationStageType,
  type JobStatus,
} from "@popcorn/shared/v1/types";
import {
  listRunActions,
  listRunGates,
  type OrchestratorGateStatus,
  type OrchestratorRun,
  type OrchestratorRunGate,
  type RunActionSummary,
} from "@/lib/api/v1/orchestrator-store";
import type { GenerationRunPayload } from "@/lib/v1/generation-runs";
import type { ToolName } from "@/lib/orchestrator";

type StageSeed = {
  type: GenerationStageType;
};

const STAGE_SEEDS: StageSeed[] = [
  { type: "brief_intake" },
  { type: "creative_plan" },
  { type: "storyboard" },
  { type: "asset_generation" },
  { type: "audio_generation" },
  { type: "timeline_assembly" },
  { type: "quality_review" },
  { type: "export" },
  { type: "ready" },
];

const STAGE_TO_TOOLS: Record<GateableGenerationStageType, ToolName[]> = {
  brief_intake: ["create_or_load_brief"],
  creative_plan: ["develop_story_blueprint", "draft_script", "plan_shots"],
  storyboard: ["generate_storyboard"],
  asset_generation: [
    "plan_visual_anchors",
    "generate_anchor",
    "generate_keyframe",
    "generate_clip",
  ],
  audio_generation: ["generate_audio"],
  timeline_assembly: ["assemble_timeline"],
  quality_review: ["critique_timeline"],
  export: ["export_video"],
};

const TOOL_TO_STAGE = new Map<ToolName, GateableGenerationStageType>(
  Object.entries(STAGE_TO_TOOLS).flatMap(([stage, tools]) =>
    tools.map((tool) => [tool, stage as GateableGenerationStageType])
  )
);

export function orchestratorGateStages(
  reviewGates: readonly GateableGenerationStageType[] = []
): string[] {
  return [...new Set(reviewGates.flatMap((stage) => STAGE_TO_TOOLS[stage] ?? []))];
}

function runStatus(status: OrchestratorRun["status"]): JobStatus {
  switch (status) {
    case "queued":
      return "queued";
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    case "running":
    case "waiting":
    default:
      return "running";
  }
}

function actionStage(action: RunActionSummary): GateableGenerationStageType | null {
  return TOOL_TO_STAGE.get(action.tool as ToolName) ?? null;
}

function gateStage(gate: OrchestratorRunGate): GateableGenerationStageType | null {
  return TOOL_TO_STAGE.get(gate.stage as ToolName) ?? null;
}

function stageId(stage: GenerationStageType): string {
  return `orchestrator-stage-${stage}`;
}

function latestActionStage(actions: RunActionSummary[]): GenerationStageType {
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const stage = actionStage(actions[index]);
    if (stage) return stage;
  }
  return "brief_intake";
}

function reachedGate(gates: OrchestratorRunGate[]): OrchestratorRunGate | null {
  return gates.find((gate) => gate.status === "reached") ?? null;
}

function selectedReviewGates(gates: OrchestratorRunGate[]): GateableGenerationStageType[] {
  return [
    ...new Set(
      gates
        .map(gateStage)
        .filter((stage): stage is GateableGenerationStageType => Boolean(stage))
    ),
  ];
}

function stageMessage(
  stage: GenerationStageType,
  gateStatus: OrchestratorGateStatus | undefined
): string | undefined {
  if (gateStatus === "reached") {
    return `${GENERATION_STAGE_LABELS[stage]} checkpoint reached.`;
  }
  if (gateStatus === "approved") {
    return `${GENERATION_STAGE_LABELS[stage]} checkpoint approved.`;
  }
  if (gateStatus === "rejected") {
    return `${GENERATION_STAGE_LABELS[stage]} checkpoint rejected.`;
  }
  return undefined;
}

function stageStatus(args: {
  run: OrchestratorRun;
  stage: GenerationStageType;
  stageActions: RunActionSummary[];
  activeStage: GenerationStageType;
  gateStatus?: OrchestratorGateStatus;
  finishedVideo: boolean;
}): JobStatus {
  const { run, stage, stageActions, activeStage, gateStatus, finishedVideo } = args;
  if (run.status === "canceled") return "canceled";
  if (stage === "ready") {
    return run.status === "succeeded" && finishedVideo ? "succeeded" : "queued";
  }
  if (stageActions.some((action) => action.status === "failed")) return "failed";
  if (stageActions.some((action) => action.status === "running")) return "running";
  if (stageActions.some((action) => action.status === "applied")) return "succeeded";
  if (gateStatus === "reached") return "running";
  if (gateStatus === "approved") return "succeeded";
  if (run.status === "failed" && stage === activeStage) return "failed";
  if ((run.status === "running" || run.status === "waiting") && stage === activeStage) {
    return "running";
  }
  return "queued";
}

function progressPercent(stages: GenerationStage[]): number {
  const done = stages.filter((stage) => stage.status === "succeeded").length;
  return Math.round((done / STAGE_SEEDS.length) * 100);
}

export async function assembleOrchestratorPayload(
  run: OrchestratorRun
): Promise<GenerationRunPayload> {
  const [actions, gates] = await Promise.all([
    listRunActions(run.id),
    listRunGates(run.id),
  ]);
  return assembleOrchestratorPayloadFromParts(run, actions, gates);
}

function hasFinishedVideo(actions: RunActionSummary[]): boolean {
  return actions.some(
    (action) =>
      action.tool === "export_video" &&
      action.status === "applied" &&
      action.outputAssetIds.length > 0
  );
}

function surfaceRunStatus(run: OrchestratorRun, actions: RunActionSummary[]): JobStatus {
  if (run.status !== "succeeded") return runStatus(run.status);
  return hasFinishedVideo(actions) ? "succeeded" : "running";
}

function collectResultArtifacts(actions: RunActionSummary[]): GenerationRunPayload["resultArtifacts"] {
  const artifacts: GenerationRunPayload["resultArtifacts"] = [];
  for (const action of actions) {
    if (action.tool !== "export_video" || action.status !== "applied") continue;
    for (const assetId of action.outputAssetIds) {
      artifacts.push({
        kind: "export",
        artifactId: assetId,
        assetId,
        stageId: stageId("export"),
      });
    }
  }
  return artifacts;
}

export function assembleOrchestratorPayloadFromParts(
  run: OrchestratorRun,
  actions: RunActionSummary[],
  gates: OrchestratorRunGate[]
): GenerationRunPayload {
  const activeGate = reachedGate(gates);
  const finishedVideo = hasFinishedVideo(actions);
  const status = surfaceRunStatus(run, actions);
  const activeStage = activeGate
    ? gateStage(activeGate) ?? latestActionStage(actions)
    : run.status === "succeeded" && finishedVideo
      ? "ready"
      : latestActionStage(actions);
  const selectedGates = selectedReviewGates(gates);
  const resultArtifacts = collectResultArtifacts(actions);

  const stages = STAGE_SEEDS.map((seed, index): GenerationStage => {
    const stageActions = actions.filter((action) => actionStage(action) === seed.type);
    const gate = gates.find((candidate) => gateStage(candidate) === seed.type);
    const status = stageStatus({
      run,
      stage: seed.type,
      stageActions,
      activeStage,
      gateStatus: gate?.status,
      finishedVideo,
    });
    const firstAction = stageActions[0];
    const lastAction = stageActions[stageActions.length - 1];
    return {
      stageId: stageId(seed.type),
      runId: run.id,
      type: seed.type,
      label: GENERATION_STAGE_LABELS[seed.type],
      order: index,
      status,
      isReviewGate: selectedGates.includes(seed.type as GateableGenerationStageType),
      reviewedAt: gate?.status === "approved" ? gate.decidedAt ?? gate.updatedAt : null,
      progressPercent: status === "succeeded" ? 100 : status === "running" ? 50 : 0,
      message: stageMessage(seed.type, gate?.status),
      startedAt: firstAction?.createdAt,
      completedAt: status === "succeeded" ? lastAction?.createdAt ?? gate?.decidedAt : undefined,
      jobIds: stageActions.flatMap((action) => action.jobIds),
      artifactIds: [],
      createdAt: firstAction?.createdAt ?? run.createdAt,
      updatedAt: lastAction?.createdAt ?? gate?.updatedAt ?? run.updatedAt,
      ...(status === "failed" && lastAction?.error
        ? {
            error: {
              code: String(lastAction.error.kind ?? "orchestrator_tool_failed"),
              message: String(lastAction.error.message ?? "The orchestrator tool failed."),
              retryable: Boolean(lastAction.error.recoverable),
            },
          }
        : {}),
    };
  });

  const percent = status === "succeeded" ? 100 : progressPercent(stages);
  const surfaceRun: GenerationRun = {
    runId: run.id,
    projectId: run.projectId,
    status,
    reviewGates: selectedGates,
    reviewGate: activeGate
      ? {
          stageType: activeStage as GateableGenerationStageType,
          stageId: stageId(activeStage),
          state: "awaiting_review",
          enteredAt: activeGate.updatedAt,
        }
      : null,
    currentStageType: status === "succeeded" ? "ready" : activeStage,
    progressPercent: percent,
    message:
      status === "succeeded"
        ? "Your video is ready."
        : activeGate
          ? `${GENERATION_STAGE_LABELS[activeStage]} is awaiting review.`
          : run.status === "failed"
            ? "The orchestrator run failed."
            : run.status === "succeeded"
              ? "The orchestrator completed the currently available tools, but no video export is ready yet."
              : "The orchestrator is generating your video.",
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    ...(run.error
      ? {
          error: {
            code: String(run.error.kind ?? "orchestrator_failed"),
            message: String(run.error.message ?? "The orchestrator run failed."),
            retryable: Boolean(run.error.recoverable),
          },
        }
      : {}),
  };

  return {
    run: surfaceRun,
    stages,
    stageItems: [],
    resultArtifacts,
  };
}
