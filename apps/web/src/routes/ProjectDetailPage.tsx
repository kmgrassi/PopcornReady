import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import type {
  ProjectVisibility,
  ProjectStoryboard,
  V1Project,
} from "@popcorn/shared/v1/types";
import type { ProjectWatchMedia, WorkspaceOutput } from "../lib/api-client";
import { useAuth } from "../components/auth/AuthProvider";
import { Button, ButtonLink } from "../components/ui/Button";
import { ImageWithSkeleton } from "../components/ui/ImageWithSkeleton";
import { ErrorState } from "../components/ui/StateCard";
import { VisibilityBadge } from "../components/ui/VisibilityBadge";
import { storyboardProgress, type StoryboardProgress } from "../lib/v1/storyboard/progress";
import {
  useGenerateProjectStoryboardMutation,
  useDeleteProjectMutation,
  useProjectQuery,
  useSetProjectVisibilityMutation,
  useProjectStoryboardJobQuery,
  useProjectStoryboardQuery,
} from "../lib/queryClient";
import {
  useDashboardOutputsQuery,
  useDashboardRunsQuery,
} from "../lib/v1/dashboard/query";
import { ProjectStagePanel } from "./ProjectStagePanel";
import { StoryboardPreview } from "./StoryboardPreview";
import styles from "./ProjectDetailPage.module.css";
import { formatDate, formatDuration, titleCase } from "./project-detail-format";

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
        <div className={stagePanel ? styles.projectPageLayout : styles.projectContent} id="overview">
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
      ) : null}
    </main>
  );
}

function ProjectWatchVideo({ media }: { media: ProjectWatchMedia }) {
  return (
    <section className={styles.panel} id="watch">
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Watch</span>
          <h2>Final video</h2>
        </div>
      </div>
      <video
        className={styles.watchVideo}
        src={media.url}
        poster={media.posterUrl}
        controls
        playsInline
        preload="metadata"
      />
    </section>
  );
}

function isProjectSectionId(value: string | undefined): value is ProjectSectionId {
  return PROJECT_SECTIONS.includes(value as ProjectSectionId);
}

function ProjectConcept({
  project,
  projectId,
  readOnly,
}: {
  project: V1Project;
  projectId: string;
  readOnly: boolean;
}) {
  const brief = project.brief;
  const title = brief?.oneBigIdea ?? brief?.goal ?? project.name;
  const visibility = project.visibility ?? "public";
  const nextVisibility: ProjectVisibility =
    visibility === "public" ? "private" : "public";
  const visibilityMutation = useSetProjectVisibilityMutation(projectId);
  const [confirmVisibility, setConfirmVisibility] = useState<ProjectVisibility | null>(null);
  const helperText =
    visibility === "public"
      ? "Visible in public discovery. Public assets can be shared."
      : "Only your workspace can view it. Media uses private links.";
  const shareUrl = publicProjectUrl(project.id);
  return (
    <section className={styles.hero} id="concept">
      <ProjectPoster name={project.name} posterUrl={project.posterUrl} />
      <div className={styles.heroBody}>
        <div className={styles.metaRow}>
          <StatusChip status={project.status} />
          <VisibilityBadge visibility={visibility} />
          <span>Created {formatDate(project.createdAt)}</span>
          {!readOnly ? (
            <div className={styles.visibilityControl}>
              <Button
                variant="ghost"
                size="sm"
                disabled={visibilityMutation.isPending}
                isLoading={visibilityMutation.isPending}
                onClick={() => setConfirmVisibility(nextVisibility)}
              >
                {nextVisibility === "private" ? "Make private" : "Make public"}
              </Button>
              <span>{helperText}</span>
            </div>
          ) : null}
          {!readOnly ? (
            <ButtonLink
              variant="ghost"
              size="sm"
              to={`/projects/${encodeURIComponent(projectId)}/concept`}
            >
              Open concept
            </ButtonLink>
          ) : null}
        </div>
        {!readOnly ? (
          <ProjectShareAffordance
            visibility={visibility}
            shareUrl={shareUrl}
          />
        ) : null}
        <div>
          <span className={styles.eyebrow}>Concept</span>
          <h2 className={styles.conceptTitle}>
            {readOnly ? (
              title
            ) : (
              <Link
                className={styles.sectionTitleLink}
                to={`/projects/${encodeURIComponent(projectId)}/concept`}
              >
                {title}
              </Link>
            )}
          </h2>
          {brief?.strongestVisual ? (
            <p className={styles.conceptSummary}>{brief.strongestVisual}</p>
          ) : null}
        </div>
        <dl className={styles.stats}>
          <div>
            <dt>Length</dt>
            <dd>{formatDuration(brief?.targetLengthSec) ?? "Unset"}</dd>
          </div>
          <div>
            <dt>Aspect</dt>
            <dd>{brief?.aspectRatio ?? "Unset"}</dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd>{brief?.format ?? "Unset"}</dd>
          </div>
          <div>
            <dt>Platform</dt>
            <dd>{brief?.platform ?? "Unset"}</dd>
          </div>
        </dl>
      </div>
      <ProjectVisibilityConfirmDialog
        visibility={confirmVisibility}
        pending={visibilityMutation.isPending}
        onCancel={() => setConfirmVisibility(null)}
        onConfirm={(visibility) => {
          visibilityMutation.mutate(visibility, {
            onSuccess: () => setConfirmVisibility(null),
          });
        }}
      />
    </section>
  );
}

function ProjectVisibilityConfirmDialog({
  visibility,
  pending,
  onCancel,
  onConfirm,
}: {
  visibility: ProjectVisibility | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (visibility: ProjectVisibility) => void;
}) {
  const titleId = useId();
  if (!visibility) return null;

  const isPublic = visibility === "public";
  const title = isPublic ? "Make this project public?" : "Make this project private?";
  const body = isPublic
    ? "People may be able to discover the project and view its public media. Private assets stay private."
    : "The project will leave public discovery and media delivery will be reconciled to private links.";

  return (
    <div
      className={styles.dialogBackdrop}
      role="presentation"
      onMouseDown={pending ? undefined : onCancel}
    >
      <div
        className={styles.confirmDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div>
          <span className={styles.eyebrow}>Visibility</span>
          <h2 id={titleId}>{title}</h2>
        </div>
        <p>{body}</p>
        <div className={styles.dialogActions}>
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="cta"
            onClick={() => onConfirm(visibility)}
            disabled={pending}
            isLoading={pending}
          >
            {isPublic ? "Make public" : "Make private"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProjectShareAffordance({
  visibility,
  shareUrl,
}: {
  visibility?: "public" | "private" | null;
  shareUrl: string;
}) {
  const isPublic = visibility === "public";
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  async function copyPublicLink() {
    setCopyState("idle");
    try {
      await copyTextToClipboard(shareUrl);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  if (!isPublic) {
    return (
      <div className={styles.shareNotice} data-state="private">
        <p>Private projects do not have a public link.</p>
        <span>Make this project public before sharing it outside your workspace.</span>
      </div>
    );
  }

  return (
    <div className={styles.shareNotice} data-state="public">
      <div>
        <p>Public project</p>
        <span>Appears in discovery and can be shared with this link.</span>
      </div>
      <Button variant="secondary" size="sm" onClick={() => void copyPublicLink()}>
        {copyState === "copied" ? "Copied" : "Copy public link"}
      </Button>
      <span
        className={styles.shareStatus}
        data-state={copyState}
        role="status"
        aria-live="polite"
      >
        {copyState === "copied" ? "Public link copied." : ""}
        {copyState === "error" ? "Could not copy automatically." : ""}
      </span>
    </div>
  );
}

function publicProjectUrl(projectId: string) {
  const path = `/p/${encodeURIComponent(projectId)}`;
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

async function copyTextToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textArea);
  if (!copied) throw new Error("Clipboard copy failed.");
}

function ProjectBrief({
  project,
  projectId,
  readOnly,
}: {
  project: V1Project;
  projectId: string;
  readOnly: boolean;
}) {
  const brief = project.brief;
  return (
    <section className={styles.panel} id="brief">
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Brief</span>
          <h2>Project direction</h2>
        </div>
        {!readOnly ? (
          <div className={styles.sectionHeaderActions}>
            <ButtonLink
              variant="ghost"
              size="sm"
              to={`/projects/${encodeURIComponent(projectId)}/brief`}
            >
              Open brief
            </ButtonLink>
          </div>
        ) : null}
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

function ProjectScript({
  project,
  projectId,
  storyboard,
  readOnly,
}: {
  project: V1Project;
  projectId: string;
  storyboard: ProjectStoryboard | null;
  readOnly: boolean;
}) {
  const scriptLines = storyboardScriptLines(storyboard);
  const narrationScript = project.brief?.narration?.script?.trim();

  return (
    <section className={styles.panel} id="script">
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Script</span>
          <h2>Narration and dialogue</h2>
        </div>
        {!readOnly ? (
          <div className={styles.sectionHeaderActions}>
            <ButtonLink
              variant="ghost"
              size="sm"
              to={`/projects/${encodeURIComponent(projectId)}/script`}
            >
              Open script
            </ButtonLink>
          </div>
        ) : null}
      </div>
      {narrationScript ? (
        <p className={styles.scriptBlock}>{narrationScript}</p>
      ) : scriptLines.length > 0 ? (
        <ol className={styles.scriptList}>
          {scriptLines.map((line) => (
            <li key={line.id}>
              <span>{line.label}</span>
              <p>{line.text}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.muted}>No script or narrated storyboard moments are ready yet.</p>
      )}
    </section>
  );
}

export function ProjectDangerSection({
  project,
  deleting,
  error,
  onDelete,
}: {
  project: V1Project;
  deleting: boolean;
  error: Error | null;
  onDelete: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const confirmed = confirmation === project.name;

  return (
    <section className={`${styles.panel} ${styles.dangerPanel}`} id="danger">
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Danger</span>
          <h2>Delete project</h2>
        </div>
      </div>
      <p className={styles.muted}>
        Delete this project from your library. Runs, storyboards, and generated
        assets for this project will no longer appear in the app.
      </p>
      <label className={styles.confirmField}>
        <span>Type {project.name} to confirm</span>
        <input
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          disabled={deleting}
          autoComplete="off"
        />
      </label>
      <div className={styles.dangerActions}>
        <Button
          variant="secondary"
          className={styles.dangerButton}
          disabled={!confirmed || deleting}
          isLoading={deleting}
          onClick={onDelete}
        >
          Delete project
        </Button>
      </div>
      {error ? (
        <ErrorState
          title="Unable to delete project"
          body="We couldn't delete this project. Check your session and try again."
          error={error}
          onRetry={onDelete}
        />
      ) : null}
    </section>
  );
}

function ProjectPoster({ name, posterUrl }: { name: string; posterUrl?: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (posterUrl && posterUrl !== failedUrl) {
    return (
      <ImageWithSkeleton
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

function DetailTerm({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
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

function isPlayableOutput(output: WorkspaceOutput) {
  return Boolean(output.playbackUrl ?? output.url);
}

function storyboardScriptLines(storyboard: ProjectStoryboard | null) {
  if (!storyboard) return [];
  return storyboard.scenes.flatMap((scene) =>
    scene.beats.flatMap((beat) => {
      const text = beat.narration?.trim() || beat.dialogueSummary?.trim();
      if (!text) return [];
      return [
        {
          id: beat.id,
          label: `Scene ${scene.sceneIndex + 1}, beat ${beat.beatIndex + 1}`,
          text,
        },
      ];
    }),
  );
}
