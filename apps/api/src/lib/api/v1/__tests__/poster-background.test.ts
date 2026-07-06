import assert from "node:assert/strict";
import test from "node:test";
import type { AuthContext } from "../auth";
import type { OrchestratorRun } from "../orchestrator-store";
import { startPosterGenerationInBackground } from "../poster-background";
import type { GeneratePosterResult } from "../poster-generation";

const auth: AuthContext = {
  mode: "local",
  actor: { id: "local_dev", type: "local" },
  workspaceId: "workspace_1",
  isLocal: true,
};

test("startPosterGenerationInBackground returns before poster generation settles", async () => {
  let resolvePoster!: () => void;
  let settled = false;
  const resumes: Array<{ runId: string; workspaceId: string; actorId?: string }> = [];
  const posterPromise = new Promise<void>((resolve) => {
    resolvePoster = resolve;
  }).then(() => {
    settled = true;
    return {
      project: {} as GeneratePosterResult["project"],
      poster: {
        assetId: "poster_1",
        generated: true,
        reused: false,
        selected: true,
        manuallyPinned: false,
      },
    };
  });

  startPosterGenerationInBackground(auth, "project_1", { provider: "mock", runId: "run_1" }, {
    generatePoster: async (_auth, projectId, input) => {
      assert.equal(projectId, "project_1");
      assert.equal(input?.provider, "mock");
      assert.equal(input?.runId, "run_1");
      return posterPromise;
    },
    resumeRun: async (runId, deps) => {
      resumes.push({ runId, workspaceId: deps.workspaceId, actorId: deps.actorId });
      return {} as OrchestratorRun;
    },
  });

  assert.equal(settled, false);
  resolvePoster();
  await posterPromise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, true);
  assert.deepEqual(resumes, [
    { runId: "run_1", workspaceId: "workspace_1", actorId: "local_dev" },
  ]);
});

test("startPosterGenerationInBackground logs poster generation failures and still resumes", async () => {
  const failures: unknown[] = [];
  const error = new Error("provider unavailable");
  const resumes: string[] = [];

  startPosterGenerationInBackground(auth, "project_1", { runId: "run_1" }, {
    generatePoster: async () => {
      throw error;
    },
    resumeRun: async (runId) => {
      resumes.push(runId);
      return {} as OrchestratorRun;
    },
    logError: (_message, err) => {
      failures.push(err);
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(failures, [error]);
  assert.deepEqual(resumes, ["run_1"]);
});
