import type { StepProps } from "../useStudioFlow";
import { AdvancedDirection } from "../AdvancedDirection";
import { lengthOptions, studioCopy } from "../copy";
import { StepShell } from "./StepShell";
import styles from "./BriefStep.module.css";

interface BriefStepProps extends StepProps {
  openPanel?: string;
}

function confirmLongVideoLength(seconds: number) {
  if (seconds <= 30) return true;
  if (typeof window === "undefined") return true;
  return window.confirm("This could cost a lot.\nDo you want to continue?");
}

const promptChips = [
  {
    label: "Product launch video",
    targetLengthSec: 60,
    prompt:
      "Make a 60-second product launch video for Popcorn Ready that shows the before-and-after of turning raw clips into a polished trailer.",
  },
  {
    label: "Social ad",
    targetLengthSec: 30,
    prompt:
      "Create a punchy 30-second social ad with a clear hook, fast pacing, and a simple call to action for new creators.",
  },
  {
    label: "Customer story",
    targetLengthSec: 60,
    prompt:
      "Tell a customer story that starts with a messy editing workflow and ends with a finished, shareable video.",
  },
  {
    label: "Event recap",
    targetLengthSec: 60,
    prompt:
      "Make an energetic event recap that uses the strongest crowd moments, speaker highlights, and sponsor message.",
  },
];

export function BriefStep({ draft, update, next, openPanel }: BriefStepProps) {
  return (
    <StepShell
      heading={studioCopy.brief.heading}
      description={studioCopy.brief.description}
      onNext={next}
      nextCta
      nextLabel="Continue →"
      nextDisabled={!draft.goal.trim()}
      stage
    >
      <div className={styles.form}>
        <label className={styles.field}>
          <span className={styles.label}>{studioCopy.brief.goalLabel}</span>
          <textarea
            className={styles.goal}
            value={draft.goal}
            placeholder={studioCopy.brief.goalPlaceholder}
            onChange={(event) => update({ goal: event.target.value })}
          />
        </label>

        <div className={styles.promptChips} aria-label="Prompt examples">
          {promptChips.map((chip) => (
            <button
              className={styles.promptChip}
              type="button"
              key={chip.label}
              onClick={() =>
                update({
                  goal: chip.prompt,
                  targetLengthSec: chip.targetLengthSec,
                })
              }
            >
              {chip.label}
            </button>
          ))}
        </div>

        <fieldset className={styles.field}>
          <legend className={styles.label}>{studioCopy.brief.lengthLabel}</legend>
          <div className={styles.segmented}>
            {lengthOptions.map((option) => (
              <label className={styles.option} key={option.value}>
                <input
                  className={styles.optionInput}
                  type="radio"
                  name="brief-length"
                  checked={draft.targetLengthSec === option.value}
                  onChange={() => {
                    if (confirmLongVideoLength(option.value)) {
                      update({ targetLengthSec: option.value });
                    }
                  }}
                />
                <span className={styles.optionLabel}>
                  <span className={styles.optionValue}>{option.label}</span>
                  <span className={styles.optionDescription}>{option.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <p className={styles.advancedHint}>
          Style, tone, pacing, format, references, constraints.
        </p>
        <AdvancedDirection
          draft={draft}
          update={update}
          defaultOpen={openPanel === "advanced"}
        />
      </div>
    </StepShell>
  );
}
