import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { AssetCritiqueDialog } from "../components/ai-edit/AssetCritiqueDialog";
import { AnonymousUpgradeBanner } from "../components/auth/AnonymousUpgradeBanner";
import { QuickLoadingState } from "../components/ui/QuickLoadingState";
import { Button, ButtonLink } from "../components/ui/Button";
import { useProjectWatchQuery } from "../lib/project-queries";
import styles from "./ProjectWatchPage.module.css";

export function ProjectWatchPage() {
  const { projectId } = useParams();
  const watchQuery = useProjectWatchQuery(projectId ?? null);
  const media = watchQuery.data?.media ?? null;
  const [critiqueOpen, setCritiqueOpen] = useState(false);
  const error =
    watchQuery.error instanceof Error
      ? watchQuery.error
      : watchQuery.error
        ? new Error(String(watchQuery.error))
        : null;

  if (!projectId) return <Navigate to="/library/projects" replace />;
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <Link className={styles.backLink} to="/library/projects">
            Library
          </Link>
          <h1>{media?.projectName ?? "Watch project"}</h1>
          {media ? (
            <p>
              {media.filename}
              {formatDuration(media.durationSec)
                ? ` - ${formatDuration(media.durationSec)}`
                : ""}
            </p>
          ) : watchQuery.isLoading ? (
            <p>Loading the selected render.</p>
          ) : (
            <p>No playable video is available for this project.</p>
          )}
        </div>
        <ButtonLink
          variant="secondary"
          to={`/projects/${encodeURIComponent(projectId)}#runs`}
        >
          Open workspace
        </ButtonLink>
      </header>

      <AnonymousUpgradeBanner />

      {watchQuery.isLoading ? (
        <section className={styles.panel}>
          <QuickLoadingState
            title="Loading render"
            description="Preparing the selected project video."
            reservation={<div className={styles.placeholder} />}
            showCompactWithReservation
            variant="panel"
          />
        </section>
      ) : null}

      {error ? (
        <section className={styles.panel}>
          <div className={styles.placeholder}>
            <strong>Unable to load this render.</strong>
            <span>{error.message}</span>
          </div>
        </section>
      ) : null}

      {!watchQuery.isLoading && !error && !media ? (
        <section className={styles.panel} aria-label="No video output">
          <div className={styles.placeholder} role="status">
            <strong>No playable video is available.</strong>
            <span>Open the workspace to review available assets or continue the run.</span>
          </div>
        </section>
      ) : null}

      {media ? (
        <section className={styles.panel} aria-label="Project render">
          <video
            className={styles.video}
            src={media.url}
            poster={media.posterUrl}
            controls
            playsInline
            preload="metadata"
            autoFocus
          />
          <div className={styles.videoActions}>
            <Button variant="secondary" onClick={() => setCritiqueOpen(true)}>
              Receive feedback
            </Button>
            <span>Ask the AI to review this final video without changing it.</span>
          </div>
        </section>
      ) : null}
      <AssetCritiqueDialog
        open={critiqueOpen}
        projectId={projectId}
        assetId={media?.assetId ?? ""}
        title="Review this video"
        subtitle={media?.filename ?? null}
        preview={
          media ? (
            <video src={media.url} poster={media.posterUrl} controls playsInline preload="metadata" />
          ) : null
        }
        onClose={() => setCritiqueOpen(false)}
      />
    </main>
  );
}

function formatDuration(seconds?: number) {
  if (!Number.isFinite(seconds)) return null;
  const totalSeconds = Math.max(0, Math.round(seconds ?? 0));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
