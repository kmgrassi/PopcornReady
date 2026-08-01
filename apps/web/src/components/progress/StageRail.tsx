"use client";

import { Link } from "react-router-dom";
import {
  type GenerationJobActivity,
  type GenerationRun,
  type GenerationRunStatus,
  type GenerationStage,
  type GenerationStageType,
  type RunReviewGate,
} from "@popcorn/shared/v1/types";
import { humanizeStageMessage } from "../../lib/stage-message";
import { JudgmentBadge } from "../evals/JudgmentBadge";
import { formatElapsed, useElapsedTime } from "./useElapsedTime";
import styles from "./ProgressView.module.css";

interface StageRailProps {
  stages: GenerationStage[];
  runStatus: GenerationRunStatus;
  currentStageType?: GenerationStageType;
  runProgressPercent?: number;
  runMessage?: string | null;
  reviewGate?: RunReviewGate | null;
  stopAction?: {
    pending?: boolean;
    error?: string | null;
    onStop: () => void;
  };
  stageLinks?: Partial<Record<string, string>>;
  showUpcomingStages?: boolean;
  presentationKind?: GenerationRun["presentationKind"];
}

type StageGroup = {
  id: string;
  type: GenerationStageType;
  activeTypes?: GenerationStageType[];
  fallbackTypes?: GenerationStageType[];
  label: string;
  description: string;
  tools: string[];
};

export const PIPELINE_GROUPS: StageGroup[] = [
  {
    id: "concept",
    type: "brief_intake",
    label: "Concept",
    description: "Project goal, audience, and creative direction.",
    tools: ["create_or_load_brief"],
  },
  {
    id: "brief",
    type: "creative_plan",
    label: "Brief",
    description: "Story structure, shot plan, and continuity direction.",
    tools: ["develop_story_blueprint", "plan_shots", "plan_visual_anchors"],
  },
  {
    id: "script",
    type: "creative_plan",
    label: "Script",
    description: "Narrative beats, voiceover, and scene intent.",
    tools: ["draft_script"],
  },
  {
    id: "storyboard",
    type: "storyboard",
    label: "Storyboard",
    description: "Low-cost sketch frames for each planned beat.",
    tools: ["generate_storyboard"],
  },
  {
    id: "shots",
    type: "asset_generation",
    label: "Shots",
    description: "Reference images, keyframes, and generated clips.",
    tools: ["generate_anchor", "generate_keyframe", "generate_clip"],
  },
  {
    id: "assets",
    type: "audio_generation",
    label: "Assets",
    description: "Voiceover, music, and supporting media.",
    tools: ["generate_audio"],
  },
  {
    id: "timeline",
    type: "timeline_assembly",
    label: "Timeline",
    description: "Deterministic edit assembly.",
    tools: ["assemble_timeline"],
  },
  {
    id: "final-render",
    type: "export",
    activeTypes: ["quality_review", "export"],
    fallbackTypes: ["quality_review", "export"],
    label: "Final Render",
    description: "Quality pass and finished video render.",
    tools: ["critique_timeline", "export_video"],
  },
];

const STANDALONE_GROUPS: Record<
  NonNullable<GenerationRun["presentationKind"]>,
  StageGroup[]
> = {
  standalone_image: [
    {
      id: "image-asset",
      type: "asset_generation",
      label: "Image asset",
      description: "A project image generated for the asset library.",
      tools: ["generate_image_asset", "regenerate_image_asset"],
    },
  ],
  standalone_video: [
    {
      id: "video-asset",
      type: "asset_generation",
      label: "Video asset",
      description: "A project video generated for the asset library.",
      tools: ["generate_video_asset", "edit_video_asset"],
    },
  ],
  standalone_audio: [
    {
      id: "audio-asset",
      type: "audio_generation",
      label: "Audio asset",
      description: "Project audio generated for the asset library.",
      tools: ["generate_audio"],
    },
  ],
};

const TOOL_LABELS: Record<string, string> = {
  create_or_load_brief: "Create/load brief",
  develop_story_blueprint: "Develop story blueprint",
  draft_script: "Draft script",
  plan_shots: "Plan shots",
  plan_visual_anchors: "Plan visual anchors",
  generate_anchor: "Generate anchor images",
  generate_storyboard: "Generate storyboard",
  generate_keyframe: "Generate keyframes",
  generate_clip: "Generate clips",
  generate_audio: "Generate audio",
  assemble_timeline: "Assemble timeline",
  critique_timeline: "Critique timeline",
  export_video: "Export video",
  generate_image_asset: "Generate image",
  regenerate_image_asset: "Revise image",
  generate_video_asset: "Generate video",
  edit_video_asset: "Edit video",
};

const STATUS_LABEL: Record<GenerationRunStatus | "review", string> = {
  queued: "Upcoming",
  running: "In progress",
  succeeded: "Complete",
  failed: "Failed",
  canceled: "Canceled",
  review: "Current",
};

function StatusGlyph({ status }: { status: GenerationRunStatus }) {
  if (status === "succeeded") return <span className={styles.stageGlyph} aria-hidden>✓</span>;
  if (status === "failed") return <span className={styles.stageGlyph} aria-hidden>!</span>;
  if (status === "canceled") return <span className={styles.stageGlyph} aria-hidden>—</span>;
  if (status === "running") {
    return (
      <span className={styles.stageGlyph} aria-hidden>
        <span className={styles.stagePulse} />
      </span>
    );
  }
  return (
    <span className={styles.stageGlyph} aria-hidden>
      <span className={styles.stageDot} />
    </span>
  );
}

function LoadingDot() {
  return <span className={styles.inlineSpinner} aria-hidden="true" />;
}

function statusPriority(status: GenerationRunStatus): number {
  if (status === "failed") return 5;
  if (status === "running") return 4;
  if (status === "canceled") return 3;
  if (status === "succeeded") return 2;
  return 1;
}

function groupedStatus(stages: GenerationStage[]): GenerationRunStatus {
  if (stages.length === 0) return "queued";
  if (stages.some((stage) => stage.status === "running")) return "running";
  return stages.reduce<GenerationRunStatus>(
    (current, stage) =>
      statusPriority(stage.status) > statusPriority(current) ? stage.status : current,
    "queued",
  );
}

function StageDuration({ startedAt }: { startedAt?: string }) {
  const elapsed = useElapsedTime(startedAt, undefined);
  return elapsed === null ? null : (
    <span className={styles.stageDuration}>Active for {formatElapsed(elapsed)}</span>
  );
}

function latestStage(stages: GenerationStage[]): GenerationStage | undefined {
  return [...stages].sort((a, b) => a.order - b.order).at(-1);
}

function toolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? toolName;
}

function toolStatusLabel(status: GenerationRunStatus): string {
  if (status === "running") return "Running";
  if (status === "succeeded") return "Done";
  return STATUS_LABEL[status];
}

function groupLinkComplete(
  toolNames: string[],
  stagesByTool: Map<string, GenerationStage>,
): boolean {
  return toolNames.every((toolName) => stagesByTool.get(toolName)?.status === "succeeded");
}

function currentGroupActivity(stages: GenerationStage[]): GenerationJobActivity | undefined {
  const activities = stages.flatMap((stage) => stage.jobActivities ?? []);
  return (
    activities.find((activity) => activity.status === "running") ??
    activities.find((activity) => activity.status === "queued") ??
    [...activities].sort((a, b) =>
      (b.lastProgressAt ?? b.heartbeatAt ?? b.startedAt ?? "").localeCompare(
        a.lastProgressAt ?? a.heartbeatAt ?? a.startedAt ?? "",
      ),
    )[0]
  );
}

function activityHeadline(activity: GenerationJobActivity): string | null {
  if (activity.attentionState === "possibly_stalled") {
    return "This step may be stuck. Popcorn Ready is still checking for updates.";
  }
  if (activity.attentionState === "slow") {
    return "This is taking longer than usual. Popcorn Ready is still waiting for an update.";
  }
  return null;
}

function activityDetails(activity: GenerationJobActivity): string[] {
  const details: string[] = [];
  if (activity.totalItems != null && activity.totalItems > 0) {
    details.push(`${activity.completedItems ?? 0} of ${activity.totalItems} complete`);
  }
  if (activity.currentItemLabel) details.push(activity.currentItemLabel);
  if (activity.providerLabel) details.push(activity.providerLabel);
  return details;
}

export function StageRail({
  stages,
  reviewGate,
  stopAction,
  stageLinks,
  showUpcomingStages = false,
  presentationKind,
}: StageRailProps) {
  const visibleGroups = presentationKind
    ? STANDALONE_GROUPS[presentationKind]
    : PIPELINE_GROUPS;
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  const stagesByTool = new Map<string, GenerationStage>();
  const broadFallback = new Map<GenerationStageType, GenerationStage[]>();
  ordered.forEach((stage) => {
    if (stage.toolName) stagesByTool.set(stage.toolName, stage);
    const existing = broadFallback.get(stage.type) ?? [];
    existing.push(stage);
    broadFallback.set(stage.type, existing);
  });

  const fallbackCounts = new Map<GenerationStageType, number>();
  return (
    <ol className={styles.stageRail} aria-label="Generation stages">
      {visibleGroups.map((visibleStage, idx) => {
        let groupStages = visibleStage.tools
          .map((toolName) => stagesByTool.get(toolName))
          .filter((stage): stage is GenerationStage => Boolean(stage));
        if (groupStages.length === 0) {
          for (const fallbackType of visibleStage.fallbackTypes ?? [visibleStage.type]) {
            const occurrence = fallbackCounts.get(fallbackType) ?? 0;
            const fallback = (broadFallback.get(fallbackType) ?? [])[occurrence];
            if (fallback) {
              groupStages = [fallback];
              fallbackCounts.set(fallbackType, occurrence + 1);
              break;
            }
          }
        }
        const stage = latestStage(groupStages);
        const baseStatus = groupedStatus(groupStages);
        if (groupStages.length === 0 && !showUpcomingStages) return null;
        const isLast = idx === visibleGroups.length - 1;
        const runningStage = groupStages.find((candidate) => candidate.status === "running");
        const failedStage = groupStages.find((candidate) => candidate.status === "failed");
        const isRecovering = Boolean(runningStage && failedStage);
        const status = baseStatus;
        // A completed sibling tool can legitimately report 100 while another
        // tool in the visible group is still running. Only the running tool is
        // allowed to drive an active group's percentage.
        const progressPercent = runningStage?.progressPercent;
        const message = humanizeStageMessage(
          failedStage?.error?.message ??
            runningStage?.message ??
            visibleStage.description
        );
        const activity = currentGroupActivity(groupStages);
        const activityAttention = activity ? activityHeadline(activity) : null;
        const activityMeta = activity ? activityDetails(activity) : [];
        const awaitingReview = groupStages.some((candidate) => reviewGate?.stageId === candidate.stageId);
        const statusKey = awaitingReview ? "review" : status;
        const showStopAction = status === "running" && !awaitingReview && Boolean(stopAction);
        const showStatus =
          awaitingReview ||
          status === "running" ||
          status === "succeeded" ||
          status === "failed" ||
          status === "canceled";
        const stageLink = groupLinkComplete(visibleStage.tools, stagesByTool)
          ? stageLinks?.[visibleStage.label]
          : undefined;

        return (
          <li
            key={`${visibleStage.label}-${idx}`}
            className={`${styles.stageRow} ${styles[`stage_${status}`]}${
              awaitingReview ? ` ${styles.awaitingReview}` : ""
            }`}
            aria-current={
              awaitingReview || status === "running" ? "step" : undefined
            }
          >
            <div className={styles.stageMarker}>
              <StatusGlyph status={status} />
              {!isLast && <span className={styles.stageConnector} aria-hidden />}
            </div>
            <div className={styles.stageBody}>
              <div className={styles.stageTitleRow}>
                {stageLink ? (
                  <Link className={`${styles.stageTitle} ${styles.stageTitleLink}`} to={stageLink}>
                    {visibleStage.label}
                  </Link>
                ) : (
                  <span className={styles.stageTitle}>{visibleStage.label}</span>
                )}
                {showStatus ? (
                  <span className={`${styles.stageStatusPill} ${styles[`stageStatus_${statusKey}`]}`}>
                    {stage?.reviewedAt
                      ? "Complete"
                      : isRecovering
                        ? "Recovering"
                        : STATUS_LABEL[statusKey]}
                  </span>
                ) : null}
                <JudgmentBadge judgment={stage?.judgment} compact />
              </div>
              {awaitingReview ? (
                <p className={styles.stageMessage}>Waiting for approval.</p>
              ) : (
                <p className={styles.stageMessage}>{message}</p>
              )}
              {status === "running" && activity && (activityAttention || activityMeta.length > 0) ? (
                <div className={styles.stageActivity} role="status">
                  {activityAttention ? (
                    <strong className={styles.stageActivityAttention}>{activityAttention}</strong>
                  ) : null}
                  {activityMeta.length > 0 ? (
                    <span className={styles.stageActivityMeta}>{activityMeta.join(" · ")}</span>
                  ) : null}
                </div>
              ) : null}
              {status === "running" ? (
                <div
                  className={`${styles.stageProgress} ${progressPercent == null ? styles.stageProgressIndeterminate : ""}`}
                  role="progressbar"
                  aria-valuenow={progressPercent ?? undefined}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={
                    progressPercent == null
                      ? `${visibleStage.label} in progress; percentage unavailable`
                      : `${visibleStage.label} ${progressPercent}% complete`
                  }
                >
                  <div
                    className={styles.stageProgressFill}
                    style={progressPercent == null ? undefined : { width: `${Math.max(2, Math.min(100, progressPercent))}%` }}
                  />
                </div>
              ) : null}
              {runningStage ? <StageDuration startedAt={runningStage.startedAt} /> : null}
              {groupStages.length > 0 ? (
                <details
                  className={styles.stageToolDetails}
                  open={status === "running" || status === "failed" || awaitingReview}
                >
                  <summary>Tool activity</summary>
                  <ul className={styles.stageToolList}>
                    {groupStages.map((toolStage) => {
                      const toolName = toolStage.toolName ?? toolStage.label;
                      const toolStatus = toolStage.status;
                      return (
                        <li className={styles.stageToolRow} key={toolStage.stageId}>
                          <span className={styles.stageToolName}>{toolLabel(toolName)}</span>
                          <span
                            className={`${styles.stageToolStatus} ${styles[`stageStatus_${toolStatus}`]}`}
                          >
                            {toolStatusLabel(toolStatus)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              ) : null}
              {showStopAction && stopAction ? (
                <div className={styles.stageControlRow}>
                  <button
                    type="button"
                    className={styles.stageStopButton}
                    onClick={stopAction.onStop}
                    disabled={stopAction.pending}
                    aria-busy={stopAction.pending || undefined}
                  >
                    {stopAction.pending ? (
                      <>
                        <LoadingDot />
                        Stopping here...
                      </>
                    ) : (
                      "Stop here"
                    )}
                  </button>
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
