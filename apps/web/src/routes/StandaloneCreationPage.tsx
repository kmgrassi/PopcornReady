import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ProjectPicker } from "../components/projects/ProjectPicker";
import { Button } from "../components/ui/Button";
import { ChoiceCard } from "../components/ui/ChoiceCard";
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
import styles from "./StandaloneCreationPage.module.css";

const goals: Array<[CreationGoal, string, string]> = [
  ["image", "Image", "A visual for the project asset pool."],
  ["video", "Video", "A short motion asset, without a full production."],
  ["soundtrack", "Soundtrack", "Music or sound for the project asset pool."],
];

export function StandaloneCreationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const returnedDraft = readCreationDraft(location.state);
  const [params] = useSearchParams();
  const projectsQuery = useInfiniteQuery({
    queryKey: queryKeys.assetStudioProjects(),
    queryFn: ({ pageParam }) =>
      v1Api.listProjects({ limit: 100, cursor: pageParam }),
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
  const improvePrompt =
    goal === "video" ? improveVideoPrompt : improveImagePrompt;

  if (runId && projectId) {
    return (
      <main className={styles.page}>
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
      <header className={styles.header}>
        <h1>Make an asset for your project</h1>
        <p>
          Describe the outcome. For images and videos, a quick prompt-refinement
          pass runs on the next page. Review it there, or asset generation starts
          automatically 10 seconds after the proposal is ready.
        </p>
      </header>
      <section className={styles.form}>
        <fieldset>
          <legend>What are you making?</legend>
          <div className={styles.choices}>
            {goals.map(([value, label, description]) => (
              <ChoiceCard
                key={value}
                name="goal"
                value={value}
                checked={goal === value}
                onChange={() => {
                  setGoal(value);
                  resetProposal();
                }}
                label={label}
                description={description}
              />
            ))}
          </div>
        </fieldset>

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

        <label>
          What should it feel like?
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

        <Button
          variant="cta"
          size="lg"
          disabled={!canPropose}
          onClick={startReview}
        >
          Start
        </Button>
      </section>
    </main>
  );
}
