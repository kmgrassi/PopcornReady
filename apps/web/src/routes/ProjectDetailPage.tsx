import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import type {
  GenerationRun,
  ProjectStoryboard,
  StoryboardPanel,
  V1Project,
  VideoBriefInput,
} from "@popcorn/shared/v1/types";
import { useAuth } from "../components/auth/AuthProvider";
import { Button, ButtonLink } from "../components/ui/Button";
import { EmptyState, ErrorState } from "../components/ui/StateCard";
import {
  useGenerateProjectStoryboardMutation,
  useProjectQuery,
  useProjectStoryboardGenerationJobQuery,
  useProjectStoryboardQuery,
} from "../lib/queryClient";
import { useDashboardRunsQuery } from "../lib/v1/dashboard/query";
import styles from "./ProjectDetailPage.module.css";

const DEV_AUTOPILOT = import.meta.env.DEV;
const RUN_LIMIT = 6;

function useDashboardAuthScope() {
  const auth = useAuth();
  return auth.user?.id ?? (DEV_AUTOPILOT ? "dev-autopilot" : auth.status);
}

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const authScope = useDashboardAuthScope();
  const projectQuery = useProjectQuery(projectId ?? "", Boolean(projectId));
  const storyboardQuery = useProjectStoryboardQuery(projectId ?? "", Boolean(projectId));
  const generateStoryboardMutation = useGenerateProjectStoryboardMutation(projectId ?? "");
  const storyboardGenerationJobId = generateStoryboardMutation.data?.job.id ?? "";
  const storyboardGenerationJobQuery = useProjectStoryboardGenerationJobQuery(
    projectId ?? "",
    storyboardGenerationJobId,
    Boolean(projectId && storyboardGenerationJobId)
  );
  const storyboardGenerationJob = storyboardGenerationJobQuery.data?.job;
  const refetchStoryboard = storyboardQuery.refetch;
  const storyboardGenerationError = useMemo(() => {
    if (storyboardGenerationJob?.error) {
      return new Error(storyboardGenerationJob.error.message);
    }
    return storyboardGenerationJobQuery.error;
  }, [storyboardGenerationJob?.error?.message, storyboardGenerationJobQuery.error]);
  const runsQuery = useDashboardRunsQuery(authScope, {
    status: "all",
    projectId: projectId ?? undefined,
    limit: RUN_LIMIT,
  });

  useEffect(() => {
    if (storyboardGenerationJob?.status === "succeeded") {
      void refetchStoryboard();
    }
  }, [refetchStoryboard, storyboardGenerationJob?.status]);

  if (!projectId) return <Navigate to="/library/projects" replace />;

  const project = projectQuery.data?.project ?? null;
  const storyboard = storyboardQuery.data?.storyboard ?? null;
  const loading = projectQuery.isLoading;
  const error = projectQuery.error ?? null;

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <Link className={styles.backLink} to="/library/projects">
            Projects
          </Link>
          <h1>{project?.name ?? "Project overview"}</h1>
          <p>
            {project
              ? `Updated ${formatDate(project.updatedAt)}`
              : "Loading project details."}
          </p>
        </div>
        <div className={styles.headerActions}>
          <ButtonLink
            variant="secondary"
            to={`/library/runs?projectId=${encodeURIComponent(projectId)}`}
          >
            Runs
          </ButtonLink>
          <ButtonLink
            variant="primary"
            to={`/projects/${encodeURIComponent(projectId)}/watch`}
          >
            Watch
          </ButtonLink>
        </div>
      </header>

      {loading ? <ProjectSkeleton /> : null}

      {!loading && error ? (
        <ErrorState
          title="Unable to load project"
          body="We couldn't load this project overview."
          error={error}
          onRetry={() => void projectQuery.refetch()}
        />
      ) : null}

      {!loading && !error && project ? (
        <>
          <ProjectHero project={project} storyboard={storyboard} />
          <section className={styles.layout}>
            <ProjectBrief project={project} />
            <StoryboardPreview
              projectId={projectId}
              storyboard={storyboard}
              loading={storyboardQuery.isLoading}
              error={storyboardQuery.error}
              onRetry={() => void storyboardQuery.refetch()}
              generating={generateStoryboardMutation.isPending}
              generationStarted={Boolean(generateStoryboardMutation.data)}
              generationError={
                generateStoryboardMutation.error ?? storyboardGenerationError
              }
              onGenerate={() => {
                void generateStoryboardMutation.mutateAsync().then(() => {
                  void storyboardQuery.refetch();
                  window.setTimeout(() => void storyboardQuery.refetch(), 3000);
                  window.setTimeout(() => void storyboardQuery.refetch(), 8000);
                });
              }}
            />
          </section>
          <RunsPreview
            projectId={projectId}
            runs={runsQuery.items}
            loading={runsQuery.loading}
            error={runsQuery.error}
            onRetry={runsQuery.refetch}
          />
        </>
      ) : null}
    </main>
  );
}

function ProjectHero({
  project,
  storyboard,
}: {
  project: V1Project;
  storyboard: ProjectStoryboard | null;
}) {
  const stats = useMemo(() => storyboardStats(storyboard), [storyboard]);
  return (
    <section className={styles.hero}>
      <ProjectPoster name={project.name} posterUrl={project.posterUrl} />
      <div className={styles.heroBody}>
        <div className={styles.metaRow}>
          <StatusChip status={project.status} />
          {project.visibility ? (
            <span>{project.visibility === "public" ? "Public" : "Private"}</span>
          ) : null}
          <span>Created {formatDate(project.createdAt)}</span>
        </div>
        <h2>{project.brief?.goal ?? project.name}</h2>
        <dl className={styles.stats}>
          <div>
            <dt>Length</dt>
            <dd>{formatDuration(project.brief?.targetLengthSec) ?? "Unset"}</dd>
          </div>
          <div>
            <dt>Aspect</dt>
            <dd>{project.brief?.aspectRatio ?? "Unset"}</dd>
          </div>
          <div>
            <dt>Scenes</dt>
            <dd>{stats.scenes}</dd>
          </div>
          <div>
            <dt>Beats</dt>
            <dd>{stats.beats}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function ProjectPoster({ name, posterUrl }: { name: string; posterUrl?: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (posterUrl && posterUrl !== failedUrl) {
    return (
      <img
        className={styles.poster}
        src={posterUrl}
        alt=""
        onError={() => setFailedUrl(posterUrl)}
      />
    );
  }
  return (
    <div className={`${styles.poster} ${styles.posterEmpty}`} aria-hidden="true">
      <span>{name.trim().charAt(0).toUpperCase() || "?"}</span>
    </div>
  );
}

function ProjectBrief({ project }: { project: V1Project }) {
  const brief = project.brief;
  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Brief</span>
          <h2>Project details</h2>
        </div>
      </div>
      {brief ? (
        <dl className={styles.detailList}>
          <DetailTerm label="Goal" value={brief.goal} />
          <DetailTerm label="Audience" value={brief.audience} />
          <DetailTerm label="Style" value={brief.style} />
          <DetailTerm label="Format" value={brief.format} />
          <DetailTerm label="Platform" value={brief.platform} />
          <DetailTerm label="Hook" value={brief.hookQuestion} />
          <DetailTerm label="Payoff" value={brief.payoff} />
          <DetailTerm label="Call to action" value={brief.constraints?.callToAction} />
        </dl>
      ) : (
        <p className={styles.muted}>No brief has been saved for this project yet.</p>
      )}
    </section>
  );
}

function DetailTerm({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function StoryboardPreview({
  projectId,
  storyboard,
  loading,
  error,
  onRetry,
  generating,
  generationStarted,
  generationError,
  onGenerate,
}: {
  projectId: string;
  storyboard: ProjectStoryboard | null;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  generating: boolean;
  generationStarted: boolean;
  generationError: Error | null;
  onGenerate: () => void;
}) {
  const stats = storyboardStats(storyboard);
  const panels = firstPanels(storyboard, 4);

  return (
    <section className={styles.panel} id="storyboard">
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Storyboard</span>
          <h2>Scenes and beats</h2>
        </div>
        <ButtonLink
          variant="ghost"
          size="sm"
          to={`/library/runs?projectId=${encodeURIComponent(projectId)}`}
        >
          Runs
        </ButtonLink>
      </div>
      {loading ? <div className={styles.placeholder}>Loading storyboard...</div> : null}
      {!loading && error ? (
        <ErrorState
          title="Unable to load storyboard"
          body="We couldn't load the storyboard for this project."
          error={error}
          onRetry={onRetry}
        />
      ) : null}
      {!loading && !error && !storyboard ? (
        <>
          <EmptyState
            title={generationStarted ? "Storyboard generation started" : "No storyboard yet"}
            body={
              generationStarted
                ? "Storyboard panels are being created from the current shot plan."
                : "Create storyboard scenes and beats from this project's current shot plan."
            }
            action={
              <Button
                variant="secondary"
                onClick={onGenerate}
                isLoading={generating}
                disabled={generating}
              >
                {generationStarted ? "Generate again" : "Create storyboard"}
              </Button>
            }
          />
          {generationError ? (
            <ErrorState
              title="Unable to start storyboard"
              body="We couldn't start storyboard generation for this project."
              error={generationError}
              onRetry={onGenerate}
            />
          ) : null}
        </>
      ) : null}
      {!loading && !error && storyboard ? (
        <>
          <dl className={styles.storyStats}>
            <div>
              <dt>Status</dt>
              <dd>{titleCase(storyboard.status)}</dd>
            </div>
            <div>
              <dt>Scenes</dt>
              <dd>{stats.scenes}</dd>
            </div>
            <div>
              <dt>Beats</dt>
              <dd>{stats.beats}</dd>
            </div>
            <div>
              <dt>Panels</dt>
              <dd>{stats.panels}</dd>
            </div>
          </dl>
          {panels.length > 0 ? (
            <div className={styles.panelGrid}>
              {panels.map((panel) => (
                <StoryboardPanelThumb panel={panel} key={panel.id} />
              ))}
            </div>
          ) : (
            <p className={styles.muted}>Storyboard structure exists, but no panel images are ready yet.</p>
          )}
        </>
      ) : null}
    </section>
  );
}

function StoryboardPanelThumb({ panel }: { panel: StoryboardPanel }) {
  const image = panel.thumbnailUrl ?? panel.url;
  if (image) {
    return (
      <img
        className={styles.storyImage}
        src={image}
        alt=""
        loading="lazy"
      />
    );
  }
  return (
    <div className={`${styles.storyImage} ${styles.storyImageEmpty}`}>
      <span>{titleCase(panel.status)}</span>
    </div>
  );
}

function RunsPreview({
  projectId,
  runs,
  loading,
  error,
  onRetry,
}: {
  projectId: string;
  runs: GenerationRun[];
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Runs</span>
          <h2>Recent generation work</h2>
        </div>
        <ButtonLink
          variant="ghost"
          size="sm"
          to={`/library/runs?projectId=${encodeURIComponent(projectId)}`}
        >
          All runs
        </ButtonLink>
      </div>
      {loading ? <div className={styles.placeholder}>Loading runs...</div> : null}
      {!loading && error ? (
        <ErrorState
          title="Unable to load runs"
          body="We couldn't load generation runs for this project."
          error={error}
          onRetry={onRetry}
        />
      ) : null}
      {!loading && !error && runs.length === 0 ? (
        <EmptyState
          title="No runs yet"
          body="Generation runs for this project will appear here."
        />
      ) : null}
      {!loading && !error && runs.length > 0 ? (
        <div className={styles.runList}>
          {runs.map((run) => (
            <Link
              className={styles.runRow}
              to={`/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(run.runId)}`}
              key={run.runId}
            >
              <div>
                <span className={styles.runTitle}>
                  {run.currentStageType ? titleCase(run.currentStageType) : "Generation run"}
                </span>
                <span className={styles.runMeta}>Updated {formatDate(run.updatedAt)}</span>
              </div>
              <div className={styles.progress} aria-label={`${run.progressPercent ?? 0}% complete`}>
                <span style={{ width: `${Math.max(0, Math.min(100, run.progressPercent ?? 0))}%` }} />
              </div>
              <StatusChip status={run.status} />
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ProjectSkeleton() {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`${styles.chip} ${statusClass(status)}`}>
      {titleCase(status)}
    </span>
  );
}

function statusClass(status: string) {
  if (status === "running" || status === "processing") return styles.statusRunning;
  if (status === "succeeded" || status === "ready" || status === "active") {
    return styles.statusSucceeded;
  }
  if (status === "failed" || status === "canceled" || status === "deleted") {
    return styles.statusFailed;
  }
  return "";
}

function storyboardStats(storyboard: ProjectStoryboard | null) {
  if (!storyboard) return { scenes: 0, beats: 0, panels: 0 };
  return storyboard.scenes.reduce(
    (stats, scene) => {
      stats.scenes += 1;
      stats.beats += scene.beats.length;
      stats.panels += scene.beats.reduce((count, beat) => count + beat.panels.length, 0);
      return stats;
    },
    { scenes: 0, beats: 0, panels: 0 },
  );
}

function firstPanels(storyboard: ProjectStoryboard | null, limit: number) {
  if (!storyboard) return [];
  return storyboard.scenes
    .flatMap((scene) => scene.beats)
    .flatMap((beat) => {
      const selected = beat.panels.find((panel) => panel.isSelected);
      return selected ? [selected] : beat.panels.slice(0, 1);
    })
    .slice(0, limit);
}

function formatDate(value?: string) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDuration(seconds?: VideoBriefInput["targetLengthSec"]) {
  if (!Number.isFinite(seconds)) return null;
  const totalSeconds = Math.max(0, Math.round(seconds ?? 0));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}
