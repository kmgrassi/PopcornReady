"use client";

import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  GENERATION_STAGE_LABELS,
  GENERATION_STAGE_ORDER,
  type GenerationRun,
  type GenerationStage,
  type GenerationStageType,
  type GenerationStageItem,
  type BoardRevisionTarget,
  type ProjectStoryboard,
  type V1Project,
  type VideoBriefInput,
} from "@popcorn/shared/v1/types";
import { StageItemCard } from "../generation-progress/StageItemCard";
import {
  GenerationRunClient,
  GenerationRunRequestError,
} from "../../lib/v1/generation-runs/client";
import { useProjectQuery } from "../../lib/queryClient";
import { v1Api } from "../../lib/api-client";
import { StageRail } from "./StageRail";
import {
  StoryboardBoard as FeedbackStoryboardBoard,
  storyboardFeedbackTargetKey,
} from "./StoryboardBoard";
import { TerminalState } from "./TerminalState";
import { StoryboardBoard as ReadonlyStoryboardBoard } from "../studio/StoryboardBoard";
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
    onReject: (note: string) => void;
    onCancel: () => void;
  };
  cancelAction?: {
    pending?: boolean;
    error?: string | null;
    onCancel: () => void;
  };
  /** Optional list of other demo runs to link to from the header. */
  alternateRuns?: { runId: string; label: string }[];
}

function isTerminal(status: GenerationRun["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

const VISIBLE_STAGE_COUNT = 8;

const ORDERED_STAGE_TYPES = Object.entries(GENERATION_STAGE_ORDER)
  .sort(([, a], [, b]) => a - b)
  .map(([type]) => type as GenerationStageType);

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

const VISIBLE_STAGE_INDEX: Record<GenerationStageType, number> = {
  brief_intake: 1,
  creative_plan: 2,
  storyboard: 4,
  asset_generation: 6,
  audio_generation: 6,
  timeline_assembly: 7,
  quality_review: 8,
  export: 8,
  ready: 8,
};

function shortId(id: string): string {
  if (id.length <= 18) return id;
  return `${id.slice(0, 8)}...${id.slice(-6)}`;
}

function reviewStageLabel(stageType: GenerationStageType): string {
  return REVIEW_STAGE_LABELS[stageType] ?? GENERATION_STAGE_LABELS[stageType];
}

function progressSummary(run: GenerationRun, stages: GenerationStage[]) {
  const activeStage =
    stages.find((stage) => run.reviewGate?.stageId === stage.stageId) ??
    stages.find((stage) => stage.status === "running") ??
    stages.find((stage) => stage.status === "failed") ??
    stages.find((stage) => stage.status === "queued");
  const type = activeStage?.type ?? run.currentStageType ?? "ready";
  const currentStage = VISIBLE_STAGE_INDEX[type] ?? VISIBLE_STAGE_COUNT;
  const completed = stages.filter((stage) => stage.status === "succeeded").length;
  const fallbackPercent =
    stages.length > 0 ? Math.round((completed / stages.length) * 100) : 0;
  const percent = Math.max(
    0,
    Math.min(100, Math.round(run.progressPercent ?? fallbackPercent)),
  );

  return {
    currentStage: Math.min(VISIBLE_STAGE_COUNT, currentStage),
    percent,
  };
}

function currentRunStage(
  run: GenerationRun,
  stages: GenerationStage[],
): GenerationStage | undefined {
  return (
    stages.find((stage) => run.reviewGate?.stageId === stage.stageId) ??
    stages.find((stage) => stage.status === "running") ??
    stages.find((stage) => stage.status === "failed") ??
    stages.find((stage) => stage.status === "queued")
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

function nextStageType(
  run: GenerationRun,
  stages: GenerationStage[],
): GenerationStageType | undefined {
  if (isTerminal(run.status)) return undefined;

  const queued = nextQueuedStage(run, stages);
  if (queued) return queued.type;

  const currentType =
    run.reviewGate?.stageType ?? currentRunStage(run, stages)?.type ?? run.currentStageType;
  if (!currentType) return undefined;

  const currentOrder = GENERATION_STAGE_ORDER[currentType];
  return ORDERED_STAGE_TYPES.find(
    (type) => GENERATION_STAGE_ORDER[type] > currentOrder,
  );
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

function briefMetaItems(brief: VideoBriefInput): string[] {
  return [
    brief.targetLengthSec ? `${brief.targetLengthSec} seconds` : null,
    brief.aspectRatio,
    brief.platform,
    brief.format,
  ].filter((item): item is string => Boolean(item));
}

function reviewHeading(stageType: GenerationStageType): string {
  if (stageType === "brief_intake") return "Concept ready for review";
  if (stageType === "storyboard") return "Plan ready for review";
  return `${reviewStageLabel(stageType)} ready for review`;
}

function headerStatus(run: GenerationRun): string {
  if (run.reviewGate) return "Ready for your approval";
  if (run.status === "queued") return "Waiting to start";
  if (run.status === "running") return "Generating";
  if (run.status === "succeeded") return "Complete";
  if (run.status === "failed") return "Failed";
  return "Canceled";
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

function BriefReviewOutput({
  brief,
  loading,
}: {
  brief: VideoBriefInput | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className={styles.briefReviewCard}>
        <span className={styles.briefReviewLoading}>Loading concept...</span>
      </div>
    );
  }

  if (!brief) return null;

  const fields = [
    ["Audience", brief.audience],
    ["Style", brief.style],
    ["Hook", brief.hookQuestion],
    ["Big idea", brief.oneBigIdea],
    ["Payoff", brief.payoff],
    ["Caveat", brief.caveat],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  return (
    <article className={styles.briefReviewCard}>
      <div className={styles.briefReviewMetaRow} aria-label={formatBriefMeta(brief)}>
        {briefMetaItems(brief).map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
      <h3 className={styles.briefReviewGoal}>{brief.goal}</h3>
      {brief.strongestVisual ? (
        <p className={styles.briefReviewVisual}>{brief.strongestVisual}</p>
      ) : null}
      {fields.length > 0 ? (
        <dl className={styles.briefReviewFields}>
          {fields.map(([label, value]) => (
            <div className={styles.briefReviewField} key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  );
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

export function ProgressView({
  run,
  stages,
  stageItems = [],
  studioReturnPath,
  reviewActions,
  cancelAction,
  alternateRuns,
}: ProgressViewProps) {
  const [detail, setDetail] = useState({ run, stages, stageItems });
  const [projectStoryboard, setProjectStoryboard] = useState<ProjectStoryboard | null>(null);
  const [fallbackApproving, setFallbackApproving] = useState(false);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const [fallbackFeedbackNote, setFallbackFeedbackNote] = useState("");
  const [boardFeedbackPendingKey, setBoardFeedbackPendingKey] = useState<string | null>(null);
  const [boardFeedbackError, setBoardFeedbackError] = useState<string | null>(null);
  const reviewGateKey = detail.run.reviewGate?.stageId ?? null;
  const isBriefReviewGate = detail.run.reviewGate?.stageType === "brief_intake";
  const projectQuery = useProjectQuery(detail.run.projectId);
  const project = projectQuery.data?.project ?? null;
  const projectLoading = projectQuery.isLoading;

  useEffect(() => {
    setDetail({ run, stages, stageItems });
    setFallbackApproving(false);
    setFallbackError(null);
  }, [run, stages, stageItems]);

  useEffect(() => {
    setFallbackFeedbackNote("");
  }, [reviewGateKey]);

  const terminal = isTerminal(detail.run.status);
  const reviewItems = detail.run.reviewGate
    ? detail.stageItems.filter((item) => item.stageId === detail.run.reviewGate?.stageId)
    : [];
  const generatedItems = detail.run.reviewGate
    ? detail.stageItems.filter((item) => item.stageId !== detail.run.reviewGate?.stageId)
    : detail.stageItems;
  const stageById = new Map(detail.stages.map((stage) => [stage.stageId, stage]));
  const reviewOutputGroups = splitStoryboardItems(reviewItems, stageById);
  const generatedOutputGroups = splitStoryboardItems(generatedItems, stageById);

  useEffect(() => {
    if (generatedOutputGroups.boardItems.length === 0) {
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
  }, [detail.run.projectId, generatedOutputGroups.boardItems.length]);

  const pending = reviewActions?.pending ?? (fallbackApproving ? "approve" : undefined);
  const actionError = reviewActions?.error ?? fallbackError;
  const showCancelAction = !terminal && !detail.run.reviewGate && !!cancelAction;
  const feedbackNote = reviewActions?.feedbackNote ?? fallbackFeedbackNote;
  const setFeedbackNote = reviewActions?.onFeedbackNoteChange ?? setFallbackFeedbackNote;
  const progress = progressSummary(detail.run, detail.stages);
  const nextType = nextStageType(detail.run, detail.stages);
  const nextStageLabel = nextType ? reviewStageLabel(nextType) : null;
  const currentStageLabel = detail.run.reviewGate
    ? reviewStageLabel(detail.run.reviewGate.stageType)
    : detail.run.currentStageType
      ? reviewStageLabel(detail.run.currentStageType)
      : "Final render";
  const currentStageDisplay = detail.run.reviewGate
    ? `${currentStageLabel} review`
    : currentStageLabel;

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

  async function submitBoardFeedback(input: {
    message: string;
    target: BoardRevisionTarget;
  }) {
    const key = storyboardFeedbackTargetKey(input.target);
    setBoardFeedbackPendingKey(key);
    setBoardFeedbackError(null);
    try {
      await v1Api.createRunBoardRevision(detail.run.projectId, detail.run.runId, input);
    } catch (err) {
      setBoardFeedbackError(
        err instanceof Error ? err.message : "Could not send board feedback.",
      );
      throw err;
    } finally {
      setBoardFeedbackPendingKey(null);
    }
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <p className={styles.eyebrow}>Act Two / Produce</p>
          <h1 className={styles.title}>Producing your video</h1>
          <p className={styles.headerDescription}>
            {project?.brief?.goal ??
              project?.name ??
              "The agent is turning the approved plan into production assets, timeline, review, and export."}
          </p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.headerStatusPanel} aria-label="Current run status">
            <div>
              <span className={styles.statusLabel}>Current stage</span>
              <strong>{currentStageDisplay}</strong>
            </div>
            <div>
              <span className={styles.statusLabel}>Status</span>
              <strong>{headerStatus(detail.run)}</strong>
            </div>
            {nextStageLabel ? (
              <div>
                <span className={styles.statusLabel}>Next step</span>
                <strong>{nextStageLabel}</strong>
              </div>
            ) : null}
            <div>
              <span className={styles.statusLabel}>Progress</span>
              <strong>
                Stage {progress.currentStage} of {VISIBLE_STAGE_COUNT}
              </strong>
            </div>
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
          </div>
          <Link className={styles.secondaryButton} to={studioReturnPath ?? "/studio"}>
            Back to studio
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
          {terminal ? <TerminalState run={detail.run} /> : null}

          <PlanRecap project={project} loading={projectLoading} />

          {showCancelAction ? (
            <section
              className={`${styles.card} ${styles.activeRunCard}`}
              aria-labelledby="run-actions-heading"
            >
              <div className={styles.cardHeader}>
                <div>
                  <p className={styles.eyebrow}>Run controls</p>
                  <h2 id="run-actions-heading" className={styles.cardHeading}>
                    Stop here or keep producing
                  </h2>
                  <p className={styles.activeRunMessage}>
                    {detail.run.message ??
                      `${currentStageLabel} is in progress.${
                        nextStageLabel ? ` Next step: ${nextStageLabel}.` : ""
                      }`} You can stop here and return to the draft instead of letting the run continue.
                  </p>
                </div>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={cancelAction.onCancel}
                    disabled={cancelAction.pending}
                  >
                    {cancelAction.pending ? "Stopping..." : "Stop here"}
                  </button>
                </div>
              </div>
              {cancelAction.error ? (
                <p className={styles.error} role="alert">
                  {cancelAction.error}
                </p>
              ) : null}
            </section>
          ) : null}

          {detail.run.reviewGate ? (
            <section
              className={styles.reviewPanel}
              aria-labelledby="review-gate-heading"
            >
              <div className={styles.reviewIntro}>
                <span className={styles.reviewBadge}>Needs review</span>
                <h2 id="review-gate-heading" className={styles.reviewTitle}>
                  {reviewHeading(detail.run.reviewGate.stageType)}
                </h2>
                <p className={styles.reviewDescription}>
                  {detail.run.reviewGate.stageType === "brief_intake"
                    ? "Review the concept brief before the run continues to script generation."
                    : detail.run.reviewGate.stageType === "storyboard"
                      ? "Review the plan before the agent starts storyboard, keyframe, or clip generation. Stop here if you do not want the agent to keep producing from this boundary."
                      : "Review this stage before the run continues to the next generation step. Stop here if you do not want the agent to keep producing from this boundary."}
                </p>
              </div>
              {isBriefReviewGate && (project?.brief || projectLoading) ? (
                <BriefReviewOutput brief={project?.brief ?? null} loading={projectLoading} />
              ) : reviewItems.length > 0 ? (
                <div className={styles.reviewOutputs}>
                  <ReadonlyStoryboardBoard
                    items={reviewOutputGroups.boardItems}
                    title="Review the storyboard"
                    description="Visual outputs from this checkpoint are grouped as beat tiles before the run continues."
                  />
                  {reviewOutputGroups.genericItems.length > 0 ? (
                    <div className={`${styles.itemGrid} ${styles.reviewOutputGrid}`}>
                      {reviewOutputGroups.genericItems.map((item) => (
                        <StageItemCard key={item.itemId} item={item} />
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className={styles.reviewOutputEmpty}>
                  <span>
                    No separate assets were produced for this checkpoint. Use the summary above to approve or request changes.
                  </span>
                </div>
              )}
              <div className={styles.feedbackField}>
                <label className={styles.feedbackLabel} htmlFor="review-feedback-note">
                  Feedback
                </label>
                <textarea
                  id="review-feedback-note"
                  className={styles.feedbackTextarea}
                  value={feedbackNote}
                  onChange={(event) => setFeedbackNote(event.target.value)}
                  placeholder="Optional feedback before continuing..."
                  disabled={!!pending}
                  rows={4}
                />
                <p className={styles.feedbackHint}>
                  Use this when you want the generator to revise this stage before continuing.
                </p>
              </div>
              {actionError ? (
                <p className={styles.error} role="alert">
                  {actionError}
                </p>
              ) : null}
              <div className={styles.reviewActionRow}>
                {reviewActions ? (
                  <>
                    <button
                      type="button"
                      className={styles.reviewCancelButton}
                      onClick={reviewActions.onCancel}
                      disabled={!!pending}
                    >
                      {pending === "cancel" ? "Stopping..." : "Stop here"}
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => reviewActions.onReject(feedbackNote)}
                      disabled={!!pending}
                    >
                      {pending === "reject" ? "Requesting..." : "Request changes"}
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={onApprove}
                  disabled={!!pending}
                >
                  {pending === "approve" ? "Approving..." : "Approve and continue"}
                </button>
              </div>
            </section>
          ) : null}

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
                  runId={detail.run.runId}
                  items={generatedOutputGroups.boardItems}
                  storyboard={projectStoryboard}
                  pendingTargetKey={boardFeedbackPendingKey}
                  error={boardFeedbackError}
                  onFeedback={submitBoardFeedback}
                />
                {generatedOutputGroups.genericItems.length > 0 ? (
                  <div className={`${styles.itemGrid} ${styles.reviewOutputGrid}`}>
                    {generatedOutputGroups.genericItems.map((item) => (
                      <StageItemCard key={item.itemId} item={item} />
                    ))}
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
        </section>

        <aside className={styles.sidePanel} aria-label="Stage rail">
          <div className={styles.sidePanelHeader}>
            <div>
              <p className={styles.eyebrow}>Pipeline</p>
              <h2 className={styles.sidePanelHeading}>Remaining stages</h2>
            </div>
          </div>
          <StageRail
            stages={detail.stages}
            runStatus={detail.run.status}
            currentStageType={detail.run.currentStageType}
            runProgressPercent={detail.run.progressPercent}
            runMessage={detail.run.message}
            reviewGate={detail.run.reviewGate}
          />
          <p className={styles.sidePanelMeta}>
            Started {formatDateTime(detail.run.startedAt)}. Updated{" "}
            {formatDateTime(detail.run.updatedAt)}.
          </p>
          <div className={styles.diagnosticsRow}>
            <span className={styles.statusLabel}>Run ID</span>
            <code className={styles.runId} title={detail.run.runId}>{shortId(detail.run.runId)}</code>
            <button
              type="button"
              className={styles.copyButton}
              onClick={() => void navigator.clipboard?.writeText(detail.run.runId)}
            >
              Copy
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
