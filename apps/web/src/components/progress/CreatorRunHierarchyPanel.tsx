import { Link } from "react-router-dom";
import type {
  CreatorRunHierarchy,
  CreatorRunHierarchySession,
  CreatorWorkState,
} from "../../lib/v1/generation-runs/status";
import {
  currentHierarchyRun,
  DOMAIN_LABELS,
  emptyHierarchyCopy,
  sessionDescription,
  sessionOutputAssetIds,
  sessionProgress,
  WORK_STATE_LABELS,
} from "./creator-run-hierarchy";
import { assetLibraryPath } from "../../lib/assetLibraryPath";
import styles from "./CreatorRunHierarchyPanel.module.css";

interface CreatorRunHierarchyPanelProps {
  hierarchy: CreatorRunHierarchy;
  projectId: string;
  compact?: boolean;
  stopAction?: {
    pending?: boolean;
    error?: string | null;
    onStop: () => void;
  };
}

function StateGlyph({ state }: { state: CreatorWorkState }) {
  return (
    <span className={styles.stateGlyph} data-state={state} aria-hidden="true">
      {state === "complete" ? "✓" : state === "failed" || state === "blocked" ? "!" : ""}
    </span>
  );
}

function SessionLane({
  session,
  projectId,
}: {
  session: CreatorRunHierarchySession;
  projectId: string;
}) {
  const currentRun = currentHierarchyRun(session);
  const outputs = sessionOutputAssetIds(session);
  const progress = sessionProgress(session);
  const expanded = session.state !== "complete" && session.state !== "canceled";

  return (
    <details className={styles.lane} data-state={session.state} open={expanded || undefined}>
      <summary className={styles.laneSummary}>
        <StateGlyph state={session.state} />
        <span className={styles.laneIdentity}>
          <strong>{DOMAIN_LABELS[session.domain]}</strong>
          <span>{sessionDescription(session)}</span>
        </span>
        <span className={styles.laneResult} aria-live="polite" aria-atomic="true">
          <span className={styles.stateLabel}>{WORK_STATE_LABELS[session.state]}</span>
          {outputs.length > 0 ? (
            <span>{outputs.length === 1 ? "1 output" : `${outputs.length} outputs`}</span>
          ) : null}
        </span>
        <span className={styles.chevron} aria-hidden="true">⌄</span>
      </summary>

      <div className={styles.laneBody}>
        {progress && progress.totalItems > 0 ? (
          <div className={styles.progressBlock}>
            <div className={styles.progressCopy}>
              <span>Assignment progress</span>
              <strong>{progress.completedItems} of {progress.totalItems} ready</strong>
            </div>
            <div
              className={styles.progressTrack}
              role="progressbar"
              aria-label={`${DOMAIN_LABELS[session.domain]} ${progress.completedItems} of ${progress.totalItems} ready`}
              aria-valuemin={0}
              aria-valuemax={progress.totalItems}
              aria-valuenow={Math.min(progress.completedItems, progress.totalItems)}
            >
              <span style={{ width: `${Math.min(100, (progress.completedItems / progress.totalItems) * 100)}%` }} />
            </div>
          </div>
        ) : null}

        {outputs.length > 0 ? (
          <div className={styles.outputSummary}>
            <span>{outputs.length === 1 ? "1 project asset is ready." : `${outputs.length} project assets are ready.`}</span>
            <Link
              to={outputs.length === 1
                ? assetLibraryPath(outputs[0]!, projectId)
                : `/projects/${encodeURIComponent(projectId)}/media`}
            >
              {outputs.length === 1 ? "Open output" : "Open project assets"}
            </Link>
          </div>
        ) : null}

        <details className={styles.technicalDetails}>
          <summary>Show production details</summary>
          <ol className={styles.runList}>
            {[...session.runs].reverse().map((run) => (
              <li key={run.runId}>
                <div className={styles.runHeading}>
                  <strong>{run.runId === currentRun?.runId ? "Current assignment" : "Earlier assignment"}</strong>
                  <span>{WORK_STATE_LABELS[run.state]}</span>
                </div>
                {run.actions.length > 0 ? (
                  <ul className={styles.actionList}>
                    {run.actions.map((action) => (
                      <li key={action.actionId}>
                        <span>{action.label}</span>
                        <span>{WORK_STATE_LABELS[action.state]}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{run.runId === currentRun?.runId ? "The director is preparing this assignment." : "No production activity was recorded."}</p>
                )}
              </li>
            ))}
          </ol>
        </details>
      </div>
    </details>
  );
}

export function CreatorRunHierarchyPanel({
  hierarchy,
  projectId,
  compact = false,
  stopAction,
}: CreatorRunHierarchyPanelProps) {
  const emptyCopy = hierarchy.sessions.length === 0
    ? emptyHierarchyCopy(hierarchy.root.state)
    : null;

  return (
    <section
      className={`${styles.panel}${compact ? ` ${styles.compact}` : ""}`}
      aria-labelledby={`creative-director-${hierarchy.root.runId}`}
    >
      <div className={styles.director}>
        <span className={styles.directorMark} aria-hidden="true">CD</span>
        <div>
          <h2 id={`creative-director-${hierarchy.root.runId}`}>Creative Director</h2>
          <p>{emptyCopy?.directorMessage ?? hierarchy.root.message}</p>
        </div>
        <div className={styles.directorActions}>
          <span className={styles.directorState} data-state={hierarchy.root.state} role="status">
            <StateGlyph state={hierarchy.root.state} />
            {hierarchy.root.needsDirectorDecision
              ? "Resolving a specialist question"
              : WORK_STATE_LABELS[hierarchy.root.state]}
          </span>
          {stopAction ? (
            <button
              type="button"
              className={styles.stopButton}
              onClick={stopAction.onStop}
              disabled={stopAction.pending}
              aria-busy={stopAction.pending || undefined}
            >
              {stopAction.pending ? "Stopping after this step…" : "Stop after this step"}
            </button>
          ) : null}
        </div>
      </div>

      {stopAction?.error ? <p className={styles.stopError} role="alert">{stopAction.error}</p> : null}

      <div className={styles.lanes}>
        {hierarchy.sessions.length > 0 ? (
          hierarchy.sessions.map((session) => (
            <SessionLane key={session.sessionId} session={session} projectId={projectId} />
          ))
        ) : (
          <p className={styles.empty}>{emptyHierarchyCopy(hierarchy.root.state).description}</p>
        )}
      </div>
    </section>
  );
}
