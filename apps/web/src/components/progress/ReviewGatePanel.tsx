import {
  GENERATION_STAGE_LABELS,
  type GenerationStageItem,
  type GenerationStageType,
  type VideoBriefInput,
} from "@popcorn/shared/v1/types";
import type { ScriptDraft } from "@popcorn/shared/types";
import type { StoryBlueprintSnapshot } from "../../lib/api-client";
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
  onCancel: () => void;
}

interface ReviewGatePanelProps {
  stageType: GenerationStageType;
  projectBrief: VideoBriefInput | null;
  projectLoading: boolean;
  projectScript: ScriptDraft | null;
  projectStoryBlueprint?: StoryBlueprintSnapshot | null;
  projectStoryBlueprintId?: string | null;
  scriptStoryBlueprintId?: string | null;
  storyBlueprintLoading?: boolean;
  storyBlueprintError?: string | null;
  scriptOnly?: boolean;
  scriptLoading: boolean;
  scriptError?: string | null;
  reviewItems: GenerationStageItem[];
  reviewOutputGroups: ReviewOutputGroups;
  feedbackNote: string;
  pending?: "approve" | "reject" | "cancel";
  actionError?: string | null;
  reviewActions?: ReviewActions;
  onFeedbackNoteChange: (note: string) => void;
  onApprove: () => void;
  onRequestChanges: () => void;
  canRequestChanges: boolean;
}

const REVIEW_STAGE_LABELS: Partial<Record<GenerationStageType, string>> = {
  brief_intake: "Concept",
  creative_plan: "Brief",
  script: "Script",
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
  if (stageType === "script") return "Script ready for review";
  if (stageType === "storyboard") return "Plan ready for review";
  return `${reviewStageLabel(stageType)} ready for review`;
}

function reviewDescription(stageType: GenerationStageType, scriptOnly = false): string {
  if (stageType === "brief_intake") {
    return "Review the concept brief before the run continues to script generation.";
  }

  if (stageType === "storyboard") {
    return "Review the plan before the agent starts storyboard, keyframe, or clip generation. Stop here if you do not want the agent to keep producing from this boundary.";
  }

  if (stageType === "script") {
    if (scriptOnly) {
      return "Review the story outline and complete draft. This writing run ends when you approve it; no media production will start.";
    }
    return "Read the words and request any writing changes now. No poster, storyboard, image, audio, or video work starts until you approve this script.";
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

function splitBriefReviewFields(fields: [string, string][]) {
  const priority = new Set(["Hook", "Big idea"]);
  const visible = [
    ...fields.filter(([label]) => priority.has(label)),
    ...fields.filter(([label]) => !priority.has(label)),
  ].slice(0, 2);
  const visibleLabels = new Set(visible.map(([label]) => label));
  return {
    visible,
    hidden: fields.filter(([label]) => !visibleLabels.has(label)),
  };
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
  const { visible: visibleFields, hidden: hiddenFields } =
    splitBriefReviewFields(fields);

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
      {visibleFields.length > 0 ? (
        <dl className={styles.briefReviewFields}>
          {visibleFields.map(([label, value]) => (
            <div className={styles.briefReviewField} key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {hiddenFields.length > 0 ? (
        <details className={styles.briefReviewMore}>
          <summary>Show all</summary>
          <dl className={styles.briefReviewFields}>
            {hiddenFields.map(([label, value]) => (
              <div className={styles.briefReviewField} key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </article>
  );
}

function ScriptReviewOutput({
  script,
  loading,
}: {
  script: ScriptDraft | null;
  loading: boolean;
}) {
  if (loading) {
    return <div className={styles.briefReviewCard}>Loading script…</div>;
  }
  if (!script) {
    return (
      <div className={styles.reviewOutputEmpty} role="status">
        The script is still being selected. Refresh before approving.
      </div>
    );
  }
  const topLevelNarration = script.narration?.trim();
  const sceneNarration = script.scenes
    .map((scene) => scene.narration?.trim())
    .filter(Boolean)
    .join("\n\n");
  const showTopLevelNarration = Boolean(
    topLevelNarration && !sceneNarration.includes(topLevelNarration)
  );
  return (
    <article className={styles.briefReviewCard} aria-label="Script draft">
      <div className={styles.briefReviewMetaRow}>
        <span>{script.targetLengthSec} seconds</span>
        <span>{script.scenes.length} {script.scenes.length === 1 ? "scene" : "scenes"}</span>
        <span>{script.status}</span>
      </div>
      <h3 className={styles.briefReviewGoal}>Script</h3>
      <div className={styles.scriptCopy}>
        {showTopLevelNarration ? (
          <section>
            <h4>Narration</h4>
            <p>{topLevelNarration}</p>
          </section>
        ) : null}
        {script.scenes.map((scene) => (
          <section key={scene.id}>
            <h4>{scene.title}</h4>
            {scene.narration ? <p>{scene.narration}</p> : null}
            {scene.dialogue.map((line, index) => (
              <p key={`${scene.id}:${index}`}>
                {line.characterName ? <strong>{line.characterName}: </strong> : null}
                {line.text}
              </p>
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}

function StoryOutlineOutput({
  blueprint,
  loading,
}: {
  blueprint: StoryBlueprintSnapshot | null;
  loading: boolean;
}) {
  if (loading) return <div className={styles.briefReviewCard}>Loading story outline…</div>;
  if (!blueprint) return null;
  return (
    <article className={styles.briefReviewCard} aria-label="Story outline">
      <div className={styles.briefReviewMetaRow}>
        <span>Story outline</span>
        <span>{blueprint.scenes.length} plot points</span>
      </div>
      <h3 className={styles.briefReviewGoal}>{blueprint.logline}</h3>
      <p>{blueprint.premise}</p>
      <ol className={styles.scriptCopy}>
        {blueprint.scenes.map((scene) => (
          <li key={scene.id}>
            <strong>{scene.title}</strong>
            <p>{scene.summary}</p>
          </li>
        ))}
      </ol>
      <p><strong>Ending:</strong> {blueprint.ending}</p>
    </article>
  );
}

export function ReviewGatePanel({
  stageType,
  projectBrief,
  projectLoading,
  projectScript,
  projectStoryBlueprint,
  projectStoryBlueprintId,
  scriptStoryBlueprintId,
  storyBlueprintLoading,
  storyBlueprintError,
  scriptOnly,
  scriptLoading,
  scriptError,
  reviewItems,
  reviewOutputGroups,
  feedbackNote,
  pending,
  actionError,
  reviewActions,
  onFeedbackNoteChange,
  onApprove,
  onRequestChanges,
  canRequestChanges,
}: ReviewGatePanelProps) {
  const isBriefReviewGate = stageType === "brief_intake";
  const storyIdentityMismatch = Boolean(
    scriptOnly && projectStoryBlueprintId && scriptStoryBlueprintId &&
    projectStoryBlueprintId !== scriptStoryBlueprintId
  );
  const scriptReviewBlocked = stageType === "script" && (
    scriptLoading || Boolean(scriptError) || !projectScript ||
    Boolean(scriptOnly && (storyBlueprintLoading || storyBlueprintError || !projectStoryBlueprint || storyIdentityMismatch))
  );

  return (
    <section className={styles.reviewPanel} aria-labelledby="review-gate-heading">
      <div className={styles.reviewIntro}>
        <span className={styles.reviewBadge}>Needs review</span>
        <h2 id="review-gate-heading" className={styles.reviewTitle}>
          {reviewHeading(stageType)}
        </h2>
        <p className={styles.reviewDescription}>{reviewDescription(stageType, scriptOnly)}</p>
      </div>
      {stageType === "script" ? (
        scriptError || (scriptOnly && (storyBlueprintError || storyIdentityMismatch)) ? (
          <div className={styles.reviewOutputEmpty} role="alert">
            {storyIdentityMismatch
              ? "The script was written from an older story outline. Refresh or request a new draft before finishing."
              : "Could not load the complete outline and script for review. Refresh before finishing."}
          </div>
        ) : (
          <div className={styles.reviewOutputs}>
            {scriptOnly ? (
              <StoryOutlineOutput
                blueprint={projectStoryBlueprint ?? null}
                loading={Boolean(storyBlueprintLoading)}
              />
            ) : null}
            <ScriptReviewOutput script={projectScript} loading={scriptLoading} />
          </div>
        )
      ) : isBriefReviewGate && (projectBrief || projectLoading) ? (
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
          disabled={
            !!pending ||
            scriptReviewBlocked
          }
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
              onClick={onRequestChanges}
              disabled={!!pending || !canRequestChanges || scriptReviewBlocked}
              title={
                canRequestChanges
                  ? undefined
                  : "Open a specific generated object before requesting changes."
              }
            >
              Request changes
            </button>
            {!canRequestChanges ? (
              <span className={styles.feedbackHint}>
                {stageType === "script"
                  ? "Describe the script changes you want first."
                  : "Open a specific generated object to request changes safely."}
              </span>
            ) : null}
          </>
        ) : null}
        <button
          type="button"
          className={styles.primaryButton}
          onClick={onApprove}
          disabled={
            !!pending ||
            scriptReviewBlocked
          }
        >
          {pending === "approve"
            ? "Approving..."
            : stageType === "script"
              ? scriptOnly ? "Finish script" : "Approve script & continue"
              : "Approve and continue"}
        </button>
      </div>
    </section>
  );
}
