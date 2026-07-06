import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "@/lib/api/v1/auth";
import type { StoryBlueprint } from "@/lib/api/v1/store";
import type { VideoBrief } from "@/lib/api/v1/schemas";
import {
  createDevelopStoryBlueprintTool,
  deriveStoryBlueprint,
  developStoryBlueprintForProject,
  parseDevelopStoryBlueprintInput,
  type DevelopStoryBlueprintOutput,
} from "../develop-story-blueprint";
import { ToolRegistry } from "../registry";
import type { ToolCallResult } from "../types";

const auth: AuthContext = {
  mode: "local",
  actor: { id: "local_dev", type: "local" },
  workspaceId: "ws_1",
  isLocal: true,
};

const sampleBrief: VideoBrief = {
  goal: "A cozy neighborhood cafe wins over morning commuters.",
  targetLengthSec: 30,
  aspectRatio: "9:16",
  style: "warm documentary",
};

const activeBrief = {
  brief: sampleBrief,
  assetId: "brief_asset_1",
  contentHash: "brief_hash_1",
};

test("deriveStoryBlueprint builds a structured three-act blueprint from the brief", () => {
  const blueprint = deriveStoryBlueprint(sampleBrief);

  assert.equal(blueprint.schemaVersion, "storyBlueprint.v1");
  assert.equal(blueprint.targetLengthSec, 30);
  assert.equal(blueprint.aspectRatio, "9:16");
  assert.equal(blueprint.acts.length, 3);
  assert.equal(blueprint.scenes.length, 3);
  assert.equal(blueprint.acts[0].id, "act_1_setup");
});

test("deriveStoryBlueprint preserves target length for very short briefs", () => {
  const blueprint = deriveStoryBlueprint({
    ...sampleBrief,
    targetLengthSec: 5,
  });
  const actDuration = blueprint.acts.reduce((sum, act) => sum + act.targetDurationSec, 0);
  const sceneDuration = blueprint.scenes.reduce(
    (sum, scene) => sum + scene.targetDurationSec,
    0
  );

  assert.equal(actDuration, 5);
  assert.equal(sceneDuration, 5);
});

test("develop_story_blueprint parses retry revisionInstruction as feedback", () => {
  assert.deepEqual(
    parseDevelopStoryBlueprintInput({ revisionInstruction: "Make the ending more joyful." }),
    { feedback: "Make the ending more joyful." }
  );
});

test("develop_story_blueprint rejects unsupported input fields", () => {
  assert.throws(
    () => parseDevelopStoryBlueprintInput({ unexpected: true }),
    /unsupported fields/
  );
});

test("develop_story_blueprint validates input before reading the brief", async () => {
  let readBrief = false;
  const registry = new ToolRegistry();
  registry.register(createDevelopStoryBlueprintTool({
    getActiveProjectBrief: async () => {
      readBrief = true;
      return activeBrief;
    },
    addProjectStoryBlueprint: async () => ({
      storyBlueprintId: "story_1",
      storyBlueprintAssetId: "story_asset_1",
    }),
  }));

  const result = await registry.execute(
    "develop_story_blueprint",
    { feedback: 123 },
    { auth, projectId: "proj_1" }
  );

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.kind, "invalid_input");
  }
  assert.equal(readBrief, false);
});

test("develop_story_blueprint requires a brief and suggests create_or_load_brief", async () => {
  const tool = createDevelopStoryBlueprintTool({
    getActiveProjectBrief: async () => null,
    addProjectStoryBlueprint: async () => {
      throw new Error("must not persist without a brief");
    },
  });

  const result = await tool.execute({}, { auth, projectId: "proj_1" });

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.kind, "precondition_unmet");
    assert.equal(
      result.error.unmetRequirements?.[0]?.satisfyWith.tool,
      "create_or_load_brief"
    );
  }
});

test("develop_story_blueprint persists the blueprint with brief provenance", async () => {
  let persisted:
    | {
        blueprint: StoryBlueprint;
        briefAssetId: string;
        briefContentHash: string;
      }
    | undefined;
  const tool = createDevelopStoryBlueprintTool({
    getActiveProjectBrief: async () => activeBrief,
    addProjectStoryBlueprint: async (input) => {
      persisted = input;
      return {
        storyBlueprintId: "story_1",
        storyBlueprintAssetId: "story_asset_1",
      };
    },
  });

  const result = (await tool.execute(
    { feedback: "Emphasize community." },
    { auth, projectId: "proj_1" }
  )) as ToolCallResult<DevelopStoryBlueprintOutput>;

  assert.equal(persisted?.briefAssetId, "brief_asset_1");
  assert.equal(persisted?.briefContentHash, "brief_hash_1");
  assert.match(persisted?.blueprint.logline ?? "", /Emphasize community/);
  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded") {
    assert.deepEqual(result.resourceIds, ["story_1", "story_asset_1"]);
    assert.equal(result.output?.storyBlueprintId, "story_1");
    assert.equal(result.output?.storyBlueprintAssetId, "story_asset_1");
  }
});

test("developStoryBlueprintForProject returns null without an active brief", async () => {
  const output = await developStoryBlueprintForProject(
    { workspaceId: "ws_1", projectId: "proj_1" },
    {
      getActiveProjectBrief: async () => null,
      addProjectStoryBlueprint: async () => {
        throw new Error("must not persist without a brief");
      },
    }
  );
  assert.equal(output, null);
});

test("developStoryBlueprintForProject persists a feedback-steered blueprint", async () => {
  let persisted:
    | {
        workspaceId: string;
        projectId: string;
        blueprint: StoryBlueprint;
        briefAssetId: string;
      }
    | undefined;
  const output = await developStoryBlueprintForProject(
    { workspaceId: "ws_1", projectId: "proj_1", feedback: "Lean into the regulars." },
    {
      getActiveProjectBrief: async () => activeBrief,
      addProjectStoryBlueprint: async (input) => {
        persisted = input;
        return {
          storyBlueprintId: "story_2",
          storyBlueprintAssetId: "story_asset_2",
        };
      },
    }
  );

  assert.equal(persisted?.workspaceId, "ws_1");
  assert.equal(persisted?.projectId, "proj_1");
  assert.equal(persisted?.briefAssetId, "brief_asset_1");
  assert.match(persisted?.blueprint.logline ?? "", /Lean into the regulars/);
  assert.equal(output?.storyBlueprintId, "story_2");
  assert.equal(output?.storyBlueprintAssetId, "story_asset_2");
});
