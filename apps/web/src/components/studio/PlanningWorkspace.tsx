import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StudioPlanningBeatOutlineItem } from "@popcorn/shared/v1/studio-planning";
import type { StoryFormat } from "./useStudioFlow";
import type { StepProps } from "./useStudioFlow";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { LONG_VIDEO_PLANNING_REVIEW_THRESHOLD_SEC } from "../../lib/startRun";
import { formatOptions, platformOptions } from "./copy";
import { useStudioPlanningDecisionsQuery } from "./studioQueries";
import styles from "./PlanningWorkspace.module.css";

const formatLabels = new Map(formatOptions.map((option) => [option.value, option.label]));
const platformLabels = new Map(platformOptions.map((option) => [option.value, option.label]));
const AUTO_CONTINUE_DELAY_MS = 5_000;

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

function fallbackBeatOutline(draft: StepProps["draft"]): StudioPlanningBeatOutlineItem[] {
  const beats: StudioPlanningBeatOutlineItem[] = [];
  const hook = draft.hook.trim() || fallbackHook(draft.goal);
  if (hook) {
    beats.push({ id: "fallback_hook", label: "Hook", text: hook, role: "hook" });
  }
  if (draft.goal.trim()) {
    beats.push({ id: "fallback_context", label: "Context", text: draft.goal.trim() });
  }
  if (draft.bestVisual.trim()) {
    beats.push({
      id: "fallback_visual",
      label: "Visual proof",
      text: draft.bestVisual.trim(),
    });
  }
  if (draft.payoff.trim()) {
    beats.push({
      id: "fallback_payoff",
      label: "Payoff",
      text: draft.payoff.trim(),
      role: "payoff",
    });
  }
  return beats;
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
  const [autoContinueStopped, setAutoContinueStopped] = useState(false);
  const [autoContinueSeconds, setAutoContinueSeconds] = useState(
    AUTO_CONTINUE_DELAY_MS / 1_000,
  );
  const appliedDecisionRef = useRef(false);
  const appliedFallbackRef = useRef(false);
  const autoContinueStartedRef = useRef(false);
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
  const isLongVideo = draft.targetLengthSec > LONG_VIDEO_PLANNING_REVIEW_THRESHOLD_SEC;
  const hasMissingInputs = Boolean(preview?.source.missingInputs.length);
  const missingInputs = preview?.source.missingInputs ?? [];
  const visualSummary =
    visualValue.trim() ||
    generatedVisual ||
    "The agent will derive the visual direction from the brief and selected footage.";
  const hookSummary =
    hookValue.trim() ||
    generatedHook ||
    "The agent will open with the strongest hook it can infer from the brief.";
  const planBeats = useMemo(() => {
    if (preview?.beats?.length) return preview.beats;
    return fallbackBeatOutline(draft);
  }, [draft, preview?.beats]);
  const planMetadata = [
    formatLabels.get(draft.format),
    platformLabels.get(draft.platform) ?? draft.platform,
    `${draft.targetLengthSec}s`,
    draft.aspectRatio,
  ].filter(Boolean);
  const requiresPlanApproval = isLongVideo;

  const planIsReady = !planningQuery.isLoading && !planningQuery.isFetching;
  const planningStatus = useMemo(() => {
    if (!planIsReady) return "Agent is writing the plan";
    if (planningQuery.error) return "Draft plan ready";
    return "Plan ready";
  }, [planIsReady, planningQuery.error]);
  const canContinue = Boolean(draft.goal.trim()) && planIsReady && !submitting;

  const generate = useCallback(async () => {
    if (submitting) return;
    autoContinueStartedRef.current = true;
    setSubmitting(true);
    try {
      await onGenerate();
    } catch {
      // Flow surfaces the error below.
    } finally {
      setSubmitting(false);
    }
  }, [onGenerate, submitting]);

  function selectFormat(format: StoryFormat) {
    update({ format });
  }

  useEffect(() => {
    autoContinueStartedRef.current = false;
    setAutoContinueStopped(false);
    setAutoContinueSeconds(AUTO_CONTINUE_DELAY_MS / 1_000);
  }, [draft.goal, draft.targetLengthSec, draft.aspectRatio, draft.platform, draft.format]);

  useEffect(() => {
    if (!planIsReady || isLongVideo || autoContinueStopped || error || !canContinue) return;

    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      const remainingMs = Math.max(0, AUTO_CONTINUE_DELAY_MS - elapsedMs);
      setAutoContinueSeconds(Math.ceil(remainingMs / 1_000));
    }, 250);
    const timer = window.setTimeout(() => {
      setAutoContinueStopped(true);
      void generate();
    }, AUTO_CONTINUE_DELAY_MS);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timer);
    };
  }, [autoContinueStopped, canContinue, error, generate, isLongVideo, planIsReady]);

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{planningStatus}</p>
          <h2 className={styles.heading}>Plan</h2>
        </div>
        <div className={styles.headerActions}>
          <Button variant="secondary" onClick={onEditBrief}>
            Edit brief
          </Button>
          <Button variant="secondary" onClick={onEditFootage}>
            Edit footage
          </Button>
        </div>
      </header>

      <Card padding="lg" elevated className={styles.planCard}>
        <div className={styles.planHeader}>
          <div>
            <p className={styles.kicker}>Plan outline</p>
            <h3 className={styles.planTitle}>
              {draft.goal.trim() || "Draft video plan"}
            </h3>
          </div>
          <div className={styles.planMeta} aria-label="Plan metadata">
            {planMetadata.map((item) => (
              <span key={item}>{item}</span>
            ))}
            <span className={planIsReady ? styles.ready : styles.pending}>
              {planIsReady ? "Ready" : "Writing"}
            </span>
          </div>
        </div>
        {planBeats.length > 0 ? (
          <ol className={styles.beatList}>
            {planBeats.map((beat, index) => (
              <li className={styles.beatRow} key={beat.id}>
                <span className={styles.beatNumber}>{index + 1}</span>
                <div>
                  <div className={styles.beatLabelRow}>
                    <span className={styles.beatLabel}>{beat.label}</span>
                    {beat.role ? <span className={styles.beatRole}>{beat.role}</span> : null}
                  </div>
                  <p className={styles.beatText}>{beat.text}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.rationale}>
            Add a brief goal to generate the beat outline.
          </p>
        )}
        <div className={styles.planSections}>
          <section>
            <p className={styles.summaryLabel}>Opening hook</p>
            <p className={styles.summaryText}>{hookSummary}</p>
          </section>
          <section>
            <p className={styles.summaryLabel}>Visual direction</p>
            <p className={styles.summaryText}>{visualSummary}</p>
          </section>
        </div>

        <div className={styles.caveat}>
          <p className={styles.summaryLabel}>
            {hasMissingInputs ? "Missing inputs / caveats" : "Caveats"}
          </p>
          <p className={styles.summaryText}>
            {hasMissingInputs
              ? missingInputs.join(", ")
              : "No blocking inputs found. You can still revise the plan before production."}
          </p>
        </div>
        <div className={isLongVideo ? styles.approvalNotice : styles.autoNotice}>
          {isLongVideo ? (
            <p>
              This is longer than 30 seconds, so production will not start until you
              explicitly approve the plan.
            </p>
          ) : autoContinueStopped ? (
            <p>Auto-continue is stopped. Production will wait for your approval.</p>
          ) : planIsReady ? (
            <p>Production starts automatically in {autoContinueSeconds}s unless you stop here.</p>
          ) : (
            <p>Production will wait until the plan finishes.</p>
          )}
        </div>
      </Card>

      <div className={styles.grid}>
        <Card padding="lg" elevated className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.kicker}>Format</p>
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
              <h3 className={styles.panelTitle}>First moment</h3>
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
              <p className={styles.kicker}>Visual direction</p>
              <h3 className={styles.panelTitle}>Look and feel</h3>
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

      <Card padding="lg" elevated className={styles.boundaryCard}>
        <div>
          <p className={styles.kicker}>Stage boundary</p>
          <h3 className={styles.panelTitle}>
            {requiresPlanApproval ? "Approval required before production" : "Production can start next"}
          </h3>
          <p className={styles.rationale}>
            {requiresPlanApproval
              ? `This is a ${draft.targetLengthSec}-second video, so the run will stop after planning and wait for approval before image or video assets are generated.`
              : autoContinueStopped
                ? "Stopped at the plan. Continue whenever you are ready."
                : `The agent will continue to production in ${autoContinueSeconds}s unless you stop here.`}
          </p>
        </div>
        <div className={styles.boundaryActions}>
          {!requiresPlanApproval && !autoContinueStopped ? (
            <Button variant="secondary" onClick={() => setAutoContinueStopped(true)} disabled={submitting}>
              Stop here
            </Button>
          ) : null}
          <Button
            variant="cta"
            onClick={() => void generate()}
            disabled={!draft.goal.trim() || submitting}
            isLoading={submitting}
          >
            Continue to production
          </Button>
        </div>
      </Card>

      {planningQuery.error ? (
        <p className={styles.notice}>
          Planning service is not available yet. You can edit these decisions and continue.
        </p>
      ) : null}
      {error ? <p className="new-project-error">{error}</p> : null}

      <footer className={styles.footer}>
        <div className={styles.footerSecondary}>
          <Button variant="secondary" onClick={back}>
            Back
          </Button>
          <Button variant="secondary" onClick={onEditBrief}>
            Edit brief
          </Button>
          <Button variant="secondary" onClick={onEditFootage}>
            Edit footage
          </Button>
        </div>
        <Button
          variant="cta"
          onClick={() => void generate()}
          disabled={!canContinue}
          isLoading={submitting}
        >
          Produce
        </Button>
      </footer>
    </div>
  );
}
