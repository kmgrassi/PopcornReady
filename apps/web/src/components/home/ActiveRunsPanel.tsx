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
          const pct = run.progressPercent == null
            ? null
            : Math.max(0, Math.min(100, Math.round(run.progressPercent)));
          const needsReview = Boolean(run.reviewGate);
          const failed = run.status === "failed";
          const indeterminate = pct === null && run.status === "running";
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
                  {failed
                    ? run.currentStageType
                      ? `Stopped at ${formatStage(run.currentStageType)}`
                      : "Stopped"
                    : formatStage(run.currentStageType)}
                </span>

                {failed ? (
                  <div className={styles.recovery} aria-label="Failed run recovery">
                    <span>
                      Open the run to see what stopped. Request changes from the
                      project when you are ready.
                    </span>
                    <span className={styles.recoveryAction}>See what stopped</span>
                  </div>
                ) : null}

                <div className={styles.progress}>
                  <span className={styles.track} aria-hidden="true">
                    <span
                      className={`${styles.fill} ${indeterminate ? styles.fillIndeterminate : ""} ${needsReview ? styles.fillPaused : ""} ${failed ? styles.fillFailed : ""}`}
                      style={
                        pct === null
                          ? indeterminate
                            ? undefined
                            : { width: failed ? "100%" : "0%" }
                          : { width: `${pct}%` }
                      }
                    />
                  </span>
                  <span className={styles.pct}>
                    {pct === null ? (indeterminate ? "Working" : "Ended") : `${pct}%`}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
