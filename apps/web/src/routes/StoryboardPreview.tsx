import { Link } from "react-router-dom";
import type {
  ProjectStoryboard,
  StoryboardBeat,
  StoryboardPanel,
} from "@popcorn/shared/v1/types";
import { AssetImage } from "../components/media/AssetImage";
import { Button, ButtonLink } from "../components/ui/Button";
import { Spinner } from "../components/ui/Spinner";
import { EmptyState, ErrorState } from "../components/ui/StateCard";
import type { StoryboardProgress } from "../lib/v1/storyboard/progress";
import styles from "./ProjectDetailPage.module.css";
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
  onGenerate,
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
  onGenerate?: () => void;
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
              : "Create a visual plan from the current project concept."}
          </p>
        </div>
        <div className={styles.storyboardHeaderActions}>
          {storyboard && !readOnly ? (
            <ButtonLink
              variant="ghost"
              size="sm"
              to={`/projects/${encodeURIComponent(projectId)}/storyboard`}
            >
              Open storyboard
            </ButtonLink>
          ) : null}
          {/* The generate control only appears once nothing is in flight, so
              the page never offers "Generate again" mid-run. */}
          {!readOnly && onGenerate && !loading && !error && !generating ? (
            <Button variant="secondary" size="sm" onClick={onGenerate}>
              {storyboard ? "Generate again" : "Create storyboard"}
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
          title="Unable to generate storyboard"
          body="We couldn't finish storyboard generation for this project."
          error={generationError}
          onRetry={onGenerate ?? onRetry}
        />
      ) : null}
      {!loading && !error && !storyboard && !generating ? (
        <EmptyState
          title="No storyboard yet"
          body="Create storyboard scenes from this project's current shot plan."
        />
      ) : null}
      {!loading && !error && storyboard ? (
        hasPreviewBeats ? (
          <div className={styles.storyboardBoard}>
            {scenes.map((scene) => {
              if (scene.beats.length === 0) return null;
              return (
                <article className={styles.sceneGroup} key={scene.id}>
                  <header className={styles.sceneHeader}>
                    <div>
                      <span>Scene {scene.sceneIndex + 1}</span>
                      <h3>{scene.title ?? scene.summary ?? "Untitled scene"}</h3>
                    </div>
                    {scene.durationSec ? (
                      <strong>{formatDuration(scene.durationSec)}</strong>
                    ) : null}
                  </header>
                  <div className={styles.beatGrid}>
                    {scene.beats.map((beat) => (
                      <StoryboardBeatCard beat={beat} key={beat.id} />
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        ) : !generating ? (
          <p className={styles.muted}>Storyboard structure exists, but no panel images are ready yet.</p>
        ) : null
      ) : null}
    </section>
  );
}

function StoryboardBeatCard({ beat }: { beat: StoryboardBeat }) {
  const panel = selectedPanel(beat);
  const label = `Moment ${beat.beatIndex + 1}`;
  const prompt = panel?.prompt?.trim() || beat.visualDescription?.trim() || null;

  return (
    <article className={styles.beatCard}>
      {panel ? (
        <StoryboardPanelThumb panel={panel} label={label} />
      ) : (
        <div className={`${styles.storyImage} ${styles.storyImageEmpty}`}>
          <span>{titleCase(beat.status)}</span>
        </div>
      )}
      <div className={styles.beatBody}>
        <div className={styles.beatMeta}>
          <span>{label}</span>
          {beat.durationSec ? <span>{formatDuration(beat.durationSec)}</span> : null}
        </div>
        {prompt ? (
          <details className={styles.storyPrompt}>
            <summary>Scene description prompt</summary>
            <p>{prompt}</p>
          </details>
        ) : null}
      </div>
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
        : "Starting generation…";

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
