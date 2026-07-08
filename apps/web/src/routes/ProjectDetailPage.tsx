import { type ReactNode, useEffect, useMemo } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import type { ProjectStoryboard, V1Project } from "@popcorn/shared/v1/types";
import type { ProjectWatchMedia, WorkspaceOutput } from "../lib/api-client";
import { useAuth } from "../components/auth/AuthProvider";
import { ButtonLink } from "../components/ui/Button";
import { ErrorState } from "../components/ui/StateCard";
import { ProjectUploadButton } from "../components/project-upload/ProjectUploadButton";
import { storyboardProgress, type StoryboardProgress } from "../lib/v1/storyboard/progress";
import {
  useGenerateProjectStoryboardMutation,
  useDeleteProjectMutation,
  useProjectQuery,
  useProjectStoryboardJobQuery,
  useProjectStoryboardQuery,
} from "../lib/queryClient";
import {
  useDashboardOutputsQuery,
  useDashboardRunsQuery,
} from "../lib/v1/dashboard/query";
import { ProjectStagePanel } from "./ProjectStagePanel";
import { StoryboardPreview } from "./StoryboardPreview";
import {
  ProjectBrief,
  ProjectConcept,
  ProjectDangerSection,
  ProjectScript,
  ProjectWatchVideo,
} from "./ProjectDetailSections";
import {
  MobileProjectStatus,
  ProjectMobilePrimaryAction,
  mobileProjectStatus,
} from "./ProjectMobileStatus";
import styles from "./ProjectDetailPage.module.css";
import { formatDate } from "./project-detail-format";

export { ProjectDangerSection } from "./ProjectDetailSections";

const DEV_AUTOPILOT = import.meta.env.DEV;
const RUN_LIMIT = 6;
const OUTPUT_LIMIT = 6;
const PROJECT_SECTIONS = ["concept", "brief", "script"] as const;

type ProjectSectionId = (typeof PROJECT_SECTIONS)[number];

function useDashboardAuthScope() {
  const auth = useAuth();
  return auth.user?.id ?? (DEV_AUTOPILOT ? "dev-autopilot" : auth.status);
}

export function ProjectDetailPage() {
  const { projectId, section } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const activeSection = isProjectSectionId(section) ? section : null;
  const authScope = useDashboardAuthScope();
  const projectQuery = useProjectQuery(projectId ?? "", Boolean(projectId));
  const deleteProjectMutation = useDeleteProjectMutation(projectId ?? "");
  const generateStoryboardMutation = useGenerateProjectStoryboardMutation(projectId ?? "");
  // Latest job for the project, fetched from the server, so an in-flight
  // generation is rediscovered after a reload (the storyboard row isn't created
  // until every tile is generated, so before then this is the only signal).
  const storyboardJobQuery = useProjectStoryboardJobQuery(projectId ?? "", Boolean(projectId));
  const storyboardGenerationJob = storyboardJobQuery.data?.job ?? null;
  const jobActive = Boolean(
    storyboardGenerationJob &&
      storyboardGenerationJob.status !== "succeeded" &&
      storyboardGenerationJob.status !== "failed" &&
      storyboardGenerationJob.status !== "canceled"
  );
  // Keep the storyboard query polling while the job runs so the row appears and
  // panel progress streams in.
  const storyboardQuery = useProjectStoryboardQuery(
    projectId ?? "",
    Boolean(projectId),
    jobActive
  );
  const refetchStoryboard = storyboardQuery.refetch;
  const storyboardGenerationError = useMemo(() => {
    if (storyboardGenerationJob?.status === "failed" && storyboardGenerationJob.error) {
      return new Error(storyboardGenerationJob.error.message);
    }
    return storyboardJobQuery.error;
  }, [
    storyboardGenerationJob?.status,
    storyboardGenerationJob?.error?.message,
    storyboardJobQuery.error,
  ]);
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
    if (!projectQuery.data?.project) return;
    const sectionId = location.hash ? decodeURIComponent(location.hash.slice(1)) : activeSection ?? "";
    if (!sectionId) return;
    window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ block: "start" });
    });
  }, [activeSection, location.hash, projectQuery.data?.project]);

  if (!projectId) return <Navigate to="/library/projects" replace />;
  if (section && !activeSection) {
    return <Navigate to={`/projects/${encodeURIComponent(projectId)}`} replace />;
  }

  const project = projectQuery.data?.project ?? null;
  const storyboard = storyboardQuery.data?.storyboard ?? null;
  const storyboardProgressState = storyboardProgress(storyboard);
  // One continuous "in progress" signal: the request is in flight, the job is
  // running, or the storyboard still has panels rendering. The "Generate again"
  // control only returns once all of these settle.
  const storyboardGenerating =
    generateStoryboardMutation.isPending || jobActive || storyboardProgressState.isGenerating;
  const loading = projectQuery.isLoading;
  const error = projectQuery.error ?? null;
  const hasPlayableOutput = outputsQuery.items.some(isPlayableOutput);
  const watchDisabled = outputsQuery.loading || !hasPlayableOutput;
  const watchTitle = outputsQuery.loading
    ? "Checking for a playable export."
    : hasPlayableOutput
      ? "Watch this project's latest video."
      : "Watch is available after this project has a playable video.";
  const latestRun = runsQuery.items[0] ?? null;
  const runsDisabled = runsQuery.loading || !latestRun;
  const runsTitle = runsQuery.loading
    ? "Checking for recent runs."
    : latestRun
      ? "Open this project's latest run."
      : "Runs are available after this project starts generation.";
  const mobilePrimaryAction = project ? (
    <ProjectMobilePrimaryAction
      projectId={projectId}
      hasPlayableOutput={hasPlayableOutput}
      watchDisabled={watchDisabled}
      watchTitle={watchTitle}
      storyboard={storyboard}
      storyboardGenerating={storyboardGenerating}
      storyboardError={generateStoryboardMutation.error ?? storyboardGenerationError}
      canGenerateStoryboard={Boolean(
        !storyboardPreviewIsBlocked(storyboardQuery.isLoading, storyboardQuery.error) &&
          !storyboardGenerating
      )}
      onStoryboardRetry={() => void storyboardQuery.refetch()}
      onGenerate={() => {
        void generateStoryboardMutation.mutateAsync().then(() => {
          void storyboardQuery.refetch();
        });
      }}
    />
  ) : null;

  return (
    <ProjectOverviewPage
      projectId={projectId}
      project={project}
      storyboard={storyboard}
      loading={loading}
      error={error}
      onProjectRetry={() => void projectQuery.refetch()}
      backLink={{ to: "/library/projects", label: "Projects" }}
      titleFallback="Project overview"
      loadingSubtitle="Loading project details."
      readOnly={false}
      headerActions={
        <>
          <ProjectUploadButton
            projectId={projectId}
            source="project_view"
            label="Upload more"
          />
          <ButtonLink
            variant="secondary"
            to={
              latestRun
                ? `/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(latestRun.runId)}`
                : `/projects/${encodeURIComponent(projectId)}`
            }
            aria-disabled={runsDisabled}
            title={runsTitle}
          >
            Runs
          </ButtonLink>
          <ButtonLink
            variant="secondary"
            to={`/projects/${encodeURIComponent(projectId)}/watch`}
            aria-disabled={watchDisabled}
            title={watchTitle}
          >
            Outputs
          </ButtonLink>
          <ButtonLink
            variant="primary"
            to={`/projects/${encodeURIComponent(projectId)}/watch`}
            aria-disabled={watchDisabled}
            title={watchTitle}
          >
            Watch
          </ButtonLink>
        </>
      }
      storyboardPreview={{
        loading: storyboardQuery.isLoading,
        error: storyboardQuery.error,
        onRetry: () => void storyboardQuery.refetch(),
        generating: storyboardGenerating,
        progress: storyboardProgressState,
        generationError: generateStoryboardMutation.error ?? storyboardGenerationError,
        onGenerate: () => {
          void generateStoryboardMutation.mutateAsync().then(() => {
            void storyboardQuery.refetch();
          });
        },
      }}
      media={null}
      mobilePrimaryAction={mobilePrimaryAction}
      mobileStatus={mobileProjectStatus({
        storyboard,
        progress: storyboardProgressState,
        generating: storyboardGenerating,
        hasPlayableOutput,
        projectStatus: project?.status,
        storyboardError: generateStoryboardMutation.error ?? storyboardGenerationError,
      })}
      mobileRunLink={
        latestRun
          ? `/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(latestRun.runId)}`
          : null
      }
      dangerSection={
        project ? (
          <ProjectDangerSection
            project={project}
            deleting={deleteProjectMutation.isPending}
            error={deleteProjectMutation.error}
            onDelete={() => {
              void deleteProjectMutation.mutateAsync().then(() => {
                navigate("/library/projects", { replace: true });
              });
            }}
          />
        ) : null
      }
      stagePanel={
        <ProjectStagePanel
          projectId={projectId}
          runs={runsQuery.items}
          loading={runsQuery.loading}
          error={runsQuery.error}
          onRetry={runsQuery.refetch}
        />
      }
    />
  );
}

function storyboardPreviewIsBlocked(loading: boolean, error: Error | null) {
  return loading || Boolean(error);
}

export function ProjectOverviewPage({
  projectId,
  project,
  storyboard,
  loading,
  error,
  onProjectRetry,
  backLink,
  titleFallback,
  loadingSubtitle,
  readOnly,
  headerActions,
  storyboardPreview,
  media,
  dangerSection,
  stagePanel,
  mobilePrimaryAction,
  mobileStatus,
  mobileRunLink,
}: {
  projectId: string;
  project: V1Project | null;
  storyboard: ProjectStoryboard | null;
  loading: boolean;
  error: Error | null;
  onProjectRetry: () => void;
  backLink: { to: string; label: string };
  titleFallback: string;
  loadingSubtitle: string;
  readOnly: boolean;
  headerActions?: ReactNode;
  storyboardPreview: {
    loading: boolean;
    error: Error | null;
    onRetry: () => void;
    generating: boolean;
    progress: StoryboardProgress;
    generationError: Error | null;
    onGenerate?: () => void;
  };
  media?: ProjectWatchMedia | null;
  dangerSection?: ReactNode;
  stagePanel?: ReactNode;
  mobilePrimaryAction?: ReactNode;
  mobileStatus?: string;
  mobileRunLink?: string | null;
}) {
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <Link className={styles.backLink} to={backLink.to}>
            {backLink.label}
          </Link>
          <h1>{project?.name ?? titleFallback}</h1>
          <p>{project ? `Updated ${formatDate(project.updatedAt)}` : loadingSubtitle}</p>
        </div>
        {headerActions ? <div className={styles.headerActions}>{headerActions}</div> : null}
      </header>

      {loading ? <ProjectSkeleton /> : null}

      {!loading && error ? (
        <ErrorState
          title="Unable to load project"
          body="We couldn't load this project overview."
          error={error}
          onRetry={onProjectRetry}
        />
      ) : null}

      {!loading && !error && project ? (
        <>
          <MobileProjectStatus
            project={project}
            projectId={projectId}
            storyboard={storyboard}
            storyboardProgressState={storyboardPreview.progress}
            storyboardGenerating={storyboardPreview.generating}
            storyboardError={storyboardPreview.generationError ?? storyboardPreview.error}
            readOnly={readOnly}
            media={media}
            status={mobileStatus}
            primaryAction={mobilePrimaryAction ?? headerActions}
            runLink={mobileRunLink}
          />
          <div
            className={`${stagePanel ? styles.projectPageLayout : styles.projectContent} ${styles.desktopProjectOverview}`}
            id="overview"
          >
            <div className={stagePanel ? styles.projectContent : undefined}>
              <section className={styles.projectTopLayout}>
                <div className={styles.projectPrimaryColumn}>
                  <ProjectConcept project={project} projectId={projectId} readOnly={readOnly} />
                </div>
                <div className={styles.projectStoryboardColumn}>
                  <StoryboardPreview
                    projectId={projectId}
                    storyboard={storyboard}
                    loading={storyboardPreview.loading}
                    error={storyboardPreview.error}
                    onRetry={storyboardPreview.onRetry}
                    generating={storyboardPreview.generating}
                    progress={storyboardPreview.progress}
                    generationError={storyboardPreview.generationError}
                    onGenerate={storyboardPreview.onGenerate}
                    readOnly={readOnly}
                  />
                  <div className={styles.projectContextGrid}>
                    <ProjectBrief project={project} projectId={projectId} readOnly={readOnly} />
                    <ProjectScript
                      project={project}
                      projectId={projectId}
                      storyboard={storyboard}
                      readOnly={readOnly}
                    />
                  </div>
                </div>
              </section>
              {media ? <ProjectWatchVideo media={media} /> : null}
              {dangerSection}
            </div>
            {stagePanel ? (
              <aside className={styles.stageAside} aria-label="Run pipeline">
                {stagePanel}
              </aside>
            ) : null}
          </div>
        </>
      ) : null}
    </main>
  );
}

function isProjectSectionId(value: string | undefined): value is ProjectSectionId {
  return PROJECT_SECTIONS.includes(value as ProjectSectionId);
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

function isPlayableOutput(output: WorkspaceOutput) {
  return Boolean(output.playbackUrl ?? output.url);
}
