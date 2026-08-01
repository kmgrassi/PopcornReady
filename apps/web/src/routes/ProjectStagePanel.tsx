import { useEffect, useMemo, useState } from "react";
import type { GenerationRun } from "@popcorn/shared/v1/types";
import { RerunProposalDialog } from "../components/ai-edit/RerunProposalDialog";
import { StageRail } from "../components/progress/StageRail";
import { Button, ButtonLink } from "../components/ui/Button";
import { EmptyState, ErrorState } from "../components/ui/StateCard";
import {
  useGenerationRunQuery,
  useUpdateGenerationRunMutation,
} from "../lib/queryClient";
import { reviewProposalTarget as resolveReviewProposalTarget } from "../lib/reviewProposalTarget";
import styles from "./ProjectStagePanel.module.css";
import { formatDate, titleCase } from "./project-detail-format";

const STAGE_PANEL_COMPACT_QUERY = "(max-width: 900px)";

export function ProjectStagePanel({
  projectId,
  runs,
  loading,
  error,
  onRetry,
}: {
  projectId: string;
  runs: GenerationRun[];
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  const selectedRun = useMemo(() => selectStageRun(runs), [runs]);
  const [pendingGateAction, setPendingGateAction] = useState<"approve" | null>(null);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [stageExpanded, setStageExpanded] = useState(() => {
    if (typeof window === "undefined") return true;
    return !window.matchMedia(STAGE_PANEL_COMPACT_QUERY).matches;
  });
  const runDetailQuery = useGenerationRunQuery(
    projectId,
    selectedRun?.runId ?? "",
    Boolean(selectedRun),
  );
  const runDetail = runDetailQuery.data ?? null;
  const run = runDetail?.run ?? selectedRun ?? null;
  const standaloneStage = run?.presentationKind
    ? runDetail?.stages.slice().sort((a, b) => b.order - a.order)[0]
    : undefined;
  const updateRunMutation = useUpdateGenerationRunMutation(projectId, run?.runId ?? "");
  const activeError = error ?? runDetailQuery.error ?? null;
  const activeLoading = loading || (Boolean(selectedRun) && runDetailQuery.isLoading);
  const nextStage = runDetail?.stages
    .slice()
    .sort((a, b) => a.order - b.order)
    .find((stage) => stage.status === "queued");
  const hasReviewGate = Boolean(run?.reviewGate);
  const gateItems = run?.reviewGate && runDetail
    ? runDetail.stageItems.filter((item) => item.stageId === run.reviewGate?.stageId)
    : [];
  const proposalTarget = run?.reviewGate
    ? resolveReviewProposalTarget({
        stageType: run.reviewGate.stageType,
        runId: run.runId,
        items: gateItems,
      })
    : null;
  const projectPath = `/projects/${encodeURIComponent(projectId)}`;
  const runPath = run
    ? `${projectPath}/runs/${encodeURIComponent(run.runId)}`
    : projectPath;
  const stagePanelBodyId = "project-stage-panel-body";
  const stageLinks = {
    Concept: `${projectPath}/concept`,
    Brief: `${projectPath}/brief`,
    Script: `${projectPath}/script`,
    Storyboard: `${projectPath}#storyboard`,
    Shots: runPath,
    Assets: runPath,
    Timeline: runPath,
    "Final Render": `${projectPath}/watch`,
  };

  function updateGate() {
    if (!run?.runId) return;
    setPendingGateAction("approve");
    updateRunMutation.mutate({
      action: "approve",
    });
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia(STAGE_PANEL_COMPACT_QUERY);
    const syncExpanded = () => {
      setStageExpanded(!query.matches);
    };

    syncExpanded();
    query.addEventListener("change", syncExpanded);
    return () => query.removeEventListener("change", syncExpanded);
  }, []);

  return (
    <section className={`${styles.panel} ${styles.stagePanel}`} aria-labelledby="project-stage-heading">
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>{run?.presentationKind ? "Asset activity" : "Run pipeline"}</span>
          <h2 id="project-stage-heading">
            {run?.presentationKind ? "Generation status" : "Stage and next step"}
          </h2>
        </div>
        <div className={styles.sectionHeaderActions}>
          {run ? (
            <ButtonLink
              variant="ghost"
              size="sm"
              to={`/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(run.runId)}`}
            >
              Open run
            </ButtonLink>
          ) : null}
          <Button
            className={styles.stageToggle}
            variant="secondary"
            size="sm"
            aria-controls={stagePanelBodyId}
            aria-expanded={stageExpanded}
            onClick={() => setStageExpanded((expanded) => !expanded)}
          >
            {stageExpanded ? "Hide details" : "Show details"}
          </Button>
        </div>
      </div>

      <div id={stagePanelBodyId} className={styles.stageCollapsible} hidden={!stageExpanded}>
        {activeLoading ? (
          <div className={styles.stageSkeleton} aria-busy="true" aria-label="Loading generation stage">
            <span /><span /><span />
          </div>
        ) : null}
        {!activeLoading && activeError ? (
          <ErrorState
            title="Unable to load stage"
            body="We couldn't load the latest generation stage for this project."
            error={activeError}
            onRetry={() => {
              onRetry();
              void runDetailQuery.refetch();
            }}
          />
        ) : null}
        {!activeLoading && !activeError && !run ? (
          <EmptyState
            title="No generation stage yet"
            body="Start a generation run to see the project's current stage and next step."
          />
        ) : null}
        {!activeLoading && !activeError && run ? (
          <div className={styles.stagePanelBody}>
            <div className={styles.stageSummary}>
              <div>
                <dt>Current</dt>
                <dd>
                  {run.reviewGate
                    ? `${titleCase(run.reviewGate.stageType)} review`
                    : run.status === "failed" || run.status === "canceled"
                      ? titleCase(run.status)
                    : standaloneStage
                      ? standaloneStage.label
                      : run.currentStageType
                        ? titleCase(run.currentStageType)
                        : titleCase(run.status)}
                </dd>
              </div>
              <div>
                <dt>Next</dt>
                <dd>
                  {nextStage
                    ? titleCase(nextStage.type)
                    : run.status === "failed"
                      ? "Needs attention"
                      : run.status === "canceled"
                        ? "Stopped"
                    : run.status === "succeeded"
                      ? run.completionKind === "standalone_asset"
                        ? "Asset ready"
                        : run.completionKind === "video"
                          ? "Video ready"
                          : run.completionKind === "storyboard_assets"
                            ? "Storyboard ready"
                            : "Run ended"
                      : run.presentationKind && run.status === "running"
                        ? "Finishing asset"
                        : "Pending"}
                </dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{formatDate(run.updatedAt)}</dd>
              </div>
            </div>

            {runDetail ? (
              <StageRail
                stages={runDetail.stages}
                runStatus={run.status}
                currentStageType={run.currentStageType}
                runProgressPercent={run.progressPercent}
                runMessage={run.message}
                reviewGate={run.reviewGate}
                stageLinks={stageLinks}
                showUpcomingStages
                presentationKind={run.presentationKind}
              />
            ) : (
              <p className={styles.muted}>
                {run.message ?? "Stage details will appear once the run reports its first step."}
              </p>
            )}

            <div className={styles.stageActions}>
              {hasReviewGate ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => setProposalOpen(true)}
                    disabled={!proposalTarget || updateRunMutation.isPending}
                    title={
                      proposalTarget
                        ? undefined
                        : "Open the run and select a generated object to request changes."
                    }
                  >
                    Request changes
                  </Button>
                  <Button
                    variant="primary"
                    onClick={updateGate}
                    disabled={updateRunMutation.isPending}
                    isLoading={updateRunMutation.isPending && pendingGateAction === "approve"}
                  >
                    Approve and continue
                  </Button>
                </>
              ) : (
                <ButtonLink
                  variant="secondary"
                  to={`/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(run.runId)}`}
                >
                  Manage run
                </ButtonLink>
              )}
            </div>
            {updateRunMutation.error ? (
              <ErrorState
                title="Unable to update stage"
                body="We couldn't apply that stage action. The run may have changed, or your session may need to be refreshed."
                error={updateRunMutation.error}
                onRetry={() => {
                  if (pendingGateAction) updateGate();
                }}
              />
            ) : null}
            {hasReviewGate && !proposalTarget ? (
              <p className={styles.muted}>
                Open the run and select a generated object to request changes safely.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {run?.reviewGate && proposalTarget ? (
        <RerunProposalDialog
          open={proposalOpen}
          projectId={projectId}
          rootRunId={run.runId}
          target={proposalTarget}
          title={`Change ${titleCase(run.reviewGate.stageType)}`}
          subtitle="Review the exact impact and maximum cost before this checkpoint changes."
          asset={
            <div>
              <strong>{proposalTarget.label ?? titleCase(run.reviewGate.stageType)}</strong>
              <p>The current checkpoint remains unchanged until you approve.</p>
            </div>
          }
          onClose={() => setProposalOpen(false)}
          onExecutionStarted={() => {
            void runDetailQuery.refetch();
            onRetry();
          }}
          onExecutionSettled={() => {
            void runDetailQuery.refetch();
            onRetry();
          }}
        />
      ) : null}
    </section>
  );
}

function selectStageRun(runs: GenerationRun[]) {
  return (
    runs.find((run) => run.reviewGate) ??
    runs.find((run) => run.status === "running" || run.status === "queued") ??
    runs[0] ??
    null
  );
}
