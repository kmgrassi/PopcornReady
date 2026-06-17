import { useEffect, useMemo, useRef, useState } from "react";
import type { StoryFormat } from "./useStudioFlow";
import type { StepProps } from "./useStudioFlow";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { formatOptions } from "./copy";
import { useStudioPlanningDecisionsQuery } from "./studioQueries";
import styles from "./PlanningWorkspace.module.css";

const formatLabels = new Map(formatOptions.map((option) => [option.value, option.label]));

function fallbackHook(goal: string): string {
  const trimmed = goal.trim();
  if (!trimmed) return "";
  const firstSentence = trimmed.split(/[.!?]/)[0]?.trim() || trimmed;
  return firstSentence.endsWith("?") ? firstSentence : `What if ${firstSentence}?`;
}

function posterStatusLabel({
  backgroundReady,
  status,
}: {
  backgroundReady: boolean;
  status?: string;
}) {
  if (backgroundReady || status === "ready_for_background") return "Ready";
  return "Loading";
}

export interface PlanningWorkspaceProps extends StepProps {
  error?: string;
  onGenerate: () => Promise<void>;
  onEditBrief: () => void;
  onEditFootage: () => void;
}

export function PlanningWorkspace({
  draft,
  update,
  back,
  error,
  onGenerate,
  onEditBrief,
  onEditFootage,
}: PlanningWorkspaceProps) {
  const [submitting, setSubmitting] = useState(false);
  const appliedDecisionRef = useRef(false);
  const appliedFallbackRef = useRef(false);
  const hookTouchedRef = useRef(false);
  const visualTouchedRef = useRef(false);
  const planningQuery = useStudioPlanningDecisionsQuery(draft, Boolean(draft.goal.trim()));
  const preview = planningQuery.data?.preview;

  const generatedFormat = preview?.storyDirection.format;
  const generatedHook = preview?.openingHook.trim();
  const generatedVisual = preview?.poster.visualDirection.trim();
  const posterReady = Boolean(preview?.poster.backgroundReady);
  const posterStatus = preview?.poster.status;

  useEffect(() => {
    if (!preview || appliedDecisionRef.current) return;
    const patch: Partial<typeof draft> = {};
    if (generatedFormat && generatedFormat !== draft.format) {
      patch.format = generatedFormat;
    }
    if (!hookTouchedRef.current && !draft.hook.trim() && generatedHook) {
      patch.hook = generatedHook;
    }
    if (
      posterReady &&
      !visualTouchedRef.current &&
      !draft.bestVisual.trim() &&
      generatedVisual
    ) {
      patch.bestVisual = generatedVisual;
    }
    if (Object.keys(patch).length > 0) update(patch);
    appliedDecisionRef.current = true;
  }, [preview, draft, generatedFormat, generatedHook, generatedVisual, posterReady, update]);

  useEffect(() => {
    if (preview || appliedFallbackRef.current || hookTouchedRef.current || draft.hook.trim()) {
      return;
    }
    const hook = fallbackHook(draft.goal);
    if (!hook) return;
    update({ hook });
    appliedFallbackRef.current = true;
  }, [draft.goal, draft.hook, preview, update]);

  const hookValue = draft.hook;
  const visualValue = draft.bestVisual;
  const storyReady = Boolean(draft.format);
  const hookReady = Boolean(hookValue.trim());

  const planningStatus = useMemo(() => {
    if (planningQuery.isLoading || planningQuery.isFetching) return "Planning";
    if (planningQuery.error) return "Draft ready";
    return "Ready";
  }, [planningQuery.error, planningQuery.isFetching, planningQuery.isLoading]);

  async function generate() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onGenerate();
    } catch {
      // Flow surfaces the error below.
    } finally {
      setSubmitting(false);
    }
  }

  function selectFormat(format: StoryFormat) {
    update({ format });
  }

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{planningStatus}</p>
          <h2 className={styles.heading}>Planning decisions</h2>
        </div>
        <div className={styles.headerActions}>
          <Button variant="secondary" onClick={onEditBrief}>
            Brief
          </Button>
          <Button variant="secondary" onClick={onEditFootage}>
            Footage
          </Button>
        </div>
      </header>

      <div className={styles.grid}>
        <Card padding="lg" elevated className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.kicker}>Story direction</p>
              <h3 className={styles.panelTitle}>
                {formatLabels.get(draft.format) ?? "Story direction"}
              </h3>
            </div>
            <span className={styles.ready}>{storyReady ? "Ready" : "Loading"}</span>
          </div>
          <div className={styles.formatGrid}>
            {formatOptions.map((option) => (
              <label className={styles.formatOption} key={option.value}>
                <input
                  type="radio"
                  name="planning-format"
                  checked={draft.format === option.value}
                  onChange={() => selectFormat(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          {preview?.storyDirection.rationale ? (
            <p className={styles.rationale}>{preview.storyDirection.rationale}</p>
          ) : null}
        </Card>

        <Card padding="lg" elevated className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.kicker}>Opening hook</p>
              <h3 className={styles.panelTitle}>First beat</h3>
            </div>
            <span className={styles.ready}>{hookReady ? "Ready" : "Loading"}</span>
          </div>
          <textarea
            className={styles.textarea}
            rows={5}
            value={hookValue}
            placeholder="Opening hook"
            onChange={(event) => {
              hookTouchedRef.current = true;
              update({ hook: event.target.value });
            }}
          />
          {preview?.source.missingInputs.length ? (
            <p className={styles.rationale}>
              Missing: {preview.source.missingInputs.join(", ")}
            </p>
          ) : null}
        </Card>

        <Card padding="lg" elevated className={`${styles.panel} ${styles.visualPanel}`}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.kicker}>Poster / visual</p>
              <h3 className={styles.panelTitle}>High-level visual</h3>
            </div>
            <span className={posterReady ? styles.ready : styles.pending}>
              {posterStatusLabel({ backgroundReady: posterReady, status: posterStatus })}
            </span>
          </div>
          <div className={styles.posterPending} aria-hidden="true" />
          <textarea
            className={styles.textarea}
            rows={4}
            value={visualValue}
            placeholder="Visual direction will appear here."
            onChange={(event) => {
              visualTouchedRef.current = true;
              update({ bestVisual: event.target.value });
            }}
          />
          {preview?.poster.reason ? (
            <p className={styles.rationale}>{preview.poster.reason}</p>
          ) : null}
        </Card>
      </div>

      {planningQuery.error ? (
        <p className={styles.notice}>
          Planning service is not available yet. You can edit these decisions and continue.
        </p>
      ) : null}
      {error ? <p className="new-project-error">{error}</p> : null}

      <footer className={styles.footer}>
        <Button variant="secondary" onClick={back}>
          Back
        </Button>
        <Button
          variant="cta"
          onClick={() => void generate()}
          disabled={!draft.goal.trim() || submitting}
          isLoading={submitting}
        >
          Start generating
        </Button>
      </footer>
    </div>
  );
}
