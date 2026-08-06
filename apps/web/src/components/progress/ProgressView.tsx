"use client";

import { Link } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import {
  GENERATION_STAGE_LABELS,
  type GenerationRun,
  type GenerationJobDiagnostics,
  type GenerationStage,
  type GenerationStageItem,
  type BoardRevisionTarget,
  type ProjectStoryboard,
} from "@popcorn/shared/v1/types";
import { StageItemCard } from "../generation-progress/StageItemCard";
import { AiAssetFeedbackDialog } from "../ai-edit/AiAssetFeedbackDialog";
import { AssetCritiqueButton } from "../ai-edit/AssetCritiqueButton";
import {
  GenerationRunClient,
  GenerationRunRequestError,
} from "../../lib/v1/generation-runs/client";
import type { CreatorRunHierarchy } from "../../lib/v1/generation-runs/status";
import { useProjectQuery, useProjectScriptQuery } from "../../lib/queryClient";
import { v1Api } from "../../lib/api-client";
import { reviewProposalTarget as resolveReviewProposalTarget } from "../../lib/reviewProposalTarget";
import {
  StoryboardBoard as FeedbackStoryboardBoard,
  storyboardFeedbackTargetKey,
} from "./StoryboardBoard";
import { TerminalState } from "./TerminalState";
import { ReviewGatePanel } from "./ReviewGatePanel";
import { PlanRecap } from "./PlanRecap";
import { OperatorDiagnostics, PipelineDepth, usePipelineElapsed } from "./PipelineDepth";
import { CreatorRunHierarchyPanel } from "./CreatorRunHierarchyPanel";
import {
  hierarchyCurrentLabel,
  hierarchyProgressLabel,
} from "./creator-run-hierarchy";
import {
  currentRunStage,
  headerStatus,
  isTerminal,
  isVisibleGeneratedItem,
  lastCompletedPipelineStage,
  nextStageType,
  progressSummary,
  reviewStageLabel,
  splitStoryboardItems,
  standaloneAssetLabel,
  workspaceReturnLabel,
} from "./progress-view-helpers";
import styles from "./ProgressView.module.css";

interface ProgressViewProps {
  run: GenerationRun;
  stages: GenerationStage[];
  stageItems?: GenerationStageItem[];
  studioReturnPath?: string | null;
  reviewActions?: {
    pending?: "approve" | "reject" | "cancel";
    error?: string | null;
    feedbackNote?: string;
    onFeedbackNoteChange?: (note: string) => void;
    onApprove: (note: string, scriptDraftId?: string) => void;
    onRequestChanges?: (note: string, scriptDraftId: string) => void;
    onCancel: () => void;
  };
  cancelAction?: {
    pending?: boolean;
    error?: string | null;
    onCancel: () => void;
  };
  creditRecovery?: {
    balanceCredits: number;
    pending?: boolean;
    onContinue: () => void;
  };
  onBoardRevisionSuccess?: () => Promise<void> | void;
  headerSlot?: ReactNode;
  /** Optional list of other demo runs to link to from the header. */
  alternateRuns?: { runId: string; label: string }[];
  /** Present only for operators; the API also omits this projection for creators. */
  operatorDiagnostics?: GenerationJobDiagnostics[];
  hierarchy?: CreatorRunHierarchy;
}

function mobileProgressSentence({
  run,
  currentStageDisplay,
  hasExplicitAction,
}: {
  run: GenerationRun;
  currentStageDisplay: string;
  progress: ReturnType<typeof progressSummary>;
  hasExplicitAction: boolean;
}): string {
  if (run.reviewGate) {
    return `${currentStageDisplay} is ready for review.`;
  }

  if (run.status === "queued") {
    return `${currentStageDisplay} is queued.`;
  }

  if (run.status === "running") {
    if (!hasExplicitAction) return "Choosing the next step.";
    if (run.activityState === "waiting_on_job") return `${currentStageDisplay} is waiting on a provider.`;
    if (run.activityState === "recovering") return `Recovering with ${currentStageDisplay}.`;
    return `${currentStageDisplay} is in progress.`;
  }

  if (run.status === "succeeded") {
    if (run.completionKind === "video") return "Your video is ready.";
    if (run.completionKind === "standalone_asset") return "Your asset is ready.";
    if (run.completionKind === "storyboard_assets") {
      return "Storyboard ready; no video was created.";
    }
    return "Run ended; no playable video was created.";
  }

  if (run.status === "failed") {
    if (run.error?.code === "missing_video_output") {
      return "Run ended; no playable video was created.";
    }
    return `${currentStageDisplay} needs attention.`;
  }

  return "This run was canceled.";
}

function stageItemRevisionTarget(
  runId: string,
  item: GenerationStageItem,
): BoardRevisionTarget {
  return {
    scope: "tile",
    runId,
    stageId: item.stageId,
    itemId: item.itemId,
    ...(item.assetId ? { assetId: item.assetId } : {}),
    ...(item.artifactId ? { artifactId: item.artifactId } : {}),
    label: item.label,
  };
}

export function ProgressView({
  run,
  stages,
  stageItems = [],
  studioReturnPath,
  reviewActions,
  cancelAction,
  creditRecovery,
  onBoardRevisionSuccess,
  headerSlot,
  alternateRuns,
  operatorDiagnostics,
  hierarchy,
}: ProgressViewProps) {
  const [detail, setDetail] = useState({ run, stages, stageItems, hierarchy });
  const [projectStoryboard, setProjectStoryboard] = useState<ProjectStoryboard | null>(null);
  const [fallbackApproving, setFallbackApproving] = useState(false);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const [fallbackFeedbackNote, setFallbackFeedbackNote] = useState("");
  const [boardFeedbackActiveKeys, setBoardFeedbackActiveKeys] = useState<string[]>([]);
  const [selectedAssetItemId, setSelectedAssetItemId] = useState<string | null>(null);
  const [reviewProposalOpen, setReviewProposalOpen] = useState(false);
  const reviewGateKey = detail.run.reviewGate?.stageId ?? null;
  const projectQuery = useProjectQuery(detail.run.projectId);
  const scriptQuery = useProjectScriptQuery(
    detail.run.projectId,
    detail.run.reviewGate?.stageType === "script",
  );
  const project = projectQuery.data?.project ?? null;
  const projectLoading = projectQuery.isLoading;

  useEffect(() => {
    setDetail({ run, stages, stageItems, hierarchy });
    setFallbackApproving(false);
    setFallbackError(null);
  }, [run, stages, stageItems, hierarchy]);

  useEffect(() => {
    setSelectedAssetItemId(null);
    setBoardFeedbackActiveKeys([]);
  }, [run.runId]);

  useEffect(() => {
    if (isTerminal(detail.run.status)) {
      setBoardFeedbackActiveKeys([]);
    }
  }, [detail.run.status]);

  useEffect(() => {
    setFallbackFeedbackNote("");
  }, [reviewGateKey]);

  const terminal = isTerminal(detail.run.status) && !detail.run.reviewGate;
  const reviewItems = detail.run.reviewGate
    ? detail.stageItems
        .filter((item) => item.stageId === detail.run.reviewGate?.stageId)
        .filter(isVisibleGeneratedItem)
    : [];
  const generatedItems = detail.run.reviewGate
    ? detail.stageItems
        .filter((item) => item.stageId !== detail.run.reviewGate?.stageId)
        .filter(isVisibleGeneratedItem)
    : detail.stageItems.filter(isVisibleGeneratedItem);
  const stageById = new Map(detail.stages.map((stage) => [stage.stageId, stage]));
  const reviewOutputGroups = splitStoryboardItems(reviewItems, stageById);
  const generatedOutputGroups = splitStoryboardItems(generatedItems, stageById);
  const selectedAssetItem =
    selectedAssetItemId
      ? detail.stageItems.find((item) => item.itemId === selectedAssetItemId) ?? null
      : null;
  const reviewProposalTarget = detail.run.reviewGate
    ? resolveReviewProposalTarget({
        stageType: detail.run.reviewGate.stageType,
        runId: detail.run.runId,
        items: reviewItems,
        storyboardId: projectStoryboard?.id,
      })
    : null;

  useEffect(() => {
    if (
      reviewOutputGroups.boardItems.length === 0 &&
      generatedOutputGroups.boardItems.length === 0
    ) {
      setProjectStoryboard(null);
      return;
    }

    let canceled = false;
    v1Api
      .getProjectStoryboard(detail.run.projectId)
      .then(({ storyboard }) => {
        if (!canceled) setProjectStoryboard(storyboard ?? null);
      })
      .catch(() => {
        if (!canceled) setProjectStoryboard(null);
      });

    return () => {
      canceled = true;
    };
  }, [
    detail.run.projectId,
    generatedOutputGroups.boardItems.length,
    reviewOutputGroups.boardItems.length,
  ]);

  const pending = reviewActions?.pending ?? (fallbackApproving ? "approve" : undefined);
  const actionError = reviewActions?.error ?? fallbackError;
  const showCancelAction = !terminal && !detail.run.reviewGate && !!cancelAction;
  const feedbackNote = reviewActions?.feedbackNote ?? fallbackFeedbackNote;
  const setFeedbackNote = reviewActions?.onFeedbackNoteChange ?? setFallbackFeedbackNote;
  const progress = progressSummary(detail.run, detail.stages);
  const { elapsed, sinceLastActivity } = usePipelineElapsed(detail.run);
  // Only durable progress counts as creator-visible activity. `updatedAt` can
  // move when a recovery sweeper touches the run without any provider output.
  const nextType = nextStageType(detail.run, detail.stages);
  const nextStageLabel = nextType ? reviewStageLabel(nextType) : null;
  const lastCompletedStageLabel = lastCompletedPipelineStage(
    detail.stages,
    detail.run.presentationKind,
  );
  const activeStage = currentRunStage(detail.run, detail.stages);
  const hasExplicitAction = Boolean(detail.run.reviewGate || activeStage);
  const choosingNextStep = detail.run.status === "running" && !hasExplicitAction;
  const currentStageLabel = detail.run.reviewGate
    ? reviewStageLabel(detail.run.reviewGate.stageType)
    : choosingNextStep
      ? "Choosing the next step"
      : activeStage?.label
        ? activeStage.label
        : standaloneAssetLabel(detail.run.presentationKind) ??
          (detail.run.currentStageType
            ? reviewStageLabel(detail.run.currentStageType)
            : "Final render");
  const currentStageDisplay = detail.run.reviewGate
    ? `${currentStageLabel} review`
    : currentStageLabel;
  const projectBrief = project?.brief ?? null;
  const standaloneLabel = standaloneAssetLabel(detail.run.presentationKind);
  const projectTitle = project?.name?.trim() || (standaloneLabel ? "this project" : "your video");
  const returnLabel = workspaceReturnLabel({
    hasStudioDraft: Boolean(studioReturnPath),
    terminal,
    succeeded: detail.run.status === "succeeded",
  });
  const projectPath = `/projects/${encodeURIComponent(detail.run.projectId)}`;
  const stageLinks = {
    Concept: `${projectPath}/concept`,
    Brief: `${projectPath}/brief`,
    Script: `${projectPath}/script`,
    Storyboard: `${projectPath}/storyboard`,
    "Final Render": `${projectPath}/watch`,
  };

  async function approveFallback() {
    const reviewGate = detail.run.reviewGate;
    if (!reviewGate || fallbackApproving) return;
    setFallbackApproving(true);
    setFallbackError(null);

    if (detail.run.runId.startsWith("demo-")) {
      const now = new Date().toISOString();
      const ordered = [...detail.stages].sort((a, b) => a.order - b.order);
      const gateIndex = ordered.findIndex((stage) => stage.stageId === reviewGate.stageId);
      const next = ordered.slice(gateIndex + 1).find((stage) => stage.status === "queued");
      setDetail((current) => ({
        ...current,
        run: {
          ...current.run,
          reviewGate: null,
          currentStageType: next?.type ?? current.run.currentStageType,
          message: next
            ? `${GENERATION_STAGE_LABELS[next.type]} is in progress.`
            : "Review approved. Continuing the run.",
          updatedAt: now,
        },
        stages: current.stages.map((stage) => {
          if (stage.stageId === reviewGate.stageId) return { ...stage, reviewedAt: now };
          if (next && stage.stageId === next.stageId) {
            return {
              ...stage,
              status: "running",
              startedAt: now,
              message: `${GENERATION_STAGE_LABELS[next.type]} started.`,
            };
          }
          return stage;
        }),
      }));
      setFallbackApproving(false);
      return;
    }

    try {
      const client = new GenerationRunClient();
      const nextDetail = await client.approveRun(detail.run.projectId, detail.run.runId);
      setDetail({
        run: nextDetail.run,
        stages: nextDetail.stages,
        stageItems: nextDetail.stageItems,
        hierarchy: nextDetail.hierarchy,
      });
    } catch (err) {
      setFallbackError(
        err instanceof GenerationRunRequestError
          ? err.message
          : "Could not approve this review gate.",
      );
    } finally {
      setFallbackApproving(false);
    }
  }

  const onApprove = reviewActions
    ? () => reviewActions.onApprove(
        feedbackNote,
        detail.run.reviewGate?.stageType === "script"
          ? scriptQuery.data?.script?.scriptDraftId
          : undefined,
      )
    : approveFallback;

  const progressSentence = detail.hierarchy
    ? detail.hierarchy.root.message
    : mobileProgressSentence({
        run: detail.run,
        currentStageDisplay,
        progress,
        hasExplicitAction,
      });

  const progressContext = [
    lastCompletedStageLabel ? `Last completed: ${lastCompletedStageLabel}` : null,
    nextStageLabel ? `Next: ${nextStageLabel}` : null,
  ].filter((item): item is string => Boolean(item));
  const progressDetails = [
    detail.hierarchy || choosingNextStep ? null : detail.run.message,
    ...(detail.hierarchy ? [] : progressContext),
  ].filter((item): item is string => Boolean(item));

  async function markBoardFeedbackStarted(target: BoardRevisionTarget) {
    const key = storyboardFeedbackTargetKey(target);
    setBoardFeedbackActiveKeys((current) =>
      current.includes(key) ? current : [...current, key],
    );
    await onBoardRevisionSuccess?.();
  }

  async function markBoardFeedbackSettled(target: BoardRevisionTarget) {
    const key = storyboardFeedbackTargetKey(target);
    setBoardFeedbackActiveKeys((current) =>
      current.filter((candidate) => candidate !== key),
    );
    await onBoardRevisionSuccess?.();
  }

  const selectedAssetTarget = selectedAssetItem
    ? stageItemRevisionTarget(detail.run.runId, selectedAssetItem)
    : null;
  const hierarchyCurrent = detail.hierarchy
    ? hierarchyCurrentLabel(detail.hierarchy)
    : null;
  const hierarchyProgress = detail.hierarchy
    ? hierarchyProgressLabel(detail.hierarchy)
    : null;
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <p className={styles.eyebrow}>{standaloneLabel ? "Asset Studio" : "Unified workspace"}</p>
          <h1 className={styles.title}>
            {standaloneLabel ? `${standaloneLabel} for ${projectTitle}` : `Producing ${projectTitle}`}
          </h1>
          <p className={styles.headerDescription}>
            {standaloneLabel
              ? "This one-off asset and its generation history stay attached to the project library."
              : "The plan, generated assets, review checkpoints, and final export stay attached to this workspace."}
          </p>
          {headerSlot ? <div className={styles.headerSlot}>{headerSlot}</div> : null}
        </div>
        <div className={styles.headerActions}>
          <div
            className={`${styles.headerStatusPanel}${detail.hierarchy ? ` ${styles.headerStatusPanelHierarchy}` : ""}`}
            aria-label="Current run status"
          >
            {!detail.hierarchy ? <div className={styles.mobileStatusNarrative}>
              <strong>{progressSentence}</strong>
              {progressDetails.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div> : null}
            <div className={styles.statusGrid}>
              <div>
                <span className={styles.statusLabel}>Status</span>
                <strong>{headerStatus(detail.run)}</strong>
              </div>
              {lastCompletedStageLabel ? (
                <div>
                  <span className={styles.statusLabel}>
                    {detail.hierarchy ? "Current work" : "Last completed"}
                  </span>
                  <strong>{hierarchyCurrent ?? lastCompletedStageLabel}</strong>
                </div>
              ) : (
                <div>
                  <span className={styles.statusLabel}>Current step</span>
                  <strong>{hierarchyCurrent ?? currentStageDisplay}</strong>
                </div>
              )}
              {nextStageLabel && !detail.hierarchy ? (
                <div>
                  <span className={styles.statusLabel}>Next step</span>
                  <strong>{nextStageLabel}</strong>
                </div>
              ) : null}
              <div>
                <span className={styles.statusLabel}>Progress</span>
                <strong>{hierarchyProgress ?? `${progress.completed} tool steps complete`}</strong>
              </div>
            </div>
            {!detail.hierarchy && progress.percent == null && detail.run.status === "running" ? (
              <div
                className={`${styles.headerMeter} ${styles.headerMeterIndeterminate}`}
                role="progressbar"
                aria-label="Generation in progress; percentage unavailable"
              >
                <div className={styles.headerMeterFill} />
              </div>
            ) : !detail.hierarchy && progress.percent != null ? (
              <div
                className={styles.headerMeter}
                role="progressbar"
                aria-valuenow={progress.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${progress.percent}% complete`}
              >
                <div
                  className={styles.headerMeterFill}
                  style={{ width: `${Math.max(2, progress.percent)}%` }}
                />
              </div>
            ) : null}
          </div>
          <Link
            className={styles.secondaryButton}
            to={studioReturnPath ?? `/projects/${encodeURIComponent(detail.run.projectId)}`}
          >
            {returnLabel}
          </Link>
          {alternateRuns && alternateRuns.length > 0 ? (
            <nav className={styles.altRuns} aria-label="Other demo states">
              <span className={styles.altRunsLabel}>View other states:</span>
              <ul>
                {alternateRuns.map((alt) => (
                  <li key={alt.runId}>
                    <Link
                      to={`/projects/${detail.run.projectId}/runs/${alt.runId}`}
                      className={`${styles.altLink}${
                        alt.runId === detail.run.runId ? ` ${styles.altLinkActive}` : ""
                      }`}
                    >
                      {alt.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </div>
      </header>

      <div className={`${styles.body}${detail.hierarchy ? ` ${styles.bodyHierarchy}` : ""}`}>
        <section className={styles.main}>
          {terminal ? <TerminalState run={detail.run} creditRecovery={creditRecovery} /> : null}

          {detail.hierarchy ? (
            <CreatorRunHierarchyPanel
              hierarchy={detail.hierarchy}
              projectId={detail.run.projectId}
              stopAction={
                showCancelAction && cancelAction
                  ? {
                      pending: cancelAction.pending,
                      error: cancelAction.error,
                      onStop: cancelAction.onCancel,
                    }
                  : undefined
              }
            />
          ) : null}

          {detail.hierarchy && operatorDiagnostics ? (
            <section className={styles.hierarchyOperatorDiagnostics} aria-label="Operator tools">
              <OperatorDiagnostics
                runId={detail.run.runId}
                diagnostics={operatorDiagnostics}
              />
            </section>
          ) : null}

          <PlanRecap project={project} loading={projectLoading} />

          {detail.run.reviewGate ? (
            <ReviewGatePanel
              stageType={detail.run.reviewGate.stageType}
              projectBrief={projectBrief}
              projectLoading={projectLoading}
              projectScript={scriptQuery.data?.script?.scriptDraft ?? null}
              scriptLoading={scriptQuery.isLoading}
              scriptError={scriptQuery.error instanceof Error ? scriptQuery.error.message : null}
              reviewItems={reviewItems}
              reviewOutputGroups={reviewOutputGroups}
              feedbackNote={feedbackNote}
              pending={pending}
              actionError={actionError}
              reviewActions={reviewActions}
              onFeedbackNoteChange={setFeedbackNote}
              onApprove={onApprove}
              onRequestChanges={() => {
                if (detail.run.reviewGate?.stageType === "script") {
                  const scriptDraftId = scriptQuery.data?.script?.scriptDraftId;
                  if (scriptDraftId) reviewActions?.onRequestChanges?.(feedbackNote, scriptDraftId);
                  return;
                }
                setReviewProposalOpen(true);
              }}
              canRequestChanges={
                detail.run.reviewGate.stageType === "script"
                  ? Boolean(
                      reviewActions?.onRequestChanges &&
                      feedbackNote.trim() &&
                      scriptQuery.data?.script?.scriptDraftId
                    )
                  : Boolean(reviewProposalTarget)
              }
            />
          ) : null}
          <AiAssetFeedbackDialog
            open={reviewProposalOpen}
            projectId={detail.run.projectId}
            rootRunId={detail.run.runId}
            target={reviewProposalTarget}
            title={`Change ${currentStageLabel.toLowerCase()}`}
            subtitle="Review the exact impact and maximum cost before the run changes."
            initialMessage={feedbackNote}
            onClose={() => setReviewProposalOpen(false)}
            onExecutionStarted={() => {
              void onBoardRevisionSuccess?.();
            }}
            onExecutionSettled={() => {
              void onBoardRevisionSuccess?.();
            }}
            asset={
              <div className={styles.assetModalPreview}>
                <strong>{currentStageLabel} review</strong>
                <p>
                  The Creative Director will preserve unaffected work and
                  propose only the changes required by your feedback.
                </p>
              </div>
            }
          />

          {generatedItems.length > 0 ? (
            <section
              className={`${styles.card} ${styles.assetsCard}`}
              aria-labelledby="generated-assets-heading"
            >
              <h2 id="generated-assets-heading" className={styles.cardHeading}>
                Generated assets
              </h2>
              <div className={styles.generatedOutputs}>
                <FeedbackStoryboardBoard
                  projectId={detail.run.projectId}
                  runId={detail.run.runId}
                  items={generatedOutputGroups.boardItems}
                  storyboard={projectStoryboard}
                  activeTargetKeys={boardFeedbackActiveKeys}
                  onExecutionStarted={markBoardFeedbackStarted}
                  onExecutionSettled={markBoardFeedbackSettled}
                />
                {generatedOutputGroups.genericItems.length > 0 ? (
                  <div className={`${styles.itemGrid} ${styles.reviewOutputGrid}`}>
                    {generatedOutputGroups.genericItems.map((item) => (
                      item.assetId ? (
                        <div className={styles.assetReviewItem} key={item.itemId}>
                          <button
                            className={styles.assetEditButton}
                            type="button"
                            onClick={() => setSelectedAssetItemId(item.itemId)}
                            aria-label={`Edit ${item.label} with AI`}
                            aria-busy={
                              boardFeedbackActiveKeys.includes(
                                storyboardFeedbackTargetKey(
                                  stageItemRevisionTarget(detail.run.runId, item)
                                )
                              ) || undefined
                            }
                          >
                            {/* Embedded in the edit <button>; a nested regenerate
                                <button> would be invalid markup, so suppress it. */}
                            <StageItemCard item={item} allowInlineRegenerate={false} />
                          </button>
                          {(item.kind === "image" || item.kind === "video") && item.assetId ? (
                            <AssetCritiqueButton
                              projectId={detail.run.projectId}
                              assetId={item.assetId}
                              title={`Review ${item.label}`}
                              subtitle={item.promptPreview ?? item.purpose}
                              preview={<StageItemCard item={item} allowInlineRegenerate={false} />}
                            />
                          ) : null}
                        </div>
                      ) : (
                        <div key={item.itemId}>
                          <StageItemCard item={item} allowInlineRegenerate={false} />
                        </div>
                      )
                    ))}
                  </div>
                ) : null}
              </div>
              <AiAssetFeedbackDialog
                open={Boolean(selectedAssetItem)}
                projectId={detail.run.projectId}
                rootRunId={detail.run.runId}
                target={selectedAssetTarget}
                title={selectedAssetItem?.label ?? "Edit asset"}
                subtitle={selectedAssetItem?.promptPreview ?? selectedAssetItem?.purpose}
                initialMessage={selectedAssetItem?.prompt ?? null}
                onClose={() => setSelectedAssetItemId(null)}
                onExecutionStarted={(executedTarget) => {
                  void markBoardFeedbackStarted(executedTarget);
                }}
                onExecutionSettled={(executedTarget) => {
                  void markBoardFeedbackSettled(executedTarget);
                }}
                asset={
                  selectedAssetItem ? (
                    <div className={styles.assetModalPreview}>
                      <StageItemCard item={selectedAssetItem} allowInlineRegenerate={false} />
                    </div>
                  ) : null
                }
              />
            </section>
          ) : null}

          {!detail.hierarchy ? <details className={styles.mobilePipelineDetails}>
            <summary>
              {standaloneLabel ? "Show asset status" : "Show pipeline"}
              <span aria-hidden="true">+</span>
            </summary>
            <div
              className={styles.mobilePipelineContent}
              role="complementary"
              aria-label="Stage rail"
            >
              <PipelineDepth
                run={detail.run}
                stages={detail.stages}
                elapsed={elapsed}
                sinceLastActivity={sinceLastActivity}
                stageLinks={stageLinks}
                showCancelAction={showCancelAction}
                cancelAction={cancelAction}
                operatorDiagnostics={operatorDiagnostics}
                standaloneLabel={standaloneLabel}
                choosingNextStep={choosingNextStep}
              />
            </div>
          </details> : null}
        </section>

        {!detail.hierarchy ? <aside className={styles.sidePanel} aria-label="Stage rail">
          <PipelineDepth
            run={detail.run}
            stages={detail.stages}
            elapsed={elapsed}
            sinceLastActivity={sinceLastActivity}
            stageLinks={stageLinks}
            showCancelAction={showCancelAction}
            cancelAction={cancelAction}
            operatorDiagnostics={operatorDiagnostics}
            standaloneLabel={standaloneLabel}
            choosingNextStep={choosingNextStep}
          />
        </aside> : null}
      </div>
    </div>
  );
}
