import { Stepper } from "../ui/Stepper";
import { STUDIO_SETUP_STEPS, type StudioStep } from "./studioSteps";

/** Human labels for the wizard steps shown in the rail. */
const STEP_LABELS: Record<StudioStep, string> = {
  brief: "Idea",
  footage: "Footage",
  plan: "Production Plan",
  story: "Story",
  generate: "Produce",
  review: "Review",
  export: "Export",
};

const STEP_SUBTITLES: Partial<Record<StudioStep, string>> = {
  brief: "Goal + length",
  footage: "Upload or choose clips",
  plan: "Review the agent's plan",
};

const STEPPER_STEPS = STUDIO_SETUP_STEPS.map((id) => ({
  id,
  label: STEP_LABELS[id],
  subtitle: STEP_SUBTITLES[id],
}));

export interface StudioStepperProps {
  /** The currently active step. */
  step: StudioStep;
  /** Jump to a completed/active step (steps after the active one stay inert). */
  onStepClick?: (step: StudioStep) => void;
  /** Allow direct navigation through a specific step, even if it is upcoming. */
  clickableThroughStep?: StudioStep;
}

/**
 * StudioStepper — thin wrapper over the PR 0 `Stepper` that translates the
 * `StudioStep` vocabulary into the presentational step list. Keeps the step
 * labels in one place so steps stay consistent across the shell.
 */
export function StudioStepper({
  step,
  onStepClick,
  clickableThroughStep,
}: StudioStepperProps) {
  const setupStep = STUDIO_SETUP_STEPS.includes(step) ? step : "plan";
  const activeIndex = Math.max(
    0,
    STUDIO_SETUP_STEPS.indexOf(setupStep),
  );
  const clickableThroughIndex = clickableThroughStep
    ? STUDIO_SETUP_STEPS.indexOf(
        STUDIO_SETUP_STEPS.includes(clickableThroughStep)
          ? clickableThroughStep
          : "plan",
      )
    : activeIndex;
  return (
    <Stepper
      steps={STEPPER_STEPS}
      activeIndex={activeIndex}
      clickableThroughIndex={clickableThroughIndex}
      onStepClick={
        onStepClick
          ? (index) => onStepClick(STUDIO_SETUP_STEPS[index])
          : undefined
      }
    />
  );
}
