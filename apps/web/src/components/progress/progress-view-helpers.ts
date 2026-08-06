import {
  GENERATION_STAGE_LABELS,
  type GenerationRun,
  type GenerationStage,
  type GenerationStageItem,
  type GenerationStageType,
} from "@popcorn/shared/v1/types";
import { PIPELINE_GROUPS } from "./StageRail";

export function isTerminal(status: GenerationRun["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

export const REVIEW_STAGE_LABELS: Record<GenerationStageType, string> = {
  brief_intake: "Concept",
  creative_plan: "Brief",
  script: "Script",
  storyboard: "Storyboard",
  asset_generation: "Assets",
  audio_generation: "Audio",
  timeline_assembly: "Timeline",
  quality_review: "Quality review",
  export: "Final render",
  ready: "Ready",
};

export function shortId(id: string): string {
  if (id.length <= 18) return id;
  return `${id.slice(0, 8)}...${id.slice(-6)}`;
}

export function formatDateTime(value?: string): string {
  if (!value) return "Not started";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function reviewStageLabel(stageType: GenerationStageType): string {
  return REVIEW_STAGE_LABELS[stageType] ?? GENERATION_STAGE_LABELS[stageType];
}

export function progressSummary(run: GenerationRun, stages: GenerationStage[]) {
  const completed = stages.filter((stage) => stage.status === "succeeded").length;
  return {
    completed,
    percent:
      run.progressPercent == null
        ? undefined
        : Math.max(0, Math.min(100, Math.round(run.progressPercent))),
  };
}

export function currentRunStage(
  run: GenerationRun,
  stages: GenerationStage[],
): GenerationStage | undefined {
  return (
    stages.find((stage) => run.reviewGate?.stageId === stage.stageId) ??
    stages.find(
      (stage) => stage.toolName === run.currentToolName && stage.status === "running",
    ) ??
    [...stages]
      .filter((stage) => stage.status === "running")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ??
    (run.status === "failed"
      ? stages.find((stage) => stage.status === "failed")
      : undefined)
  );
}

export function nextStageType(
  run: GenerationRun,
  stages: GenerationStage[],
): GenerationStageType | undefined {
  if (isTerminal(run.status)) return undefined;
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  const active = currentRunStage(run, ordered);
  const minOrder = active?.order ?? -1;
  return ordered.find(
    (stage) =>
      stage.order > minOrder &&
      (stage.status === "queued" || stage.status === "running"),
  )?.type;
}

export function standaloneAssetLabel(
  presentationKind: GenerationRun["presentationKind"],
): string | null {
  if (presentationKind === "standalone_image") return "Image asset";
  if (presentationKind === "standalone_video") return "Video asset";
  if (presentationKind === "standalone_audio") return "Audio asset";
  return null;
}

export function lastCompletedPipelineStage(
  stages: GenerationStage[],
  presentationKind?: GenerationRun["presentationKind"],
): string | null {
  const assetLabel = standaloneAssetLabel(presentationKind);
  if (assetLabel) {
    return stages.some((stage) => stage.status === "succeeded") ? assetLabel : null;
  }
  const stagesByTool = new Map(
    stages
      .filter((stage) => stage.toolName)
      .map((stage) => [stage.toolName as string, stage]),
  );
  const completedGroup = [...PIPELINE_GROUPS].reverse().find((group) => {
    const hasAnyToolStage = group.tools.some((toolName) => stagesByTool.has(toolName));
    if (hasAnyToolStage) {
      return group.tools.every(
        (toolName) => stagesByTool.get(toolName)?.status === "succeeded",
      );
    }
    const fallbackStages = stages.filter(
      (stage) =>
        !stage.toolName &&
        (group.fallbackTypes ?? [group.type]).includes(stage.type),
    );
    return fallbackStages.some((stage) => stage.status === "succeeded");
  });
  return completedGroup?.label ?? null;
}

export function headerStatus(run: GenerationRun): string {
  if (run.reviewGate) return "Ready for your approval";
  if (run.status === "queued") return "Waiting to start";
  if (run.status === "running") {
    if (run.activityState === "waiting_on_job") return "Waiting on provider";
    if (run.activityState === "recovering") return "Recovering";
    return "Producing";
  }
  if (run.status === "succeeded") {
    if (run.completionKind === "video") return "Video ready";
    if (run.completionKind === "standalone_asset") return "Asset ready";
    return "Partial result";
  }
  if (run.status === "failed") {
    return run.error?.code === "missing_video_output" ? "Partial result" : "Failed";
  }
  return "Canceled";
}

export function workspaceReturnLabel({
  hasStudioDraft,
  terminal,
  succeeded,
}: {
  hasStudioDraft: boolean;
  terminal: boolean;
  succeeded: boolean;
}): string {
  if (hasStudioDraft && succeeded) return "Review in Studio";
  if (hasStudioDraft && terminal) return "View draft";
  if (hasStudioDraft) return "View draft";
  return "Open project";
}

export function splitStoryboardItems(
  items: GenerationStageItem[],
  stageById: Map<string, GenerationStage>,
) {
  const boardItems: GenerationStageItem[] = [];
  const genericItems: GenerationStageItem[] = [];
  for (const item of items) {
    const stage = stageById.get(item.stageId);
    const isBoardItem =
      (item.kind === "image" || item.kind === "video") &&
      stage &&
      (stage.type === "storyboard" ||
        (stage.type === "asset_generation" &&
          ["generate_keyframe", "generate_clip"].some((tool) =>
            item.label.toLowerCase().startsWith(tool),
          )));
    (isBoardItem ? boardItems : genericItems).push(item);
  }
  return { boardItems, genericItems };
}

export function isVisibleGeneratedItem(item: GenerationStageItem): boolean {
  return item.kind !== "caption";
}
