import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GENERATION_STAGE_LABELS,
  type GateableGenerationStageType,
  type GenerationRunStatus,
} from "@popcorn/shared/v1/types";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/Button";
import { StatusChecklist } from "../ui/StatusChecklist";
import { StudioEmptyState } from "./StudioEmptyState";
import { STEP_LABELS, StudioStepper } from "./StudioStepper";
import { buildChecklistItems } from "./statusChecklist";
import {
  EMPTY_BRIEF_DRAFT,
  STUDIO_SETUP_STEPS,
  STUDIO_STEPS,
  useStudioFlow,
  type BriefDraft,
  type StudioStep,
} from "./useStudioFlow";
import { BriefStep } from "./steps/BriefStep";
import { SourceFootageStep } from "./steps/SourceFootageStep";
import { ReviewStep } from "./ReviewStep";
import { ExportStep } from "./steps/ExportStep";
import {
  type StudioDraftPayload,
} from "../../lib/draftStore";
import {
  useCreateStudioDraftMutation,
  useDeleteStudioDraftMutation,
  useStudioDraftQuery,
  useStudioDraftsQuery,
} from "../../lib/draftStoreQuery";
import styles from "./StudioShell.module.css";

const LOCAL_DRAFT_ID = "local";
const TERMINAL_RECOVERABLE_RUN_STATUSES: GenerationRunStatus[] = ["failed", "canceled"];

function studioDraftPath({
  draftId,
  step,
  openPanel,
  started,
  autoStart,
}: {
  draftId?: string;
  step: StudioStep;
  openPanel?: string;
  started?: boolean;
  autoStart?: boolean;
}) {
  const params = new URLSearchParams();
  if (draftId) params.set("draft", draftId);
  if (started) params.set("start", "1");
  if (autoStart) params.set("autoStart", "1");
  if (step !== "brief") params.set("step", step);
  if (openPanel) params.set("panel", openPanel);
  const query = params.toString();
  return query ? `/projects/new?${query}` : "/projects/new";
}

export interface StudioShellProps {
  /** Seed the brief draft, e.g. from `?goal=`/`?length=` query params. */
  initialBrief?: Partial<BriefDraft>;
  /** Seed the active step, e.g. from palette deep links. */
  initialStep?: StudioStep;
  /** Skip the empty state when the route is opened for a specific action. */
  initialStarted?: boolean;
  /** Optional panel key the active step should open by default. */
  openPanel?: string;
  /** Optional saved draft id from the retired Studio route. */
  draftId?: string | null;
  /** Unique route token requesting a fresh Studio draft. */
  newDraftRequest?: string;
  /** Start generation immediately after creating/restoring the prompt draft. */
  autoStartGeneration?: boolean;
}

/**
 * StudioShell — the Studio wizard backbone (PR 1).
 *
 * Drives the `initial → generating → review` state machine and renders, per
 * state: the empty state + stepper + active step (initial), the calm status
 * checklist (generating), and the preview + timeline (review). Steps plug in by
 * implementing `StepProps`; the shell owns navigation and the run lifecycle.
 */
export function StudioShell({
  initialBrief,
  initialStep,
  initialStarted = false,
  openPanel,
  draftId,
  newDraftRequest,
  autoStartGeneration = false,
}: StudioShellProps) {
  const navigate = useNavigate();
  const seededBrief = useMemo(
    () => ({
      ...initialBrief,
    }),
    [initialBrief],
  );
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [initialPayload, setInitialPayload] = useState<StudioDraftPayload | null>(null);
  const [pendingDraftRequest, setPendingDraftRequest] = useState<{
    draftId: string;
    requestedAt: number;
  } | null>(null);
  const [draftActionError, setDraftActionError] = useState<string | null>(null);
  const [flowKey, setFlowKey] = useState(0);
  const [isStartingFreshDraft, setIsStartingFreshDraft] = useState(false);
  const autoStartRequestedRef = useRef(false);
  const handledNewDraftRequestRef = useRef<string | null>(null);
  const createDraftInFlightRef = useRef(false);
  const [pendingAutoStartGeneration, setPendingAutoStartGeneration] =
    useState(autoStartGeneration);
  const draftsQuery = useStudioDraftsQuery();
  const draftQuery = useStudioDraftQuery(pendingDraftRequest?.draftId ?? null);
  const createDraftMutation = useCreateStudioDraftMutation();
  const deleteDraftMutation = useDeleteStudioDraftMutation();
  const drafts = draftsQuery.data ?? [];
  const draftsLoading = draftsQuery.isLoading;
  const draftsError =
    draftActionError ??
    (draftsQuery.error instanceof Error ? draftsQuery.error.message : null) ??
    (draftQuery.error instanceof Error ? draftQuery.error.message : null);

  const openDraft = useCallback(
    (nextDraftId: string) => {
      setDraftActionError(null);
      setPendingDraftRequest({ draftId: nextDraftId, requestedAt: Date.now() });
    },
    [],
  );

  useEffect(() => {
    if (draftQuery.isFetching || draftQuery.error) return;
    if (!pendingDraftRequest || draftQuery.dataUpdatedAt < pendingDraftRequest.requestedAt) {
      return;
    }
    const record = draftQuery.data;
    if (!record || pendingDraftRequest.draftId !== record.draftId) return;
    setActiveDraftId(record.draftId);
    setInitialPayload(record.payload);
    setFlowKey((current) => current + 1);
    setPendingDraftRequest(null);
    navigate(`/projects/new?draft=${encodeURIComponent(record.draftId)}`, { replace: true });
  }, [
    draftQuery.data,
    draftQuery.dataUpdatedAt,
    draftQuery.error,
    draftQuery.isFetching,
    navigate,
    pendingDraftRequest,
  ]);

  useEffect(() => {
    if (!draftId || activeDraftId === draftId) return;
    openDraft(draftId);
  }, [activeDraftId, draftId, openDraft]);

  const startUnsavedDraft = useCallback((step: StudioStep = "brief") => {
    setDraftActionError(null);
    setPendingDraftRequest(null);
    setActiveDraftId(LOCAL_DRAFT_ID);
    setInitialPayload(null);
    setFlowKey((current) => current + 1);
    navigate(studioDraftPath({ step, openPanel, started: initialStarted }), {
      replace: true,
    });
  }, [initialStarted, navigate, openPanel]);

  const createPersistedDraft = useCallback(async (step: StudioStep = "brief") => {
    if (createDraftInFlightRef.current) return;

    createDraftInFlightRef.current = true;
    setIsStartingFreshDraft(true);
    setDraftActionError(null);
    try {
      const record = await createDraftMutation.mutateAsync({
        draft: { ...EMPTY_BRIEF_DRAFT, ...seededBrief },
        step,
      });
      setActiveDraftId(record.draftId);
      setInitialPayload(record.payload);
      setFlowKey((current) => current + 1);
      navigate(
        studioDraftPath({
          draftId: record.draftId,
          step,
          openPanel,
          autoStart: pendingAutoStartGeneration,
        }),
        { replace: true },
      );
    } catch {
      setActiveDraftId(LOCAL_DRAFT_ID);
      setInitialPayload(null);
      setFlowKey((current) => current + 1);
      navigate(studioDraftPath({ step, openPanel, started: initialStarted }), {
        replace: true,
      });
    } finally {
      createDraftInFlightRef.current = false;
      setIsStartingFreshDraft(false);
    }
  }, [
    createDraftMutation,
    initialStarted,
    navigate,
    openPanel,
    pendingAutoStartGeneration,
    seededBrief,
  ]);

  const persistLocalDraft = useCallback(
    async (draft: BriefDraft, step: StudioStep) => {
      if (activeDraftId !== LOCAL_DRAFT_ID) return activeDraftId;
      if (createDraftInFlightRef.current) return null;

      createDraftInFlightRef.current = true;
      setDraftActionError(null);
      try {
        const record = await createDraftMutation.mutateAsync({ draft, step });
        setActiveDraftId(record.draftId);
        setInitialPayload(record.payload);
        setFlowKey((current) => current + 1);
        navigate(
          studioDraftPath({
            draftId: record.draftId,
            step,
            openPanel,
            autoStart: pendingAutoStartGeneration,
          }),
          { replace: true },
        );
        return record.draftId;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not create draft.";
        setDraftActionError(message);
        return null;
      } finally {
        createDraftInFlightRef.current = false;
      }
    },
    [activeDraftId, createDraftMutation, navigate, openPanel, pendingAutoStartGeneration],
  );

  useEffect(() => {
    if (autoStartGeneration) setPendingAutoStartGeneration(true);
  }, [autoStartGeneration]);

  useEffect(() => {
    if (!initialStarted || draftId) {
      autoStartRequestedRef.current = false;
      return;
    }
    if (newDraftRequest) return;
    if (activeDraftId || autoStartRequestedRef.current) return;
    autoStartRequestedRef.current = true;
    if (seededBrief.goal?.trim()) {
      void createPersistedDraft(initialStep ?? "brief");
    } else {
      startUnsavedDraft(initialStep ?? "brief");
    }
  }, [
    activeDraftId,
    createPersistedDraft,
    draftId,
    initialStarted,
    initialStep,
    newDraftRequest,
    seededBrief.goal,
    startUnsavedDraft,
  ]);

  useEffect(() => {
    if (!newDraftRequest || handledNewDraftRequestRef.current === newDraftRequest) {
      return;
    }
    handledNewDraftRequestRef.current = newDraftRequest;
    startUnsavedDraft(initialStep ?? "brief");
  }, [initialStep, newDraftRequest, startUnsavedDraft]);

  async function removeDraft(nextDraftId: string) {
    setDraftActionError(null);
    try {
      await deleteDraftMutation.mutateAsync(nextDraftId);
      if (nextDraftId === activeDraftId) {
        setActiveDraftId(null);
        setInitialPayload(null);
        setPendingDraftRequest(null);
        navigate("/projects/new", { replace: true });
      }
    } catch (error) {
      setDraftActionError(error instanceof Error ? error.message : "Could not delete draft.");
    }
  }

  if (isStartingFreshDraft) {
    return (
      <main className={styles.shell}>
        <StudioEmptyState
          drafts={[]}
          loading={false}
          error={null}
          creating
        />
      </main>
    );
  }

  if (!activeDraftId) {
    return (
      <main className={styles.shell}>
        <StudioEmptyState
          drafts={drafts}
          loading={draftsLoading}
          error={draftsError}
          creating={createDraftMutation.isPending}
          onCreate={() => startUnsavedDraft("brief")}
          onResume={(id) => void openDraft(id)}
          onDelete={(id) => void removeDraft(id)}
        />
      </main>
    );
  }

  return (
    <StudioFlowView
      key={`${activeDraftId}-${flowKey}`}
      draftId={activeDraftId}
      initialBrief={seededBrief}
      initialPayload={initialPayload}
      initialStep={initialStep}
      openPanel={openPanel}
      draftActionError={draftActionError}
      onPersistLocalDraft={persistLocalDraft}
      autoStartGeneration={pendingAutoStartGeneration}
      onAutoStartGenerationSettled={() => setPendingAutoStartGeneration(false)}
    />
  );
}

function StudioFlowView({
  draftId,
  initialBrief,
  initialPayload,
  initialStep,
  openPanel,
  draftActionError,
  onPersistLocalDraft,
  autoStartGeneration,
  onAutoStartGenerationSettled,
}: {
  draftId: string;
  initialBrief?: Partial<BriefDraft>;
  initialPayload: StudioDraftPayload | null;
  initialStep?: StudioStep;
  openPanel?: string;
  draftActionError?: string | null;
  onPersistLocalDraft: (draft: BriefDraft, step: StudioStep) => Promise<string | null>;
  autoStartGeneration?: boolean;
  onAutoStartGenerationSettled?: () => void;
}) {
  const navigate = useNavigate();
  const [isRedirectingToRun, setIsRedirectingToRun] = useState(autoStartGeneration);
  const autoStartRequestedRef = useRef(false);
  const flow = useStudioFlow({
    initialBrief,
    draftId: draftId === LOCAL_DRAFT_ID ? undefined : draftId,
    initialPayload,
    initialStep,
  });
  const briefRef = useRef(flow.brief);

  useEffect(() => {
    briefRef.current = flow.brief;
  }, [flow.brief]);

  const guardedGoToStep = useCallback(
    (nextStep: StudioStep) => {
      if (draftId === LOCAL_DRAFT_ID && nextStep !== "brief") {
        if (!briefRef.current.goal.trim()) {
          flow.goTo("brief");
          return;
        }
        void onPersistLocalDraft(briefRef.current, nextStep);
        return;
      }
      flow.goTo(nextStep);
    },
    [draftId, flow.goTo, onPersistLocalDraft],
  );

  useEffect(() => {
    if (initialStep) guardedGoToStep(initialStep);
  }, [guardedGoToStep, initialStep]);

  const navigateToRun = useCallback(
    (projectId: string, runId: string) => {
      const params = new URLSearchParams();
      if (draftId !== LOCAL_DRAFT_ID) params.set("studioDraft", draftId);
      const query = params.toString();
      navigate(
        `/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}${
          query ? `?${query}` : ""
        }`,
        { replace: true },
      );
    },
    [draftId, navigate],
  );

  useEffect(() => {
    if (flow.state !== "initial" || flow.step !== "plan" || flow.brief.goal.trim()) return;
    flow.goTo("brief");
  }, [flow]);

  useEffect(() => {
    const shouldStartGeneration =
      autoStartGeneration || (flow.state === "initial" && flow.step === "plan");
    if (!shouldStartGeneration || autoStartRequestedRef.current) return;
    if (flow.state !== "initial" || !flow.brief.goal.trim()) return;

    autoStartRequestedRef.current = true;
    setIsRedirectingToRun(true);
    void flow.startGeneration()
      .then((result) => {
        onAutoStartGenerationSettled?.();
        navigateToRun(result.projectId, result.runId);
      })
      .catch(() => {
        autoStartRequestedRef.current = false;
        setIsRedirectingToRun(false);
      });
  }, [autoStartGeneration, flow, navigateToRun, onAutoStartGenerationSettled]);

  const mobileStep = <MobileStudioProgress step={flow.step} onBack={flow.back} />;
  const isStartingGeneration =
    isRedirectingToRun ||
    (flow.state === "initial" &&
      flow.step === "plan" &&
      Boolean(flow.brief.goal.trim()) &&
      !flow.error);

  if (isStartingGeneration) {
    return (
      <main className={styles.shell}>
        <DesktopStudioStepper step="plan" />
        <MobileStudioProgress step="plan" />
        <section className={styles.redirecting}>
          <p className={styles.workspaceEyebrow}>Starting run</p>
          <h2 className={styles.generatingHeading}>Opening project runs</h2>
          <p className="muted">
            Production is starting in the background. The run progress page will
            take over when the project is ready.
          </p>
        </section>
      </main>
    );
  }

  if (flow.state === "initial" && flow.step === "plan" && flow.error) {
    return (
      <main className={styles.shell}>
        <DesktopStudioStepper step="plan" />
        <MobileStudioProgress step="plan" onBack={() => flow.goTo("brief")} />
        <section className={styles.redirecting}>
          <p className={styles.workspaceEyebrow}>Starting run</p>
          <h2 className={styles.generatingHeading}>Could not start production</h2>
          <p className="new-project-error">{flow.error}</p>
          <div className={styles.recoveryActions}>
            <Button
              variant="cta"
              onClick={() => {
                autoStartRequestedRef.current = false;
                setIsRedirectingToRun(true);
                void flow.startGeneration()
                  .then((result) => {
                    navigateToRun(result.projectId, result.runId);
                  })
                  .catch(() => setIsRedirectingToRun(false));
              }}
            >
              Retry
            </Button>
            <Button variant="secondary" onClick={() => flow.goTo("brief")}>
              Edit idea
            </Button>
            <Button variant="secondary" onClick={() => flow.goTo("footage")}>
              Edit assets
            </Button>
          </div>
        </section>
      </main>
    );
  }

  if (flow.state === "generating") {
    const runStatus = flow.run?.status ?? "queued";
    const items = buildChecklistItems(flow.stages, runStatus);
    const gate = flow.run?.reviewGate ?? null;
    const canRecover = TERMINAL_RECOVERABLE_RUN_STATUSES.includes(runStatus);
    return (
      <main className={styles.shell}>
        <DesktopStudioStepper step={flow.step} />
        <MobileStudioProgress step={flow.step} />
        <section className={styles.generating}>
          <div className={styles.workspaceIntro}>
            <p className={styles.workspaceEyebrow}>Produce</p>
            <h2 className={styles.generatingHeading}>Producing your video</h2>
            <p className={styles.workspaceGoal}>
              {flow.brief.projectName || flow.brief.goal || "Your Studio draft"}
            </p>
            <p className="muted">
              The agent is running autonomously. You can stop at a checkpoint,
              then review the rough cut in this same workspace.
            </p>
          </div>
          <StatusChecklist items={items} />
          {gate ? (
            <GateCard
              stageType={gate.stageType}
              onApprove={() => flow.approveGate()}
              onReject={() => flow.rejectGate()}
            />
          ) : null}
          {canRecover ? (
            <RunRecoveryCard
              status={runStatus}
              error={flow.run?.error?.message ?? flow.error}
              onRetry={() => flow.retryGeneration()}
              onEdit={() => flow.resetGeneration("plan")}
            />
          ) : flow.error ? (
            <p className="new-project-error">{flow.error}</p>
          ) : null}
        </section>
      </main>
    );
  }

  if (flow.state === "review") {
    const stepProps = {
      draft: flow.brief,
      projectId: flow.projectId,
      update: flow.update,
      next: flow.next,
      back: flow.back,
      completeDraft: flow.completeDraft,
    };

    return (
      <main className={styles.shell}>
        <DesktopStudioStepper step={flow.step} onStepClick={guardedGoToStep} />
        {flow.step === "export" ? (
          <section className={styles.stepBody}>
            <ExportStep {...stepProps} />
          </section>
        ) : (
          <ReviewStep
            draft={flow.brief}
            project={flow.reviewProject}
            timeline={flow.reviewTimeline}
            timelineId={flow.reviewTimelineId}
            clips={flow.reviewClips}
            stages={flow.stages}
            segmentNotes={flow.reviewSegmentNotes}
            loading={flow.reviewLoading}
            error={flow.reviewError ?? flow.error}
            onFeedback={flow.requestRevision}
            onSegmentChange={flow.updateReviewSegment}
            onSegmentNoteChange={flow.updateReviewSegmentNote}
            onExport={() => guardedGoToStep("export")}
          />
        )}
      </main>
    );
  }

  // initial + started: the wizard's setup steps.
  return (
    <main className={styles.shell}>
      <DesktopStudioStepper
        step={flow.step}
        onStepClick={guardedGoToStep}
        clickableThroughStep="footage"
      />
      {mobileStep}
      <section className={styles.stepBody}>
        <ActiveStep
          key={`${flow.step}:${openPanel ?? ""}`}
          step={flow.step}
          flow={flow}
          openPanel={openPanel}
          draftActionError={draftActionError}
          onGoToStep={guardedGoToStep}
        />
      </section>
    </main>
  );
}

function DesktopStudioStepper(props: Parameters<typeof StudioStepper>[0]) {
  return (
    <div className={styles.desktopStepper}>
      <StudioStepper {...props} />
    </div>
  );
}

function MobileStudioProgress({
  step,
  onBack,
}: {
  step: StudioStep;
  onBack?: () => void;
}) {
  const setupStep = STUDIO_SETUP_STEPS.includes(step) ? step : "plan";
  const currentIndex = STUDIO_SETUP_STEPS.indexOf(setupStep);
  const progress = ((currentIndex + 1) / STUDIO_SETUP_STEPS.length) * 100;

  return (
    <header className={styles.mobileProgress} aria-label="Studio progress">
      <div className={styles.mobileProgressBar} aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className={styles.mobileProgressRow}>
        {onBack && currentIndex > 0 ? (
          <button className={styles.mobileBack} type="button" onClick={onBack}>
            <span>Back</span>
          </button>
        ) : (
          <span className={styles.mobileBackPlaceholder} aria-hidden="true" />
        )}
        <p className={styles.mobileStepLabel}>
          Step {currentIndex + 1} of {STUDIO_SETUP_STEPS.length} - {STEP_LABELS[setupStep]}
        </p>
      </div>
    </header>
  );
}

function ActiveStep({
  step,
  flow,
  openPanel,
  draftActionError,
  onGoToStep,
}: {
  step: StudioStep;
  flow: ReturnType<typeof useStudioFlow>;
  openPanel?: string;
  draftActionError?: string | null;
  onGoToStep: (step: StudioStep) => void;
}) {
  const guardedNext = useCallback(() => {
    const currentIndex = STUDIO_STEPS.indexOf(flow.step);
    const nextStep = STUDIO_STEPS[Math.min(currentIndex + 1, STUDIO_STEPS.length - 1)];
    onGoToStep(nextStep);
  }, [flow.step, onGoToStep]);

  const stepProps = {
    draft: flow.brief,
    projectId: flow.projectId,
    update: flow.update,
    next: guardedNext,
    back: flow.back,
    completeDraft: flow.completeDraft,
  };

  switch (step) {
    case "brief":
      return (
        <>
          <BriefStep {...stepProps} openPanel={openPanel} />
          {draftActionError ? (
            <p className="new-project-error">{draftActionError}</p>
          ) : null}
        </>
      );
    case "footage":
      return <SourceFootageStep {...stepProps} />;
    case "plan":
    case "story":
    case "generate":
    case "review":
    case "export":
      return null;
    default:
      return null;
  }
}

function RunRecoveryCard({
  status,
  error,
  onRetry,
  onEdit,
}: {
  status: GenerationRunStatus;
  error?: string;
  onRetry: () => Promise<unknown>;
  onEdit: () => Promise<void>;
}) {
  const [retrying, setRetrying] = useState(false);
  const [editing, setEditing] = useState(false);
  const busy = retrying || editing;
  const heading =
    status === "canceled" ? "This run was canceled." : "This run could not finish.";

  async function retry() {
    if (busy) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  async function edit() {
    if (busy) return;
    setEditing(true);
    try {
      await onEdit();
    } finally {
      setEditing(false);
    }
  }

  return (
    <div className={styles.recovery}>
      <div className={styles.recoveryCopy}>
        <p className={styles.recoveryHeading}>{heading}</p>
        <p className={styles.recoveryText}>
          {error ?? "You can start a fresh run from this draft or change the setup first."}
        </p>
      </div>
      <div className={styles.recoveryActions}>
        <Button variant="cta" onClick={() => void retry()} isLoading={retrying}>
          Try again
        </Button>
        <Button variant="secondary" onClick={() => void edit()} isLoading={editing}>
          Edit settings
        </Button>
      </div>
    </div>
  );
}

/**
 * GateCard — approve/reject controls for a paused mid-run review gate. Keeps the
 * gate actionable inside the `generating` view so gated runs aren't stranded.
 * (A richer feedback box lands with PR 6 / the stepwise-story-generation scope.)
 */
function GateCard({
  stageType,
  onApprove,
  onReject,
}: {
  stageType: GateableGenerationStageType;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className={styles.gate}>
      <p className={styles.gateHeading}>
        {GENERATION_STAGE_LABELS[stageType]} is ready for your review.
      </p>
      <div className={styles.gateActions}>
        <Button variant="cta" onClick={onApprove}>
          Approve &amp; continue
        </Button>
        <Button variant="secondary" onClick={onReject}>
          Reject / regenerate
        </Button>
      </div>
    </div>
  );
}
