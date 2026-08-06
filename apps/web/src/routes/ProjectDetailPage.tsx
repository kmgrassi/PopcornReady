import { type ReactNode, useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import type {
  BoardRevisionTarget,
  ProjectStoryboard,
  V1Project,
} from "@popcorn/shared/v1/types";
import type { ScriptDraft } from "@popcorn/shared/types";
import type { ProjectWatchMedia, WorkspaceOutput } from "../lib/api-client";
import { useAuth } from "../components/auth/AuthProvider";
import { AiAssetFeedbackDialog } from "../components/ai-edit/AiAssetFeedbackDialog";
import { QuickLoadingState } from "../components/ui/QuickLoadingState";
import { ButtonLink } from "../components/ui/Button";
import { ErrorState } from "../components/ui/StateCard";
import { ProjectUploadButton } from "../components/project-upload/ProjectUploadButton";
import { storyboardProgress, type StoryboardProgress } from "../lib/v1/storyboard/progress";
import {
  useDeleteProjectMutation,
  useProjectQuery,
  useProjectScriptQuery,
  useProjectStoryboardQuery,
  useProjectStoryboardRunQuery,
  useStartProjectStoryboardRunMutation,
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

export type RequestChangesScope = "concept" | "brief" | "script" | "board";

interface ChangeRequest {
  target: BoardRevisionTarget;
  title: string;
  subtitle: string;
  summary: string | null;
}

function buildChangeRequest(
  scope: RequestChangesScope,
  project: V1Project,
  storyboard: ProjectStoryboard | null
): ChangeRequest {
  const brief = project.brief ?? null;
  switch (scope) {
    case "concept":
      return {
        target: { scope, label: "Concept", ...(brief ? { currentBrief: brief } : {}) },
        title: "Change the concept",
        subtitle: "Concept — big idea, poster, and creative direction",
        summary: brief?.oneBigIdea ?? brief?.goal ?? null,
      };
    case "brief":
      return {
        target: { scope, label: "Brief", ...(brief ? { currentBrief: brief } : {}) },
        title: "Change the brief",
        subtitle: "Brief — goal, audience, style, and structure",
        summary: brief?.goal ?? null,
      };
    case "script":
      return {
        target: { scope, label: "Script", ...(brief ? { currentBrief: brief } : {}) },
        title: "Change the script",
        subtitle: "Script — narration and dialogue",
        summary: brief?.narration?.script?.trim() || null,
      };
    case "board":
      return {
        target: {
          scope,
          label: "Storyboard",
          ...(storyboard ? { storyboardId: storyboard.id } : {}),
        },
        title: "Change the storyboard",
        subtitle: "Storyboard — scenes and moments",
        summary: storyboard
          ? `${storyboard.scenes.length} ${storyboard.scenes.length === 1 ? "scene" : "scenes"}`
          : null,
      };
  }
}

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
  const scriptQuery = useProjectScriptQuery(projectId ?? "", Boolean(projectId));
  const deleteProjectMutation = useDeleteProjectMutation(projectId ?? "");
  const startStoryboardRunMutation = useStartProjectStoryboardRunMutation(projectId ?? "");
  const runsQuery = useDashboardRunsQuery(authScope, {
    status: "all",
    projectId: projectId ?? undefined,
    limit: RUN_LIMIT,
  });
  const latestRun = runsQuery.items[0] ?? null;
  const storyboardRunQuery = useProjectStoryboardRunQuery(projectId ?? "", Boolean(projectId));
  const storyboardBoundRun = storyboardRunQuery.data?.run ?? null;
  const storyboardRunNeedsReview = Boolean(
    storyboardBoundRun?.storyboardBoundaryStatus === "pending" &&
      storyboardBoundRun.reviewGate,
  );
  const storyboardRunActive = Boolean(
    storyboardBoundRun &&
      storyboardBoundRun.storyboardBoundaryStatus === "pending" &&
      (storyboardBoundRun.status === "queued" || storyboardBoundRun.status === "running")
  );
  const storyboardRunBlocksCreate = storyboardRunActive || storyboardRunNeedsReview;
  const storyboardReviewRunLink = storyboardRunNeedsReview && storyboardBoundRun
    ? `/projects/${encodeURIComponent(projectId ?? "")}/runs/${encodeURIComponent(storyboardBoundRun.runId)}`
    : null;
  const storyboardQuery = useProjectStoryboardQuery(
    projectId ?? "",
    Boolean(projectId),
    storyboardRunActive
  );
  const refetchStoryboard = storyboardQuery.refetch;
  const outputsQuery = useDashboardOutputsQuery(authScope, {
    projectId: projectId ?? undefined,
    limit: OUTPUT_LIMIT,
  });
  const [changeRequest, setChangeRequest] = useState<ChangeRequest | null>(null);
  const [changeSent, setChangeSent] = useState<string | null>(null);

  useEffect(() => {
    if (
      storyboardBoundRun?.storyboardBoundaryStatus === "reached" ||
      storyboardBoundRun?.status === "succeeded"
    ) {
      void refetchStoryboard();
    }
  }, [refetchStoryboard, storyboardBoundRun?.status, storyboardBoundRun?.storyboardBoundaryStatus]);

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
  const storyboardRunError =
    !storyboard &&
    storyboardBoundRun &&
    (storyboardBoundRun.status === "failed" || storyboardBoundRun.status === "canceled")
      ? new Error(
          storyboardBoundRun.error?.message ??
            (storyboardBoundRun.status === "canceled"
              ? "Storyboard production stopped before a board was ready."
              : "Storyboard production failed before a board was ready.")
        )
      : null;
  // One continuous "in progress" signal: the request is starting, a production
  // run is working toward the storyboard boundary, or panel assets are rendering.
  const storyboardGenerating =
    startStoryboardRunMutation.isPending ||
    storyboardRunActive ||
    storyboardProgressState.isGenerating;
  const loading = projectQuery.isLoading || scriptQuery.isLoading;
  const error = projectQuery.error ?? scriptQuery.error ?? null;
  const hasPlayableOutput = outputsQuery.items.some(isPlayableOutput);
  const watchDisabled = outputsQuery.loading || !hasPlayableOutput;
  const watchTitle = outputsQuery.loading
    ? "Checking for a playable export."
    : hasPlayableOutput
      ? "Watch this project's latest video."
      : "Watch is available after this project has a playable video.";
  const runsDisabled = runsQuery.loading || !latestRun;
  const runsTitle = runsQuery.loading
    ? "Checking for recent runs."
    : latestRun
      ? "Open this project's latest run."
      : "Runs are available after this project starts generation.";
  const startStoryboardRun = () => {
    void startStoryboardRunMutation
      .mutateAsync()
      .then(({ runId }) => {
        navigate(
          `/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`
        );
      })
      .catch(() => undefined);
  };
  const mobilePrimaryAction = project ? (
    <ProjectMobilePrimaryAction
      projectId={projectId}
      hasPlayableOutput={hasPlayableOutput}
      watchDisabled={watchDisabled}
      watchTitle={watchTitle}
      storyboard={storyboard}
      storyboardGenerating={storyboardGenerating}
      storyboardError={startStoryboardRunMutation.error ?? storyboardRunError}
      scriptReviewRunLink={storyboardReviewRunLink}
      hasBrief={Boolean(project.brief)}
      canGenerateStoryboard={Boolean(
        !storyboardPreviewIsBlocked(storyboardQuery.isLoading, storyboardQuery.error) &&
          !storyboardGenerating &&
          !storyboardRunBlocksCreate &&
          project.brief
      )}
      onGenerate={startStoryboardRun}
    />
  ) : null;

  return (
    <>
      <ProjectOverviewPage
      projectId={projectId}
      project={project}
      storyboard={storyboard}
      activeScript={scriptQuery.data?.script?.scriptDraft ?? null}
      scriptAssetId={scriptQuery.data?.script?.assetId ?? null}
      loading={loading}
      error={error}
      onRequestChanges={(scope) => {
        if (!project) return;
        setChangeSent(null);
        setChangeRequest(buildChangeRequest(scope, project, storyboard));
      }}
      notice={
        changeSent ? (
          <p className={styles.changeSentNotice} role="status">
            Sent {changeSent} feedback to the agent. The run will update this
            project in context.
          </p>
        ) : null
      }
      onProjectRetry={() => {
        void projectQuery.refetch();
        void scriptQuery.refetch();
      }}
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
          {hasPlayableOutput ? (
            <>
              <ButtonLink variant="secondary" to={`/projects/${encodeURIComponent(projectId)}/watch`}>
                Outputs
              </ButtonLink>
              <ButtonLink variant="primary" to={`/projects/${encodeURIComponent(projectId)}/watch`}>
                Watch
              </ButtonLink>
            </>
          ) : outputsQuery.error ? (
            <p className={styles.outputUnavailable} role="alert">
              Unable to check video outputs right now. Open Runs to inspect the latest generation state.
            </p>
          ) : (
            <p className={styles.outputUnavailable} role="status" title={watchTitle}>
              {outputsQuery.loading
                ? "Checking for a playable video…"
                : storyboard
                  ? "No playable video yet. The storyboard remains available in this workspace."
                  : "No playable video yet. Continue the run or create a storyboard first."}
            </p>
          )}
        </>
      }
      storyboardPreview={{
        loading: storyboardQuery.isLoading,
        error: storyboardQuery.error,
        onRetry: () => void storyboardQuery.refetch(),
        generating: storyboardGenerating,
        progress: storyboardProgressState,
        generationError: startStoryboardRunMutation.error ?? storyboardRunError,
        unavailableReason: project?.brief
          ? storyboardRunNeedsReview
            ? "Review and approve the script before storyboard production begins."
            : null
          : "Finish the project brief before creating a storyboard.",
        reviewRunLink: storyboardReviewRunLink,
        onGenerate: startStoryboardRun,
      }}
      media={null}
      mobilePrimaryAction={mobilePrimaryAction}
      mobileStatus={mobileProjectStatus({
        storyboard,
        progress: storyboardProgressState,
        generating: storyboardGenerating,
        hasPlayableOutput,
        hasBrief: Boolean(project?.brief),
        projectStatus: project?.status,
        storyboardError: startStoryboardRunMutation.error ?? storyboardRunError,
        scriptReviewPending: storyboardRunNeedsReview,
      })}
      mobileRunLink={
        storyboardRunBlocksCreate && storyboardBoundRun
          ? `/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(storyboardBoundRun.runId)}`
          : latestRun
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
      <AiAssetFeedbackDialog
        open={Boolean(changeRequest)}
        projectId={projectId}
        target={changeRequest?.target ?? null}
        title={changeRequest?.title ?? "Request changes"}
        subtitle={changeRequest?.subtitle}
        asset={
          changeRequest?.summary ? (
            <p className={styles.changeRequestSummary}>{changeRequest.summary}</p>
          ) : (
            <p className={styles.changeRequestSummary}>
              Describe what should change; the agent applies it in context and
              propagates it downstream.
            </p>
          )
        }
        onExecutionStarted={() => {
          setChangeSent(changeRequest?.target.label ?? "change");
          void runsQuery.refetch();
        }}
        onExecutionSettled={() => {
          void projectQuery.refetch();
          void scriptQuery.refetch();
          void storyboardQuery.refetch();
          void outputsQuery.refetch();
        }}
        onClose={() => setChangeRequest(null)}
      />
    </>
  );
}

function storyboardPreviewIsBlocked(loading: boolean, error: Error | null) {
  return loading || Boolean(error);
}

export function ProjectOverviewPage({
  projectId,
  project,
  storyboard,
  activeScript,
  scriptAssetId,
  loading,
  error,
  onProjectRetry,
  onRequestChanges,
  notice,
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
  activeScript?: ScriptDraft | null;
  scriptAssetId?: string | null;
  loading: boolean;
  error: Error | null;
  onProjectRetry: () => void;
  onRequestChanges?: (scope: RequestChangesScope) => void;
  notice?: ReactNode;
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
    unavailableReason?: string | null;
    reviewRunLink?: string | null;
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
          {notice}
          <div
            className={`${stagePanel ? styles.projectPageLayout : styles.projectContent} ${styles.desktopProjectOverview}`}
            id="overview"
          >
            <div className={stagePanel ? styles.projectContent : undefined}>
              <section className={styles.projectTopLayout}>
                <div className={styles.projectPrimaryColumn}>
                  <ProjectConcept
                    project={project}
                    projectId={projectId}
                    readOnly={readOnly}
                    onRequestChanges={
                      onRequestChanges ? () => onRequestChanges("concept") : undefined
                    }
                  />
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
                    unavailableReason={storyboardPreview.unavailableReason}
                    reviewRunLink={storyboardPreview.reviewRunLink}
                    onGenerate={storyboardPreview.onGenerate}
                    onRequestChanges={
                      onRequestChanges ? () => onRequestChanges("board") : undefined
                    }
                    readOnly={readOnly}
                  />
                  <div className={styles.projectContextGrid}>
                    <ProjectBrief
                      project={project}
                      projectId={projectId}
                      readOnly={readOnly}
                      onRequestChanges={
                        onRequestChanges ? () => onRequestChanges("brief") : undefined
                      }
                    />
                    <ProjectScript
                      project={project}
                      projectId={projectId}
                      storyboard={storyboard}
                      activeScript={activeScript ?? null}
                      scriptAssetId={scriptAssetId ?? null}
                      readOnly={readOnly}
                      onRequestChanges={
                        onRequestChanges ? () => onRequestChanges("script") : undefined
                      }
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
    <QuickLoadingState
      title="Loading project"
      description="Gathering the latest project details."
      reservation={(
        <div className={styles.skeleton}>
          <span />
          <span />
          <span />
        </div>
      )}
      variant="page"
    />
  );
}

function isPlayableOutput(output: WorkspaceOutput) {
  return Boolean(output.playbackUrl ?? output.url);
}
