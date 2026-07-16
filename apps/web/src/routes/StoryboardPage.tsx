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
import { Button, ButtonLink } from "../components/ui/Button";
import { EmptyState, ErrorState } from "../components/ui/StateCard";
import {
  useGenerationRunQuery,
  useProjectQuery,
  useProjectGenerationRunsQuery,
  useProjectStoryboardQuery,
  useUpdateGenerationRunMutation,
} from "../lib/queryClient";
import { useGenerateSceneWireframeMutation } from "../lib/sceneWireframe";
import styles from "./StoryboardPage.module.css";

type SceneWireframeMutation = ReturnType<typeof useGenerateSceneWireframeMutation>;

const TERMINAL_RUN_STATUSES = new Set(["succeeded", "failed", "canceled"]);

interface EditTarget {
  target: BoardRevisionTarget;
  url?: string | null;
  title: string;
  subtitle?: string | null;
  sourcePrompt?: string | null;
  // Seeds the Request Changes box. Set when opening the modal to GENERATE a
  // missing wireframe so the item's intended prompt is pre-filled.
  initialPrompt?: string;
}

export function StoryboardPage() {
  const { projectId } = useParams();
  const projectQuery = useProjectQuery(projectId ?? "", Boolean(projectId));
  const storyboardQuery = useProjectStoryboardQuery(projectId ?? "", Boolean(projectId));
  const refetchStoryboard = storyboardQuery.refetch;
  const projectRunsQuery = useProjectGenerationRunsQuery(projectId ?? "", Boolean(projectId));
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  // Beats whose panel the agent is currently revising (skeleton + live update).
  const [revisingBeats, setRevisingBeats] = useState<Set<string>>(() => new Set());
  const [revisionRunId, setRevisionRunId] = useState<string | null>(null);
  const sceneWireframe = useGenerateSceneWireframeMutation(projectId ?? "");

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
  // Project runs are returned newest-first; the newest waiting storyboard pass
  // is the active board review for this project.
  const storyboardReviewRun = projectRunsQuery.data?.runs.find(
    (run) => run.reviewGate?.stageType === "storyboard",
  );
  const continueRunMutation = useUpdateGenerationRunMutation(
    projectId ?? "",
    storyboardReviewRun?.runId ?? "",
  );
  const loading = storyboardQuery.isLoading;
  const error = storyboardQuery.error ?? null;
  const revising = revisingBeats.size > 0;
  const headerDescription = loading
    ? "Loading storyboard..."
    : storyboardReviewRun
      ? "Review the visual plan. When it is ready, start video production from this board."
    : storyboard
      ? "Click any panel to request changes."
      : "Generate a storyboard from the project page to see scenes, beats, and panels here.";

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
          <p>{headerDescription}</p>
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
        <>
          {storyboardReviewRun ? (
            <section className={styles.productionGate} aria-labelledby="storyboard-review-heading">
              <div>
                <span className={styles.productionGateLabel}>Storyboard ready for review</span>
                <h2 id="storyboard-review-heading">Ready to make the video?</h2>
                <p>
                  Your visual plan is paused here. Request changes to any panel first, or continue
                  to generate the photoreal frames, motion, sound, and final cut.
                </p>
              </div>
              <Button
                variant="cta"
                type="button"
                onClick={() =>
                  void continueRunMutation.mutateAsync({ action: "approve" }).then(() => {
                    void projectRunsQuery.refetch();
                  }).catch(() => undefined)
                }
                isLoading={continueRunMutation.isPending}
                disabled={continueRunMutation.isPending}
              >
                Generate video
              </Button>
            </section>
          ) : null}
          {continueRunMutation.error ? (
            <p className={styles.productionGateError} role="alert">
              We couldn't start video production. Please try again.
            </p>
          ) : null}
          <StoryboardBody
            storyboard={storyboard}
            revisingBeats={revisingBeats}
            sceneWireframe={sceneWireframe}
            onEdit={setEditTarget}
            onRegenerateStart={(beatId) => {
              setRevisingBeats((current) => new Set(current).add(beatId));
            }}
            onRegenerateSettled={(beatId) => {
              void refetchStoryboard().finally(() => {
                setRevisingBeats((current) => {
                  const next = new Set(current);
                  next.delete(beatId);
                  return next;
                });
              });
            }}
          />
        </>
      ) : null}

      <AssetEditModal
        open={Boolean(editTarget)}
        projectId={projectId}
        target={editTarget?.target ?? null}
        imageUrl={editTarget?.url}
        title={editTarget?.title}
        subtitle={editTarget?.subtitle}
        sourcePrompt={editTarget?.sourcePrompt}
        initialPrompt={editTarget?.initialPrompt}
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
  sceneWireframe,
  onEdit,
  onRegenerateStart,
  onRegenerateSettled,
}: {
  storyboard: ProjectStoryboard;
  revisingBeats: Set<string>;
  sceneWireframe: SceneWireframeMutation;
  onEdit: (target: EditTarget) => void;
  onRegenerateStart: (beatId: string) => void;
  onRegenerateSettled: (beatId: string) => void;
}) {
  const scenes = [...storyboard.scenes].sort((a, b) => a.sceneIndex - b.sceneIndex);
  if (scenes.length === 0) {
    return <p className={styles.muted}>This storyboard has no scenes yet.</p>;
  }
  const generatingSceneId =
    sceneWireframe.isPending ? sceneWireframe.variables?.sceneId ?? null : null;
  return (
    <div className={styles.scenes}>
      {scenes.map((scene, index) => (
        <SceneSection
          key={scene.id}
          scene={scene}
          storyboardId={storyboard.id}
          revisingBeats={revisingBeats}
          order={index + 1}
          wireframeGenerating={generatingSceneId === scene.id}
          onGenerateWireframe={(prompt) =>
            sceneWireframe.mutate({ storyboardId: storyboard.id, sceneId: scene.id, prompt })
          }
          onEdit={onEdit}
          onRegenerateStart={onRegenerateStart}
          onRegenerateSettled={onRegenerateSettled}
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
  wireframeGenerating,
  onGenerateWireframe,
  onEdit,
  onRegenerateStart,
  onRegenerateSettled,
}: {
  scene: StoryboardScene;
  storyboardId: string;
  revisingBeats: Set<string>;
  order: number;
  wireframeGenerating: boolean;
  onGenerateWireframe: (prompt?: string) => void;
  onEdit: (target: EditTarget) => void;
  onRegenerateStart: (beatId: string) => void;
  onRegenerateSettled: (beatId: string) => void;
}) {
  const beats = [...scene.beats].sort((a, b) => a.beatIndex - b.beatIndex);
  const sceneTitle = scene.title ?? `Scene ${order}`;
  const sceneImage = scene.thumbnailUrl ?? scene.url ?? null;
  // Seeds the agent's "Generate beats" action when a scene has no beats yet.
  const scenePrompt =
    [scene.summary, scene.setting, scene.mood].filter(Boolean).join(" · ") || null;
  return (
    <section className={styles.scene}>
      <div className={styles.sceneHead}>
        <span className={styles.sceneTag}>Scene {order}</span>
        <h2>{sceneTitle}</h2>
        {scene.summary ? <p className={styles.sceneSummary}>{scene.summary}</p> : null}
        <div className={styles.sceneMeta}>
          {scene.setting ? <span>{scene.setting}</span> : null}
          {scene.mood ? <span>{scene.mood}</span> : null}
          {scene.durationSec ? <span>{Math.round(scene.durationSec)}s</span> : null}
        </div>
      </div>
      {/* The disposable storyboard image: one review panel per scene. */}
      <div className={styles.sceneWireframe}>
        {wireframeGenerating ? (
          <div className={`${styles.panelImage} ${styles.panelEmpty}`} aria-busy="true">
            <span className={styles.spinner} aria-hidden />
            <span>Drawing storyboard image…</span>
          </div>
        ) : (
          <AssetImage
            kind="image"
            url={sceneImage}
            assetId={scene.sceneAssetId}
            prompt={scene.summary}
            alt={`${sceneTitle} storyboard image`}
            // Re-rolls go through the dedicated generate mutation, not the
            // per-asset regenerate endpoint.
            allowRegenerate={false}
            mediaClassName={styles.panelImage}
            placeholderClassName={`${styles.panelImage} ${styles.panelEmpty}`}
            activateClassName={styles.panelButton}
            placeholder={
              <>
                <span className={styles.beatNumber}>Scene {order}</span>
                <span>No storyboard image yet</span>
                <Button
                  variant="cta"
                  size="sm"
                  type="button"
                  className={styles.generateButton}
                  onClick={() => onGenerateWireframe()}
                >
                  Generate storyboard image
                </Button>
              </>
            }
            {...(scene.sceneAssetId && sceneImage
              ? {
                  onActivate: () =>
                    onEdit({
                      target: {
                        scope: "tile",
                        storyboardId,
                        sceneId: scene.id,
                        assetId: scene.sceneAssetId!,
                        label: sceneTitle,
                      },
                      url: scene.url ?? scene.thumbnailUrl,
                      title: `${sceneTitle} storyboard image`,
                      subtitle: `Scene ${order}`,
                    }),
                }
              : {})}
          />
        )}
      </div>
      {beats.length === 0 ? (
        // A scene with no beats yet (e.g. its storyboard stage never ran): offer
        // to generate the beats — the actionable unit — rather than a scene image.
        <div className={styles.sceneEmpty}>
          <span>No beats yet</span>
          <Button
            variant="cta"
            size="sm"
            type="button"
            onClick={() =>
              onEdit({
                target: {
                  scope: "tile",
                  storyboardId,
                  sceneId: scene.id,
                  label: sceneTitle,
                },
                title: `Generate ${sceneTitle}`,
                subtitle: `Scene ${order}`,
                initialPrompt: scenePrompt ?? "",
              })
            }
          >
            Generate beats
          </Button>
        </div>
      ) : (
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
              onRegenerateStart={onRegenerateStart}
              onRegenerateSettled={onRegenerateSettled}
            />
          ))}
        </div>
      )}
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
  onRegenerateStart,
  onRegenerateSettled,
}: {
  beat: StoryboardBeat;
  storyboardId: string;
  sceneId: string;
  revising: boolean;
  order: number;
  sceneOrder: number;
  onEdit: (target: EditTarget) => void;
  onRegenerateStart: (beatId: string) => void;
  onRegenerateSettled: (beatId: string) => void;
}) {
  const panel = selectedPanel(beat);
  const image = panel?.thumbnailUrl ?? panel?.url ?? null;
  const label = beat.intent || `Beat ${order}`;
  const canEdit = Boolean(panel?.imageAssetId);
  const prompt = panel?.prompt?.trim() || beat.visualDescription?.trim() || null;
  const mediaOverlay =
    canEdit && image ? (
      <>
        <span className={styles.beatNumber}>Beat {order}</span>
        <span className={styles.editHint}>Request Changes</span>
      </>
    ) : (
      <span className={styles.beatNumber}>Beat {order}</span>
    );

  return (
    <article className={styles.beat}>
      {revising ? (
        <div className={`${styles.panelImage} ${styles.panelRevising}`} aria-busy="true">
          {image ? <img className={styles.panelGhost} src={image} alt="" /> : null}
          <div className={styles.shimmer} aria-hidden />
          <span className={styles.beatNumber}>Beat {order}</span>
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
          prompt={prompt}
          alt={label}
          recoveryClassName={styles.panelRecovery}
          mediaClassName={styles.panelImage}
          placeholderClassName={`${styles.panelImage} ${styles.panelEmpty}`}
          placeholder={
            <>
              <span className={styles.beatNumber}>Beat {order}</span>
              <span>No panel image yet</span>
              {/* No asset to recover — offer generation (an existing-but-blank
                  asset shows the inline regenerate control instead). */}
              {!panel?.imageAssetId ? (
                <Button
                  variant="cta"
                  size="sm"
                  type="button"
                  className={styles.generateButton}
                  onClick={() =>
                    onEdit({
                      target: {
                        scope: "tile",
                        storyboardId,
                        sceneId,
                        beatId: beat.id,
                        label,
                      },
                      title: `Generate ${label}`,
                      subtitle: `Scene ${sceneOrder} · Beat ${order}`,
                      initialPrompt: prompt ?? "",
                    })
                  }
                >
                  Generate
                </Button>
              ) : null}
            </>
          }
          activateClassName={styles.panelButton}
          onRegenerateStart={() => onRegenerateStart(beat.id)}
          onRegenerateSettled={() => onRegenerateSettled(beat.id)}
          mediaOverlay={mediaOverlay}
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
                    sourcePrompt: prompt,
                  }),
              }
            : {})}
        />
      )}
      <div className={styles.beatBody}>
        <p className={styles.beatIntent}>{label}</p>
      </div>
    </article>
  );
}
