import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  RerunProposalLifecycleView,
  RerunTarget,
} from "@popcorn/shared/rerun-proposal";
import type { BoardRevisionTarget } from "@popcorn/shared/v1/types";
import { ApiClientError } from "../../lib/api-client";
import {
  rerunProposalQueryKey,
  useApproveRerunProposalMutation,
  useCancelRerunProposalMutation,
  useCreateRerunProposalMutation,
  useExecuteRerunProposalMutation,
  useRefreshRerunProposalMutation,
  useRejectRerunProposalMutation,
  useRerunProposalQuery,
} from "../../lib/rerunProposalQueries";
import { resolveRerunTarget } from "../../lib/rerunTargets";
import { queryClient } from "../../lib/queryClientCore";
import { Button } from "../ui/Button";
import { CloseButton } from "../ui/CloseButton";
import styles from "./RerunProposalDialog.module.css";

export interface RerunProposalDialogProps {
  open: boolean;
  projectId: string;
  target: BoardRevisionTarget | null;
  rerunTarget?: RerunTarget | null;
  rootRunId?: string | null;
  title: string;
  subtitle?: string | null;
  asset: ReactNode;
  initialMessage?: string | null;
  sourcePrompt?: string | null;
  onClose: () => void;
  onExecutionStarted?: (target: BoardRevisionTarget) => Promise<void> | void;
  onExecutionSettled?: (target: BoardRevisionTarget) => Promise<void> | void;
}

function targetIdentity(target: RerunTarget) {
  switch (target.kind) {
    case "project":
      return `project:${target.projectId}`;
    case "storyboard":
      return `storyboard:${target.storyboardId}`;
    case "scene":
      return `scene:${target.sceneId}`;
    case "beat":
      return `beat:${target.beatId}`;
    case "panel":
      return `panel:${target.panelId}`;
    case "asset":
      return `asset:${target.assetId}`;
    case "lineage":
      return `lineage:${target.lineageId}`;
    case "timeline_item":
      return `timeline:${target.timelineItemId}`;
    case "export":
      return `export:${target.exportId}`;
    case "selection":
      return `selection:${target.slotOwnerLineageId ?? "project"}:${target.slotRole}`;
    case "transcript_segment":
      return `transcript:${target.transcriptSegmentId}`;
  }
}

function storageKey(projectId: string, target: RerunTarget) {
  return `popcorn:rerun-proposal:${projectId}:${targetIdentity(target)}`;
}

function operationKey(
  projectId: string,
  actionId: string,
  operation: "refresh" | "execute"
) {
  const key = `popcorn:rerun-idempotency:${projectId}:${actionId}:${operation}`;
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(key, created);
  return created;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function targetLabel(target: RerunTarget) {
  return target.kind.replace("_", " ");
}

function workLabel(owner: string) {
  if (owner === "creative_director") return "Story and assembly";
  if (owner === "visuals") return "Visuals";
  return "Audio";
}

function statusCopy(view: RerunProposalLifecycleView) {
  if (view.execution?.status === "canceled") return "Changes canceled";
  if (view.execution?.status === "completed" || view.status === "applied") {
    return "Changes applied";
  }
  if (view.execution?.status === "failed" || view.status === "failed") {
    return "Changes failed";
  }
  if (view.execution || view.status === "running") return "Changes in progress";
  if (view.approval || view.status === "approved") return "Approved";
  if (view.status === "rejected") return "Proposal declined";
  return "Ready for review";
}

export function RerunProposalDialog({
  open,
  projectId,
  target,
  rerunTarget,
  rootRunId,
  title,
  subtitle,
  asset,
  initialMessage,
  sourcePrompt,
  onClose,
  onExecutionStarted,
  onExecutionSettled,
}: RerunProposalDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusIdentityRef = useRef<{
    ariaLabel: string | null;
    text: string;
  } | null>(null);
  const onCloseRef = useRef(onClose);
  const pendingRef = useRef(false);
  const executionTargetRef = useRef<BoardRevisionTarget | null>(null);
  const [message, setMessage] = useState("");
  const [actionId, setActionId] = useState<string | null>(null);
  const [createdView, setCreatedView] =
    useState<RerunProposalLifecycleView | null>(null);
  const [selectedOption, setSelectedOption] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [settledNotifiedActionId, setSettledNotifiedActionId] =
    useState<string | null>(null);
  const [activeOperation, setActiveOperation] = useState<
    "create" | "approve" | "reject" | "refresh" | "execute" | "cancel" | null
  >(null);
  const exactTarget = useMemo(
    () => resolveRerunTarget(projectId, target, rerunTarget),
    [projectId, rerunTarget, target]
  );
  const persistedKey = exactTarget ? storageKey(projectId, exactTarget) : null;
  const proposalQuery = useRerunProposalQuery(projectId, actionId);
  const createMutation = useCreateRerunProposalMutation(projectId);
  const approveMutation = useApproveRerunProposalMutation(projectId, actionId);
  const rejectMutation = useRejectRerunProposalMutation(projectId, actionId);
  const refreshMutation = useRefreshRerunProposalMutation(projectId, actionId);
  const executeMutation = useExecuteRerunProposalMutation(projectId, actionId);
  const cancelMutation = useCancelRerunProposalMutation(projectId, actionId);
  const view = proposalQuery.data ?? createdView;
  const pending =
    createMutation.isPending ||
    approveMutation.isPending ||
    rejectMutation.isPending ||
    refreshMutation.isPending ||
    executeMutation.isPending ||
    cancelMutation.isPending;
  pendingRef.current = pending;
  onCloseRef.current = onClose;
  const mutationError =
    (activeOperation === "create"
      ? createMutation.error
      : activeOperation === "approve"
        ? approveMutation.error
        : activeOperation === "reject"
          ? rejectMutation.error
          : activeOperation === "refresh"
            ? refreshMutation.error
            : activeOperation === "execute"
              ? executeMutation.error
              : activeOperation === "cancel"
                ? cancelMutation.error
                : null) ?? proposalQuery.error;
  const stale =
    mutationError instanceof ApiClientError &&
    mutationError.code === "stale_proposal";
  const error = localError ?? (mutationError ? errorMessage(mutationError) : null);
  const proposal = view?.proposal;
  const active =
    view?.status === "running" ||
    view?.execution?.status === "reserved" ||
    view?.execution?.status === "running" ||
    view?.execution?.status === "waiting";
  const terminal =
    view?.status === "applied" ||
    view?.status === "failed" ||
    view?.status === "rejected" ||
    view?.execution?.status === "completed" ||
    view?.execution?.status === "failed" ||
    view?.execution?.status === "canceled";

  useEffect(() => {
    if (!open || !persistedKey) return;
    setMessage(initialMessage ?? "");
    setSelectedOption("");
    setLocalError(null);
    setCreatedView(null);
    setSettledNotifiedActionId(null);
    setActiveOperation(null);
    setActionId(window.localStorage.getItem(persistedKey));
  }, [initialMessage, open, persistedKey]);

  useEffect(() => {
    if (!persistedKey || !actionId) return;
    window.localStorage.setItem(persistedKey, actionId);
  }, [actionId, persistedKey]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    restoreFocusIdentityRef.current = restoreFocusRef.current
      ? {
          ariaLabel: restoreFocusRef.current.getAttribute("aria-label"),
          text: restoreFocusRef.current.textContent?.trim() ?? "",
        }
      : null;
    window.requestAnimationFrame(() => {
      const first =
        dialogRef.current?.querySelector<HTMLElement>("textarea") ??
        dialogRef.current?.querySelector<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), [tabindex='0']"
        );
      (first ?? dialogRef.current)?.focus();
    });
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pendingRef.current) onCloseRef.current();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex='0']"
        )
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (restoreFocusRef.current?.isConnected) {
        restoreFocusRef.current.focus();
        return;
      }
      const identity = restoreFocusIdentityRef.current;
      if (!identity) return;
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          "button, a[href], input, textarea, select, [tabindex='0']"
        )
      );
      const replacement = candidates.find(
        (candidate) =>
          (identity.ariaLabel &&
            candidate.getAttribute("aria-label") === identity.ariaLabel) ||
          (identity.text && candidate.textContent?.trim() === identity.text)
      ) ?? candidates.find((candidate) =>
        candidate.getAttribute("aria-label")?.toLowerCase().includes(
          title.toLowerCase()
        )
      ) ?? candidates.find((candidate) =>
        candidate.textContent?.toLowerCase().includes("request changes")
      );
      replacement?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (
      !view ||
      !onExecutionSettled ||
      settledNotifiedActionId === view.actionId ||
      (view.execution?.status !== "completed" &&
        view.execution?.status !== "failed" &&
        view.execution?.status !== "canceled")
    ) {
      return;
    }
    setSettledNotifiedActionId(view.actionId);
    if (executionTargetRef.current) {
      void onExecutionSettled(executionTargetRef.current);
    }
  }, [onExecutionSettled, settledNotifiedActionId, view]);

  useEffect(() => {
    if (terminal && persistedKey) {
      window.localStorage.removeItem(persistedKey);
    }
  }, [persistedKey, terminal]);

  useEffect(() => {
    if (
      !persistedKey ||
      !actionId ||
      !(proposalQuery.error instanceof ApiClientError) ||
      proposalQuery.error.code !== "not_found"
    ) {
      return;
    }
    window.localStorage.removeItem(persistedKey);
    setActionId(null);
    setCreatedView(null);
    setActiveOperation(null);
  }, [actionId, persistedKey, proposalQuery.error]);

  if (!open || (!target && !rerunTarget)) return null;

  async function createPreview() {
    const trimmed = message.trim();
    if (!trimmed || !exactTarget) return;
    setLocalError(null);
    setActiveOperation("create");
    try {
      const result = await createMutation.mutateAsync({
        message: trimmed,
        targets: [exactTarget!],
        ...(rootRunId ? { rootRunId } : {}),
      });
      const next: RerunProposalLifecycleView = {
        actionId: result.actionId,
        status: "proposed",
        proposal: result.proposal,
        approval: null,
        execution: null,
        failure: null,
      };
      setActionId(result.actionId);
      setCreatedView(next);
      setActiveOperation(null);
      queryClient.setQueryData(
        rerunProposalQueryKey(projectId, result.actionId),
        next
      );
    } catch {
      // Mutation error is rendered below.
    }
  }

  async function refreshPreview(
    clarificationAnswer?: { answerFingerprint: string; optionId: string }
  ) {
    setLocalError(null);
    setActiveOperation("refresh");
    try {
      const result = await refreshMutation.mutateAsync({
        idempotencyKey: operationKey(projectId, actionId!, "refresh"),
        message: message.trim() || view?.proposal.userIntent || "",
        ...(clarificationAnswer ? { clarificationAnswer } : {}),
      });
      const next: RerunProposalLifecycleView = {
        actionId: result.actionId,
        status: "proposed",
        proposal: result.proposal,
        approval: null,
        execution: null,
        failure: null,
      };
      setActionId(result.actionId);
      setCreatedView(next);
      setSelectedOption("");
      setActiveOperation(null);
      queryClient.setQueryData(
        rerunProposalQueryKey(projectId, result.actionId),
        next
      );
    } catch {
      // Mutation error is rendered below.
    }
  }

  async function approve() {
    if (!view) return;
    setLocalError(null);
    setActiveOperation("approve");
    try {
      await approveMutation.mutateAsync(view.proposal.estimate.maxCostUsd);
      await proposalQuery.refetch();
      setActiveOperation(null);
    } catch {
      // Mutation error is rendered below.
    }
  }

  async function execute() {
    if (!exactTarget) return;
    const executedTarget = target;
    setLocalError(null);
    setActiveOperation("execute");
    executionTargetRef.current = executedTarget;
    try {
      await executeMutation.mutateAsync(
        operationKey(projectId, actionId!, "execute")
      );
      await proposalQuery.refetch();
      if (executedTarget) {
        await onExecutionStarted?.(executedTarget);
      }
      setActiveOperation(null);
    } catch {
      // Mutation error is rendered below.
    }
  }

  async function reject() {
    setLocalError(null);
    setActiveOperation("reject");
    try {
      await rejectMutation.mutateAsync();
      await proposalQuery.refetch();
      setActiveOperation(null);
    } catch {
      // Mutation error is rendered below.
    }
  }

  async function cancel() {
    setLocalError(null);
    setActiveOperation("cancel");
    try {
      await cancelMutation.mutateAsync();
      await proposalQuery.refetch();
      setActiveOperation(null);
    } catch {
      // Mutation error is rendered below.
    }
  }

  const displayError =
    error ??
    (view?.status === "failed" ? view.failure?.message ?? null : null) ??
    (!exactTarget
      ? "This item does not expose an exact graph target yet, so the request was not broadened to the whole project."
      : null);

  function resetProposal() {
    if (persistedKey) window.localStorage.removeItem(persistedKey);
    setActionId(null);
    setCreatedView(null);
    setSelectedOption("");
    setLocalError(null);
    setActiveOperation(null);
    executionTargetRef.current = null;
  }

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={() => {
        if (!pending) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={pending || undefined}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Request changes</p>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <CloseButton onClick={onClose} disabled={pending} />
        </header>

        <div className={styles.body}>
          <div className={styles.assetPane}>{asset}</div>

          <div className={styles.reviewPane}>
            {actionId && proposalQuery.isLoading && !proposal ? (
              <div className={styles.loading} role="status">
                <span aria-hidden="true" />
                Restoring your change proposal…
              </div>
            ) : !proposal ? (
              <>
                {sourcePrompt?.trim() ? (
                  <section className={styles.sourcePrompt}>
                    <span>Original prompt</span>
                    <p>{sourcePrompt}</p>
                  </section>
                ) : null}
                <label className={styles.field}>
                  <span>What should change?</span>
                  <textarea
                    value={message}
                    rows={8}
                    autoFocus
                    placeholder="Describe the result you want. The agent will preview everything affected before changing it."
                    disabled={pending}
                    onChange={(event) => setMessage(event.target.value)}
                  />
                </label>
                <p className={styles.assurance}>
                  Nothing is generated until you review the scope and approve
                  its maximum cost.
                </p>
              </>
            ) : (
              <div className={styles.proposal}>
                <div className={styles.statusRow}>
                  <span
                    className={styles.status}
                    data-tone={active ? "active" : terminal ? "terminal" : "ready"}
                    role="status"
                  >
                    {statusCopy(view)}
                  </span>
                  <span className={styles.risk} data-risk={proposal.risk}>
                    {proposal.risk} risk
                  </span>
                </div>
                <div>
                  <h3>{proposal.userFacingSummary}</h3>
                  <p className={styles.rationale}>{proposal.rationale}</p>
                </div>

                {proposal.outcome === "ask_clarification" ? (
                  <fieldset className={styles.clarification}>
                    <legend>{proposal.clarification.question}</legend>
                    {proposal.clarification.options.map((option) => (
                      <label key={option.id}>
                        <input
                          type="radio"
                          name={`clarification-${view.actionId}`}
                          value={option.id}
                          checked={selectedOption === option.id}
                          onChange={() => setSelectedOption(option.id)}
                        />
                        <span>
                          <strong>{option.label}</strong>
                          <small>{option.tradeoff}</small>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                ) : null}

                <dl className={styles.facts}>
                  <div>
                    <dt>Maximum cost</dt>
                    <dd>${proposal.estimate.maxCostUsd.toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt>Expected timing</dt>
                    <dd>{proposal.estimate.latencyClass === "media" ? "A few minutes" : "Usually quick"}</dd>
                  </div>
                  <div>
                    <dt>Target</dt>
                    <dd>
                      {proposal.targets
                        .map((item) =>
                          item.kind === "project"
                            ? "Entire project context"
                            : targetLabel(item)
                        )
                        .join(", ")}
                    </dd>
                  </div>
                </dl>

                {proposal.selectedWork.length > 0 ? (
                  <section className={styles.work}>
                    <h4>Planned work</h4>
                    <ul>
                      {proposal.selectedWork.map((item) => (
                        <li key={item.workItemId}>
                          <strong>{workLabel(item.owner)}</strong>
                          <span>
                            {item.requiredOutputs.length} output
                            {item.requiredOutputs.length === 1 ? "" : "s"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {proposal.checklist.length > 0 ? (
                  <section className={styles.checklist}>
                    <h4>Impact check</h4>
                    <ul>
                      {proposal.checklist.map((item, index) => (
                        <li key={`${item.decision}-${index}`}>
                          <span data-decision={item.decision}>
                            {item.decision}
                          </span>
                          <p>{item.reason}</p>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {proposal.preservedAssetIds.length > 0 ? (
                  <p className={styles.preserved}>
                    {proposal.preservedAssetIds.length} existing asset
                    {proposal.preservedAssetIds.length === 1 ? "" : "s"} will
                    remain unchanged.
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {displayError ? (
          <div className={styles.error} role="alert">
            <strong>{stale ? "This preview is out of date." : "Couldn’t continue."}</strong>
            <span>{displayError}</span>
          </div>
        ) : null}

        <footer className={styles.actions}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={pending}>
            {terminal ? "Close" : "Not now"}
          </Button>
          {!proposal ? (
            <Button
              variant="primary"
              type="button"
              disabled={!message.trim() || !exactTarget || pending}
              isLoading={createMutation.isPending}
              onClick={() => void createPreview()}
            >
              Preview changes
            </Button>
          ) : proposal.outcome === "ask_clarification" ? (
            <Button
              variant="primary"
              type="button"
              disabled={!selectedOption || pending}
              isLoading={refreshMutation.isPending}
              onClick={() =>
                void refreshPreview({
                  answerFingerprint: proposal.clarification.answerFingerprint,
                  optionId: selectedOption,
                })
              }
            >
              Update preview
            </Button>
          ) : proposal.outcome === "no_op" ? (
            <Button
              variant="ghost"
              type="button"
              disabled={pending}
              onClick={() => {
                resetProposal();
              }}
            >
              Revise request
            </Button>
          ) : stale ? (
            <Button
              variant="primary"
              type="button"
              disabled={pending}
              isLoading={refreshMutation.isPending}
              onClick={() => void refreshPreview()}
            >
              Refresh preview
            </Button>
          ) : active ? (
            <Button
              variant="ghost"
              type="button"
              disabled={pending}
              isLoading={cancelMutation.isPending}
              onClick={() => void cancel()}
            >
              Cancel changes
            </Button>
          ) : terminal ? (
            <Button
              variant="ghost"
              type="button"
              disabled={pending}
              onClick={resetProposal}
            >
              New request
            </Button>
          ) : view.approval || view.status === "approved" ? (
            <Button
              variant="primary"
              type="button"
              disabled={pending}
              isLoading={executeMutation.isPending}
              onClick={() => void execute()}
            >
              Start changes
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                type="button"
                disabled={pending}
                isLoading={rejectMutation.isPending}
                onClick={() => void reject()}
              >
                Decline
              </Button>
              <Button
                variant="primary"
                type="button"
                disabled={pending}
                isLoading={approveMutation.isPending}
                onClick={() => void approve()}
              >
                Approve up to ${proposal.estimate.maxCostUsd.toFixed(2)}
              </Button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
