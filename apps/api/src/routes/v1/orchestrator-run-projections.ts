import {
  GENERATION_STAGE_LABELS,
  GENERATION_STAGE_ORDER,
  type GateableGenerationStageType,
  type GenerationRun,
  type GenerationRunStatus,
  type GenerationStage,
  type GenerationStageItem,
  type GenerationStageItemKind,
  type GenerationStageItemPurpose,
  type GenerationStageType,
} from "@popcorn/shared/v1/types";
import {
  type OrchestratorRun,
  type OrchestratorRunGate,
  type RunActionSummary,
} from "@/lib/api/v1/orchestrator-store";

const BOARD_FEEDBACK_TOOL = "board_feedback";

export interface GenerationRunDetail {
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

function generationActions(actions: RunActionSummary[]): RunActionSummary[] {
  return actions.filter((action) => action.tool !== BOARD_FEEDBACK_TOOL);
}

export function toolStage(tool: string): GenerationStageType {
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
    case "publish_to_catalog":
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

export function projectRun(
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
