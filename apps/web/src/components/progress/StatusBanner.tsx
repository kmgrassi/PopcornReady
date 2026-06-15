"use client";

import {
  GENERATION_STAGE_LABELS,
  type GenerationRun,
} from "@popcorn/shared/v1/types";
import { formatElapsed, useElapsedTime } from "./useElapsedTime";
import styles from "./ProgressView.module.css";

interface StatusBannerProps {
  run: GenerationRun;
}

export function StatusBanner({ run }: StatusBannerProps) {
  const elapsed = useElapsedTime(run.startedAt, undefined);
  const stageLabel = run.currentStageType
    ? GENERATION_STAGE_LABELS[run.currentStageType]
    : null;
  const reviewStageLabel = run.reviewGate
    ? GENERATION_STAGE_LABELS[run.reviewGate.stageType]
    : null;

  const heading =
    reviewStageLabel
      ? `${reviewStageLabel} — ready for review`
      : run.status === "queued"
      ? "Waiting to start"
      : stageLabel
        ? `${stageLabel} — in progress`
        : "Generating your video";

  return (
    <div className={styles.statusBanner}>
      <div className={styles.statusBannerHead}>
        <span
          className={`${styles.statusBannerDot} ${
            styles[`statusBannerDot_${run.reviewGate ? "review" : run.status}`]
          }`}
        />
        <span className={styles.statusBannerHeading}>{heading}</span>
      </div>
      <p className={styles.statusBannerMessage} role="status" aria-live="polite" aria-atomic="true">
        {run.reviewGate
          ? "Review this stage's output, then approve to continue the run."
          : run.message ?? "Tracking progress…"}
      </p>
      <div className={styles.statusBannerMeta} aria-live="off">
        <span className={styles.statusBannerMetaLabel}>Elapsed</span>
        <span className={styles.statusBannerMetaValue}>
          {elapsed === null ? "—" : formatElapsed(elapsed)}
        </span>
        {run.progressPercent != null ? (
          <>
            <span className={styles.statusBannerMetaSep} aria-hidden>·</span>
            <span className={styles.statusBannerMetaLabel}>Overall</span>
            <span className={styles.statusBannerMetaValue}>
              {Math.round(run.progressPercent)}%
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}
