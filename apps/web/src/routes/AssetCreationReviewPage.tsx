import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import {
  useCreationConfirmation,
  useCreationProposal,
  type CreationProposal,
} from "../lib/agent-creations";
import {
  creationDraftNavigationState,
  creationReviewNavigationState,
  readCreationReviewState,
} from "../lib/creationReview";
import styles from "./AssetCreationReviewPage.module.css";

const AUTO_APPROVAL_DELAY_MS = 10_000;
const EXPIRY_SAFETY_MARGIN_MS = 1_000;

function hasAutomaticApprovalWindow(proposal: CreationProposal) {
  return (
    Date.parse(proposal.expiresAt) >
    Date.now() + AUTO_APPROVAL_DELAY_MS + EXPIRY_SAFETY_MARGIN_MS
  );
}

export function AssetCreationReviewPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const reviewState = useMemo(
    () => readCreationReviewState(location.state),
    [location.state],
  );
  const request = reviewState?.request ?? null;
  const restoredProposal = reviewState?.proposal ?? null;
  const propose = useCreationProposal();
  const confirm = useCreationConfirmation();
  const [proposal, setProposal] = useState<CreationProposal | null>(
    restoredProposal,
  );
  const [proposalError, setProposalError] = useState<Error | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(10);
  const [proposalNeedsRefresh, setProposalNeedsRefresh] = useState(
    () => Boolean(restoredProposal && !hasAutomaticApprovalWindow(restoredProposal)),
  );
  const [countdownArmed, setCountdownArmed] = useState(
    () =>
      Boolean(
        restoredProposal &&
          reviewState?.autoApprovalAllowed &&
          hasAutomaticApprovalWindow(restoredProposal),
      ),
  );
  const proposalStarted = useRef(Boolean(restoredProposal));
  const confirmationStarted = useRef(false);
  const automaticApprovalCanceled = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    automaticApprovalCanceled.current = false;
    return () => {
      mounted.current = false;
      automaticApprovalCanceled.current = true;
    };
  }, []);

  const requestProposal = useCallback(async () => {
    if (!request) return;
    setProposalError(null);
    try {
      const nextProposal = await propose.mutateAsync(request);
      if (mounted.current) {
        const proposalHasApprovalWindow =
          hasAutomaticApprovalWindow(nextProposal);
        const canApproveAutomatically =
          reviewState?.autoApprovalAllowed !== false &&
          proposalHasApprovalWindow;
        setProposal(nextProposal);
        setProposalNeedsRefresh(!proposalHasApprovalWindow);
        setCountdownArmed(canApproveAutomatically);
        navigate(`${location.pathname}${location.search}`, {
          replace: true,
          state: creationReviewNavigationState(request, {
            proposal: nextProposal,
            autoApprovalAllowed: canApproveAutomatically,
          }),
        });
      }
    } catch (error) {
      if (mounted.current) {
        setProposalError(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  }, [
    location.pathname,
    location.search,
    navigate,
    propose,
    request,
    reviewState?.autoApprovalAllowed,
  ]);

  useEffect(() => {
    if (!request || proposalStarted.current) return;
    proposalStarted.current = true;
    void requestProposal();
  }, [request, requestProposal]);

  const approve = useCallback(
    async (source: "manual" | "timer") => {
      if (
        !request ||
        !proposal ||
        proposalNeedsRefresh ||
        confirmationStarted.current
      ) {
        return;
      }
      const expiryBuffer = source === "timer" ? EXPIRY_SAFETY_MARGIN_MS : 0;
      if (Date.parse(proposal.expiresAt) <= Date.now() + expiryBuffer) {
        automaticApprovalCanceled.current = true;
        setCountdownArmed(false);
        setProposalNeedsRefresh(true);
        navigate(`${location.pathname}${location.search}`, {
          replace: true,
          state: creationReviewNavigationState(request, {
            proposal,
            autoApprovalAllowed: false,
          }),
        });
        return;
      }
      if (source === "manual") automaticApprovalCanceled.current = true;
      confirmationStarted.current = true;
      setCountdownArmed(false);
      navigate(`${location.pathname}${location.search}`, {
        replace: true,
        state: creationReviewNavigationState(request, {
          proposal,
          autoApprovalAllowed: false,
        }),
      });
      try {
        const result = await confirm.mutateAsync({
          projectId: request.projectId,
          proposal,
        });
        navigate(
          `/create/asset?projectId=${encodeURIComponent(request.projectId)}&runId=${encodeURIComponent(result.runId)}`,
          { replace: true },
        );
      } catch {
        confirmationStarted.current = false;
        automaticApprovalCanceled.current = true;
      }
    },
    [
      confirm,
      location.pathname,
      location.search,
      navigate,
      proposal,
      proposalNeedsRefresh,
      request,
    ],
  );
  const approveRef = useRef(approve);
  approveRef.current = approve;

  useEffect(() => {
    if (!proposal || !countdownArmed) return;
    const deadline = Date.now() + AUTO_APPROVAL_DELAY_MS;
    setSecondsRemaining(10);
    const updateCountdown = () => {
      setSecondsRemaining(
        Math.max(0, Math.ceil((deadline - Date.now()) / 1_000)),
      );
    };
    const interval = window.setInterval(updateCountdown, 250);
    const timeout = window.setTimeout(() => {
      updateCountdown();
      if (!automaticApprovalCanceled.current) {
        void approveRef.current("timer");
      }
    }, AUTO_APPROVAL_DELAY_MS);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [countdownArmed, proposal]);

  if (!request) {
    return (
      <main className={styles.page}>
        <section className={styles.recovery}>
          <h1>This review is no longer available</h1>
          <p>
            Return to Asset Studio to prepare the request again. Nothing has
            been generated or approved from this page.
          </p>
          <Button variant="cta" size="lg" onClick={() => navigate("/create/asset", { replace: true })}>
            Return to Asset Studio
          </Button>
        </section>
      </main>
    );
  }

  const revise = () => {
    automaticApprovalCanceled.current = true;
    navigate("/create/asset", {
      replace: true,
      state: creationDraftNavigationState({
        goal: request.goal,
        projectId: request.projectId,
        prompt: request.prompt,
        improvePrompt: request.improvePrompt,
      }),
    });
  };

  const retryProposal = () => {
    if (propose.isPending) return;
    propose.reset();
    setProposalError(null);
    proposalStarted.current = true;
    void requestProposal();
  };

  const isImprovingPrompt =
    (request.goal === "image" || request.goal === "video") &&
    request.improvePrompt;
  const refinementDescription = request.goal === "video"
    ? "We’re turning your idea into clear motion direction before generation."
    : "We’re turning your idea into clear art direction before generation.";

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>
          {proposalNeedsRefresh
            ? "Prepare a new review"
            : proposal
            ? "Approve this"
            : isImprovingPrompt
              ? "Improving your prompt"
              : "Preparing your request"}
        </h1>
        <p>
          {proposalNeedsRefresh
            ? "This proposal can no longer be approved safely."
            : proposal
            ? "Review the final request before asset generation begins."
            : isImprovingPrompt
              ? refinementDescription
              : "We’re checking the request and preparing its cost proposal."}
        </p>
      </header>

      {!proposal && propose.isPending ? (
        <section className={styles.preparing} aria-live="polite">
          <div className={styles.progressTrack} aria-hidden="true">
            <span />
          </div>
          <strong>
            {isImprovingPrompt ? "Refining the creative direction" : "Preparing the proposal"}
          </strong>
          <p>Asset generation has not started yet.</p>
        </section>
      ) : null}

      {!proposal && proposalError ? (
        <section className={styles.errorPanel} role="alert">
          <h2>We couldn’t prepare this request</h2>
          <p>{proposalError.message}</p>
          <div className={styles.actions}>
            <Button variant="cta" onClick={retryProposal}>
              Retry
            </Button>
            <Button variant="ghost" onClick={revise}>
              Revise request
            </Button>
          </div>
        </section>
      ) : null}

      {proposal ? (
        <section className={styles.proposal} aria-label="Creation proposal">
          <p className={styles.srOnly} role="status">
            {proposalNeedsRefresh
              ? "This proposal needs to be refreshed before it can be approved."
              : countdownArmed
                ? "Proposal ready. Approve it now or asset generation starts automatically in 10 seconds."
                : "Proposal ready. Automatic approval is off. Approve it manually or revise the request."}
          </p>
          <p>
            Asset generation can spend up to ${proposal.maximumUsd.toFixed(2)}.
            Asset generation has not begun.
          </p>
          <div className={styles.promptReview}>
            {proposal.enhancementApplied ? (
              <>
                <span>Original</span>
                <p>{request.prompt.trim()}</p>
                <span>Refined prompt</span>
              </>
            ) : (
              <span>Prompt</span>
            )}
            <p className={styles.effectivePrompt}>
              {proposal.effectivePrompt || request.prompt.trim()}
            </p>
          </div>
          {proposalNeedsRefresh ? (
            <div className={styles.staleNotice} role="alert">
              <h2>This proposal needs to be refreshed</h2>
              <p>
                Return to Asset Studio to prepare a fresh proposal. Nothing has
                been approved from this page.
              </p>
            </div>
          ) : countdownArmed && !confirm.isPending && !confirm.error ? (
            <>
              <p className={styles.autoApprovalNotice}>
                This request starts automatically 10 seconds after the proposal
                is ready unless you revise it.
              </p>
              <p className={styles.countdown} aria-hidden="true">
                Starting automatically in {secondsRemaining} second
                {secondsRemaining === 1 ? "" : "s"}.
              </p>
            </>
          ) : null}
          {confirm.error ? (
            <p className={styles.error} role="alert">
              {confirm.error.message}
            </p>
          ) : null}
          {proposalNeedsRefresh ? (
            <div className={styles.actions}>
              <Button variant="cta" size="lg" onClick={revise}>
                Prepare again
              </Button>
            </div>
          ) : (
            <div className={styles.actions}>
              <Button
                variant="cta"
                size="lg"
                isLoading={confirm.isPending}
                onClick={() => void approve("manual")}
              >
                Approve this
              </Button>
              <Button
                variant="ghost"
                disabled={confirm.isPending}
                onClick={revise}
              >
                Revise request
              </Button>
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}
