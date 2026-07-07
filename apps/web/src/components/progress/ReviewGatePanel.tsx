import { useState } from "react";
import {
  GENERATION_STAGE_LABELS,
  type GenerationStageItem,
  type GenerationStageType,
  type VideoBriefInput,
} from "@popcorn/shared/v1/types";
import { StageItemCard } from "../generation-progress/StageItemCard";
import { StoryboardBoard as ReadonlyStoryboardBoard } from "../studio/StoryboardBoard";
import styles from "./ReviewGatePanel.module.css";
import progressStyles from "./ProgressView.module.css";

interface ReviewOutputGroups {
  boardItems: GenerationStageItem[];
  genericItems: GenerationStageItem[];
}

interface ReviewActions {
  pending?: "approve" | "reject" | "cancel";
  error?: string | null;
  feedbackNote?: string;
  onFeedbackNoteChange?: (note: string) => void;
  onApprove: (note: string) => void;
  onReject: (note: string) => void;
  onCancel: () => void;
}

interface ReviewGatePanelProps {
  stageType: GenerationStageType;
  projectBrief: VideoBriefInput | null;
  projectLoading: boolean;
  reviewItems: GenerationStageItem[];
  reviewOutputGroups: ReviewOutputGroups;
  feedbackNote: string;
  pending?: "approve" | "reject" | "cancel";
  actionError?: string | null;
  reviewActions?: ReviewActions;
  onFeedbackNoteChange: (note: string) => void;
  onApprove: () => void;
}

const REVIEW_STAGE_LABELS: Partial<Record<GenerationStageType, string>> = {
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

function reviewStageLabel(stageType: GenerationStageType): string {
  return REVIEW_STAGE_LABELS[stageType] ?? GENERATION_STAGE_LABELS[stageType];
}

function reviewHeading(stageType: GenerationStageType): string {
  if (stageType === "brief_intake") return "Concept ready for review";
  if (stageType === "storyboard") return "Plan ready for review";
  return `${reviewStageLabel(stageType)} ready for review`;
}

function reviewDescription(stageType: GenerationStageType): string {
  if (stageType === "brief_intake") {
    return "Review the concept brief before the run continues to script generation.";
  }

  if (stageType === "storyboard") {
    return "Review the plan before the agent starts storyboard, keyframe, or clip generation. Stop here if you do not want the agent to keep producing from this boundary.";
  }

  return "Review this stage before the run continues to the next generation step. Stop here if you do not want the agent to keep producing from this boundary.";
}

function formatBriefMeta(brief: VideoBriefInput): string {
  return [
    `${brief.targetLengthSec}s`,
    brief.aspectRatio,
    brief.platform,
    brief.format,
  ].filter(Boolean).join(" / ");
}

function briefMetaItems(brief: VideoBriefInput): string[] {
  return [
    brief.targetLengthSec ? `${brief.targetLengthSec} seconds` : null,
    brief.aspectRatio,
    brief.platform,
    brief.format,
  ].filter((item): item is string => Boolean(item));
}

function BriefReviewOutput({
  brief,
  loading,
}: {
  brief: VideoBriefInput | null;
  loading: boolean;
}) {
  const [showAll, setShowAll] = useState(false);

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
  const visibleFields = showAll ? fields : fields.slice(0, 2);

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
        <>
          <dl className={styles.briefReviewFields}>
            {visibleFields.map(([label, value]) => (
              <div className={styles.briefReviewField} key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {fields.length > visibleFields.length ? (
            <button
              className={styles.disclosureButton}
              type="button"
              onClick={() => setShowAll(true)}
            >
              Show all brief details
            </button>
          ) : null}
        </>
      ) : null}
    </article>
  );
}

export function ReviewGatePanel({
  stageType,
  projectBrief,
  projectLoading,
  reviewItems,
  reviewOutputGroups,
  feedbackNote,
  pending,
  actionError,
  reviewActions,
  onFeedbackNoteChange,
  onApprove,
}: ReviewGatePanelProps) {
  const isBriefReviewGate = stageType === "brief_intake";

  return (
    <section className={styles.reviewPanel} aria-labelledby="review-gate-heading">
      <div className={styles.reviewIntro}>
        <span className={styles.reviewBadge}>Needs review</span>
        <h2 id="review-gate-heading" className={styles.reviewTitle}>
          {reviewHeading(stageType)}
        </h2>
        <p className={styles.reviewDescription}>{reviewDescription(stageType)}</p>
      </div>
      {isBriefReviewGate && (projectBrief || projectLoading) ? (
        <BriefReviewOutput brief={projectBrief} loading={projectLoading} />
      ) : reviewItems.length > 0 ? (
        <div className={styles.reviewOutputs}>
          <ReadonlyStoryboardBoard
            items={reviewOutputGroups.boardItems}
            title="Review the storyboard"
            description="Visual outputs from this checkpoint are grouped as beat tiles before the run continues."
          />
          {reviewOutputGroups.genericItems.length > 0 ? (
            <div className={`${progressStyles.itemGrid} ${styles.reviewOutputGrid}`}>
              {reviewOutputGroups.genericItems.map((item) => (
                <StageItemCard
                  key={item.itemId}
                  item={item}
                  allowInlineRegenerate={false}
                />
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
          onChange={(event) => onFeedbackNoteChange(event.target.value)}
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
  );
}
