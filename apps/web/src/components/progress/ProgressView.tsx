"use client";

import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  GENERATION_STAGE_LABELS,
  type GenerationRun,
  type GenerationStage,
  type GenerationStageType,
  type GenerationStageItem,
  type VideoBriefInput,
} from "@popcorn/shared/v1/types";
import { StageItemCard } from "../generation-progress/StageItemCard";
import { JudgmentBadge } from "../evals/JudgmentBadge";
import {
  GenerationRunClient,
  GenerationRunRequestError,
} from "../../lib/v1/generation-runs/client";
import { v1Api } from "../../lib/api-client";
import { StageRail } from "./StageRail";
import { StatusBanner } from "./StatusBanner";
import { TerminalState } from "./TerminalState";
import styles from "./ProgressView.module.css";

interface ProgressViewProps {
  run: GenerationRun;
  stages: GenerationStage[];
  stageItems?: GenerationStageItem[];
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

function titleForRun(run: GenerationRun): string {
  if (run.projectId === "demo-project") return "Demo project";
  return "Video generation run";
}

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

function formatDateTime(value?: string) {
  if (!value) return "Not started";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBriefMeta(brief: VideoBriefInput): string {
  return [
    `${brief.targetLengthSec}s`,
    brief.aspectRatio,
    brief.platform,
    brief.format,
  ].filter(Boolean).join(" / ");
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
        <span className="muted">Loading brief...</span>
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
      <div className={styles.briefReviewHeader}>
        <span className={styles.briefReviewBadge}>Brief</span>
        <span className={styles.briefReviewMeta}>{formatBriefMeta(brief)}</span>
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

export function ProgressView({
  run,
  stages,
  stageItems = [],
  reviewActions,
  cancelAction,
  alternateRuns,
}: ProgressViewProps) {
  const [detail, setDetail] = useState({ run, stages, stageItems });
  const [projectBrief, setProjectBrief] = useState<VideoBriefInput | null>(null);
  const [projectBriefLoading, setProjectBriefLoading] = useState(false);
  const [fallbackApproving, setFallbackApproving] = useState(false);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const [fallbackFeedbackNote, setFallbackFeedbackNote] = useState("");
  const reviewGateKey = detail.run.reviewGate?.stageId ?? null;
  const isBriefReviewGate = detail.run.reviewGate?.stageType === "brief_intake";

  useEffect(() => {
    setDetail({ run, stages, stageItems });
    setFallbackApproving(false);
    setFallbackError(null);
  }, [run, stages, stageItems]);

  useEffect(() => {
    setFallbackFeedbackNote("");
  }, [reviewGateKey]);

  useEffect(() => {
    if (!isBriefReviewGate) {
      setProjectBrief(null);
      setProjectBriefLoading(false);
      return;
    }

    let canceled = false;
    setProjectBriefLoading(true);
    v1Api
      .getProject(detail.run.projectId)
      .then(({ project }) => {
        if (!canceled) setProjectBrief(project.brief ?? null);
      })
      .catch(() => {
        if (!canceled) setProjectBrief(null);
      })
      .finally(() => {
        if (!canceled) setProjectBriefLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [detail.run.projectId, isBriefReviewGate]);

  const terminal = isTerminal(detail.run.status);
  const reviewStage = detail.run.reviewGate
    ? detail.stages.find((stage) => stage.stageId === detail.run.reviewGate?.stageId)
    : undefined;
  const reviewItems = detail.run.reviewGate
    ? detail.stageItems.filter((item) => item.stageId === detail.run.reviewGate?.stageId)
    : [];
  const generatedItems = detail.run.reviewGate
    ? detail.stageItems.filter((item) => item.stageId !== detail.run.reviewGate?.stageId)
    : detail.stageItems;
  const pending = reviewActions?.pending ?? (fallbackApproving ? "approve" : undefined);
  const actionError = reviewActions?.error ?? fallbackError;
  const showCancelAction = !terminal && !detail.run.reviewGate && !!cancelAction;
  const feedbackNote = reviewActions?.feedbackNote ?? fallbackFeedbackNote;
  const setFeedbackNote = reviewActions?.onFeedbackNoteChange ?? setFallbackFeedbackNote;
  const progress = progressSummary(detail.run, detail.stages);
  const currentStageLabel = detail.run.reviewGate
    ? reviewStageLabel(detail.run.reviewGate.stageType)
    : detail.run.currentStageType
      ? reviewStageLabel(detail.run.currentStageType)
      : "Final render";

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

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <p className={styles.eyebrow}>Generation workspace</p>
          <h1 className={styles.title}>{titleForRun(detail.run)}</h1>
          <div className={styles.runIdRow}>
            <span className={styles.runIdLabel}>Run ID</span>
            <code className={styles.runId} title={detail.run.runId}>{shortId(detail.run.runId)}</code>
            <button
              type="button"
              className={styles.copyButton}
              onClick={() => void navigator.clipboard?.writeText(detail.run.runId)}
            >
              Copy
            </button>
          </div>
        </div>
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
      </header>

      <section className={styles.progressOverview} aria-label="Overall progress">
        <div>
          <p className={styles.progressLabel}>
            Stage {progress.currentStage} of {VISIBLE_STAGE_COUNT}
          </p>
          <p className={styles.progressTitle}>{currentStageLabel}</p>
        </div>
        <div className={styles.progressMeterWrap}>
          <span className={styles.progressPercent}>{progress.percent}%</span>
          <div
            className={styles.progressMeter}
            role="progressbar"
            aria-valuenow={progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={styles.progressMeterFill}
              style={{ width: `${Math.max(2, progress.percent)}%` }}
            />
          </div>
        </div>
      </section>

      <div className={styles.body}>
        <section className={styles.main}>
          {terminal ? <TerminalState run={detail.run} /> : <StatusBanner run={detail.run} />}

          {showCancelAction ? (
            <section
              className={`${styles.card} ${styles.activeRunCard}`}
              aria-labelledby="run-actions-heading"
            >
              <div className={styles.cardHeader}>
                <div>
                  <p className={styles.eyebrow}>Run controls</p>
                  <h2 id="run-actions-heading" className={styles.cardHeading}>
                    Active generation
                  </h2>
                </div>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={cancelAction.onCancel}
                    disabled={cancelAction.pending}
                  >
                    {cancelAction.pending ? "Canceling..." : "Cancel generation"}
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
              className={`${styles.card} ${styles.reviewCard}`}
              aria-labelledby="review-gate-heading"
            >
              <div className={styles.reviewHeader}>
                <div>
                  <p className={styles.reviewStatus}>Needs your review</p>
                  <h2 id="review-gate-heading" className={styles.reviewTitle}>
                    {reviewStageLabel(detail.run.reviewGate.stageType)} ready.
                  </h2>
                </div>
                <JudgmentBadge judgment={reviewStage?.judgment ?? null} />
              </div>
              <div className={styles.reviewSummary}>
                <p>
                  {reviewStage?.message ??
                    "Inspect this stage's output before the next generation stage starts."}
                </p>
                <dl className={styles.summaryGrid}>
                  <div>
                    <dt>Stage output</dt>
                    <dd>{reviewItems.length > 0 ? `${reviewItems.length} item${reviewItems.length === 1 ? "" : "s"} ready` : "Summary only"}</dd>
                  </div>
                  <div>
                    <dt>Next step</dt>
                    <dd>Approve to continue the run</dd>
                  </div>
                </dl>
              </div>
              {isBriefReviewGate && (projectBrief || projectBriefLoading) ? (
                <BriefReviewOutput brief={projectBrief} loading={projectBriefLoading} />
              ) : reviewItems.length > 0 ? (
                <div className={`${styles.itemGrid} ${styles.reviewOutputGrid}`}>
                  {reviewItems.map((item) => (
                    <StageItemCard key={item.itemId} item={item} />
                  ))}
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
                  placeholder="Tell the generator what to change or carry forward."
                  disabled={!!pending}
                  rows={4}
                />
                <p className={styles.feedbackHint}>
                  Optional. Regenerate sends this feedback back to this step.
                </p>
              </div>
              {actionError ? (
                <p className={styles.error} role="alert">
                  {actionError}
                </p>
              ) : null}
              <div className={styles.reviewActionRow}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={onApprove}
                  disabled={!!pending}
                >
                  {pending === "approve" ? "Approving..." : "Approve & continue"}
                </button>
                {reviewActions ? (
                  <>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => reviewActions.onReject(feedbackNote)}
                      disabled={!!pending}
                    >
                      {pending === "reject"
                        ? "Regenerating..."
                        : "Regenerate with feedback"}
                    </button>
                    <button
                      type="button"
                      className={styles.dangerButton}
                      onClick={reviewActions.onCancel}
                      disabled={!!pending}
                    >
                      {pending === "cancel" ? "Canceling..." : "Cancel generation"}
                    </button>
                  </>
                ) : null}
              </div>
            </section>
          ) : null}

          <section
            className={`${styles.card} ${styles.assetsCard}`}
            aria-labelledby="generated-assets-heading"
          >
            <h2 id="generated-assets-heading" className={styles.cardHeading}>
              Generated assets
            </h2>
            {generatedItems.length > 0 ? (
              <div className={`${styles.itemGrid} ${styles.reviewOutputGrid}`}>
                {generatedItems.map((item) => (
                  <StageItemCard key={item.itemId} item={item} />
                ))}
              </div>
            ) : (
              <div className={styles.assetsEmpty}>
                <p>No generated assets yet.</p>
                <span>
                  As the run advances, this area will collect storyboard frames,
                  shot candidates, voice or audio items, timeline artifacts, and
                  the final render for review.
                </span>
              </div>
            )}
          </section>
        </section>

        <aside className={styles.sidePanel} aria-label="Stage rail">
          <div className={styles.sidePanelHeader}>
            <div>
              <p className={styles.eyebrow}>Run timeline</p>
              <h2 className={styles.sidePanelHeading}>Stages</h2>
            </div>
            <span className={styles.sidePanelPercent}>{progress.percent}%</span>
          </div>
          <StageRail stages={detail.stages} reviewGate={detail.run.reviewGate} />
          <div className={styles.metadataCard} aria-label="Run metadata">
            <h3>Run metadata</h3>
            <dl>
              <div>
                <dt>Project</dt>
                <dd title={detail.run.projectId}>{shortId(detail.run.projectId)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{detail.run.reviewGate ? "Waiting for approval" : detail.run.status}</dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>{formatDateTime(detail.run.startedAt)}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{formatDateTime(detail.run.updatedAt)}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
