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
  types: GenerationStageType[];
  label: string;
  description: string;
}> = [
  {
    types: ["brief_intake"],
    label: "Concept",
    description: "Project goal, audience, and creative direction.",
  },
  {
    types: ["creative_plan"],
    label: "Brief",
    description: "Structured generation brief ready for approval.",
  },
  {
    types: ["storyboard"],
    label: "Script",
    description: "Narrative beats, voiceover, and scene intent.",
  },
  {
    types: ["storyboard"],
    label: "Storyboard",
    description: "Scene-by-scene visual plan.",
  },
  {
    types: ["asset_generation"],
    label: "Shots",
    description: "Generated shot candidates and motion moments.",
  },
  {
    types: ["audio_generation", "asset_generation"],
    label: "Assets",
    description: "Images, clips, voice, and supporting media.",
  },
  {
    types: ["timeline_assembly"],
    label: "Timeline",
    description: "Deterministic edit assembly.",
  },
  {
    types: ["quality_review", "export"],
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
  const stagesByType = new Map<GenerationStageType, GenerationStage[]>();
  ordered.forEach((stage) => {
    const existing = stagesByType.get(stage.type) ?? [];
    existing.push(stage);
    stagesByType.set(stage.type, existing);
  });

  const occurrenceCounts = new Map<GenerationStageType, number>();
  let nextQueuedShown = false;
  const hasExplicitRunningStage = stages.some((stage) => stage.status === "running");
  const inferCurrentStage =
    runStatus === "running" && !reviewGate && !hasExplicitRunningStage && currentStageType;

  return (
    <ol className={styles.stageRail} aria-label="Generation stages">
      {VISIBLE_STAGES.map((visibleStage, idx) => {
        const matchingStages = visibleStage.types.flatMap((type) => {
          const occurrence = occurrenceCounts.get(type) ?? 0;
          return (stagesByType.get(type) ?? []).slice(occurrence);
        });
        const stage =
          matchingStages.find((candidate) => reviewGate?.stageId === candidate.stageId) ??
          matchingStages.find((candidate) => candidate.status === "running") ??
          matchingStages.find((candidate) => candidate.status === "failed") ??
          matchingStages.find((candidate) => candidate.status === "queued") ??
          matchingStages[0];
        if (stage) {
          occurrenceCounts.set(
            stage.type,
            (stagesByType.get(stage.type) ?? []).findIndex(
              (candidate) => candidate.stageId === stage.stageId,
            ) + 1,
          );
        }
        const isLast = idx === VISIBLE_STAGES.length - 1;
        const inferredRunning = Boolean(
          inferCurrentStage &&
            stage?.type === inferCurrentStage &&
            stage?.status === "queued",
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
        const isRealQueuedStage = Boolean(stage && stage.status === "queued");
        const isUpcoming = isRealQueuedStage && status === "queued" && !nextQueuedShown;
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
