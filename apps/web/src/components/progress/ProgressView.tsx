"use client";

import { Link } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import {
  GENERATION_STAGE_LABELS,
  type GenerationRun,
  type GenerationJobDiagnostics,
  type GenerationStage,
  type GenerationStageType,
  type GenerationStageItem,
  type BoardRevisionTarget,
  type ProjectStoryboard,
  type V1Project,
  type VideoBriefInput,
} from "@popcorn/shared/v1/types";
import { StageItemCard } from "../generation-progress/StageItemCard";
import { AiAssetFeedbackDialog } from "../ai-edit/AiAssetFeedbackDialog";
import {
  GenerationRunClient,
  GenerationRunRequestError,
} from "../../lib/v1/generation-runs/client";
import { useProjectQuery } from "../../lib/queryClient";
import { v1Api } from "../../lib/api-client";
import { reviewProposalTarget as resolveReviewProposalTarget } from "../../lib/reviewProposalTarget";
import { PIPELINE_GROUPS, StageRail } from "./StageRail";
import {
  StoryboardBoard as FeedbackStoryboardBoard,
  storyboardFeedbackTargetKey,
} from "./StoryboardBoard";
import { TerminalState } from "./TerminalState";
import { ReviewGatePanel } from "./ReviewGatePanel";
import { formatElapsed, useElapsedTime } from "./useElapsedTime";
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
    onApprove: (note: string) => void;
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
}

function isTerminal(status: GenerationRun["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

const REVIEW_STAGE_LABELS: Record<GenerationStageType, string> = {
  brief_intake: "Concept",
  creative_plan: "Brief",
  storyboard: "Storyboard",
  asset_generation: "Assets",
  audio_generation: "Audio",
  timeline_assembly: "Timeline",
  quality_review: "Quality review",
  export: "Final render",
  ready: "Ready",
};

function shortId(id: string): string {
  if (id.length <= 18) return id;
  return `${id.slice(0, 8)}...${id.slice(-6)}`;
}

function reviewStageLabel(stageType: GenerationStageType): string {
  return REVIEW_STAGE_LABELS[stageType] ?? GENERATION_STAGE_LABELS[stageType];
}

function progressSummary(run: GenerationRun, stages: GenerationStage[]) {
  const completed = stages.filter((stage) => stage.status === "succeeded").length;
  return {
    completed,
    percent:
      run.progressPercent == null
        ? undefined
        : Math.max(0, Math.min(100, Math.round(run.progressPercent))),
  };
}

function currentRunStage(
  run: GenerationRun,
  stages: GenerationStage[],
): GenerationStage | undefined {
  return (
    stages.find((stage) => run.reviewGate?.stageId === stage.stageId) ??
    stages.find(
      (stage) => stage.toolName === run.currentToolName && stage.status === "running",
    ) ??
    [...stages]
      .filter((stage) => stage.status === "running")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ??
    (run.status === "failed"
      ? stages.find((stage) => stage.status === "failed")
      : undefined)
  );
}

function nextQueuedStage(
  run: GenerationRun,
  stages: GenerationStage[],
): GenerationStage | undefined {
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  const active = currentRunStage(run, ordered);
  const minOrder = active?.order ?? -1;
  return ordered.find(
    (stage) =>
      stage.order > minOrder &&
      (stage.status === "queued" || stage.status === "running"),
  );
}

function nextStageType(run: GenerationRun, stages: GenerationStage[]): GenerationStageType | undefined {
  if (isTerminal(run.status)) return undefined;

  const queued = nextQueuedStage(run, stages);
  if (queued) return queued.type;

  return undefined;
}

function standaloneAssetLabel(
  presentationKind: GenerationRun["presentationKind"],
): string | null {
  if (presentationKind === "standalone_image") return "Image asset";
  if (presentationKind === "standalone_video") return "Video asset";
  if (presentationKind === "standalone_audio") return "Audio asset";
  return null;
}

function lastCompletedPipelineStage(
  stages: GenerationStage[],
  presentationKind?: GenerationRun["presentationKind"],
): string | null {
  const assetLabel = standaloneAssetLabel(presentationKind);
  if (assetLabel) {
    return stages.some((stage) => stage.status === "succeeded") ? assetLabel : null;
  }
  const stagesByTool = new Map(
    stages
      .filter((stage) => stage.toolName)
      .map((stage) => [stage.toolName as string, stage]),
  );

  const completedGroup = [...PIPELINE_GROUPS]
    .reverse()
    .find((group) => {
      const hasAnyToolStage = group.tools.some((toolName) =>
        stagesByTool.has(toolName),
      );

      if (hasAnyToolStage) {
        return group.tools.every(
          (toolName) => stagesByTool.get(toolName)?.status === "succeeded",
        );
      }

      const fallbackStages = stages.filter((stage) =>
        (group.fallbackTypes ?? [group.type]).includes(stage.type),
      );
      return fallbackStages.some((stage) => stage.status === "succeeded");
    });

  return completedGroup?.label ?? null;
}

function formatDateTime(value?: string) {
  if (!value) return "Not started";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatLength(seconds?: number): string | null {
  if (!seconds) return null;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatBriefMeta(brief: VideoBriefInput): string {
  return [
    `${brief.targetLengthSec}s`,
    brief.aspectRatio,
    brief.platform,
    brief.format,
  ].filter(Boolean).join(" / ");
}

function planMetaItems(brief: VideoBriefInput): string[] {
  return [
    formatLength(brief.targetLengthSec),
    brief.aspectRatio,
    brief.platform,
    brief.format,
  ].filter((item): item is string => Boolean(item));
}

function headerStatus(run: GenerationRun): string {
  if (run.reviewGate) return "Ready for your approval";
  if (run.status === "queued") return "Waiting to start";
  if (run.status === "running") {
    if (run.activityState === "waiting_on_job") return "Waiting on provider";
    if (run.activityState === "recovering") return "Recovering";
    return "Producing";
  }
  if (run.status === "succeeded") {
    if (run.completionKind === "video") return "Video ready";
    if (run.completionKind === "standalone_asset") return "Asset ready";
    return "Partial result";
  }
  if (run.status === "failed") {
    return run.error?.code === "missing_video_output" ? "Partial result" : "Failed";
  }
  return "Canceled";
}

function workspaceReturnLabel({
  hasStudioDraft,
  terminal,
  succeeded,
}: {
  hasStudioDraft: boolean;
  terminal: boolean;
  succeeded: boolean;
}): string {
  if (hasStudioDraft && succeeded) return "Review in Studio";
  if (hasStudioDraft && terminal) return "View draft";
  if (hasStudioDraft) return "View draft";
  return "Open project";
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

const BOARD_STAGE_TYPES = new Set<GenerationStageType>([
  "storyboard",
  "asset_generation",
]);

const ASSET_BOARD_TOOL_LABELS = ["generate_keyframe", "generate_clip"];

function isStoryboardBoardItem(
  item: GenerationStageItem,
  stageById: Map<string, GenerationStage>,
): boolean {
  if (item.kind !== "image" && item.kind !== "video") return false;
  const stage = stageById.get(item.stageId);
  if (!stage || !BOARD_STAGE_TYPES.has(stage.type)) return false;
  if (stage.type === "storyboard") return true;

  const label = item.label.toLowerCase();
  return ASSET_BOARD_TOOL_LABELS.some((tool) => label.startsWith(tool));
}

function splitStoryboardItems(
  items: GenerationStageItem[],
  stageById: Map<string, GenerationStage>,
) {
  const boardItems: GenerationStageItem[] = [];
  const genericItems: GenerationStageItem[] = [];

  for (const item of items) {
    if (isStoryboardBoardItem(item, stageById)) {
      boardItems.push(item);
    } else {
      genericItems.push(item);
    }
  }

  return { boardItems, genericItems };
}

function isVisibleGeneratedItem(item: GenerationStageItem): boolean {
  return item.kind !== "caption";
}

function PlanRecap({
  project,
  loading,
}: {
  project: V1Project | null;
  loading: boolean;
}) {
  const brief = project?.brief ?? null;
  const requiredBeats = brief?.constraints?.requiredBeats ?? [];

  return (
    <section className={styles.planRecap} aria-labelledby="plan-recap-heading">
      <div className={styles.planRecapHeader}>
        <div>
          <p className={styles.eyebrow}>Approved plan</p>
          <h2 id="plan-recap-heading" className={styles.planRecapTitle}>
            {project?.name ?? "Project plan"}
          </h2>
        </div>
        {brief ? (
          <div className={styles.planRecapMeta} aria-label={formatBriefMeta(brief)}>
            {planMetaItems(brief).map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        ) : null}
      </div>
      {loading ? (
        <p className={styles.planRecapLoading}>Loading plan context...</p>
      ) : brief ? (
        <>
          <p className={styles.planRecapGoal}>{brief.goal}</p>
          <dl className={styles.planRecapFacts}>
            {brief.hookQuestion ? (
              <div>
                <dt>Hook</dt>
                <dd>{brief.hookQuestion}</dd>
              </div>
            ) : null}
            {requiredBeats.length > 0 ? (
              <div>
                <dt>Beat count</dt>
                <dd>{requiredBeats.length} planned beats</dd>
              </div>
            ) : null}
            {brief.strongestVisual ? (
              <div>
                <dt>Visual direction</dt>
                <dd>{brief.strongestVisual}</dd>
              </div>
            ) : null}
          </dl>
        </>
      ) : (
        <p className={styles.planRecapLoading}>
          Plan details are unavailable for this run, but production is continuing from the saved project context.
        </p>
      )}
    </section>
  );
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
}: ProgressViewProps) {
  const [detail, setDetail] = useState({ run, stages, stageItems });
  const [projectStoryboard, setProjectStoryboard] = useState<ProjectStoryboard | null>(null);
  const [fallbackApproving, setFallbackApproving] = useState(false);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const [fallbackFeedbackNote, setFallbackFeedbackNote] = useState("");
  const [boardFeedbackActiveKeys, setBoardFeedbackActiveKeys] = useState<string[]>([]);
  const [selectedAssetItemId, setSelectedAssetItemId] = useState<string | null>(null);
  const [reviewProposalOpen, setReviewProposalOpen] = useState(false);
  const reviewGateKey = detail.run.reviewGate?.stageId ?? null;
  const projectQuery = useProjectQuery(detail.run.projectId);
  const project = projectQuery.data?.project ?? null;
  const projectLoading = projectQuery.isLoading;

  useEffect(() => {
    setDetail({ run, stages, stageItems });
    setFallbackApproving(false);
    setFallbackError(null);
  }, [run, stages, stageItems]);

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

  const terminal = isTerminal(detail.run.status);
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
  const showBackgroundActivity = !terminal && !detail.run.reviewGate;
  const feedbackNote = reviewActions?.feedbackNote ?? fallbackFeedbackNote;
  const setFeedbackNote = reviewActions?.onFeedbackNoteChange ?? setFallbackFeedbackNote;
  const progress = progressSummary(detail.run, detail.stages);
  const elapsed = useElapsedTime(detail.run.startedAt, detail.run.completedAt);
  // Only durable progress counts as creator-visible activity. `updatedAt` can
  // move when a recovery sweeper touches the run without any provider output.
  const sinceLastActivity = useElapsedTime(
    detail.run.lastProgressAt,
    detail.run.completedAt,
  );
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
    ? () => reviewActions.onApprove(feedbackNote)
    : approveFallback;

  const progressSentence = mobileProgressSentence({
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
    choosingNextStep ? null : detail.run.message,
    ...progressContext,
  ].filter((item): item is string => Boolean(item));

  function renderPipelineDepth() {
    return (
      <>
        <div className={styles.sidePanelHeader}>
          <div>
            <p className={styles.eyebrow}>{standaloneLabel ? "Asset activity" : "Pipeline"}</p>
            <h2 className={styles.sidePanelHeading}>{standaloneLabel ? "Status" : "Stages"}</h2>
          </div>
        </div>
        {showBackgroundActivity ? (
          <div className={styles.backgroundActivity} role="status">
            <span className={styles.backgroundSpinner} aria-hidden="true" />
            <span>
              {cancelAction?.pending
                ? "Stopping after the current step..."
                : detail.run.activityState === "waiting_on_job"
                  ? "Waiting on a provider"
                  : detail.run.activityState === "recovering"
                    ? "Recovering from an earlier failed step"
                    : choosingNextStep
                      ? "Choosing the next step"
                      : "Working in the background"}
            </span>
          </div>
        ) : null}
        <StageRail
          stages={detail.stages}
          runStatus={detail.run.status}
          currentStageType={detail.run.currentStageType}
          runProgressPercent={detail.run.progressPercent}
          runMessage={detail.run.message}
          reviewGate={detail.run.reviewGate}
          stageLinks={stageLinks}
          presentationKind={detail.run.presentationKind}
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
        {showCancelAction && cancelAction?.error ? (
          <p className={styles.error} role="alert">
            {cancelAction.error}
          </p>
        ) : null}
        <p className={styles.sidePanelMeta}>
          {elapsed !== null ? `Elapsed ${formatElapsed(elapsed)}. ` : ""}
          {sinceLastActivity !== null
            ? `Last activity ${formatElapsed(sinceLastActivity)} ago.`
            : detail.run.status === "running"
              ? "Waiting for the first meaningful progress update."
              : "No meaningful progress timestamp was recorded."}
        </p>
        {operatorDiagnostics ? (
          <details className={styles.operatorDiagnostics}>
            <summary>Operator diagnostics</summary>
            <div className={styles.operatorDiagnosticsBody}>
              <div className={styles.diagnostics}>
                <span className={styles.runIdLabel}>Run ID</span>
                <code className={styles.runId} title={detail.run.runId}>
                  {shortId(detail.run.runId)}
                </code>
                <button
                  type="button"
                  className={styles.copyButton}
                  onClick={() => void navigator.clipboard?.writeText(detail.run.runId)}
                >
                  Copy
                </button>
              </div>
              {operatorDiagnostics.length > 0 ? (
                <ol className={styles.operatorJobList}>
                  {operatorDiagnostics.map((job) => (
                    <li className={styles.operatorJob} key={job.jobId}>
                      <div className={styles.operatorJobHeading}>
                        <strong>{job.currentStep ?? "Background job"}</strong>
                        <span>{job.status}</span>
                      </div>
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
              ) : (
                <p className={styles.operatorEmpty}>No job diagnostics reported yet.</p>
              )}
            </div>
          </details>
        ) : null}
      </>
    );
  }

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
          <div className={styles.headerStatusPanel} aria-label="Current run status">
            <div className={styles.mobileStatusNarrative}>
              <strong>{progressSentence}</strong>
              {progressDetails.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
            <div className={styles.statusGrid}>
              <div>
                <span className={styles.statusLabel}>Status</span>
                <strong>{headerStatus(detail.run)}</strong>
              </div>
              {lastCompletedStageLabel ? (
                <div>
                  <span className={styles.statusLabel}>Last completed</span>
                  <strong>{lastCompletedStageLabel}</strong>
                </div>
              ) : (
                <div>
                  <span className={styles.statusLabel}>Current step</span>
                  <strong>{currentStageDisplay}</strong>
                </div>
              )}
              {nextStageLabel ? (
                <div>
                  <span className={styles.statusLabel}>Next step</span>
                  <strong>{nextStageLabel}</strong>
                </div>
              ) : null}
              <div>
                <span className={styles.statusLabel}>Progress</span>
                <strong>{progress.completed} tool steps complete</strong>
              </div>
            </div>
            {progress.percent == null && detail.run.status === "running" ? (
              <div
                className={`${styles.headerMeter} ${styles.headerMeterIndeterminate}`}
                role="progressbar"
                aria-label="Generation in progress; percentage unavailable"
              >
                <div className={styles.headerMeterFill} />
              </div>
            ) : progress.percent != null ? (
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

      <div className={styles.body}>
        <section className={styles.main}>
          {terminal ? <TerminalState run={detail.run} creditRecovery={creditRecovery} /> : null}

          <PlanRecap project={project} loading={projectLoading} />

          {detail.run.reviewGate ? (
            <ReviewGatePanel
              stageType={detail.run.reviewGate.stageType}
              projectBrief={projectBrief}
              projectLoading={projectLoading}
              reviewItems={reviewItems}
              reviewOutputGroups={reviewOutputGroups}
              feedbackNote={feedbackNote}
              pending={pending}
              actionError={actionError}
              reviewActions={reviewActions}
              onFeedbackNoteChange={setFeedbackNote}
              onApprove={onApprove}
              onRequestChanges={() => setReviewProposalOpen(true)}
              canRequestChanges={Boolean(reviewProposalTarget)}
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
                        <button
                          className={styles.assetEditButton}
                          type="button"
                          key={item.itemId}
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

          <details className={styles.mobilePipelineDetails}>
            <summary>
              {standaloneLabel ? "Show asset status" : "Show pipeline"}
              <span aria-hidden="true">+</span>
            </summary>
            <div
              className={styles.mobilePipelineContent}
              role="complementary"
              aria-label="Stage rail"
            >
              {renderPipelineDepth()}
            </div>
          </details>
        </section>

        <aside className={styles.sidePanel} aria-label="Stage rail">
          {renderPipelineDepth()}
        </aside>
      </div>
    </div>
  );
}
