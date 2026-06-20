import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import type {
  GenerationRun,
  GenerationStageType,
  ProjectStoryboard,
  StoryboardPanel,
  V1Project,
  VideoBriefInput,
} from "@popcorn/shared/v1/types";
import {
  GENERATION_STAGE_LABELS,
  GENERATION_STAGE_ORDER,
} from "@popcorn/shared/v1/types";
import type { WorkspaceOutput } from "../lib/api-client";
import { useAuth } from "../components/auth/AuthProvider";
import { Button, ButtonLink } from "../components/ui/Button";
import { EmptyState, ErrorState } from "../components/ui/StateCard";
import {
  useGenerateProjectStoryboardMutation,
  useProjectQuery,
  useProjectStoryboardGenerationJobQuery,
  useProjectStoryboardQuery,
} from "../lib/queryClient";
import {
  useDashboardOutputsQuery,
  useDashboardRunsQuery,
} from "../lib/v1/dashboard/query";
import styles from "./ProjectDetailPage.module.css";

const DEV_AUTOPILOT = import.meta.env.DEV;
const RUN_LIMIT = 6;
const OUTPUT_LIMIT = 6;

function useDashboardAuthScope() {
  const auth = useAuth();
  return auth.user?.id ?? (DEV_AUTOPILOT ? "dev-autopilot" : auth.status);
}

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const location = useLocation();
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
  const outputsQuery = useDashboardOutputsQuery(authScope, {
    projectId: projectId ?? undefined,
    limit: OUTPUT_LIMIT,
  });

  useEffect(() => {
    if (storyboardGenerationJob?.status === "succeeded") {
      void refetchStoryboard();
    }
  }, [refetchStoryboard, storyboardGenerationJob?.status]);

  useEffect(() => {
    if (!location.hash || !projectQuery.data?.project) return;
    const sectionId = decodeURIComponent(location.hash.slice(1));
    window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ block: "start" });
    });
  }, [location.hash, projectQuery.data?.project]);

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
            to="#runs"
          >
            Runs
          </ButtonLink>
          <ButtonLink
            variant="secondary"
            to="#outputs"
          >
            Outputs
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
          <section className={styles.overviewLayout}>
            <ProjectHero project={project} storyboard={storyboard} />
            <ProjectPipelinePanel
              projectId={projectId}
              runs={runsQuery.items}
              loading={runsQuery.loading}
              error={runsQuery.error}
              onRetry={runsQuery.refetch}
            />
          </section>
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
            loadingMore={runsQuery.loadingMore}
            hasMore={runsQuery.hasMore}
            error={runsQuery.error}
            onRetry={runsQuery.refetch}
            onLoadMore={() => void runsQuery.fetchNextPage()}
          />
          <OutputsPreview
            outputs={outputsQuery.items}
            loading={outputsQuery.loading}
            loadingMore={outputsQuery.loadingMore}
            hasMore={outputsQuery.hasMore}
            error={outputsQuery.error}
            onRetry={outputsQuery.refetch}
            onLoadMore={() => void outputsQuery.fetchNextPage()}
          />
        </>
      ) : null}
    </main>
  );
}

function ProjectPipelinePanel({
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
  const latestRun = runs[0] ?? null;
  const currentStage = latestRun
    ? latestRun.reviewGate?.stageType ?? latestRun.currentStageType ?? null
    : null;
  const currentStageLabel = currentStage
    ? GENERATION_STAGE_LABELS[currentStage]
    : latestRun?.status === "queued"
      ? "Queued"
      : "Not started";
  const nextStage = latestRun ? nextStageType(latestRun, currentStage) : null;
  const nextStageLabel = nextStage ? GENERATION_STAGE_LABELS[nextStage] : null;
  const progressPercent = Math.max(
    0,
    Math.min(100, latestRun?.progressPercent ?? 0),
  );

  return (
    <aside className={styles.pipelinePanel} aria-label="Project pipeline">
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Pipeline</span>
          <h2>Stage and next step</h2>
        </div>
      </div>

      {loading ? <div className={styles.placeholder}>Loading pipeline...</div> : null}

      {!loading && error ? (
        <ErrorState
          title="Unable to load pipeline"
          body="We couldn't load the latest generation run for this project."
          error={error}
          onRetry={onRetry}
        />
      ) : null}

      {!loading && !error && !latestRun ? (
        <EmptyState
          title="No pipeline activity"
          body="Start a generation run to see the current stage and next step."
        />
      ) : null}

      {!loading && !error && latestRun ? (
        <>
          <div className={styles.pipelineSummary}>
            <div>
              <span className={styles.statusLabel}>Current stage</span>
              <strong>
                {latestRun.reviewGate ? `${currentStageLabel} review` : currentStageLabel}
              </strong>
            </div>
            <div>
              <span className={styles.statusLabel}>Status</span>
              <strong>{latestRun.reviewGate ? "Needs review" : titleCase(latestRun.status)}</strong>
            </div>
            <div>
              <span className={styles.statusLabel}>Next step</span>
              <strong>{nextStageLabel ?? (isTerminalRun(latestRun) ? "Complete" : "Preparing")}</strong>
            </div>
          </div>

          <div
            className={styles.pipelineMeter}
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${progressPercent}% complete`}
          >
            <span style={{ width: `${Math.max(2, progressPercent)}%` }} />
          </div>

          <p className={styles.pipelineMeta}>
            Updated {formatDate(latestRun.updatedAt)}
          </p>

          <ButtonLink
            variant="secondary"
            size="sm"
            to={`/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(latestRun.runId)}`}
          >
            View run
          </ButtonLink>
        </>
      ) : null}
    </aside>
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
          <DetailTerm label="Prompt" value={brief.goal} />
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
          to="#runs"
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
  loadingMore,
  hasMore,
  error,
  onRetry,
  onLoadMore,
}: {
  projectId: string;
  runs: GenerationRun[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: Error | null;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  return (
    <section className={styles.panel} id="runs">
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Runs</span>
          <h2>Recent generation work</h2>
        </div>
        <ButtonLink
          variant="ghost"
          size="sm"
          to={`/projects/${encodeURIComponent(projectId)}`}
        >
          Project
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
      {hasMore ? (
        <div className={styles.loadMore}>
          <Button variant="secondary" size="sm" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? "Loading..." : "Load more runs"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function OutputsPreview({
  outputs,
  loading,
  loadingMore,
  hasMore,
  error,
  onRetry,
  onLoadMore,
}: {
  outputs: WorkspaceOutput[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: Error | null;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  return (
    <section className={styles.panel} id="outputs">
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Outputs</span>
          <h2>Finished exports</h2>
        </div>
      </div>
      {loading ? <div className={styles.placeholder}>Loading outputs...</div> : null}
      {!loading && error ? (
        <ErrorState
          title="Unable to load outputs"
          body="We couldn't load exported videos for this project."
          error={error}
          onRetry={onRetry}
        />
      ) : null}
      {!loading && !error && outputs.length === 0 ? (
        <EmptyState
          title="No outputs yet"
          body="Finished exports for this project will appear here."
        />
      ) : null}
      {!loading && !error && outputs.length > 0 ? (
        <div className={styles.outputGrid}>
          {outputs.map((output) => {
            const playbackUrl = output.playbackUrl ?? output.url;
            const meta = [output.format?.toUpperCase(), formatDuration(output.durationSec)]
              .filter(Boolean)
              .join(" - ");
            return (
              <article className={styles.outputCard} key={output.artifactId}>
                <div className={styles.outputMedia}>
                  {playbackUrl ? (
                    <video
                      src={playbackUrl}
                      poster={output.thumbnailUrl}
                      muted
                      playsInline
                      preload="metadata"
                    />
                  ) : output.thumbnailUrl ? (
                    <img src={output.thumbnailUrl} alt="" loading="lazy" />
                  ) : (
                    <span>Output</span>
                  )}
                </div>
                <div className={styles.outputBody}>
                  <span className={styles.runTitle}>Exported {formatDate(output.createdAt)}</span>
                  <span className={styles.runMeta}>{meta || "Finished export"}</span>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
      {hasMore ? (
        <div className={styles.loadMore}>
          <Button variant="secondary" size="sm" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? "Loading..." : "Load more outputs"}
          </Button>
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

function isTerminalRun(run: GenerationRun) {
  return run.status === "succeeded" || run.status === "failed" || run.status === "canceled";
}

function nextStageType(
  run: GenerationRun,
  currentStage: GenerationStageType | null,
): GenerationStageType | null {
  if (isTerminalRun(run)) return null;
  if (!currentStage) return run.status === "queued" ? "brief_intake" : null;
  const currentOrder = GENERATION_STAGE_ORDER[currentStage];
  const nextEntry = Object.entries(GENERATION_STAGE_ORDER)
    .filter((entry): entry is [GenerationStageType, number] => entry[0] !== "ready")
    .sort((a, b) => a[1] - b[1])
    .find(([, order]) => order > currentOrder);
  return nextEntry?.[0] ?? null;
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
