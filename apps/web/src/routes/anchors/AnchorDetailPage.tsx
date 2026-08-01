import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import type { V1Project } from "@popcorn/shared/v1/types";
import { useAuth } from "../../components/auth/AuthProvider";
import { StudioCrewLoadingState } from "../../components/creation/StudioCrewLoadingState";
import { Button } from "../../components/ui/Button";
import { ImageWithSkeleton } from "../../components/ui/ImageWithSkeleton";
import { EmptyState, ErrorState } from "../../components/ui/StateCard";
import {
  useCatalogEntryQuery,
  useCatalogLikeMutation,
  useCatalogLikesQuery,
  useCatalogProjectPickerQuery,
  type CatalogEntry,
} from "../../lib/catalog";
import {
  entrySummary,
  formatUseCount,
  kindLabel,
} from "./anchorDisplay";
import styles from "./AnchorDetailPage.module.css";

const DEV_AUTOPILOT = import.meta.env.DEV;

function catalogLikesAuthScope(auth: ReturnType<typeof useAuth>): string {
  if (auth.user?.id) return auth.user.id;
  if (auth.status === "disabled") return "local-disabled-auth";
  if (DEV_AUTOPILOT && auth.status === "unauthenticated") return "dev-autopilot";
  return "";
}

function DetailPreview({ entry }: { entry: CatalogEntry }) {
  if (entry.previewUrl) {
    return <ImageWithSkeleton className={styles.previewImage} src={entry.previewUrl} alt="" />;
  }

  return (
    <div className={styles.previewFallback} aria-hidden="true">
      <span>{entry.title.trim().charAt(0).toUpperCase() || "A"}</span>
    </div>
  );
}

function formatLikeCount(count: number) {
  return `${count} ${count === 1 ? "like" : "likes"}`;
}

function ProjectOption({ project }: { project: V1Project }) {
  const date = new Date(project.updatedAt);
  const updated = Number.isNaN(date.getTime())
    ? project.updatedAt
    : new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
      }).format(date);

  return (
    <option value={project.id}>
      {project.name} - updated {updated}
    </option>
  );
}

function StorySnapshot({ entry }: { entry: CatalogEntry }) {
  const acts = entry.snapshot?.story?.acts ?? entry.snapshot?.acts ?? [];
  const scenes = entry.snapshot?.story?.scenes ?? entry.snapshot?.scenes ?? [];
  const characters =
    entry.snapshot?.story?.characters ?? entry.snapshot?.characters ?? [];

  if (entry.kind !== "story" || (!acts.length && !scenes.length && !characters.length)) {
    return null;
  }

  return (
    <section className={styles.section} aria-labelledby="story-snapshot-heading">
      <h2 id="story-snapshot-heading">Story snapshot</h2>
      {characters.length ? (
        <div className={styles.stack}>
          <h3>Cast</h3>
          <ul className={styles.plainList}>
            {characters.slice(0, 6).map((character, index) => (
              <li key={character.id ?? `${character.name}-${index}`}>
                <strong>{character.name ?? "Character"}</strong>
                {character.description ? <span>{character.description}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {acts.length ? (
        <div className={styles.stack}>
          <h3>Acts</h3>
          <ol className={styles.plainList}>
            {acts.slice(0, 5).map((act, index) => (
              <li key={act.id ?? `${act.title}-${index}`}>
                <strong>{act.title ?? `Act ${index + 1}`}</strong>
                {act.summary ? <span>{act.summary}</span> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {!acts.length && scenes.length ? (
        <div className={styles.stack}>
          <h3>Scenes</h3>
          <ol className={styles.plainList}>
            {scenes.slice(0, 6).map((scene, index) => (
              <li key={scene.id ?? `${scene.title}-${index}`}>
                <strong>{scene.title ?? `Scene ${index + 1}`}</strong>
                {scene.summary ? <span>{scene.summary}</span> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

function UseAnchorPanel({
  entry,
  projects,
}: {
  entry: CatalogEntry;
  projects: V1Project[];
}) {
  const navigate = useNavigate();
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id ?? "");

  useEffect(() => {
    if (!selectedProjectId && projects[0]?.id) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  return (
    <section className={styles.usePanel} aria-labelledby="use-anchor-heading">
      <div>
        <h2 id="use-anchor-heading">Use in a project</h2>
        <p>
          Copy this {kindLabel(entry.kind).toLowerCase()} into one of your
          projects as new graph-owned material.
        </p>
      </div>
      {projects.length ? (
        <form className={styles.useForm} onSubmit={submit}>
          <label htmlFor="target-project">Project</label>
          <select
            id="target-project"
            value={selectedProjectId}
            onChange={(event) => setSelectedProjectId(event.target.value)}
          >
            {projects.map((project) => (
              <ProjectOption key={project.id} project={project} />
            ))}
          </select>
          <Button
            variant="secondary"
            type="submit"
            disabled
          >
            Use pending copy API
          </Button>
          <p className={styles.pending}>
            Copying anchors into projects is waiting on the catalog use endpoint.
          </p>
        </form>
      ) : (
        <EmptyState
          title="No projects yet"
          body="Create a project before copying an anchor into your workspace."
          action={
            <Button variant="secondary" onClick={() => navigate("/library/projects")}>
              View projects
            </Button>
          }
        />
      )}
    </section>
  );
}

export function AnchorDetailPage() {
  const auth = useAuth();
  const { entryId } = useParams();
  const entryQuery = useCatalogEntryQuery(entryId ?? "");
  const projectsQuery = useCatalogProjectPickerQuery();
  const entry = entryQuery.data?.entry ?? null;
  const authScope = catalogLikesAuthScope(auth);
  const likesQuery = useCatalogLikesQuery(entryId ? [entryId] : [], authScope);
  const likedEntryIds = useMemo(
    () => new Set(likesQuery.data?.likedEntryIds ?? []),
    [likesQuery.data?.likedEntryIds],
  );
  const likeMutation = useCatalogLikeMutation();
  const projects = useMemo(
    () => projectsQuery.data?.projects ?? [],
    [projectsQuery.data?.projects],
  );
  const viewerHasLiked = entry
    ? entry.viewerHasLiked ?? likedEntryIds.has(entry.id)
    : false;

  if (!entryId) return <Navigate to="/anchors" replace />;

  return (
    <div className={styles.page}>
      <Link className={styles.backLink} to="/anchors">
        Back to anchors
      </Link>

      {entryQuery.isLoading ? (
        <StudioCrewLoadingState
          title="Loading anchor"
          description="Gathering this creative reference."
          reservation={(
            <div className={styles.skeleton}>
              <span />
              <span />
              <span />
            </div>
          )}
          variant="page"
        />
      ) : null}

      {!entryQuery.isLoading && entryQuery.error ? (
        <ErrorState
          title="Unable to load anchor"
          body="The anchor detail could not be loaded."
          error={entryQuery.error}
          onRetry={() => void entryQuery.refetch()}
        />
      ) : null}

      {!entryQuery.isLoading && !entryQuery.error && entry ? (
        <div className={styles.layout}>
          <article className={styles.detail}>
            <div className={styles.preview}>
              <DetailPreview entry={entry} />
            </div>
            <div className={styles.body}>
              <div className={styles.kickerRow}>
                <span>{kindLabel(entry.kind)}</span>
                <span>{formatUseCount(entry.useCount)}</span>
                <span>{formatLikeCount(entry.likeCount)}</span>
              </div>
              <h1>{entry.title}</h1>
              <p className={styles.summary}>{entrySummary(entry)}</p>
              <button
                className={`${styles.likeButton} ${viewerHasLiked ? styles.liked : ""}`}
                type="button"
                aria-pressed={viewerHasLiked}
                disabled={likeMutation.isPending}
                onClick={() =>
                  likeMutation.mutate({
                    entryId: entry.id,
                    shouldLike: !viewerHasLiked,
                  })
                }
              >
                {viewerHasLiked ? "Liked" : "Like this anchor"}
              </button>
              {entry.tags.length ? (
                <div className={styles.tags} aria-label="Tags">
                  {entry.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              ) : null}
            </div>
          </article>

          <div className={styles.side}>
            {projectsQuery.error ? (
              <ErrorState
                title="Unable to load projects"
                body="Project choices could not be loaded."
                error={projectsQuery.error}
                onRetry={() => void projectsQuery.refetch()}
              />
            ) : null}
            {projectsQuery.isLoading ? (
              <div className={styles.skeleton} aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            ) : null}
            {!projectsQuery.isLoading && !projectsQuery.error ? (
              <UseAnchorPanel entry={entry} projects={projects} />
            ) : null}
          </div>

          <StorySnapshot entry={entry} />
        </div>
      ) : null}
    </div>
  );
}
