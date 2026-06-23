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

const VISIBLE_STAGES: Array<{
  toolName: string;
  type: GenerationStageType;
  label: string;
  description: string;
}> = [
  {
    toolName: "create_or_load_brief",
    type: "brief_intake",
    label: "Concept",
    description: "Project goal, audience, and creative direction.",
  },
  {
    toolName: "develop_story_blueprint",
    type: "creative_plan",
    label: "Story Structure",
    description: "Premise, arc, characters, acts, and ending.",
  },
  {
    toolName: "draft_script",
    type: "creative_plan",
    label: "Script",
    description: "Narrative beats, voiceover, and scene intent.",
  },
  {
    toolName: "plan_shots",
    type: "creative_plan",
    label: "Shot Plan",
    description: "Scenes, beats, durations, and visual intent.",
  },
  {
    toolName: "plan_visual_anchors",
    type: "creative_plan",
    label: "Continuity Plan",
    description: "Reusable character, location, and style anchors.",
  },
  {
    toolName: "generate_anchor",
    type: "asset_generation",
    label: "Anchor Images",
    description: "Reference images for recurring subjects and locations.",
  },
  {
    toolName: "generate_storyboard",
    type: "storyboard",
    label: "Storyboard",
    description: "Low-cost sketch frames for each planned beat.",
  },
  {
    toolName: "generate_keyframe",
    type: "asset_generation",
    label: "Keyframes",
    description: "Photoreal first frames for planned beats.",
  },
  {
    toolName: "generate_clip",
    type: "asset_generation",
    label: "Clips",
    description: "Motion clips generated from approved keyframes.",
  },
  {
    toolName: "generate_audio",
    type: "audio_generation",
    label: "Audio",
    description: "Voiceover, music, and supporting sound.",
  },
  {
    toolName: "assemble_timeline",
    type: "timeline_assembly",
    label: "Timeline",
    description: "Deterministic edit assembly.",
  },
  {
    toolName: "export_video",
    type: "export",
    label: "Final Render",
    description: "Quality pass and finished video render.",
  },
];

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
  let nextQueuedShown = false;
  const hasExplicitRunningStage = stages.some((stage) => stage.status === "running");
  const inferCurrentStage =
    runStatus === "running" && !reviewGate && !hasExplicitRunningStage && currentStageType;

  return (
    <ol className={styles.stageRail} aria-label="Generation stages">
      {VISIBLE_STAGES.map((visibleStage, idx) => {
        let stage = stagesByTool.get(visibleStage.toolName);
        if (!stage) {
          const occurrence = fallbackCounts.get(visibleStage.type) ?? 0;
          stage = (broadFallback.get(visibleStage.type) ?? [])[occurrence];
          if (stage) fallbackCounts.set(visibleStage.type, occurrence + 1);
        }
        const isLast = idx === VISIBLE_STAGES.length - 1;
        const inferredRunning = Boolean(
          inferCurrentStage &&
            visibleStage.type === inferCurrentStage &&
            (!stage || stage.status === "queued"),
        );
        const status = inferredRunning ? "running" : stage?.status ?? "queued";
        const progressPercent = inferredRunning
          ? runProgressPercent
          : stage?.progressPercent;
        const message =
          stage?.error?.message ??
          (inferredRunning ? runMessage : stage?.message) ??
          visibleStage.description;
        const awaitingReview = Boolean(stage && reviewGate?.stageId === stage.stageId);
        const statusKey = awaitingReview ? "review" : status;
        const isUpcoming = status === "queued" && !nextQueuedShown;
        if (isUpcoming) nextQueuedShown = true;
        const showStatus =
          awaitingReview ||
          status === "running" ||
          status === "succeeded" ||
          status === "failed" ||
          status === "canceled" ||
          isUpcoming;
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
                    {isUpcoming ? "Up next" : stage?.reviewedAt ? "Complete" : STATUS_LABEL[statusKey]}
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
              {isUpcoming && stopAction ? (
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
