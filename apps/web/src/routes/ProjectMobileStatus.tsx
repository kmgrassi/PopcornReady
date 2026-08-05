import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  ProjectStoryboard,
  StoryboardPanel,
  V1Project,
} from "@popcorn/shared/v1/types";
import { AssetImage } from "../components/media/AssetImage";
import { Button, ButtonLink } from "../components/ui/Button";
import { ImageWithSkeleton } from "../components/ui/ImageWithSkeleton";
import type { ProjectWatchMedia } from "../lib/api-client";
import type { StoryboardProgress } from "../lib/v1/storyboard/progress";
import { assetLibraryPath } from "../lib/assetLibraryPath";
import { ProjectPoster } from "./ProjectDetailSections";
import styles from "./ProjectMobileStatus.module.css";

export function MobileProjectStatus({
  project,
  projectId,
  storyboard,
  storyboardProgressState,
  storyboardGenerating,
  storyboardError,
  readOnly,
  media,
  status,
  primaryAction,
  runLink,
}: {
  project: V1Project;
  projectId: string;
  storyboard: ProjectStoryboard | null;
  storyboardProgressState: StoryboardProgress;
  storyboardGenerating: boolean;
  storyboardError: Error | null;
  readOnly: boolean;
  media?: ProjectWatchMedia | null;
  status?: string;
  primaryAction?: ReactNode;
  runLink?: string | null;
}) {
  const brief = project.brief;
  const title = brief?.oneBigIdea ?? brief?.goal ?? project.name;
  const sceneCount = storyboard?.scenes.length ?? 0;
  const momentCount =
    storyboard?.scenes.reduce((total, scene) => total + scene.beats.length, 0) ?? 0;

  return (
    <section className={styles.mobileProjectStatus} aria-label="Project status">
      <MobileProjectHero
        project={project}
        storyboard={storyboard}
        media={media}
        readOnly={readOnly}
      />
      <div className={styles.mobileStatusCard}>
        <div className={styles.mobileStatusText}>
          <span className={styles.eyebrow}>Project</span>
          <h2>{title}</h2>
          <p>
            {status ??
              mobileProjectStatus({
                storyboard,
                progress: storyboardProgressState,
                generating: storyboardGenerating,
                hasPlayableOutput: Boolean(media),
                projectStatus: project.status,
                storyboardError,
              })}
          </p>
        </div>
        <div
          className={styles.mobileProgressTrack}
          role="progressbar"
          aria-label="Storyboard progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={storyboardProgressState.percent}
        >
          <span style={{ width: `${storyboardProgressState.percent}%` }} />
        </div>
        {primaryAction ? <div className={styles.mobilePrimaryAction}>{primaryAction}</div> : null}
      </div>

      <div className={styles.mobileDisclosureList}>
        <details className={styles.mobileDisclosure}>
          <summary>
            <span>Storyboard</span>
            <strong>
              {sceneCount > 0
                ? `${sceneCount} ${sceneCount === 1 ? "scene" : "scenes"}`
                : "Not started"}
            </strong>
          </summary>
          <p>
            {momentCount > 0
              ? `${momentCount} ${momentCount === 1 ? "moment" : "moments"} are ready to review.`
              : "The agent plans scenes and moments before drawing storyboard panels."}
          </p>
          {!readOnly && storyboard ? (
            <ButtonLink
              variant="secondary"
              size="sm"
              to={`/projects/${encodeURIComponent(projectId)}/storyboard`}
            >
              Open storyboard
            </ButtonLink>
          ) : null}
        </details>
        <details className={styles.mobileDisclosure}>
          <summary>
            <span>Direction</span>
            <strong>{brief?.format ?? brief?.platform ?? "Brief"}</strong>
          </summary>
          {brief?.hookQuestion ? <p>{brief.hookQuestion}</p> : null}
          {brief?.strongestVisual ? <p>{brief.strongestVisual}</p> : null}
          {!readOnly ? (
            <div className={styles.mobileDisclosureActions}>
              <ButtonLink
                variant="secondary"
                size="sm"
                to={`/projects/${encodeURIComponent(projectId)}/brief`}
              >
                Open brief
              </ButtonLink>
              <ButtonLink
                variant="ghost"
                size="sm"
                to={`/projects/${encodeURIComponent(projectId)}/script`}
              >
                Script
              </ButtonLink>
            </div>
          ) : null}
        </details>
        {!readOnly ? (
          <details className={styles.mobileDisclosure} id="mobile-stages">
            <summary>
              <span>Stages</span>
              <strong>{storyboardGenerating ? "In progress" : runLink ? "Latest run" : "Waiting"}</strong>
            </summary>
            <p>
              Pipeline details stay one tap away so the main screen stays focused on the next step.
            </p>
            {runLink ? (
              <ButtonLink variant="secondary" size="sm" to={runLink}>
                View stages
              </ButtonLink>
            ) : null}
          </details>
        ) : null}
      </div>
    </section>
  );
}

function MobileProjectHero({
  project,
  storyboard,
  media,
  readOnly,
}: {
  project: V1Project;
  storyboard: ProjectStoryboard | null;
  media?: ProjectWatchMedia | null;
  readOnly: boolean;
}) {
  const navigate = useNavigate();
  const panel = latestStoryboardPanel(storyboard);
  if (panel) {
    const assetPath = !readOnly && panel.imageAssetId
      ? assetLibraryPath(panel.imageAssetId, project.id)
      : null;
    return (
      <AssetImage
        kind="image"
        url={panel.thumbnailUrl ?? panel.url}
        assetId={panel.imageAssetId ?? null}
        prompt={panel.prompt ?? null}
        status={panel.status}
        mediaClassName={styles.mobileHeroImage}
        placeholderClassName={`${styles.mobileHeroImage} ${styles.posterEmpty}`}
        alt={assetPath ? `View ${project.name} storyboard asset` : ""}
        onActivate={assetPath ? () => navigate(assetPath) : undefined}
        activateClassName={styles.mobileHeroButton}
      />
    );
  }
  if (media?.posterUrl) {
    return (
      <ImageWithSkeleton
        className={styles.mobileHeroImage}
        src={media.posterUrl}
        alt=""
      />
    );
  }
  const poster = (
    <ProjectPoster
      name={project.name}
      posterUrl={project.posterUrl}
      className={styles.mobileHeroImage}
      emptyClassName={styles.posterEmpty}
    />
  );
  if (!readOnly && project.posterAssetId) {
    return (
      <Link
        className={styles.mobileHeroLink}
        to={assetLibraryPath(project.posterAssetId, project.id)}
        aria-label={`View ${project.name} poster asset`}
      >
        {poster}
      </Link>
    );
  }
  return poster;
}

export function ProjectMobilePrimaryAction({
  projectId,
  hasPlayableOutput,
  watchDisabled,
  watchTitle,
  storyboard,
  storyboardGenerating,
  storyboardError,
  scriptReviewRunLink,
  hasBrief,
  canGenerateStoryboard,
  onGenerate,
}: {
  projectId: string;
  hasPlayableOutput: boolean;
  watchDisabled: boolean;
  watchTitle: string;
  storyboard: ProjectStoryboard | null;
  storyboardGenerating: boolean;
  storyboardError: Error | null;
  scriptReviewRunLink?: string | null;
  hasBrief: boolean;
  canGenerateStoryboard: boolean;
  onGenerate: () => void;
}) {
  if (storyboardError) {
    return (
      <Button variant="cta" fullWidth onClick={onGenerate}>
        Retry storyboard workflow
      </Button>
    );
  }
  if (scriptReviewRunLink) {
    return (
      <ButtonLink variant="cta" fullWidth to={scriptReviewRunLink}>
        Review script
      </ButtonLink>
    );
  }
  if (storyboardGenerating) {
    return (
      <ButtonLink variant="cta" fullWidth to="#mobile-stages">
        View stages
      </ButtonLink>
    );
  }
  if (hasPlayableOutput) {
    return (
      <ButtonLink
        variant="cta"
        fullWidth
        to={`/projects/${encodeURIComponent(projectId)}/watch`}
        aria-disabled={watchDisabled}
        title={watchTitle}
      >
        Watch
      </ButtonLink>
    );
  }
  if (storyboard) {
    return (
      <ButtonLink
        variant="cta"
        fullWidth
        to={`/projects/${encodeURIComponent(projectId)}/storyboard`}
      >
        Review storyboard
      </ButtonLink>
    );
  }
  if (!hasBrief) {
    return (
      <ButtonLink
        variant="cta"
        fullWidth
        to={`/projects/${encodeURIComponent(projectId)}/brief`}
      >
        Finish brief
      </ButtonLink>
    );
  }
  return (
    <Button
      variant="cta"
      fullWidth
      disabled={!canGenerateStoryboard}
      onClick={onGenerate}
    >
      Create storyboard
    </Button>
  );
}

export function mobileProjectStatus({
  storyboard,
  progress,
  generating,
  hasPlayableOutput,
  hasBrief = true,
  projectStatus,
  storyboardError,
  scriptReviewPending = false,
}: {
  storyboard: ProjectStoryboard | null;
  progress: StoryboardProgress;
  generating: boolean;
  hasPlayableOutput: boolean;
  hasBrief?: boolean;
  projectStatus?: string;
  storyboardError?: Error | null;
  scriptReviewPending?: boolean;
}) {
  if (storyboardError) return "Storyboard could not load. Retry to continue.";
  if (scriptReviewPending) return "Script ready for review.";
  if (generating) {
    if (progress.total > 0) {
      return `Generating storyboard: ${progress.ready + progress.failed} of ${progress.total} panels ready.`;
    }
    return "Generating storyboard: preparing scenes.";
  }
  if (hasPlayableOutput) return "Ready to watch.";
  if (storyboard) {
    const sceneCount = storyboard.scenes.length;
    return `Storyboard ready: ${sceneCount} ${sceneCount === 1 ? "scene" : "scenes"} to review.`;
  }
  if (projectStatus === "failed") return "Needs attention before generation can continue.";
  if (!hasBrief) return "Finish the brief to create a storyboard.";
  return "Ready for a storyboard.";
}

function latestStoryboardPanel(storyboard: ProjectStoryboard | null): StoryboardPanel | null {
  if (!storyboard) return null;
  const panels = storyboard.scenes.flatMap((scene) =>
    scene.beats.flatMap((beat) => beat.panels),
  );
  return (
    panels.find((panel) => {
      const hasUrl = Boolean(panel.thumbnailUrl ?? panel.url);
      const isReady = panel.status === "approved" || panel.status === "ready";
      return hasUrl && isReady;
    }) ??
    panels.find((panel) => Boolean(panel.thumbnailUrl ?? panel.url)) ??
    null
  );
}
