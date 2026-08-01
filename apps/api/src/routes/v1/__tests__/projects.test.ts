import assert from "node:assert/strict";
import test from "node:test";
import { parseCreateProject } from "@/lib/api/v1/schemas";
import { projectCreationParams } from "../projects";

test("projects route forwards request-only naming fields into project creation", () => {
  const input = parseCreateProject({
    namingPrompt: "An amber-lit product still",
    namingContext: "image",
  });

  assert.deepEqual(projectCreationParams("workspace-1", input), {
    workspaceId: "workspace-1",
    name: undefined,
    brief: undefined,
    namingPrompt: "An amber-lit product still",
    namingContext: "image",
  });
});
