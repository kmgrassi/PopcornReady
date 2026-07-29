import { useInfiniteQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ProjectPicker } from "../components/projects/ProjectPicker";
import { Button } from "../components/ui/Button";
import { ChoiceCard } from "../components/ui/ChoiceCard";
import { v1Api } from "../lib/api-client";
import {
  useCreationConfirmation,
  useCreationProposal,
  useCreationStatus,
  type CreationGoal,
  type CreationProposal,
} from "../lib/agent-creations";
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
  const [params, setParams] = useSearchParams();
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
  const [goal, setGoal] = useState<CreationGoal>("image");
  const [projectId, setProjectId] = useState(params.get("projectId") ?? "");
  const [prompt, setPrompt] = useState("");
  const [proposal, setProposal] = useState<CreationProposal | null>(null);
  const [proposalKey, setProposalKey] = useState(
    () => `asset-studio:proposal:${crypto.randomUUID()}`,
  );
  const proposalVersion = useRef(0);
  const propose = useCreationProposal();
  const confirm = useCreationConfirmation();
  const runId = params.get("runId");
  const status = useCreationStatus(projectId, runId);
  const listedSelection = projects.find((project) => project.id === projectId);
  const selectedProjectQuery = useProjectQuery(
    projectId,
    Boolean(projectId && !listedSelection && !projectsQuery.isLoading),
  );
  const selectedName =
    listedSelection?.name ?? selectedProjectQuery.data?.project.name;

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
    proposalVersion.current += 1;
    setProposal(null);
    setProposalKey(`asset-studio:proposal:${crypto.randomUUID()}`);
  };
  const selectProject = (nextProjectId: string) => {
    if (nextProjectId === projectId) return;
    setProjectId(nextProjectId);
    resetProposal();
  };
  const canPropose = Boolean(projectId && prompt.trim());

  async function reviewCost() {
    if (!canPropose) return;
    const requestedVersion = proposalVersion.current;
    const nextProposal = await propose.mutateAsync({
      projectId,
      goal,
      prompt: prompt.trim(),
      maximumUsd: 10,
      idempotencyKey: proposalKey,
    });
    if (proposalVersion.current === requestedVersion) {
      setProposal(nextProposal);
    }
  }

  async function start() {
    if (!proposal) return;
    const result = await confirm.mutateAsync({ projectId, proposal });
    setParams({ projectId, runId: result.runId });
  }

  const error = propose.error ?? confirm.error;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>Make an asset for your project</h1>
        <p>
          Describe the outcome. You confirm the maximum cost before anything
          starts.
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
          error={projectsQuery.error}
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
            placeholder="A quiet amber-lit close-up of popcorn falling into a bowl"
          />
        </label>

        {proposal ? (
          <section className={styles.proposal} aria-live="polite">
            <h2>Review before starting</h2>
            <p>
              This request can spend up to ${proposal.maximumUsd.toFixed(2)}.
              Nothing has started yet.
            </p>
            <div className={styles.actions}>
              <Button
                variant="cta"
                size="lg"
                isLoading={confirm.isPending}
                onClick={() => void start()}
              >
                Confirm and start
              </Button>
              <Button variant="ghost" onClick={resetProposal}>
                Revise request
              </Button>
            </div>
          </section>
        ) : (
          <Button
            variant="cta"
            size="lg"
            disabled={!canPropose}
            isLoading={propose.isPending}
            onClick={() => void reviewCost()}
          >
            Review cost
          </Button>
        )}
        {error ? (
          <p role="alert" className={styles.error}>
            {error.message}
          </p>
        ) : null}
      </section>
    </main>
  );
}
