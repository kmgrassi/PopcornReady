"use client";

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
  reviewGate?: RunReviewGate | null;
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
  running: "Generating",
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

export function StageRail({ stages, reviewGate }: StageRailProps) {
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  const stagesByType = new Map<GenerationStageType, GenerationStage[]>();
  ordered.forEach((stage) => {
    const existing = stagesByType.get(stage.type) ?? [];
    existing.push(stage);
    stagesByType.set(stage.type, existing);
  });

  const occurrenceCounts = new Map<GenerationStageType, number>();
  let nextQueuedShown = false;

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
        const status = stage?.status ?? "queued";
        const message = stage?.error?.message ?? stage?.message ?? visibleStage.description;
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
                <span className={styles.stageTitle}>{visibleStage.label}</span>
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
              {status === "running" && stage?.progressPercent != null ? (
                <div
                  className={styles.stageProgress}
                  role="progressbar"
                  aria-valuenow={stage.progressPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className={styles.stageProgressFill}
                    style={{ width: `${Math.max(2, Math.min(100, stage.progressPercent))}%` }}
                  />
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
