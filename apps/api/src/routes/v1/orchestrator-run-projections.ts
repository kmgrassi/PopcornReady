import {
  GENERATION_STAGE_LABELS,
  GENERATION_STAGE_ORDER,
  type GateableGenerationStageType,
  type GenerationActivityAttentionState,
  type GenerationJobActivity,
  type GenerationJobDiagnostics,
  type GenerationRun,
  type GenerationRunStatus,
  type GenerationStage,
  type GenerationStageItem,
  type GenerationStageItemKind,
  type GenerationStageItemPurpose,
  type GenerationStageType,
  type Job,
} from "@popcorn/shared/v1/types";
import {
  type OrchestratorRun,
  type OrchestratorRunGate,
  type RunActionSummary,
} from "@/lib/api/v1/orchestrator-store";
import {
  getToolCapability,
  isToolName,
} from "@/lib/orchestrator-tools/capability-catalog";
import { redactMessage } from "@/lib/v1/redact";

const BOARD_FEEDBACK_TOOL = "board_feedback";
const AFTER_GATE_PREFIX = "after:";

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
  operatorDiagnostics?: GenerationJobDiagnostics[];
}

export interface GenerationAttentionPolicy {
  slowAfterMs: number;
  possiblyStalledAfterMs: number;
}

export interface GenerationProjectionOptions {
  jobs?: ReadonlyMap<string, Job>;
  includeOperatorDiagnostics?: boolean;
  now?: () => Date;
  attentionPolicy?: GenerationAttentionPolicy;
}

export const DEFAULT_GENERATION_ATTENTION_POLICY: GenerationAttentionPolicy = {
  slowAfterMs: 2 * 60 * 1000,
  possiblyStalledAfterMs: 10 * 60 * 1000,
};

export interface RunAssetPrompt {
  prompt?: string;
  description?: string;
  status?: string;
  kind?: string;
  hasPlayableSource?: boolean;
}

function generationActions(actions: RunActionSummary[]): RunActionSummary[] {
  return actions.filter((action) => action.tool !== BOARD_FEEDBACK_TOOL);
}

export function toolStage(tool: string): GenerationStageType {
  const normalizedTool = tool.startsWith(AFTER_GATE_PREFIX)
    ? tool.slice(AFTER_GATE_PREFIX.length)
    : tool;
  switch (normalizedTool) {
    case "create_or_load_brief":
      return "brief_intake";
    case "generate_storyboard":
      return "storyboard";
    case "generate_anchor":
    case "generate_keyframe":
    case "generate_clip":
    case "edit_video_asset":
      return "asset_generation";
    case "generate_audio":
    case "fit_audio_to_picture":
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
    case "create_or_load_brief":
    case "develop_story_blueprint":
    case "draft_script":
    case "plan_shots":
    case "plan_visual_anchors":
    case "critique_timeline":
    case "publish_to_catalog":
      return "caption";
    case "generate_clip":
    case "edit_video_asset":
      return "video";
    case "generate_audio":
    case "fit_audio_to_picture":
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
    case "edit_video_asset":
      return "shot";
    case "generate_audio":
    case "fit_audio_to_picture":
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
  // Domain finite-run transport states (specialist-agents PR 4): the legacy
  // projection collapses them onto their nearest terminal legacy status.
  if (status === "timed_out") return "failed";
  if (status === "superseded") return "canceled";
  return status;
}

function hasFinishedVideo(
  actions: RunActionSummary[],
  assets: ReadonlyMap<string, RunAssetPrompt>
): boolean {
  return generationActions(actions).some(
    (action) =>
      action.tool === "export_video" &&
      action.status === "applied" &&
      action.outputAssetIds.some((assetId) => {
        const asset = assets.get(assetId);
        return asset?.status === "ready" && asset.kind === "video" && asset.hasPlayableSource;
      })
  );
}

function hasReachedAfterGate(gates: OrchestratorRunGate[]): boolean {
  return gates.some(
    (gate) => gate.stage.startsWith(AFTER_GATE_PREFIX) && gate.status === "reached"
  );
}

function hasReachedStoryboardAfterGate(gates: OrchestratorRunGate[]): boolean {
  return gates.some((gate) => {
    if (!gate.stage.startsWith(AFTER_GATE_PREFIX) || gate.status !== "reached") return false;
    const stage = toolStage(gate.stage);
    return stage === "storyboard" || stage === "asset_generation";
  });
}

function completionKind(
  run: OrchestratorRun,
  gates: OrchestratorRunGate[],
  actions: RunActionSummary[],
  assets: ReadonlyMap<string, RunAssetPrompt>
): GenerationRun["completionKind"] {
  if (run.status !== "succeeded") return undefined;
  if (hasFinishedVideo(actions, assets)) return "video";
  if (hasReachedStoryboardAfterGate(gates)) return "storyboard_assets";
  return undefined;
}

function projectedRunStatus(
  run: OrchestratorRun,
  actions: RunActionSummary[],
  gates: OrchestratorRunGate[],
  assets: ReadonlyMap<string, RunAssetPrompt>
): GenerationRunStatus {
  if (run.status !== "succeeded") return runStatus(run.status);
  if (hasFinishedVideo(actions, assets)) return "succeeded";
  return hasReachedAfterGate(gates) ? "succeeded" : "failed";
}

function actionStatus(status: string): GenerationRunStatus {
  if (status === "applied") return "succeeded";
  if (status === "failed") return "failed";
  if (status === "running") return "running";
  return "queued";
}

function runMessage(
  run: OrchestratorRun,
  actions: RunActionSummary[],
  gates: OrchestratorRunGate[],
  assets: ReadonlyMap<string, RunAssetPrompt>
): string {
  switch (run.status) {
    case "queued":
      return "Generation is queued.";
    case "running":
      return "The orchestrator is choosing and running tools.";
    case "waiting":
      return "Generation is waiting for a job or approval gate.";
    case "succeeded":
      if (hasFinishedVideo(actions, assets)) return "Video export is ready.";
      return hasReachedStoryboardAfterGate(gates)
        ? "Storyboard assets are ready."
        : "Run ended; no playable video was created.";
    case "failed":
      return "Generation failed.";
    case "canceled":
      return "Generation was canceled.";
    case "timed_out":
      return "Generation timed out.";
    case "superseded":
      return "Generation was superseded by a newer run.";
  }
}

function stageId(runId: string, type: GenerationStageType): string {
  return `${runId}:${type}`;
}

function toolStageId(runId: string, tool: string): string {
  return `${runId}:tool:${tool}`;
}

function reviewStageId(runId: string, gateStage: string): string {
  const tool = gateStage.startsWith(AFTER_GATE_PREFIX)
    ? gateStage.slice(AFTER_GATE_PREFIX.length)
    : gateStage;
  return toolStageId(runId, tool);
}

export function toolOrder(tool: string): number {
  const catalogOrder = isToolName(tool)
    ? getToolCapability(tool).runProjection.order
    : null;
  return catalogOrder ?? 100 + GENERATION_STAGE_ORDER[toolStage(tool)];
}

export function toolLabel(tool: string): string {
  const catalogLabel = isToolName(tool)
    ? getToolCapability(tool).runProjection.label
    : null;
  return catalogLabel ?? GENERATION_STAGE_LABELS[toolStage(tool)];
}

function toErrorSummary(error: Record<string, unknown> | undefined) {
  if (!error) return undefined;
  return {
    code: typeof error.kind === "string" ? error.kind : "orchestrator_error",
    message: typeof error.message === "string" ? error.message : "The orchestrator run failed.",
    retryable: error.recoverable === true,
  };
}

function timestampMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function latestTimestamp(values: Array<string | undefined>): string | undefined {
  return values.reduce<string | undefined>((latest, value) => {
    const valueMs = timestampMs(value);
    if (valueMs === undefined) return latest;
    const latestMs = timestampMs(latest);
    return latestMs === undefined || valueMs > latestMs ? value : latest;
  }, undefined);
}

function providerLabel(provider: string | undefined): string | undefined {
  if (!provider) return undefined;
  return ({
    openai: "OpenAI",
    gemini: "Google Gemini",
    runway: "Runway",
    ltx: "LTX",
    kling: "Kling",
    seedance: "Seedance",
    xai: "xAI",
    ideogram: "Ideogram",
    elevenlabs: "ElevenLabs",
    nanobanano: "Google Gemini",
    nvidia_api_catalog: "NVIDIA",
    mock: "Preview provider",
  } as Record<string, string>)[provider.toLowerCase()];
}

export function generationJobAttentionState(
  job: Job,
  options: Pick<GenerationProjectionOptions, "now" | "attentionPolicy"> = {}
): GenerationActivityAttentionState {
  if (job.status !== "queued" && job.status !== "running") return "normal";
  const policy = options.attentionPolicy ?? DEFAULT_GENERATION_ATTENTION_POLICY;
  const reference = latestTimestamp([
    job.progress.lastProgressAt,
    job.progress.startedAt,
    job.createdAt,
  ]);
  const referenceMs = timestampMs(reference);
  if (referenceMs === undefined) return "normal";
  const ageMs = Math.max(0, (options.now ?? (() => new Date()))().getTime() - referenceMs);
  if (ageMs >= policy.possiblyStalledAfterMs) return "possibly_stalled";
  if (ageMs >= policy.slowAfterMs) return "slow";
  return "normal";
}

export function projectGenerationJobActivity(
  job: Job,
  options: Pick<GenerationProjectionOptions, "now" | "attentionPolicy"> = {}
): GenerationJobActivity {
  return {
    status: job.status,
    currentStep: job.progress.currentStep,
    providerLabel: providerLabel(job.progress.provider),
    startedAt: job.progress.startedAt,
    heartbeatAt: job.progress.heartbeatAt,
    lastProgressAt: job.progress.lastProgressAt,
    completedItems: job.progress.completedItems,
    totalItems: job.progress.totalItems,
    currentItemLabel: job.progress.currentItem?.label,
    attentionState: generationJobAttentionState(job, options),
  };
}

function projectJobDiagnostics(
  runId: string,
  action: RunActionSummary,
  job: Job,
  options: Pick<GenerationProjectionOptions, "now" | "attentionPolicy">
): GenerationJobDiagnostics {
  return {
    ...projectGenerationJobActivity(job, options),
    jobId: job.id,
    actionId: action.id,
    runId,
    message: job.progress.message ? redactMessage(job.progress.message) : undefined,
    provider: job.progress.provider,
    attempt: job.progress.attempt,
    nextRetryAt: job.progress.nextRetryAt,
    updatedAt: job.updatedAt,
  };
}

export function projectRun(
  run: OrchestratorRun,
  gates: OrchestratorRunGate[],
  actions: RunActionSummary[] = [],
  assets: ReadonlyMap<string, RunAssetPrompt> = new Map(),
  jobs: ReadonlyMap<string, Job> = new Map()
): GenerationRun {
  const reviewGates = gates.filter((gate) => !gate.stage.startsWith(AFTER_GATE_PREFIX));
  const status = projectedRunStatus(run, actions, gates, assets);
  // A post-tool gate is the storyboard-review stop: the storyboard work is
  // complete, but production must not start until the creator continues it.
  // Project it just like a conventional review gate so every surface has one
  // clear, actionable state rather than a misleading terminal success.
  const reachedGate = gates.find((gate) => gate.status === "reached");
  const reviewGate = reachedGate
    ? {
        stageType: toolStage(reachedGate.stage) as GateableGenerationStageType,
        stageId: reviewStageId(run.id, reachedGate.stage),
        state: "awaiting_review" as const,
        enteredAt: reachedGate.updatedAt,
      }
    : null;
  const projectedActions = generationActions(actions);
  const latestRunningAction = [...projectedActions]
    .reverse()
    .find((action) => action.status === "running");
  const latestAction = [...projectedActions].reverse()[0];
  const latestByTool = new Map<string, RunActionSummary>();
  for (const action of projectedActions) latestByTool.set(action.tool, action);
  const latestRecoverableFailure = [...latestByTool.values()].find(
    (action) => action.status === "failed" && action.error?.recoverable === true
  );
  const recovering = Boolean(
    status === "running" &&
      latestRunningAction &&
      latestRecoverableFailure &&
      new Date(latestRunningAction.createdAt).getTime() >
        new Date(latestRecoverableFailure.createdAt).getTime()
  );
  const activityState = reviewGate || status !== "running"
    ? undefined
    : recovering
      ? "recovering" as const
      : run.status === "waiting" && latestAction?.jobIds.length
        ? "waiting_on_job" as const
        : "working" as const;
  const currentStageType =
    reviewGate?.stageType ??
    (status === "succeeded"
      ? "ready"
      : latestRunningAction
        ? toolStage(latestRunningAction.tool)
        : latestAction
          ? toolStage(latestAction.tool)
          : undefined);
  const lastProgressAt = latestTimestamp(
    [...jobs.values()].map((job) => job.progress.lastProgressAt)
  );

  return {
    runId: run.id,
    projectId: run.projectId,
    status,
    completionKind: completionKind(run, gates, actions, assets),
    activityState,
    currentToolName: latestRunningAction?.tool,
    reviewGates: reviewGates.map((gate) => toolStage(gate.stage) as GateableGenerationStageType),
    reviewGate,
    currentStageType,
    progressPercent: status === "succeeded" ? 100 : run.status === "queued" ? 0 : undefined,
    message: runMessage(run, actions, gates, assets),
    lastProgressAt,
    createdAt: run.createdAt,
    updatedAt: [run.updatedAt, ...projectedActions.map((action) => action.updatedAt ?? action.createdAt), ...gates.map((gate) => gate.updatedAt)]
      .sort()
      .at(-1) ?? run.updatedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    error:
      status === "failed" && run.status === "succeeded"
        ? {
            code: "missing_video_output",
            message: "Run ended; no playable video was created.",
            retryable: true,
          }
        : toErrorSummary(run.error),
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

function projectStages(
  run: OrchestratorRun,
  actions: RunActionSummary[],
  options: GenerationProjectionOptions
): GenerationStage[] {
  const grouped = new Map<string, RunActionSummary[]>();
  for (const action of generationActions(actions)) {
    grouped.set(action.tool, [...(grouped.get(action.tool) ?? []), action]);
  }

  return [...grouped.entries()]
    .map(([tool, stageActions]) => {
      const type = toolStage(tool);
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
      const jobActivities = [...new Set(stageActions.flatMap((action) => action.jobIds))]
        .map((jobId) => options.jobs?.get(jobId))
        .filter((job): job is Job => Boolean(job))
        .map((job) => projectGenerationJobActivity(job, options));
      return {
        stageId: toolStageId(run.id, tool),
        runId: run.id,
        type,
        toolName: tool,
        label: toolLabel(tool),
        order: toolOrder(tool),
        status,
        progressPercent: status === "succeeded" ? 100 : status === "queued" ? 0 : undefined,
        message: statusAction ? `${toolLabel(statusAction.tool)} ${statusAction.status}.` : undefined,
        startedAt:
          status === "running" && latest?.status === "running"
            ? latest.createdAt
            : stageActions[0]?.createdAt,
        completedAt:
          status === "succeeded" || status === "failed"
            ? statusAction?.updatedAt ?? statusAction?.createdAt
            : undefined,
        jobIds: stageActions.flatMap((action) => action.jobIds),
        artifactIds: stageActions.flatMap((action) => action.outputAssetIds),
        createdAt: stageActions[0]?.createdAt ?? run.createdAt,
        updatedAt: latest?.updatedAt ?? latest?.createdAt ?? run.updatedAt,
        ...(jobActivities.length > 0 ? { jobActivities } : {}),
        error: latestFailed ? toErrorSummary(latestFailed.error) : undefined,
      };
    })
    .sort((a, b) => a.order - b.order);
}

const PROMPT_PREVIEW_MAX = 240;

function promptPreview(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= PROMPT_PREVIEW_MAX) return trimmed;
  return `${trimmed.slice(0, PROMPT_PREVIEW_MAX - 1)}…`;
}

function actionPrompt(action: RunActionSummary): string | undefined {
  const prompt = action.params.prompt;
  return typeof prompt === "string" && prompt.trim() ? prompt : undefined;
}

function projectStageItems(
  run: OrchestratorRun,
  actions: RunActionSummary[],
  assetPrompts: ReadonlyMap<string, RunAssetPrompt>
): GenerationStageItem[] {
  return generationActions(actions).flatMap((action) => {
    const type = toolStage(action.tool);
    const actionLevelPrompt = actionPrompt(action);
    return action.outputAssetIds.map((assetId, index) => {
      const assetPrompt = assetPrompts.get(assetId);
      const prompt = actionLevelPrompt ?? assetPrompt?.prompt ?? assetPrompt?.description;
      return {
        itemId: `${action.id}:${assetId}`,
        stageId: toolStageId(run.id, action.tool),
        kind: toolItemKind(action.tool),
        purpose: toolItemPurpose(action.tool),
        label: `${action.tool} output ${index + 1}`,
        status: actionStatus(action.status),
        ...(prompt ? { prompt, promptPreview: promptPreview(prompt) } : {}),
        assetId,
        artifactId: assetId,
        createdAt: action.createdAt,
        updatedAt: action.updatedAt ?? action.createdAt,
      };
    });
  });
}

export function projectRunDetailFromParts(
  run: OrchestratorRun,
  gates: OrchestratorRunGate[],
  actions: RunActionSummary[],
  assetPrompts: ReadonlyMap<string, RunAssetPrompt> = new Map(),
  options: GenerationProjectionOptions = {}
): GenerationRunDetail {
  const jobs = options.jobs ?? new Map();
  const operatorDiagnostics = options.includeOperatorDiagnostics
    ? generationActions(actions).flatMap((action) =>
        action.jobIds.flatMap((jobId) => {
          const job = jobs.get(jobId);
          return job ? [projectJobDiagnostics(run.id, action, job, options)] : [];
        })
      )
    : undefined;
  return {
    run: projectRun(run, gates, actions, assetPrompts, jobs),
    stages: projectStages(run, actions, { ...options, jobs }),
    stageItems: projectStageItems(run, actions, assetPrompts),
    resultArtifacts: projectResultArtifacts(run, actions),
    ...(operatorDiagnostics && operatorDiagnostics.length > 0
      ? { operatorDiagnostics }
      : {}),
  };
}
