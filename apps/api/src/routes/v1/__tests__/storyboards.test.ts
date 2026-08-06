import assert from "node:assert/strict";
import test from "node:test";

import { ApiError } from "@/core/errors";
import { generateStoryboardPanelsRoute } from "../storyboards";

test("low-level storyboard generation reports a 409 plan_missing precondition", async () => {
  await assert.rejects(
    generateStoryboardPanelsRoute(
      {
        auth: { workspaceId: "workspace_1" } as never,
        req: { header: () => null } as never,
      },
      { projectId: "project_1" },
      {
        getProject: async () => ({ id: "project_1" }) as never,
        requireApprovedScript: async () => undefined,
        getActiveProjectPlan: async () => null,
      }
    ),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "plan_missing");
      assert.equal(error.status, 409);
      assert.match(error.message, /shot plan is required/i);
      return true;
    }
  );
});

test("storyboard media generation stops before job creation without script approval", async () => {
  let jobCalls = 0;
  await assert.rejects(
    generateStoryboardPanelsRoute(
      {
        auth: { workspaceId: "workspace_1" } as never,
        req: { header: () => null } as never,
      },
      { projectId: "project_1" },
      {
        getProject: async () => ({ id: "project_1" }) as never,
        requireApprovedScript: async () => {
          throw new ApiError("validation_failed", "Approve the active script first.");
        },
        getActiveProjectPlan: async () => ({
          plan: {}, assetId: "plan-1", contentHash: "hash",
        }) as never,
        createOrGetJob: async () => {
          jobCalls += 1;
          return {} as never;
        },
      },
    ),
    (error: unknown) =>
      error instanceof ApiError && error.code === "validation_failed",
  );
  assert.equal(jobCalls, 0);
});

test("storyboard media generation may create a job after script approval", async () => {
  const result = await generateStoryboardPanelsRoute(
    {
      auth: { workspaceId: "workspace_1" } as never,
      req: { header: () => null } as never,
    },
    { projectId: "project_1" },
    {
      getProject: async () => ({ id: "project_1" }) as never,
      requireApprovedScript: async () => undefined,
      getActiveProjectPlan: async () => ({
        plan: {}, assetId: "plan-1", contentHash: "hash",
      }) as never,
      createOrGetJob: async () => ({
        created: false,
        job: { id: "job-1", status: "queued" },
      }) as never,
    },
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.job.id, "job-1");
});
