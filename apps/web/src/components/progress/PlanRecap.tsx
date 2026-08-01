import type { V1Project, VideoBriefInput } from "@popcorn/shared/v1/types";
import styles from "./ProgressView.module.css";

function formatBriefMeta(brief: VideoBriefInput): string {
  return [
    `${brief.targetLengthSec}s`,
    brief.aspectRatio,
    brief.platform,
    brief.format,
  ].filter(Boolean).join(" / ");
}

function formatLength(seconds?: number): string | null {
  if (!seconds) return null;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function planMetaItems(brief: VideoBriefInput): string[] {
  return [
    formatLength(brief.targetLengthSec),
    brief.aspectRatio,
    brief.platform,
    brief.format,
  ].filter((item): item is string => Boolean(item));
}

export function PlanRecap({
  project,
  loading,
}: {
  project: V1Project | null;
  loading: boolean;
}) {
  const brief = project?.brief ?? null;
  const requiredBeats = brief?.constraints?.requiredBeats ?? [];
  return (
    <section className={styles.planRecap} aria-labelledby="plan-recap-heading">
      <div className={styles.planRecapHeader}>
        <div>
          <p className={styles.eyebrow}>Approved plan</p>
          <h2 id="plan-recap-heading" className={styles.planRecapTitle}>
            {project?.name ?? "Project plan"}
          </h2>
        </div>
        {brief ? (
          <div className={styles.planRecapMeta} aria-label={formatBriefMeta(brief)}>
            {planMetaItems(brief).map((item) => <span key={item}>{item}</span>)}
          </div>
        ) : null}
      </div>
      {loading ? (
        <p className={styles.planRecapLoading}>Loading plan context...</p>
      ) : brief ? (
        <>
          <p className={styles.planRecapGoal}>{brief.goal}</p>
          <dl className={styles.planRecapFacts}>
            {brief.hookQuestion ? <div><dt>Hook</dt><dd>{brief.hookQuestion}</dd></div> : null}
            {requiredBeats.length > 0 ? <div><dt>Beat count</dt><dd>{requiredBeats.length} planned beats</dd></div> : null}
            {brief.strongestVisual ? <div><dt>Visual direction</dt><dd>{brief.strongestVisual}</dd></div> : null}
          </dl>
        </>
      ) : (
        <p className={styles.planRecapLoading}>
          Plan details are unavailable for this run, but production is continuing from the saved project context.
        </p>
      )}
    </section>
  );
}
