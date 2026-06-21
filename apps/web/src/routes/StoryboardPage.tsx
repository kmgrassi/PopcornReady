import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import type {
  BoardRevisionTarget,
  ProjectStoryboard,
  StoryboardBeat,
  StoryboardPanel,
  StoryboardScene,
} from "@popcorn/shared/v1/types";
import { AssetEditModal } from "../components/media/AssetEditModal";
import { ButtonLink } from "../components/ui/Button";
import { EmptyState, ErrorState } from "../components/ui/StateCard";
import { useProjectQuery, useProjectStoryboardQuery } from "../lib/queryClient";
import styles from "./StoryboardPage.module.css";

interface EditTarget {
  target: BoardRevisionTarget;
  url?: string | null;
  title: string;
  subtitle?: string | null;
}

export function StoryboardPage() {
  const { projectId } = useParams();
  const projectQuery = useProjectQuery(projectId ?? "", Boolean(projectId));
  const storyboardQuery = useProjectStoryboardQuery(projectId ?? "", Boolean(projectId));
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  if (!projectId) return <Navigate to="/library/projects" replace />;

  const project = projectQuery.data?.project ?? null;
  const storyboard = storyboardQuery.data?.storyboard ?? null;
  const loading = storyboardQuery.isLoading;
  const error = storyboardQuery.error ?? null;

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <Link
            className={styles.backLink}
            to={`/projects/${encodeURIComponent(projectId)}`}
          >
            {project?.name ?? "Project"}
          </Link>
          <h1>Storyboard</h1>
          <p>Click any panel to ask the AI to edit it.</p>
        </div>
        <ButtonLink
          variant="secondary"
          to={`/projects/${encodeURIComponent(projectId)}`}
        >
          Back to project
        </ButtonLink>
      </header>

      {loading ? <div className={styles.placeholder}>Loading storyboard…</div> : null}

      {!loading && error ? (
        <ErrorState
          title="Unable to load storyboard"
          body="We couldn't load the storyboard for this project."
          error={error}
          onRetry={() => void storyboardQuery.refetch()}
        />
      ) : null}

      {!loading && !error && !storyboard ? (
        <EmptyState
          title="No storyboard yet"
          body="Generate a storyboard from the project page to see scenes, beats, and panels here."
          action={
            <ButtonLink variant="secondary" to={`/projects/${encodeURIComponent(projectId)}`}>
              Back to project
            </ButtonLink>
          }
        />
      ) : null}

      {!loading && !error && storyboard ? (
        <StoryboardBody storyboard={storyboard} onEdit={setEditTarget} />
      ) : null}

      <AssetEditModal
        open={Boolean(editTarget)}
        projectId={projectId}
        target={editTarget?.target ?? null}
        imageUrl={editTarget?.url}
        title={editTarget?.title}
        subtitle={editTarget?.subtitle}
        onClose={() => setEditTarget(null)}
        onSubmitted={() => {
          // The agent revises in the background; refetch a few times to pick up
          // the new panel image.
          window.setTimeout(() => void storyboardQuery.refetch(), 4000);
          window.setTimeout(() => void storyboardQuery.refetch(), 12000);
        }}
      />
    </main>
  );
}

function StoryboardBody({
  storyboard,
  onEdit,
}: {
  storyboard: ProjectStoryboard;
  onEdit: (target: EditTarget) => void;
}) {
  const scenes = [...storyboard.scenes].sort((a, b) => a.sceneIndex - b.sceneIndex);
  if (scenes.length === 0) {
    return <p className={styles.muted}>This storyboard has no scenes yet.</p>;
  }
  return (
    <div className={styles.scenes}>
      {scenes.map((scene, index) => (
        <SceneSection
          key={scene.id}
          scene={scene}
          storyboardId={storyboard.id}
          order={index + 1}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}

function SceneSection({
  scene,
  storyboardId,
  order,
  onEdit,
}: {
  scene: StoryboardScene;
  storyboardId: string;
  order: number;
  onEdit: (target: EditTarget) => void;
}) {
  const beats = [...scene.beats].sort((a, b) => a.beatIndex - b.beatIndex);
  return (
    <section className={styles.scene}>
      <div className={styles.sceneHead}>
        <span className={styles.sceneTag}>Scene {order}</span>
        <h2>{scene.title ?? `Scene ${order}`}</h2>
        {scene.summary ? <p className={styles.sceneSummary}>{scene.summary}</p> : null}
        <div className={styles.sceneMeta}>
          {scene.setting ? <span>{scene.setting}</span> : null}
          {scene.mood ? <span>{scene.mood}</span> : null}
          {scene.durationSec ? <span>{Math.round(scene.durationSec)}s</span> : null}
        </div>
      </div>
      <div className={styles.beats}>
        {beats.map((beat, index) => (
          <BeatCard
            key={beat.id}
            beat={beat}
            storyboardId={storyboardId}
            sceneId={scene.id}
            order={index + 1}
            sceneOrder={order}
            onEdit={onEdit}
          />
        ))}
      </div>
    </section>
  );
}

function selectedPanel(beat: StoryboardBeat): StoryboardPanel | null {
  if (beat.panels.length === 0) return null;
  return beat.panels.find((panel) => panel.isSelected) ?? beat.panels[0];
}

function BeatCard({
  beat,
  storyboardId,
  sceneId,
  order,
  sceneOrder,
  onEdit,
}: {
  beat: StoryboardBeat;
  storyboardId: string;
  sceneId: string;
  order: number;
  sceneOrder: number;
  onEdit: (target: EditTarget) => void;
}) {
  const panel = selectedPanel(beat);
  const image = panel?.thumbnailUrl ?? panel?.url ?? null;
  const label = beat.intent || `Beat ${order}`;
  const canEdit = Boolean(panel?.imageAssetId);

  return (
    <article className={styles.beat}>
      {canEdit && image ? (
        <button
          type="button"
          className={styles.panelButton}
          onClick={() =>
            onEdit({
              target: {
                scope: "tile",
                storyboardId,
                sceneId,
                beatId: beat.id,
                panelId: panel!.id,
                assetId: panel!.imageAssetId!,
                label,
              },
              url: panel!.url ?? panel!.thumbnailUrl,
              title: label,
              subtitle: `Scene ${sceneOrder} · Beat ${order}`,
            })
          }
          aria-label={`Edit panel for ${label}`}
        >
          <img className={styles.panelImage} src={image} alt="" loading="lazy" />
          <span className={styles.editHint}>Click to edit</span>
        </button>
      ) : (
        <div className={`${styles.panelImage} ${styles.panelEmpty}`}>
          <span>{image ? "Generated" : "No panel image yet"}</span>
        </div>
      )}
      <div className={styles.beatBody}>
        <span className={styles.beatTag}>Beat {order}</span>
        <p className={styles.beatIntent}>{label}</p>
        {beat.visualDescription ? (
          <p className={styles.beatDesc}>{beat.visualDescription}</p>
        ) : null}
      </div>
    </article>
  );
}
