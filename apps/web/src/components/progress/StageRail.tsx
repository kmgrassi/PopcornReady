"use client";

import { Link } from "react-router-dom";
import {
  type GenerationRunStatus,
  type GenerationStage,
  type GenerationStageType,
  type RunReviewGate,
} from "@popcorn/shared/v1/types";
import { JudgmentBadge } from "../evals/JudgmentBadge";
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
  restartAction?: {
    pendingStageType?: GenerationStageType | null;
    onRestart: (stageType: GenerationStageType) => void;
  };
  stageLinks?: Partial<Record<string, string>>;
}

const PIPELINE_GROUPS: Array<{
  id: string;
  type: GenerationStageType;
  label: string;
  description: string;
  tools: string[];
}> = [
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
    label: "Final Render",
    description: "Quality pass and finished video render.",
    tools: ["critique_timeline", "export_video"],
  },
];

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
  return stages.reduce<GenerationRunStatus>(
    (current, stage) =>
      statusPriority(stage.status) > statusPriority(current) ? stage.status : current,
    "queued",
  );
}

function latestStage(stages: GenerationStage[]): GenerationStage | undefined {
  return [...stages].sort((a, b) => a.order - b.order).at(-1);
}

function toolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? toolName;
}

export function StageRail({
  stages,
  runStatus,
  currentStageType,
  runProgressPercent,
  runMessage,
  reviewGate,
  stopAction,
  restartAction,
  stageLinks,
}: StageRailProps) {
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
  let inferredRunningShown = false;
  const hasExplicitRunningStage = stages.some((stage) => stage.status === "running");
  const inferCurrentStage =
    runStatus === "running" && !reviewGate && !hasExplicitRunningStage && currentStageType;

  return (
    <ol className={styles.stageRail} aria-label="Generation stages">
      {PIPELINE_GROUPS.map((visibleStage, idx) => {
        let groupStages = visibleStage.tools
          .map((toolName) => stagesByTool.get(toolName))
          .filter((stage): stage is GenerationStage => Boolean(stage));
        if (groupStages.length === 0) {
          const occurrence = fallbackCounts.get(visibleStage.type) ?? 0;
          const fallback = (broadFallback.get(visibleStage.type) ?? [])[occurrence];
          if (fallback) {
            groupStages = [fallback];
            fallbackCounts.set(visibleStage.type, occurrence + 1);
          }
        }
        const stage = latestStage(groupStages);
        const baseStatus = groupedStatus(groupStages);
        const inferredRunning = Boolean(
          inferCurrentStage &&
            visibleStage.type === inferCurrentStage &&
            !inferredRunningShown &&
            baseStatus === "queued",
        );
        if (groupStages.length === 0 && !inferredRunning) return null;
        if (inferredRunning) inferredRunningShown = true;
        const isLast = idx === PIPELINE_GROUPS.length - 1;
        const runningStage = groupStages.find((candidate) => candidate.status === "running");
        const failedStage = groupStages.find((candidate) => candidate.status === "failed");
        const status = inferredRunning ? "running" : baseStatus;
        const progressPercent = inferredRunning
          ? runProgressPercent
          : runningStage?.progressPercent ?? stage?.progressPercent;
        const message =
          failedStage?.error?.message ??
          (inferredRunning ? runMessage : runningStage?.message) ??
          visibleStage.description;
        const awaitingReview = groupStages.some((candidate) => reviewGate?.stageId === candidate.stageId);
        const statusKey = awaitingReview ? "review" : status;
        const showStatus =
          awaitingReview ||
          status === "running" ||
          status === "succeeded" ||
          status === "failed" ||
          status === "canceled";
        const stageLink = stageLinks?.[visibleStage.label];

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
                    {stage?.reviewedAt ? "Complete" : STATUS_LABEL[statusKey]}
                  </span>
                ) : null}
                <JudgmentBadge judgment={stage?.judgment} compact />
              </div>
              {awaitingReview ? (
                <p className={styles.stageMessage}>Waiting for approval.</p>
              ) : (
                <p className={styles.stageMessage}>{message}</p>
              )}
              {status === "running" && progressPercent != null ? (
                <div
                  className={styles.stageProgress}
                  role="progressbar"
                  aria-valuenow={progressPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className={styles.stageProgressFill}
                    style={{ width: `${Math.max(2, Math.min(100, progressPercent))}%` }}
                  />
                </div>
              ) : null}
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
                            {STATUS_LABEL[toolStatus]}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              ) : null}
              {status === "running" && stopAction ? (
                <div className={styles.stageControlRow}>
                  <button
                    type="button"
                    className={styles.stageStopButton}
                    onClick={stopAction.onStop}
                    disabled={stopAction.pending}
                    aria-busy={stopAction.pending || undefined}
                    aria-label={
                      stopAction.pending
                        ? "Stopping after current stage"
                        : "Stop after current stage"
                    }
                  >
                    {stopAction.pending ? (
                      <>
                        <LoadingDot />
                        Stopping after current step...
                      </>
                    ) : (
                      "Stop after current stage"
                    )}
                  </button>
                </div>
              ) : null}
              {restartAction &&
              stage &&
              (status === "succeeded" ||
                status === "failed" ||
                status === "canceled" ||
                awaitingReview) ? (
                <div className={styles.stageControlRow}>
                  <button
                    type="button"
                    className={styles.stageRestartButton}
                    onClick={() => restartAction.onRestart(stage.type)}
                    disabled={restartAction.pendingStageType != null}
                    aria-busy={restartAction.pendingStageType === stage.type || undefined}
                    aria-label={`Restart the run from the ${visibleStage.label} stage`}
                  >
                    {restartAction.pendingStageType === stage.type ? (
                      <>
                        <LoadingDot />
                        Restarting...
                      </>
                    ) : (
                      "Restart from here"
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
