import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { V1Project } from "@popcorn/shared/v1/types";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
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
    return (
      <main className={`${styles.page} ${styles.statusPage}`}>
        <header className={styles.header}>
          <h1>Your asset is in motion</h1>
          <p>It will appear in this project’s asset library when it is ready.</p>
        </header>
        {status.isLoading ? (
          <div className={styles.skeleton} aria-label="Loading creation status" />
        ) : null}
        {status.error ? (
          <p role="alert" className={styles.error}>
            {status.error.message}
          </p>
        ) : null}
        {status.data ? (
          <section className={styles.status}>
            <strong>{status.data.run.status}</strong>
            <p>{status.data.run.inputSummary}</p>
            {status.data.report?.outcome.outcome === "blocked" ? (
              <p>{status.data.report.outcome.reason}</p>
            ) : null}
            {status.data.report?.outcome.outcome === "question" ? (
              <p>{status.data.report.outcome.question}</p>
            ) : null}
            {status.data.outputs.length ? (
              <>
                <p>
                  {status.data.outputs.length} immutable output
                  {status.data.outputs.length === 1 ? "" : "s"} ready.
                </p>
                <Link to={`/projects/${encodeURIComponent(projectId)}/media`}>
                  Open project assets
                </Link>
              </>
            ) : (
              <p>Progress and provenance will stay here as work continues.</p>
            )}
          </section>
        ) : null}
      </main>
    );
  }

  const resetProposal = () => {
    setProposalKey(`asset-studio:proposal:${crypto.randomUUID()}`);
  };
  const selectProject = (nextProjectId: string) => {
    if (nextProjectId === projectId) return;
    setProjectId(nextProjectId);
    resetProposal();
  };
  const canPropose = Boolean(projectId && prompt.trim());

  function startReview() {
    if (!canPropose) return;
    const draft = {
      projectId,
      goal,
      prompt: prompt.trim(),
      improvePrompt,
    };
    navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: creationDraftNavigationState(draft),
    });
    navigate("/create/review", {
      state: creationReviewNavigationState({
        ...draft,
        maximumUsd: 10,
        idempotencyKey: proposalKey,
      }),
    });
  }

  return (
    <main className={styles.page}>
      <RecentProjectSwitcher
        projects={projects}
        selectedProjectId={projectId}
        loading={projectsQuery.isLoading}
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
              createError={createProject.error}
              onChange={selectProject}
              onCreate={async (name) =>
                (await createProject.mutateAsync({ name })).project
              }
              onResetCreateError={createProject.reset}
              onLoadMore={() => void projectsQuery.fetchNextPage()}
              onRetry={() => void projectsQuery.refetch()}
            />
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
              onChange={(event) => {
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
            <Button
              variant="cta"
              size="lg"
              disabled={!canPropose}
              onClick={startReview}
            >
              Review request
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
