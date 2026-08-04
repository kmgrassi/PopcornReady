import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { GenerationRun } from "@popcorn/shared/v1/types";
import { AnonymousUpgradeBanner } from "../components/auth/AnonymousUpgradeBanner";
import { useAuth } from "../components/auth/AuthProvider";
import { ProgressView } from "../components/progress/ProgressView";
import type { GenerationRunDetail } from "../lib/v1/generation-runs/status";
import {
  clearLastRunHint,
  readLastRunHint,
  writeLastRunHint,
} from "../lib/v1/generation-runs/recovery";
import {
  useGenerationRunQuery,
  useCreditsQuery,
  useRetryGenerationRunAfterCreditUpdateMutation,
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
  const auth = useAuth();
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewFeedbackNote, setReviewFeedbackNote] = useState("");
  const hint = readLastRunHint(projectId);
  const studioReturnPath = null;
  const runQuery = useGenerationRunQuery(projectId, runId);
  const updateRun = useUpdateGenerationRunMutation(projectId, runId);
  const payload = runQuery.data ?? null;
  const authScope = auth.user?.id ?? auth.status;
  const creditFailure = payload?.run.status === "failed" && payload.run.error?.code === "insufficient_credits";
  const creditsQuery = useCreditsQuery(authScope, {
    enabled: auth.status === "authenticated" && creditFailure,
    refetchInterval: creditFailure ? 5_000 : false,
  });
  const retryAfterCreditUpdate = useRetryGenerationRunAfterCreditUpdateMutation(projectId, runId);
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

  async function runAction(action: "approve" | "cancel", note?: string) {
    if (actionPending) return;
    setActionError(null);
    try {
      const trimmedNote = note?.trim();
      const body = action === "approve" && trimmedNote ? { note: trimmedNote } : undefined;
      const data = await updateRun.mutateAsync({ action, body });
      applyPayload(data);
      if (action === "approve") {
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

  async function continueAfterCreditUpdate() {
    if (retryAfterCreditUpdate.isPending) return;
    setActionError(null);
    try {
      const data = await retryAfterCreditUpdate.mutateAsync();
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
      hierarchy={payload.hierarchy}
      operatorDiagnostics={payload.operatorDiagnostics}
      studioReturnPath={studioReturnPath}
      headerSlot={<AnonymousUpgradeBanner />}
      onBoardRevisionSuccess={async () => {
        await runQuery.refetch();
      }}
      cancelAction={
        !payload.run.reviewGate && !isTerminal(payload.run.status)
          ? {
              pending: actionPending === "cancel",
              error: actionError,
              onCancel: () => void runAction("cancel"),
            }
          : undefined
      }
      creditRecovery={
        creditFailure && typeof creditsQuery.data?.balanceCredits === "number" && creditsQuery.data.balanceCredits > 0
          ? {
              balanceCredits: creditsQuery.data.balanceCredits,
              pending: retryAfterCreditUpdate.isPending,
              onContinue: () => void continueAfterCreditUpdate(),
            }
          : undefined
      }
      reviewActions={
        payload.run.reviewGate
          ? {
              pending: actionPending,
              error: actionError,
              feedbackNote: reviewFeedbackNote,
              onFeedbackNoteChange: setReviewFeedbackNote,
              onApprove: (note) => void runAction("approve", note),
              onCancel: () => void runAction("cancel"),
            }
          : undefined
      }
    />
  );
}
