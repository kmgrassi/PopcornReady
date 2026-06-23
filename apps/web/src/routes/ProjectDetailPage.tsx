import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import type {
  GenerationRun,
  ProjectStoryboard,
  StoryboardBeat,
  StoryboardPanel,
  V1Project,
  VideoBriefInput,
} from "@popcorn/shared/v1/types";
import type { WorkspaceOutput } from "../lib/api-client";
import { useAuth } from "../components/auth/AuthProvider";
import { Button, ButtonLink } from "../components/ui/Button";
import { ImageWithSkeleton } from "../components/ui/ImageWithSkeleton";
import { Spinner } from "../components/ui/Spinner";
import { EmptyState, ErrorState } from "../components/ui/StateCard";
import { StageRail } from "../components/progress/StageRail";
import { AssetImage } from "../components/media/AssetImage";
import { storyboardProgress, type StoryboardProgress } from "../lib/v1/storyboard/progress";
import {
  useGenerateProjectStoryboardMutation,
  useGenerationRunQuery,
  useDeleteProjectMutation,
  useProjectQuery,
  useProjectStoryboardJobQuery,
  useProjectStoryboardQuery,
  useUpdateGenerationRunMutation,
} from "../lib/queryClient";
import {
  useDashboardOutputsQuery,
  useDashboardRunsQuery,
} from "../lib/v1/dashboard/query";
import styles from "./ProjectDetailPage.module.css";

const DEV_AUTOPILOT = import.meta.env.DEV;
const RUN_LIMIT = 6;
const OUTPUT_LIMIT = 6;
const PROJECT_SECTIONS = ["concept", "brief", "script"] as const;
const STAGE_PANEL_COMPACT_QUERY = "(max-width: 900px)";

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
        <div className={styles.projectPageLayout}>
          <div className={styles.projectContent} id="overview">
            <section className={styles.projectTopLayout}>
              <div className={styles.projectPrimaryColumn}>
                <ProjectConcept project={project} projectId={projectId} />
              </div>
              <div className={styles.projectStoryboardColumn}>
                <StoryboardPreview
                  projectId={projectId}
                  storyboard={storyboard}
                  loading={storyboardQuery.isLoading}
                  error={storyboardQuery.error}
                  onRetry={() => void storyboardQuery.refetch()}
                  generating={storyboardGenerating}
                  progress={storyboardProgressState}
                  generationError={
                    generateStoryboardMutation.error ?? storyboardGenerationError
                  }
                  onGenerate={() => {
                    void generateStoryboardMutation.mutateAsync().then(() => {
                      void storyboardQuery.refetch();
                    });
                  }}
                />
                <div className={styles.projectContextGrid}>
                  <ProjectBrief project={project} projectId={projectId} />
                  <ProjectScript project={project} projectId={projectId} storyboard={storyboard} />
                </div>
              </div>
            </section>
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
          </div>
          <aside className={styles.stageAside} aria-label="Run pipeline">
            <ProjectStagePanel
              projectId={projectId}
              runs={runsQuery.items}
              loading={runsQuery.loading}
              error={runsQuery.error}
              onRetry={runsQuery.refetch}
            />
          </aside>
        </div>
      ) : null}
    </main>
  );
}

function isProjectSectionId(value: string | undefined): value is ProjectSectionId {
  return PROJECT_SECTIONS.includes(value as ProjectSectionId);
}

function ProjectStagePanel({
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
  const selectedRun = useMemo(() => selectStageRun(runs), [runs]);
  const [pendingGateAction, setPendingGateAction] = useState<"approve" | "reject" | null>(null);
  const [stageExpanded, setStageExpanded] = useState(() => {
    if (typeof window === "undefined") return true;
    return !window.matchMedia(STAGE_PANEL_COMPACT_QUERY).matches;
  });
  const runDetailQuery = useGenerationRunQuery(
    projectId,
    selectedRun?.runId ?? "",
    Boolean(selectedRun),
  );
  const runDetail = runDetailQuery.data ?? null;
  const run = runDetail?.run ?? selectedRun ?? null;
  const updateRunMutation = useUpdateGenerationRunMutation(projectId, run?.runId ?? "");
  const activeError = error ?? runDetailQuery.error ?? null;
  const activeLoading = loading || (Boolean(selectedRun) && runDetailQuery.isLoading);
  const nextStage = runDetail?.stages
    .slice()
    .sort((a, b) => a.order - b.order)
    .find((stage) => stage.status === "queued");
  const hasReviewGate = Boolean(run?.reviewGate);
  const projectPath = `/projects/${encodeURIComponent(projectId)}`;
  const runPath = run
    ? `${projectPath}/runs/${encodeURIComponent(run.runId)}`
    : projectPath;
  const stagePanelBodyId = "project-stage-panel-body";
  const stageLinks = {
    Concept: `${projectPath}/concept`,
    Brief: `${projectPath}/brief`,
    Script: `${projectPath}/script`,
    Storyboard: `${projectPath}#storyboard`,
    Shots: runPath,
    Assets: runPath,
    Timeline: runPath,
    "Final Render": `${projectPath}/watch`,
  };

  function updateGate(action: "approve" | "reject") {
    if (!run?.runId) return;
    setPendingGateAction(action);
    updateRunMutation.mutate({
      action,
      body: action === "reject"
        ? {
            stageType: run.reviewGate?.stageType,
            note: "Requested from the project stage panel.",
          }
        : undefined,
    });
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia(STAGE_PANEL_COMPACT_QUERY);
    const syncExpanded = () => {
      setStageExpanded(!query.matches);
    };

    syncExpanded();
    query.addEventListener("change", syncExpanded);
    return () => query.removeEventListener("change", syncExpanded);
  }, []);

  return (
    <section className={`${styles.panel} ${styles.stagePanel}`} aria-labelledby="project-stage-heading">
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Run pipeline</span>
          <h2 id="project-stage-heading">Stage and next step</h2>
        </div>
        <div className={styles.sectionHeaderActions}>
          {run ? (
            <ButtonLink
              variant="ghost"
              size="sm"
              to={`/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(run.runId)}`}
            >
              Open run
            </ButtonLink>
          ) : null}
          <Button
            className={styles.stageToggle}
            variant="secondary"
            size="sm"
            aria-controls={stagePanelBodyId}
            aria-expanded={stageExpanded}
            onClick={() => setStageExpanded((expanded) => !expanded)}
          >
            {stageExpanded ? "Hide details" : "Show details"}
          </Button>
        </div>
      </div>

      <div id={stagePanelBodyId} className={styles.stageCollapsible} hidden={!stageExpanded}>
        {activeLoading ? <div className={styles.placeholder}>Loading stage...</div> : null}
        {!activeLoading && activeError ? (
          <ErrorState
            title="Unable to load stage"
            body="We couldn't load the latest generation stage for this project."
            error={activeError}
            onRetry={() => {
              onRetry();
              void runDetailQuery.refetch();
            }}
          />
        ) : null}
        {!activeLoading && !activeError && !run ? (
          <EmptyState
            title="No generation stage yet"
            body="Start a generation run to see the project's current stage and next step."
          />
        ) : null}
        {!activeLoading && !activeError && run ? (
          <div className={styles.stagePanelBody}>
            <div className={styles.stageSummary}>
              <div>
                <dt>Current</dt>
                <dd>
                  {run.reviewGate
                    ? `${titleCase(run.reviewGate.stageType)} review`
                    : run.currentStageType
                      ? titleCase(run.currentStageType)
                      : titleCase(run.status)}
                </dd>
              </div>
              <div>
                <dt>Next</dt>
                <dd>{nextStage ? titleCase(nextStage.type) : run.status === "succeeded" ? "Complete" : "Pending"}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{formatDate(run.updatedAt)}</dd>
              </div>
            </div>

            {runDetail?.stages.length ? (
              <StageRail
                stages={runDetail.stages}
                runStatus={run.status}
                currentStageType={run.currentStageType}
                runProgressPercent={run.progressPercent}
                runMessage={run.message}
                reviewGate={run.reviewGate}
                stageLinks={stageLinks}
              />
            ) : (
              <p className={styles.muted}>
                {run.message ?? "Stage details will appear once the run reports its first step."}
              </p>
            )}

            <div className={styles.stageActions}>
              {hasReviewGate ? (
                <>
                  <Button
                    variant="primary"
                    onClick={() => updateGate("approve")}
                    disabled={updateRunMutation.isPending}
                    isLoading={updateRunMutation.isPending && pendingGateAction === "approve"}
                  >
                    Approve and continue
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => updateGate("reject")}
                    disabled={updateRunMutation.isPending}
                    isLoading={updateRunMutation.isPending && pendingGateAction === "reject"}
                  >
                    Request revision
                  </Button>
                </>
              ) : (
                <ButtonLink
                  variant="secondary"
                  to={`/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(run.runId)}`}
                >
                  Manage run
                </ButtonLink>
              )}
            </div>
            {updateRunMutation.error ? (
              <ErrorState
                title="Unable to update stage"
                body="We couldn't apply that stage action. The run may have changed, or your session may need to be refreshed."
                error={updateRunMutation.error}
                onRetry={() => {
                  if (pendingGateAction) updateGate(pendingGateAction);
                }}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ProjectConcept({ project, projectId }: { project: V1Project; projectId: string }) {
  const brief = project.brief;
  return (
    <section className={styles.hero} id="concept">
      <ProjectPoster name={project.name} posterUrl={project.posterUrl} />
      <div className={styles.heroBody}>
        <div className={styles.metaRow}>
          <StatusChip status={project.status} />
          {project.visibility ? (
            <span>{project.visibility === "public" ? "Public" : "Private"}</span>
          ) : null}
          <span>Created {formatDate(project.createdAt)}</span>
          <ButtonLink
            variant="ghost"
            size="sm"
            to={`/projects/${encodeURIComponent(projectId)}/concept`}
          >
            Open concept
          </ButtonLink>
        </div>
        <div>
          <span className={styles.eyebrow}>Concept</span>
          <h2 className={styles.conceptTitle}>
            <Link
              className={styles.sectionTitleLink}
              to={`/projects/${encodeURIComponent(projectId)}/concept`}
            >
              {brief?.oneBigIdea ?? brief?.goal ?? project.name}
            </Link>
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
    </section>
  );
}

function ProjectBrief({ project, projectId }: { project: V1Project; projectId: string }) {
  const brief = project.brief;
  return (
    <section className={styles.panel} id="brief">
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Brief</span>
          <h2>Project direction</h2>
        </div>
        <div className={styles.sectionHeaderActions}>
          <ButtonLink
            variant="ghost"
            size="sm"
            to={`/projects/${encodeURIComponent(projectId)}/brief`}
          >
            Open brief
          </ButtonLink>
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

function ProjectScript({
  project,
  projectId,
  storyboard,
}: {
  project: V1Project;
  projectId: string;
  storyboard: ProjectStoryboard | null;
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
        <div className={styles.sectionHeaderActions}>
          <ButtonLink
            variant="ghost"
            size="sm"
            to={`/projects/${encodeURIComponent(projectId)}/script`}
          >
            Open script
          </ButtonLink>
        </div>
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

function ProjectDangerSection({
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

function StoryboardPreview({
  projectId,
  storyboard,
  loading,
  error,
  onRetry,
  generating,
  progress,
  generationError,
  onGenerate,
}: {
  projectId: string;
  storyboard: ProjectStoryboard | null;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  generating: boolean;
  progress: StoryboardProgress;
  generationError: Error | null;
  onGenerate: () => void;
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
            {storyboard ? (
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
          {storyboard ? (
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
          {!loading && !error && !generating ? (
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
          onRetry={onGenerate}
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

function selectStageRun(runs: GenerationRun[]) {
  return (
    runs.find((run) => run.reviewGate) ??
    runs.find((run) => run.status === "running" || run.status === "queued") ??
    runs[0] ??
    null
  );
}

function isPlayableOutput(output: WorkspaceOutput) {
  return Boolean(output.playbackUrl ?? output.url);
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
