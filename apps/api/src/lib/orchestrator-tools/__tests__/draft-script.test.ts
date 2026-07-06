import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "@/lib/api/v1/auth";
import type {
  ActiveProjectBrief,
  ActiveProjectStoryBlueprint,
} from "@/lib/api/v1/store";
import { createDraftScriptTool } from "../draft-script";
import { ToolInputError } from "../types";
import type { ToolCallResult } from "../types";

const auth: AuthContext = {
  mode: "local",
  actor: { id: "local_dev", type: "local" },
  workspaceId: "ws_1",
  isLocal: true,
};

const activeBrief: ActiveProjectBrief = {
  assetId: "brief_asset_1",
  contentHash: "brief_hash",
  brief: {
    goal: "A space comedy about clones taking over a survey ship.",
    targetLengthSec: 180,
    aspectRatio: "16:9",
    style: "dry sci-fi comedy",
  },
};

const activeBlueprint: ActiveProjectStoryBlueprint = {
  storyBlueprintId: "blueprint_1",
  assetId: "blueprint_asset_1",
  contentHash: "blueprint_hash",
  storyBlueprint: {
    schemaVersion: "storyBlueprint.v1",
    targetLengthSec: 180,
    premise: "Explorers keep cloning themselves and lose track of command.",
    logline: "Every clone thinks they are captain.",
    tone: "dry sci-fi comedy",
    aspectRatio: "16:9",
    characters: [
      {
        id: "captain_ren",
        name: "Captain Ren",
        role: "protagonist",
        description: "A precise commander.",
      },
    ],
    acts: [
      {
        id: "act_1",
        title: "Duplicate Trouble",
        purpose: "Launch the cloning mistake.",
        summary: "The pod makes copies.",
        targetDurationSec: 90,
      },
      {
        id: "act_2",
        title: "Clone Vote",
        purpose: "Escalate command confusion.",
        summary: "The copies hold an election.",
        targetDurationSec: 90,
      },
    ],
    scenes: [
      {
        id: "scene_1",
        title: "Duplicate Trouble",
        summary: "The pod makes copies.",
        actId: "act_1",
        targetDurationSec: 90,
      },
      {
        id: "scene_2",
        title: "Clone Vote",
        summary: "The copies hold an election.",
        actId: "act_2",
        targetDurationSec: 90,
      },
    ],
    ending: "The crew survives with an absurd org chart.",
  },
};

test("draft_script validates input before reading graph state", () => {
  let briefReads = 0;
  const tool = createDraftScriptTool({
    getActiveProjectBrief: async () => {
      briefReads += 1;
      return activeBrief;
    },
    buildFootageGroundingContext: async () => ({ excerpts: [], promptText: null }),
  });

  assert.throws(() => tool.parseInput({ unsupported: true }), ToolInputError);
  assert.equal(briefReads, 0);
});

test("draft_script requires a brief before the blueprint", async () => {
  const tool = createDraftScriptTool({
    getActiveProjectBrief: async () => null,
    getActiveProjectStoryBlueprint: async () => {
      throw new Error("must not read blueprint when brief is missing");
    },
    buildFootageGroundingContext: async () => ({ excerpts: [], promptText: null }),
  });

  const result = (await tool.execute({}, { auth, projectId: "proj_1" })) as ToolCallResult;
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.kind, "precondition_unmet");
    assert.equal(result.error.unmetRequirements?.[0]?.satisfyWith.tool, "create_or_load_brief");
  }
});

test("draft_script persists a script draft with brief and blueprint provenance", async () => {
  let persisted:
    | {
        briefAssetId: string;
        storyBlueprintId: string;
        storyBlueprintAssetId: string;
        sceneCount: number;
      }
    | undefined;
  const tool = createDraftScriptTool({
    getActiveProjectBrief: async () => activeBrief,
    getActiveProjectStoryBlueprint: async () => activeBlueprint,
    buildFootageGroundingContext: async () => ({ excerpts: [], promptText: null }),
    addProjectScriptDraft: async (input) => {
      persisted = {
        briefAssetId: input.briefAssetId,
        storyBlueprintId: input.storyBlueprintId,
        storyBlueprintAssetId: input.storyBlueprintAssetId,
        sceneCount: input.scriptDraft.scenes.length,
      };
      return {
        scriptDraftId: "script_1",
        scriptDraftAssetId: "script_asset_1",
      };
    },
  });

  const parsed = tool.parseInput({ revisionInstruction: "make the banter sharper" });
  const result = (await tool.execute(parsed, { auth, projectId: "proj_1" })) as ToolCallResult;

  assert.equal(result.status, "succeeded");
  assert.deepEqual(persisted, {
    briefAssetId: "brief_asset_1",
    storyBlueprintId: "blueprint_1",
    storyBlueprintAssetId: "blueprint_asset_1",
    sceneCount: 2,
  });
  if (result.status === "succeeded") {
    assert.deepEqual(result.resourceIds, ["script_1", "script_asset_1"]);
    assert.equal(
      (result.output as { scriptDraft?: { narration?: string } }).scriptDraft?.narration?.includes(
        "Every clone thinks they are captain."
      ),
      true
    );
  }
});

test("draft_script includes transcript excerpts and moment windows when present", async () => {
  const tool = createDraftScriptTool({
    getActiveProjectBrief: async () => activeBrief,
    getActiveProjectStoryBlueprint: async () => activeBlueprint,
    buildFootageGroundingContext: async () => ({
      excerpts: [
        {
          assetId: "clip_asset_1",
          label: "birthday.mov",
          transcript: "Maya says this is the best cake ever",
          moments: [
            {
              startSec: 2,
              endSec: 5,
              label: "cake reveal",
              description: "Maya points at the candles",
            },
          ],
        },
      ],
      promptText: "unused by deterministic script draft",
    }),
    addProjectScriptDraft: async (input) => {
      assert.match(input.scriptDraft.narration ?? "", /Maya says this is the best cake ever/);
      assert.match(input.scriptDraft.narration ?? "", /2\.0-5\.0s/);
      assert.equal(
        input.scriptDraft.scenes[0].dialogue[0].text,
        "Maya says this is the best cake ever"
      );
      return {
        scriptDraftId: "script_1",
        scriptDraftAssetId: "script_asset_1",
      };
    },
  });

  const result = await tool.execute({}, { auth, projectId: "proj_1" });

  assert.equal(result.status, "succeeded");
});
