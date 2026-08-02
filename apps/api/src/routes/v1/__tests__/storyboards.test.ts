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
