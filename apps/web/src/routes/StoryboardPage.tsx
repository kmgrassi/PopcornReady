import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import type {
  BoardRevisionTarget,
  ProjectStoryboard,
  StoryboardBeat,
  StoryboardPanel,
  StoryboardScene,
} from "@popcorn/shared/v1/types";
import { AssetEditModal } from "../components/media/AssetEditModal";
import { AssetImage } from "../components/media/AssetImage";
import { ButtonLink } from "../components/ui/Button";
import { EmptyState, ErrorState } from "../components/ui/StateCard";
import {
  useGenerationRunQuery,
  useProjectQuery,
  useProjectStoryboardQuery,
} from "../lib/queryClient";
import styles from "./StoryboardPage.module.css";

const TERMINAL_RUN_STATUSES = new Set(["succeeded", "failed", "canceled"]);

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
  const refetchStoryboard = storyboardQuery.refetch;
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  // Beats whose panel the agent is currently revising (skeleton + live update).
  const [revisingBeats, setRevisingBeats] = useState<Set<string>>(() => new Set());
  const [revisionRunId, setRevisionRunId] = useState<string | null>(null);

  // Poll the revision run; useGenerationRunQuery auto-polls while it's active.
  const revisionRunQuery = useGenerationRunQuery(
    projectId ?? "",
    revisionRunId ?? "",
    Boolean(projectId && revisionRunId),
  );
  const revisionStatus = revisionRunQuery.data?.run.status;

  // When the revision run settles, pull the updated panel image and clear the
  // skeletons.
  useEffect(() => {
    if (!revisionRunId || !revisionStatus) return;
    if (TERMINAL_RUN_STATUSES.has(revisionStatus)) {
      void refetchStoryboard();
      setRevisingBeats(new Set());
      setRevisionRunId(null);
    }
  }, [revisionRunId, revisionStatus, refetchStoryboard]);

  if (!projectId) return <Navigate to="/library/projects" replace />;

  const project = projectQuery.data?.project ?? null;
  const storyboard = storyboardQuery.data?.storyboard ?? null;
  const loading = storyboardQuery.isLoading;
  const error = storyboardQuery.error ?? null;
  const revising = revisingBeats.size > 0;

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
        <div className={styles.headerActions}>
          {revising ? (
            <span className={styles.syncPill} role="status">
              <span className={styles.spinner} aria-hidden />
              Agent revising…
            </span>
          ) : null}
          <ButtonLink
            variant="secondary"
            to={`/projects/${encodeURIComponent(projectId)}`}
          >
            Back to project
          </ButtonLink>
        </div>
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
        <StoryboardBody storyboard={storyboard} revisingBeats={revisingBeats} onEdit={setEditTarget} />
      ) : null}

      <AssetEditModal
        open={Boolean(editTarget)}
        projectId={projectId}
        target={editTarget?.target ?? null}
        imageUrl={editTarget?.url}
        title={editTarget?.title}
        subtitle={editTarget?.subtitle}
        onClose={() => setEditTarget(null)}
        onSubmitted={(runId) => {
          // Mark the edited beat's panel as out of sync (skeleton) and poll the
          // run until it settles, then live-update the image.
          const beatId = editTarget?.target.beatId;
          if (beatId) {
            setRevisingBeats((current) => new Set(current).add(beatId));
          }
          setRevisionRunId(runId);
        }}
      />
    </main>
  );
}

function StoryboardBody({
  storyboard,
  revisingBeats,
  onEdit,
}: {
  storyboard: ProjectStoryboard;
  revisingBeats: Set<string>;
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
          revisingBeats={revisingBeats}
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
  revisingBeats,
  order,
  onEdit,
}: {
  scene: StoryboardScene;
  storyboardId: string;
  revisingBeats: Set<string>;
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
            revising={revisingBeats.has(beat.id)}
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
  revising,
  order,
  sceneOrder,
  onEdit,
}: {
  beat: StoryboardBeat;
  storyboardId: string;
  sceneId: string;
  revising: boolean;
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
      {revising ? (
        <div className={`${styles.panelImage} ${styles.panelRevising}`} aria-busy="true">
          {image ? <img className={styles.panelGhost} src={image} alt="" /> : null}
          <div className={styles.shimmer} aria-hidden />
          <span className={styles.revisingLabel}>
            <span className={styles.spinner} aria-hidden />
            Revising…
          </span>
        </div>
      ) : (
        <AssetImage
          kind="image"
          url={image}
          assetId={panel?.imageAssetId ?? null}
          prompt={panel?.prompt ?? null}
          alt={label}
          mediaClassName={styles.panelImage}
          placeholderClassName={`${styles.panelImage} ${styles.panelEmpty}`}
          placeholder={<span>No panel image yet</span>}
          activateClassName={styles.panelButton}
          {...(canEdit && image
            ? {
                onActivate: () =>
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
                  }),
                mediaOverlay: <span className={styles.editHint}>Click to edit</span>,
              }
            : {})}
        />
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
