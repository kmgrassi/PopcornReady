import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { V1Project } from "@popcorn/shared/v1/types";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { StudioCrewLoader } from "../components/creation/StudioCrewLoader";
import { ProjectPicker } from "../components/projects/ProjectPicker";
import { ImageWithSkeleton } from "../components/ui/ImageWithSkeleton";
import { Button } from "../components/ui/Button";
import { v1Api } from "../lib/api-client";
import {
  useCreationStatus,
  type CreationGoal,
} from "../lib/agent-creations";
import {
  creationDraftNavigationState,
  creationReviewNavigationState,
  readCreationDraft,
} from "../lib/creationReview";
import {
  queryKeys,
  useCreateProjectMutation,
  useProjectQuery,
} from "../lib/queryClient";
import { RecentProjectSwitcher } from "./create/RecentProjectSwitcher";
import styles from "./StandaloneCreationPage.module.css";

const goals: Array<{
  value: CreationGoal;
  label: string;
  description: string;
}> = [
  { value: "image", label: "Image", description: "A still visual for this project." },
  { value: "video", label: "Video", description: "A short motion asset for this project." },
  { value: "soundtrack", label: "Audio", description: "Music or sound for this project." },
];

type StatusPresentation = {
  heading: string;
  description: string;
  label: string;
  tone: "active" | "neutral" | "success" | "danger";
  isActive: boolean;
};

function presentStatus(
  status: string,
  outcome: CreationStatusOutcome,
  hasOutputs: boolean,
): StatusPresentation {
  if (hasOutputs) {
    return {
      heading: "Your asset is ready",
      description:
        "The finished work is waiting in your project’s asset library.",
      label: "Ready",
      tone: "success",
      isActive: false,
    };
  }
  if (outcome === "blocked") {
    return {
      heading: "The studio needs a decision",
      description: "Work is paused until this request is unblocked.",
      label: "Blocked",
      tone: "danger",
      isActive: false,
    };
  }
  if (outcome === "question") {
    return {
      heading: "The studio has a question",
      description:
        "A little more direction is needed before work can continue.",
      label: "Waiting for you",
      tone: "neutral",
      isActive: false,
    };
  }

  switch (status.toLowerCase()) {
    case "queued":
      return {
        heading: "Your asset is in motion",
        description: "Your brief is lined up and the studio will begin shortly.",
        label: "Queued",
        tone: "active",
        isActive: true,
      };
    case "running":
      return {
        heading: "The studio is making it",
        description: "Your crew is working through the brief now.",
        label: "In progress",
        tone: "active",
        isActive: true,
      };
    case "waiting":
      return {
        heading: "Waiting for the next step",
        description: "The work is safe while the studio waits to continue.",
        label: "Waiting",
        tone: "neutral",
        isActive: true,
      };
    case "succeeded":
    case "completed":
      return {
        heading: "The run is complete",
        description: "No project asset is attached to this run yet.",
        label: "Complete",
        tone: "success",
        isActive: false,
      };
    case "failed":
      return {
        heading: "The studio hit a snag",
        description: "This run stopped before an asset was ready.",
        label: "Needs attention",
        tone: "danger",
        isActive: false,
      };
    case "canceled":
    case "cancelled":
      return {
        heading: "Creation stopped",
        description: "This run was canceled before an asset was ready.",
        label: "Canceled",
        tone: "neutral",
        isActive: false,
      };
    case "timed_out":
      return {
        heading: "The studio ran out of time",
        description: "This run stopped before an asset was ready.",
        label: "Timed out",
        tone: "danger",
        isActive: false,
      };
    case "superseded":
      return {
        heading: "A newer request took over",
        description: "This run stopped because a newer request replaced it.",
        label: "Replaced",
        tone: "neutral",
        isActive: false,
      };
    default:
      return {
        heading: "Checking your asset",
        description: "The studio is checking the latest state of this run.",
        label: "Checking",
        tone: "neutral",
        isActive: false,
      };
  }
}

type CreationStatusOutcome = "blocked" | "question" | "other";

function briefExcerpt(summary: string, maximumLength = 180) {
  const normalized = summary.replace(/\s+/g, " ").trim();
  if (normalized.length <= maximumLength) return normalized;
  const candidate = normalized.slice(0, maximumLength + 1);
  const lastSpace = candidate.lastIndexOf(" ");
  const cutAt = lastSpace > maximumLength * 0.7 ? lastSpace : maximumLength;
  return `${candidate.slice(0, cutAt).trimEnd()}…`;
}

export function StandaloneCreationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const returnedDraft = readCreationDraft(location.state);
  const [params] = useSearchParams();
  const projectsQuery = useInfiniteQuery({
    queryKey: queryKeys.assetStudioProjects(),
    queryFn: ({ pageParam }) =>
      v1Api.listProjects({ limit: 100, cursor: pageParam, order: "updatedAt" }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.pagination.nextCursor,
  });
  const createProject = useCreateProjectMutation();
  const autoCreateProject = useCreateProjectMutation({ notifications: false });
  const listedProjects =
    projectsQuery.data?.pages.flatMap((page) => page.projects) ?? [];
  const recentProject = createProject.data?.project;
  const projects =
    recentProject &&
    !listedProjects.some((project) => project.id === recentProject.id)
      ? [recentProject, ...listedProjects]
      : listedProjects;
  const [goal, setGoal] = useState<CreationGoal>(returnedDraft?.goal ?? "image");
  const [projectId, setProjectId] = useState(
    returnedDraft?.projectId ?? params.get("projectId") ?? "",
  );
  const [prompt, setPrompt] = useState(returnedDraft?.prompt ?? "");
  const [improveImagePrompt, setImproveImagePrompt] = useState(
    returnedDraft?.goal === "image" ? returnedDraft.improvePrompt : true,
  );
  const [improveVideoPrompt, setImproveVideoPrompt] = useState(
    returnedDraft?.goal === "video" ? returnedDraft.improvePrompt : true,
  );
  const [proposalKey, setProposalKey] = useState(
    () => `asset-studio:proposal:${crypto.randomUUID()}`,
  );
  const reviewAttemptRef = useRef(false);
  const [isAutoCreatingProject, setIsAutoCreatingProject] = useState(false);
  const [autoProjectError, setAutoProjectError] = useState<string | null>(null);
  const runId = params.get("runId");
  const status = useCreationStatus(projectId, runId);
  const listedSelection = projects.find((project) => project.id === projectId);
  const selectedProjectQuery = useProjectQuery(
    projectId,
    Boolean(projectId && !listedSelection && !projectsQuery.isLoading),
  );
  const selectedName =
    listedSelection?.name ?? selectedProjectQuery.data?.project.name;
  const selectedProject = listedSelection ?? selectedProjectQuery.data?.project ?? null;
  const improvePrompt =
    goal === "video" ? improveVideoPrompt : improveImagePrompt;

  if (runId && projectId) {
    const reportOutcome = status.data?.report?.outcome.outcome;
    const outcome: CreationStatusOutcome =
      reportOutcome === "blocked" || reportOutcome === "question"
        ? reportOutcome
        : "other";
    const presentation = presentStatus(
      status.data?.run.status ?? "",
      outcome,
      Boolean(status.data?.outputs.length),
    );
    const inputSummary = status.data?.run.inputSummary?.trim();

    return (
      <main
        className={`${styles.page} ${styles.statusPage} ${styles.progressPage}`}
      >
        <header className={`${styles.header} ${styles.progressHeader}`}>
          {selectedName ? (
            <p className={styles.progressProjectContext}>
              Creating for {selectedName}
            </p>
          ) : null}
          <h1>
            {status.isLoading
              ? "Getting the studio ready"
              : presentation.heading}
          </h1>
          <p>
            {status.isLoading
              ? "Checking the latest progress on your asset."
              : presentation.description}
          </p>
        </header>
        {status.isLoading ? (
          <section
            className={styles.statusShell}
            aria-busy="true"
            aria-label="Loading creation status"
          >
            <StudioCrewLoader active />
            <div className={styles.statusDetails}>
              <div
                className={`${styles.skeletonLine} ${styles.skeletonLabel}`}
              />
              <div
                className={`${styles.skeletonLine} ${styles.skeletonTitle}`}
              />
              <div className={styles.skeletonLine} />
              <div
                className={`${styles.skeletonLine} ${styles.skeletonShort}`}
              />
              <div className={styles.skeletonBrief} />
            </div>
          </section>
        ) : null}
        {status.error ? (
          <section className={styles.errorPanel} role="alert">
            <strong>We couldn’t load this run.</strong>
            <p>{status.error.message}</p>
          </section>
        ) : null}
        {status.data ? (
          <section className={styles.statusShell}>
            <StudioCrewLoader active={presentation.isActive} />
            <div className={styles.statusDetails}>
              <div
                className={styles.liveStatus}
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                <span
                  className={styles.statusBadge}
                  data-tone={presentation.tone}
                >
                  <span className={styles.statusDot} aria-hidden="true" />
                  {presentation.label}
                </span>
              </div>

              {presentation.isActive ? (
                <div
                  className={styles.progressTrack}
                  data-testid="creation-progress-track"
                  aria-hidden="true"
                >
                  <span />
                </div>
              ) : null}

              {inputSummary ? (
                <details className={styles.briefDisclosure}>
                  <summary aria-label="View full request brief">
                    <span className={styles.briefLabel}>Creative brief</span>
                    <span className={styles.briefExcerpt} aria-hidden="true">
                      {briefExcerpt(inputSummary)}
                    </span>
                    <span className={styles.briefAction} aria-hidden="true">
                      View full brief
                    </span>
                  </summary>
                  <p>{inputSummary}</p>
                </details>
              ) : null}

              {status.data.report?.outcome.outcome === "blocked" ? (
                <div className={styles.outcomePanel} data-tone="danger">
                  <strong>What’s blocking the run</strong>
                  <p>{status.data.report.outcome.reason}</p>
                </div>
              ) : null}
              {status.data.report?.outcome.outcome === "question" ? (
                <div className={styles.outcomePanel}>
                  <strong>What the studio needs</strong>
                  <p>{status.data.report.outcome.question}</p>
                </div>
              ) : null}
              {status.data.outputs.length ? (
                <div className={styles.readyRow}>
                  <p>
                    {status.data.outputs.length === 1
                      ? "1 asset is ready."
                      : `${status.data.outputs.length} assets are ready.`}
                  </p>
                  <Link to={`/projects/${encodeURIComponent(projectId)}/media`}>
                    Open project assets
                  </Link>
                </div>
              ) : presentation.isActive && outcome === "other" ? (
                <p className={styles.continuationCopy}>
                  This page updates automatically. You can leave and come back
                  without interrupting the work.
                </p>
              ) : null}
            </div>
          </section>
        ) : null}
      </main>
    );
  }

  const resetProposal = () => {
    setProposalKey(`asset-studio:proposal:${crypto.randomUUID()}`);
  };
  const selectProject = (nextProjectId: string) => {
    if (isAutoCreatingProject) return;
    if (nextProjectId === projectId) return;
    setAutoProjectError(null);
    setProjectId(nextProjectId);
    resetProposal();
  };
  const canPropose = Boolean(prompt.trim());

  async function startReview() {
    if (!canPropose || createProject.isPending || reviewAttemptRef.current) return;
    reviewAttemptRef.current = true;
    setAutoProjectError(null);
    const draft = {
      projectId,
      goal,
      prompt: prompt.trim(),
      improvePrompt,
    };
    try {
      let reviewProjectId = draft.projectId;
      if (!reviewProjectId) {
        setIsAutoCreatingProject(true);
        const response = await autoCreateProject.mutateAsync({
          namingPrompt: draft.prompt.slice(0, 500),
          namingContext: draft.goal,
          idempotencyKey: proposalKey.replace(
            "asset-studio:proposal:",
            "asset-studio:project:",
          ),
        });
        reviewProjectId = response.project.id;
      }
      const reviewDraft = { ...draft, projectId: reviewProjectId };
      navigate(`${location.pathname}${location.search}`, {
        replace: true,
        state: creationDraftNavigationState(reviewDraft),
      });
      navigate("/create/review", {
        state: creationReviewNavigationState({
          ...reviewDraft,
          maximumUsd: 10,
          idempotencyKey: proposalKey,
        }),
      });
    } catch (error) {
      setAutoProjectError(
        error instanceof Error
          ? error.message
          : "We couldn’t create a project for this request.",
      );
    } finally {
      reviewAttemptRef.current = false;
      setIsAutoCreatingProject(false);
    }
  }

  return (
    <main className={styles.page}>
      <RecentProjectSwitcher
        projects={projects}
        selectedProjectId={projectId}
        loading={projectsQuery.isLoading}
        disabled={isAutoCreatingProject}
        onSelect={selectProject}
      />

      <div className={styles.workspace}>
        <aside className={styles.contextRail} aria-label="Creation context">
          <fieldset className={styles.mediaTypes}>
            <legend>Media type</legend>
            {goals.map(({ value, label, description }) => (
              <label className={styles.mediaType} key={value}>
                <input
                  type="radio"
                  name="goal"
                  value={value}
                  checked={goal === value}
                  disabled={isAutoCreatingProject}
                  onChange={() => {
                    setGoal(value);
                    resetProposal();
                  }}
                />
                <CreationTypeIcon goal={value} />
                <span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
              </label>
            ))}
          </fieldset>

          <section className={styles.projectContext} aria-labelledby="project-context-heading">
            <h2 id="project-context-heading">Project</h2>
            <ProjectPicker
              projects={projects}
              value={projectId}
              selectedName={selectedName}
              isLoading={projectsQuery.isLoading}
              error={projectsQuery.data ? null : projectsQuery.error}
              loadMoreError={
                projectsQuery.isFetchNextPageError ? projectsQuery.error : null
              }
              hasNextPage={Boolean(projectsQuery.hasNextPage)}
              isFetchingNextPage={projectsQuery.isFetchingNextPage}
              isCreating={createProject.isPending}
              disabled={isAutoCreatingProject}
              createError={createProject.error}
              onChange={selectProject}
              onCreate={async (name) =>
                (await createProject.mutateAsync({ name })).project
              }
              onResetCreateError={createProject.reset}
              onLoadMore={() => void projectsQuery.fetchNextPage()}
              onRetry={() => void projectsQuery.refetch()}
            />
            {!projectId ? (
              <p className={styles.projectHint}>
                Optional — we’ll create and name one when you review.
              </p>
            ) : null}
            {selectedProject ? <SelectedProjectContext project={selectedProject} /> : null}
          </section>
        </aside>

        <section className={styles.canvas} aria-label="Creation prompt">
          <header className={styles.header}>
            <h1>Create</h1>
            <p>
              Describe the result, then review the exact request before generation.
              If untouched, generation starts 10 seconds after the proposal is ready.
            </p>
          </header>

          <label className={styles.promptField}>
            <span>Describe the result</span>
            <textarea
              value={prompt}
              disabled={isAutoCreatingProject}
              onChange={(event) => {
                setAutoProjectError(null);
                setPrompt(event.target.value);
                resetProposal();
              }}
              placeholder={
                goal === "video"
                  ? "A cyclist crossing a rain-slick street as the camera holds still"
                  : goal === "soundtrack"
                    ? "Sparse brushed percussion building to a warm final chord"
                    : "A quiet amber-lit close-up of popcorn falling into a bowl"
              }
            />
          </label>

          {goal === "image" || goal === "video" ? (
            <label className={styles.enhancementControl}>
              <input
                type="checkbox"
                checked={improvePrompt}
                disabled={isAutoCreatingProject}
                onChange={(event) => {
                  if (goal === "video") {
                    setImproveVideoPrompt(event.target.checked);
                  } else {
                    setImproveImagePrompt(event.target.checked);
                  }
                  resetProposal();
                }}
              />
              <span>
                <strong>Improve {goal} prompt</strong>
                <small>
                  {goal === "video"
                    ? "Adds clear action, camera behavior, continuity, and an end state while preserving your idea."
                    : "Adds concrete composition, lighting, materials, and restraint while preserving your idea."}
                </small>
              </span>
            </label>
          ) : null}

          <div className={styles.canvasActions}>
            {autoProjectError ? (
              <p className={styles.reviewError} role="alert">
                We couldn’t create a project automatically. {autoProjectError}
              </p>
            ) : null}
            <Button
              variant="cta"
              size="lg"
              disabled={!canPropose || createProject.isPending}
              isLoading={isAutoCreatingProject}
              onClick={() => void startReview()}
            >
              {isAutoCreatingProject ? "Creating project…" : "Review request"}
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}

function SelectedProjectContext({ project }: { project: V1Project }) {
  const [posterFailed, setPosterFailed] = useState(false);

  useEffect(() => {
    setPosterFailed(false);
  }, [project.id, project.posterUrl]);

  const updated = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(project.updatedAt));
  const posterUrl = posterFailed ? null : project.posterUrl;

  return (
    <article className={styles.selectedProject} aria-label={`Selected project ${project.name}`}>
      {posterUrl ? (
        <ImageWithSkeleton
          className={styles.projectPoster}
          src={posterUrl}
          alt=""
          onError={() => setPosterFailed(true)}
        />
      ) : (
        <span className={styles.projectFallback} aria-hidden="true">
          {project.name.trim().charAt(0).toUpperCase() || "?"}
        </span>
      )}
      <span className={styles.projectCopy}>
        <strong title={project.name}>{project.name}</strong>
        <small>Updated {updated}</small>
      </span>
    </article>
  );
}

function CreationTypeIcon({ goal }: { goal: CreationGoal }) {
  if (goal === "image") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="9" r="1.5" />
        <path d="m5 17 4.5-4 3 2.5 2.5-2 4 3.5" />
      </svg>
    );
  }
  if (goal === "video") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="m10 9 5 3-5 3Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
    </svg>
  );
}
