import type {
  GenerationJobDiagnostics,
  GenerationRun,
  GenerationStage,
} from "@popcorn/shared/v1/types";
import { StageRail } from "./StageRail";
import { formatElapsed, useElapsedTime } from "./useElapsedTime";
import { formatDateTime, shortId } from "./progress-view-helpers";
import styles from "./ProgressView.module.css";

interface PipelineDepthProps {
  run: GenerationRun;
  stages: GenerationStage[];
  elapsed: number | null;
  sinceLastActivity: number | null;
  stageLinks: Partial<Record<string, string>>;
  showCancelAction: boolean;
  cancelAction?: {
    pending?: boolean;
    error?: string | null;
    onCancel: () => void;
  };
  operatorDiagnostics?: GenerationJobDiagnostics[];
  standaloneLabel: string | null;
  choosingNextStep: boolean;
}

interface OperatorDiagnosticsProps {
  runId: string;
  diagnostics: GenerationJobDiagnostics[];
}

export function OperatorDiagnostics({
  runId,
  diagnostics,
}: OperatorDiagnosticsProps) {
  return (
    <details className={styles.operatorDiagnostics}>
      <summary>Operator diagnostics</summary>
      <div className={styles.operatorDiagnosticsBody}>
        <div className={styles.diagnostics}>
          <span className={styles.runIdLabel}>Run ID</span>
          <code className={styles.runId} title={runId}>{shortId(runId)}</code>
          <button type="button" className={styles.copyButton} onClick={() => void navigator.clipboard?.writeText(runId)}>
            Copy
          </button>
        </div>
        {diagnostics.length > 0 ? (
          <ol className={styles.operatorJobList}>
            {diagnostics.map((job) => (
              <li className={styles.operatorJob} key={job.jobId}>
                <div className={styles.operatorJobHeading}><strong>{job.currentStep ?? "Background job"}</strong><span>{job.status}</span></div>
                <dl className={styles.operatorJobFacts}>
                  <div><dt>Job</dt><dd><code>{shortId(job.jobId)}</code></dd></div>
                  <div><dt>Action</dt><dd><code>{shortId(job.actionId)}</code></dd></div>
                  {job.provider ? <div><dt>Provider</dt><dd>{job.provider}</dd></div> : null}
                  {job.attempt != null ? <div><dt>Attempt</dt><dd>{job.attempt}</dd></div> : null}
                  <div><dt>Updated</dt><dd>{formatDateTime(job.updatedAt)}</dd></div>
                  {job.lastProgressAt ? <div><dt>Progress</dt><dd>{formatDateTime(job.lastProgressAt)}</dd></div> : null}
                  {job.heartbeatAt ? <div><dt>Heartbeat</dt><dd>{formatDateTime(job.heartbeatAt)}</dd></div> : null}
                  {job.nextRetryAt ? <div><dt>Next retry</dt><dd>{formatDateTime(job.nextRetryAt)}</dd></div> : null}
                </dl>
              </li>
            ))}
          </ol>
        ) : <p className={styles.operatorEmpty}>No job diagnostics reported yet.</p>}
      </div>
    </details>
  );
}

export function PipelineDepth({
  run,
  stages,
  elapsed,
  sinceLastActivity,
  stageLinks,
  showCancelAction,
  cancelAction,
  operatorDiagnostics,
  standaloneLabel,
  choosingNextStep,
}: PipelineDepthProps) {
  return (
    <>
      <div className={styles.sidePanelHeader}>
        <div>
          <p className={styles.eyebrow}>{standaloneLabel ? "Asset activity" : "Pipeline"}</p>
          <h2 className={styles.sidePanelHeading}>{standaloneLabel ? "Status" : "Stages"}</h2>
        </div>
      </div>
      {!isTerminalStatus(run.status) && !run.reviewGate ? (
        <div className={styles.backgroundActivity} role="status">
          <span className={styles.backgroundSpinner} aria-hidden="true" />
          <span>
            {cancelAction?.pending
              ? "Stopping after the current step..."
              : run.activityState === "waiting_on_job"
                ? "Waiting on a provider"
                : run.activityState === "recovering"
                  ? "Recovering from an earlier failed step"
                  : choosingNextStep
                    ? "Choosing the next step"
                    : "Working in the background"}
          </span>
        </div>
      ) : null}
      <StageRail
        stages={stages}
        runStatus={run.status}
        currentStageType={run.currentStageType}
        runProgressPercent={run.progressPercent}
        runMessage={run.message}
        reviewGate={run.reviewGate}
        stageLinks={stageLinks}
        presentationKind={run.presentationKind}
        stopAction={
          showCancelAction && cancelAction
            ? { pending: cancelAction.pending, error: cancelAction.error, onStop: cancelAction.onCancel }
            : undefined
        }
      />
      {showCancelAction && cancelAction?.error ? <p className={styles.error} role="alert">{cancelAction.error}</p> : null}
      <p className={styles.sidePanelMeta}>
        {elapsed !== null ? `Elapsed ${formatElapsed(elapsed)}. ` : ""}
        {sinceLastActivity !== null
          ? `Last activity ${formatElapsed(sinceLastActivity)} ago.`
          : run.status === "running"
            ? "Waiting for the first meaningful progress update."
            : "No meaningful progress timestamp was recorded."}
      </p>
      {operatorDiagnostics ? (
        <OperatorDiagnostics runId={run.runId} diagnostics={operatorDiagnostics} />
      ) : null}
    </>
  );
}

function isTerminalStatus(status: GenerationRun["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

export function usePipelineElapsed(run: GenerationRun) {
  return {
    elapsed: useElapsedTime(run.startedAt, run.completedAt),
    sinceLastActivity: useElapsedTime(run.lastProgressAt, run.completedAt),
  };
}
