import { useState } from "react";
import type { StepProps } from "../useStudioFlow";
import { StepShell } from "./StepShell";
import styles from "./GenerateStep.module.css";

export interface GenerateStepProps extends StepProps {
  /** Kicks the create-project + start-run flow on the shell's StudioFlow. */
  onGenerate: () => Promise<void>;
  /** Jumps back to the editable brief fields from the generate summary. */
  onEditBrief: () => void;
  /** Surfaced when the last start attempt failed. */
  error?: string;
  /** Optional panel key the route/palette should open by default. */
  openPanel?: string;
}

/**
 * GenerateStep — step 4. The creator starts the autonomous planning pass here;
 * every run then pauses at the storyboard before any production media is made.
 */
export function GenerateStep({
  draft,
  onGenerate,
  onEditBrief,
  error,
  back,
}: GenerateStepProps) {
  const [submitting, setSubmitting] = useState(false);
  const [goalExpanded, setGoalExpanded] = useState(false);
  const goal = draft.goal.trim();

  async function generate() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onGenerate();
    } catch {
      // Error is surfaced via the `error` prop from the flow.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <StepShell
      wide
      heading="Create your storyboard"
      description="The agent will develop the visual plan, then wait for you to review it before it makes the video."
      onBack={back}
      onNext={generate}
      nextLabel={submitting ? "Creating storyboard..." : "Create storyboard"}
      nextDisabled={!draft.goal.trim() || submitting}
      nextCta
    >
      <section className={styles.summarySection} aria-labelledby="checkpoint-summary-heading">
        <div>
          <h3 id="checkpoint-summary-heading" className={styles.sectionTitle}>
            Run summary
          </h3>
          <p className={styles.sectionHelp}>
            Confirm the brief the agent will use before it starts generating.
          </p>
        </div>
        <div className={styles.summary}>
          <div className={styles.summaryItem}>
            <div className={styles.summaryHeading}>
              <span>Goal</span>
              <button className={styles.editButton} type="button" onClick={onEditBrief}>
                Edit
              </button>
            </div>
            <button
              className={`${styles.goalText} ${goalExpanded ? styles.goalTextExpanded : ""}`}
              type="button"
              aria-expanded={goalExpanded}
              onClick={() => setGoalExpanded((expanded) => !expanded)}
            >
              {goal || "—"}
            </button>
          </div>
          <div className={styles.summaryItem}>
            <span>Format</span>
            <strong>
              {draft.aspectRatio}, {draft.targetLengthSec}s
            </strong>
          </div>
          <div className={styles.summaryItem}>
            <span>Source</span>
            <strong>{draft.footageChoice === "upload" ? "Your footage" : "Prompt only"}</strong>
          </div>
        </div>
      </section>
      <aside className={styles.nextStep} aria-label="What happens next">
        <span className={styles.nextStepIcon} aria-hidden="true">
          i
        </span>
        <div>
          <h3>What happens when you start?</h3>
          <p>
            We'll create the project, develop its scenes and shots, and generate the visual
            storyboard. You'll review that plan before any photoreal frames, motion, sound,
            or editing begins.
          </p>
        </div>
      </aside>
      {error ? <p className="new-project-error">{error}</p> : null}
    </StepShell>
  );
}
