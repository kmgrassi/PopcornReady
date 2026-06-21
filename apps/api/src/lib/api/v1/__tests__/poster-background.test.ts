import assert from "node:assert/strict";
import test from "node:test";
import type { AuthContext } from "../auth";
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
  });

  assert.equal(settled, false);
  resolvePoster();
  await posterPromise;
  assert.equal(settled, true);
});

test("startPosterGenerationInBackground logs poster generation failures", async () => {
  const failures: unknown[] = [];
  const error = new Error("provider unavailable");

  startPosterGenerationInBackground(auth, "project_1", {}, {
    generatePoster: async () => {
      throw error;
    },
    logError: (_message, err) => {
      failures.push(err);
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(failures, [error]);
});
