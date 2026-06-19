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

export function BriefStep({ draft, update, next, openPanel }: BriefStepProps) {
  return (
    <StepShell
      heading={studioCopy.brief.heading}
      description={studioCopy.brief.description}
      onNext={next}
      nextCta
      nextDisabled={!draft.goal.trim()}
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
                <span className={styles.optionLabel}>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <AdvancedDirection
          draft={draft}
          update={update}
          defaultOpen={openPanel === "advanced"}
        />
      </div>
    </StepShell>
  );
}
