"use client";

import type { GenerationRun } from "@popcorn/shared/v1/types";
import { Button, ButtonLink } from "../ui/Button";
import { terminalRecoveryMode } from "./terminalRecovery";
import { formatElapsed, useElapsedTime } from "./useElapsedTime";
import styles from "./TerminalState.module.css";

interface TerminalStateProps {
  run: GenerationRun;
  creditRecovery?: {
    balanceCredits: number;
    pending?: boolean;
    onContinue: () => void;
  };
}

export function TerminalState({ run, creditRecovery }: TerminalStateProps) {
  const elapsed = useElapsedTime(run.startedAt, run.completedAt);

  if (run.status === "succeeded") {
    const storyboardAssetsReady = run.completionKind === "storyboard_assets";
    const videoReady = run.completionKind === "video";
    const standaloneAssetReady = run.completionKind === "standalone_asset";
    const scriptReady = run.completionKind === "script";

    return (
      <div className="terminal-state terminal-succeeded" role="status">
        <div className="terminal-state-head">
          <span className="terminal-state-glyph" aria-hidden>✓</span>
          <span className="terminal-state-heading">
            {videoReady
              ? "Your video is ready"
              : scriptReady
                ? "Your script is ready"
              : standaloneAssetReady
                ? "Your asset is ready"
              : storyboardAssetsReady
                ? "Storyboard assets are ready"
                : "Run ended without a playable video"}
          </span>
        </div>
        <p className="terminal-state-message">
          {run.message ??
            (videoReady
              ? "Generation finished. The final preview is available below."
              : scriptReady
                ? "Your story outline and approved script are saved to the project."
              : standaloneAssetReady
                ? "Generation finished. The asset is available in the project library."
              : storyboardAssetsReady
              ? "Generation stopped after creating the storyboard and keyframe images."
              : "The run ended, but no verified playable video output was reported.")}
        </p>
        {elapsed !== null ? (
          <p className="terminal-state-meta">
            Completed in {formatElapsed(elapsed)}.
          </p>
        ) : null}
        {scriptReady ? (
          <div className={styles.scriptActions}>
            <ButtonLink variant="secondary" size="sm" to={`/projects/${run.projectId}`}>
              Open script
            </ButtonLink>
          </div>
        ) : null}
      </div>
    );
  }

  if (run.status === "failed") {
    const missingVideo = run.error?.code === "missing_video_output";
    const recoveryMode = terminalRecoveryMode(run.error, Boolean(creditRecovery));
    return (
      <div className="terminal-state terminal-failed" role="alert">
        <div className="terminal-state-head">
          <span className="terminal-state-glyph" aria-hidden>!</span>
          <span className="terminal-state-heading">
            {missingVideo ? "Run ended without a playable video" : "Generation failed"}
          </span>
        </div>
        <p className="terminal-state-message">
          {run.error?.message ??
            run.message ??
            "Something went wrong while generating your video."}
        </p>
        {run.error?.code ? (
          <p className="terminal-state-meta">
            Error: <code>{run.error.code}</code>
            {elapsed !== null ? ` · Stopped after ${formatElapsed(elapsed)}.` : null}
          </p>
        ) : elapsed !== null ? (
          <p className="terminal-state-meta">
            Stopped after {formatElapsed(elapsed)}.
          </p>
        ) : null}
        {recoveryMode === "request_changes" ? (
          <p className="terminal-state-meta muted">
            Open the project to request changes.
          </p>
        ) : null}
        {recoveryMode === "continue_after_credit" && creditRecovery ? (
          <div className={styles.creditRecovery}>
            <p className="terminal-state-meta">
              Your balance is now {creditRecovery.balanceCredits.toLocaleString()} credits. Continue from
              the failed step without regenerating completed assets.
            </p>
            <Button
              variant="secondary"
              size="sm"
              isLoading={creditRecovery.pending}
              onClick={creditRecovery.onContinue}
            >
              Continue generation
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  if (run.status === "canceled") {
    return (
      <div className="terminal-state terminal-canceled" role="status">
        <div className="terminal-state-head">
          <span className="terminal-state-glyph" aria-hidden>—</span>
          <span className="terminal-state-heading">Run canceled</span>
        </div>
        <p className="terminal-state-message">
          {run.message ?? "This generation run was canceled."}
        </p>
        {elapsed !== null ? (
          <p className="terminal-state-meta">
            Stopped after {formatElapsed(elapsed)}.
          </p>
        ) : null}
      </div>
    );
  }

  return null;
}
