import { Link } from "react-router-dom";
import type {
  DashboardActiveRunSummary,
} from "@popcorn/shared/v1/dashboard";
import type { GenerationRunStatus } from "@popcorn/shared/v1/types";
import { formatStage, runPath } from "../../lib/nextAction";
import styles from "./ActiveRunsPanel.module.css";

const STATUS_LABELS: Record<GenerationRunStatus, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
  canceled: "Canceled",
};

export function ActiveRunsPanel({
  runs,
}: {
  runs: readonly DashboardActiveRunSummary[];
}) {
  if (runs.length === 0) return null;

  return (
    <section className={styles.section} aria-labelledby="active-runs-title">
      <div className={styles.header}>
        <h2 id="active-runs-title">In progress</h2>
        <Link to="/library/projects">View projects</Link>
      </div>

      <ul className={styles.list}>
        {runs.map((run) => {
          const pct = Math.max(
            0,
            Math.min(100, Math.round(run.progressPercent ?? 0)),
          );
          const needsReview = Boolean(run.reviewGate);
          const failed = run.status === "failed";
          return (
            <li key={run.runId}>
              <Link
                className={`${styles.run} ${failed ? styles.runFailed : ""}`}
                to={runPath(run)}
                aria-label={
                  failed
                    ? `Open failure details for ${run.projectName}`
                    : `Open progress for ${run.projectName}`
                }
              >
                <div className={styles.top}>
                  <span className={styles.name}>{run.projectName}</span>
                  {needsReview ? (
                    <span className={styles.reviewBadge}>Needs review</span>
                  ) : (
                    <span className={`${styles.status} ${styles[run.status]}`}>
                      {STATUS_LABELS[run.status]}
                    </span>
                  )}
                </div>

                <span className={styles.stage}>
                  {formatStage(run.currentStageType)}
                </span>

                {failed ? (
                  <div className={styles.recovery} aria-label="Failed run recovery">
                    <span>
                      Open the run to see what stopped and retry from the failed stage.
                    </span>
                    <span className={styles.recoveryAction}>See why and retry</span>
                  </div>
                ) : null}

                <div className={styles.progress}>
                  <span className={styles.track} aria-hidden="true">
                    <span
                      className={`${styles.fill} ${needsReview ? styles.fillPaused : ""}`}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className={styles.pct}>{pct}%</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
