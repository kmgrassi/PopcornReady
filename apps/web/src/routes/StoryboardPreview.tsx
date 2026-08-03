import { Link } from "react-router-dom";
import type {
  ProjectStoryboard,
  StoryboardBeat,
  StoryboardPanel,
  StoryboardScene,
} from "@popcorn/shared/v1/types";
import { AssetImage } from "../components/media/AssetImage";
import { Button, ButtonLink } from "../components/ui/Button";
import { Spinner } from "../components/ui/Spinner";
import { EmptyState, ErrorState } from "../components/ui/StateCard";
import type { StoryboardProgress } from "../lib/v1/storyboard/progress";
import { assetLibraryPath } from "../lib/assetLibraryPath";
import styles from "./StoryboardPreview.module.css";
import { formatDuration, titleCase } from "./project-detail-format";

export function StoryboardPreview({
  projectId,
  storyboard,
  loading,
  error,
  onRetry,
  generating,
  progress,
  generationError,
  unavailableReason,
  onGenerate,
  onRequestChanges,
  readOnly,
}: {
  projectId: string;
  storyboard: ProjectStoryboard | null;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  generating: boolean;
  progress: StoryboardProgress;
  generationError: Error | null;
  unavailableReason?: string | null;
  onGenerate?: () => void;
  onRequestChanges?: () => void;
  readOnly: boolean;
}) {
  const scenes = storyboardScenes(storyboard);
  const momentCount = scenes.reduce((count, scene) => count + scene.beats.length, 0);
  const hasPreviewBeats = scenes.some((scene) => scene.beats.length > 0);

  return (
    <section className={`${styles.panel} ${styles.storyboardFeature}`} id="storyboard">
      <div className={styles.storyboardHeader}>
        <div>
          <span className={styles.eyebrow}>Storyboard</span>
          <h2>
            {storyboard && !readOnly ? (
              <Link
                className={styles.sectionTitleLink}
                to={`/projects/${encodeURIComponent(projectId)}/storyboard`}
              >
                Scenes
              </Link>
            ) : (
              "Scenes"
            )}
          </h2>
          <p>
            {storyboard
              ? `${scenes.length} ${scenes.length === 1 ? "scene" : "scenes"} · ${momentCount} ${
                  momentCount === 1 ? "moment" : "moments"
                }`
              : "Popcorn Ready plans the scenes and moments, then draws sketch panels for review."}
          </p>
        </div>
        <div className={styles.storyboardHeaderActions}>
          {storyboard && !readOnly && onRequestChanges ? (
            <Button variant="ghost" size="sm" onClick={onRequestChanges}>
              Request changes
            </Button>
          ) : null}
          {storyboard && !readOnly ? (
            <ButtonLink
              variant="ghost"
              size="sm"
              to={`/projects/${encodeURIComponent(projectId)}/storyboard`}
            >
              Open storyboard
            </ButtonLink>
          ) : null}
          {!readOnly && !storyboard && unavailableReason && !generating ? (
            <ButtonLink
              variant="ghost"
              size="sm"
              to={`/projects/${encodeURIComponent(projectId)}/brief`}
            >
              Finish brief
            </ButtonLink>
          ) : null}
          {!readOnly && !storyboard && onGenerate && !loading && !error && !generating ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={onGenerate}
              disabled={Boolean(unavailableReason)}
            >
              Create storyboard
            </Button>
          ) : null}
        </div>
      </div>
      {loading ? <div className={styles.placeholder}>Loading storyboard...</div> : null}
      {!loading && !error && generating ? (
        <StoryboardGeneratingBanner progress={progress} hasStoryboard={Boolean(storyboard)} />
      ) : null}
      {!loading && error ? (
        <ErrorState
          title="Unable to load storyboard"
          body="We couldn't load the storyboard for this project."
          error={error}
          onRetry={onRetry}
        />
      ) : null}
      {!loading && !error && generationError ? (
        <ErrorState
          title="Unable to start storyboard production"
          body="We couldn't start the agent workflow. Try again to continue from the current project brief."
          error={generationError}
          onRetry={onGenerate ?? onRetry}
        />
      ) : null}
      {!loading && !error && !storyboard && !generating ? (
        <EmptyState
          title="No storyboard yet"
          body={
            unavailableReason ??
            "The agent will prepare the scene-and-moment plan automatically before drawing panels."
          }
        />
      ) : null}
      {!loading && !error && storyboard ? (
        hasPreviewBeats ? (
          // Scene-level filmstrip only: the overview stays a short read, and
          // moment-level depth lives on the storyboard page.
          <div className={styles.sceneStrip}>
            {scenes.map((scene) => (
              <SceneStripCard key={scene.id} projectId={projectId} scene={scene} readOnly={readOnly} />
            ))}
          </div>
        ) : !generating ? (
          <p className={styles.muted}>Storyboard structure exists, but no panel images are ready yet.</p>
        ) : null
      ) : null}
    </section>
  );
}

function SceneStripCard({
  projectId,
  scene,
  readOnly,
}: {
  projectId: string;
  scene: StoryboardScene;
  readOnly: boolean;
}) {
  const label = `Scene ${scene.sceneIndex + 1}`;
  const panel = scene.beats.map(selectedPanel).find(Boolean) ?? null;
  const momentCount = scene.beats.length;
  const image = panel ? (
    <StoryboardPanelThumb panel={panel} label={label} />
  ) : (
    <div className={`${styles.storyImage} ${styles.storyImageEmpty}`}>
      <span>No panels yet</span>
    </div>
  );
  const meta = (
    <div className={styles.sceneStripMeta}>
        <span>
          {label}
          {scene.durationSec ? ` · ${formatDuration(scene.durationSec)}` : ""}
        </span>
        <h3>{scene.title ?? scene.summary ?? "Untitled scene"}</h3>
        <p>
          {momentCount} {momentCount === 1 ? "moment" : "moments"}
        </p>
      </div>
  );

  if (readOnly) {
    return <article className={styles.sceneStripCard}>{image}{meta}</article>;
  }
  return (
    <article className={styles.sceneStripCard}>
      {panel?.imageAssetId ? (
        <Link
          className={styles.sceneAssetLink}
          to={assetLibraryPath(panel.imageAssetId, projectId)}
          aria-label={`View ${label} asset`}
        >
          {image}
        </Link>
      ) : image}
      <Link
        className={styles.sceneMetaLink}
        to={`/projects/${encodeURIComponent(projectId)}/storyboard`}
        aria-label={`Open ${label} in the storyboard`}
      >
        {meta}
      </Link>
    </article>
  );
}

function StoryboardGeneratingBanner({
  progress,
  hasStoryboard,
}: {
  progress: StoryboardProgress;
  hasStoryboard: boolean;
}) {
  const detail =
    progress.total > 0
      ? `${progress.ready} of ${progress.total} panels ready${
          progress.failed > 0 ? ` · ${progress.failed} failed` : ""
        }`
      : hasStoryboard
        ? "Preparing scenes…"
        : "Planning scenes and moments…";

  return (
    <div className={styles.generating} role="status" aria-live="polite">
      <div className={styles.generatingHead}>
        <Spinner size="sm" label="Generating storyboard…" />
        <span className={styles.generatingDetail}>{detail}</span>
      </div>
      {progress.total > 0 ? (
        <div
          className={styles.generatingTrack}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
        >
          <span style={{ width: `${progress.percent}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function StoryboardPanelThumb({ panel, label }: { panel: StoryboardPanel; label: string }) {
  return (
    <AssetImage
      kind="image"
      url={panel.thumbnailUrl ?? panel.url}
      assetId={panel.imageAssetId ?? null}
      prompt={panel.prompt ?? null}
      status={panel.status}
      mediaClassName={styles.storyImage}
      placeholderClassName={`${styles.storyImage} ${styles.storyImageEmpty}`}
      alt={`${label} storyboard panel`}
      placeholder={<span>{titleCase(panel.status)}</span>}
      // The thumb sits inside the scene card's Link; recovery controls would
      // nest a button in the anchor and bubble clicks into navigation.
      // Failed panels regenerate from the storyboard page this card opens.
      allowRegenerate={false}
    />
  );
}

function storyboardScenes(storyboard: ProjectStoryboard | null) {
  if (!storyboard) return [];
  return storyboard.scenes
    .map((scene) => ({
      ...scene,
      beats: [...scene.beats].sort((a, b) => a.beatIndex - b.beatIndex),
    }))
    .sort((a, b) => a.sceneIndex - b.sceneIndex);
}

function selectedPanel(beat: StoryboardBeat): StoryboardPanel | null {
  return (
    beat.panels.find((panel) => panel.isSelected) ??
    [...beat.panels].sort((a, b) => a.panelIndex - b.panelIndex)[0] ??
    null
  );
}
