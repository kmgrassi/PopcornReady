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
  type: GenerationStageType;
  label: string;
  description: string;
}> = [
  {
    type: "brief_intake",
    label: "Concept",
    description: "Project goal, audience, and creative direction.",
  },
  {
    type: "creative_plan",
    label: "Brief",
    description: "Structured generation brief ready for approval.",
  },
  {
    type: "storyboard",
    label: "Script",
    description: "Narrative beats, voiceover, and scene intent.",
  },
  {
    type: "storyboard",
    label: "Storyboard",
    description: "Scene-by-scene visual plan.",
  },
  {
    type: "asset_generation",
    label: "Shots",
    description: "Generated shot candidates and motion moments.",
  },
  {
    type: "asset_generation",
    label: "Assets",
    description: "Images, clips, voice, and supporting media.",
  },
  {
    type: "timeline_assembly",
    label: "Timeline",
    description: "Deterministic edit assembly.",
  },
  {
    type: "export",
    label: "Final Render",
    description: "Quality pass and finished video render.",
  },
];

const STATUS_LABEL: Record<GenerationRunStatus | "review", string> = {
  queued: "Pending",
  running: "Generating",
  succeeded: "Complete",
  failed: "Failed",
  canceled: "Canceled",
  review: "Needs Review",
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

  return (
    <ol className={styles.stageRail} aria-label="Generation stages">
      {VISIBLE_STAGES.map((visibleStage, idx) => {
        const occurrence = occurrenceCounts.get(visibleStage.type) ?? 0;
        occurrenceCounts.set(visibleStage.type, occurrence + 1);
        const matchingStages = stagesByType.get(visibleStage.type) ?? [];
        const stage = matchingStages[occurrence] ?? matchingStages[0];
        const isLast = idx === VISIBLE_STAGES.length - 1;
        const status = stage?.status ?? "queued";
        const message = stage?.error?.message ?? stage?.message ?? visibleStage.description;
        const awaitingReview = Boolean(stage && reviewGate?.stageId === stage.stageId);
        const statusKey = awaitingReview ? "review" : status;

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
                <span className={`${styles.stageStatusPill} ${styles[`stageStatus_${statusKey}`]}`}>
                  {stage?.reviewedAt ? "Complete" : STATUS_LABEL[statusKey]}
                </span>
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
