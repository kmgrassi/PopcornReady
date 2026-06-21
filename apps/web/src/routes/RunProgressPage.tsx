import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { GenerationRun, GenerationStageType } from "@popcorn/shared/v1/types";
import { ProgressView } from "../components/progress/ProgressView";
import type { GenerationRunDetail } from "../lib/v1/generation-runs/status";
import {
  clearLastRunHint,
  readLastRunHint,
  writeLastRunHint,
} from "../lib/v1/generation-runs/recovery";
import {
  useGenerationRunQuery,
  useRestartGenerationRunFromStageMutation,
  useUpdateGenerationRunMutation,
} from "../lib/queryClient";

function isTerminal(status: GenerationRun["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

function progressFallbackPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

export function RunProgressPage() {
  const { projectId, runId } = useParams();

  if (!projectId || !runId) {
    return (
      <main className="progress-shell">
        <div className="progress-empty-card">
          <h1 className="progress-title">Run not found</h1>
          <p className="muted">This progress URL is missing a project or run id.</p>
        </div>
      </main>
    );
  }

  return (
    <RunProgress
      projectId={projectId}
      runId={runId}
    />
  );
}

function RunProgress({
  projectId,
  runId,
}: {
  projectId: string;
  runId: string;
}) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewFeedbackNote, setReviewFeedbackNote] = useState("");
  const hint = readLastRunHint(projectId);
  const studioReturnPath = null;
  const runQuery = useGenerationRunQuery(projectId, runId);
  const updateRun = useUpdateGenerationRunMutation(projectId, runId);
  const restartRun = useRestartGenerationRunFromStageMutation(projectId, runId);
  const payload = runQuery.data ?? null;
  const error =
    runQuery.error instanceof Error
      ? runQuery.error.message
      : runQuery.error
        ? String(runQuery.error)
        : null;
  const actionPending = updateRun.isPending
    ? updateRun.variables?.action
    : undefined;
  const reviewGateKey = payload?.run.reviewGate?.stageId ?? null;

  const applyPayload = useCallback(
    (next: GenerationRunDetail) => {
      if (next.run.status === "canceled") {
        clearLastRunHint(projectId);
        return;
      }
      if (isTerminal(next.run.status)) {
        if (next.run.runId === runId) {
          writeLastRunHint(projectId, next.run);
        }
      } else {
        writeLastRunHint(projectId, next.run);
      }
    },
    [projectId, runId],
  );

  useEffect(() => {
    if (payload) applyPayload(payload);
  }, [applyPayload, payload]);

  useEffect(() => {
    setReviewFeedbackNote("");
  }, [reviewGateKey]);

  async function runAction(action: "approve" | "reject" | "cancel", note?: string) {
    if (actionPending) return;
    setActionError(null);
    try {
      const trimmedNote = note?.trim();
      const body =
        action === "reject" && payload?.run.reviewGate
          ? {
              stageType: payload.run.reviewGate.stageType,
              ...(trimmedNote ? { note: trimmedNote } : {}),
            }
          : action === "approve" && trimmedNote
            ? { note: trimmedNote }
            : undefined;
      const data = await updateRun.mutateAsync({ action, body });
      applyPayload(data);
      if (action === "approve" || action === "reject") {
        setReviewFeedbackNote("");
      }
      if (action === "cancel" && data.run.status === "canceled") {
        clearLastRunHint(projectId);
      }
      void runQuery.refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function restartFromStage(stageType: GenerationStageType) {
    if (restartRun.isPending) return;
    const confirmed = window.confirm(
      `Restart this run from the ${stageType.replace(/_/g, " ")} stage? ` +
        "That stage and everything after it will re-run; existing assets are kept as history.",
    );
    if (!confirmed) return;
    setActionError(null);
    try {
      const data = await restartRun.mutateAsync(stageType);
      applyPayload(data);
      void runQuery.refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!payload) {
    return (
      <main className="progress-shell">
        <div className="progress-empty-card">
          <h1 className="progress-title">Opening production workspace</h1>
          <p className={`muted${error ? " lp-prompt-error" : ""}`}>
            {error ?? "Preparing your progress view."}
          </p>
          {hint ? (
            <p className="muted">
              Last seen run <code>{hint.runId}</code> was {hint.status}.
            </p>
          ) : null}
          <Link className="secondary compact" to={studioReturnPath ?? progressFallbackPath(projectId)}>
            {studioReturnPath ? "View draft" : "Open project"}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <ProgressView
      run={payload.run}
      stages={payload.stages}
      stageItems={payload.stageItems}
      studioReturnPath={studioReturnPath}
      cancelAction={
        !payload.run.reviewGate && !isTerminal(payload.run.status)
          ? {
              pending: actionPending === "cancel",
              error: actionError,
              onCancel: () => void runAction("cancel"),
            }
          : undefined
      }
      restartAction={{
        pendingStageType: restartRun.isPending ? restartRun.variables ?? null : null,
        onRestart: (stageType) => void restartFromStage(stageType),
      }}
      reviewActions={
        payload.run.reviewGate
          ? {
              pending: actionPending,
              error: actionError,
              feedbackNote: reviewFeedbackNote,
              onFeedbackNoteChange: setReviewFeedbackNote,
              onApprove: (note) => void runAction("approve", note),
              onReject: (note) => void runAction("reject", note),
              onCancel: () => void runAction("cancel"),
            }
          : undefined
      }
    />
  );
}
