import type { ReactNode } from "react";
import { StudioCrewLoader } from "./StudioCrewLoader";
import styles from "./CreationProgressExperience.module.css";

export type CreationStatusPresentation = {
  label: string;
  tone: "active" | "neutral" | "success" | "danger";
  isActive: boolean;
};

function briefExcerpt(summary: string, maximumLength = 180) {
  const normalized = summary.replace(/\s+/g, " ").trim();
  if (normalized.length <= maximumLength) return normalized;
  const candidate = normalized.slice(0, maximumLength + 1);
  const lastSpace = candidate.lastIndexOf(" ");
  const cutAt = lastSpace > maximumLength * 0.7 ? lastSpace : maximumLength;
  return `${candidate.slice(0, cutAt).trimEnd()}…`;
}

function LiveStatus({ presentation }: { presentation: CreationStatusPresentation }) {
  return (
    <div
      className={styles.liveStatus}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className={styles.statusBadge} data-tone={presentation.tone}>
        <span className={styles.statusDot} aria-hidden="true" />
        {presentation.label}
      </span>
    </div>
  );
}

export function CreationProgressExperience({
  presentation,
  inputSummary,
  children,
}: {
  presentation: CreationStatusPresentation;
  inputSummary?: string;
  children?: ReactNode;
}) {
  return (
    <section
      className={styles.statusShell}
      data-prominent={presentation.isActive || undefined}
      data-testid="creation-progress-experience"
    >
      {presentation.isActive ? <LiveStatus presentation={presentation} /> : null}

      <StudioCrewLoader
        active={presentation.isActive}
        prominent={presentation.isActive}
      />

      <div className={styles.statusDetails}>
        {!presentation.isActive ? (
          <LiveStatus presentation={presentation} />
        ) : null}

        {presentation.isActive ? (
          <div
            className={styles.progressTrack}
            data-testid="creation-progress-track"
            aria-hidden="true"
          >
            <span />
          </div>
        ) : null}

        {inputSummary ? (
          <details className={styles.briefDisclosure}>
            <summary aria-label="View full request brief">
              <span className={styles.briefLabel}>Creative brief</span>
              <span className={styles.briefExcerpt} aria-hidden="true">
                {briefExcerpt(inputSummary)}
              </span>
              <span className={styles.briefAction} aria-hidden="true">
                View full brief
              </span>
            </summary>
            <p>{inputSummary}</p>
          </details>
        ) : null}

        {children}
      </div>
    </section>
  );
}

export function CreationProgressSkeleton() {
  return (
    <section
      className={`${styles.statusShell} ${styles.skeletonShell}`}
      aria-hidden="true"
    >
      <div className={`${styles.skeletonLine} ${styles.skeletonLabel}`} />
      <div className={styles.sceneSkeleton} />
      <div className={styles.statusDetails}>
        <div className={styles.skeletonBrief} />
        <div className={`${styles.skeletonLine} ${styles.skeletonShort}`} />
      </div>
    </section>
  );
}
