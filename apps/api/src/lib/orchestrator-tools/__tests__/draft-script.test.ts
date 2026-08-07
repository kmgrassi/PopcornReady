import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "@/lib/api/v1/auth";
import type {
  ActiveProjectBrief,
  ActiveProjectStoryBlueprint,
} from "@/lib/api/v1/store";
import { createDraftScriptTool, draftScriptFromState, parseDraftScriptInput } from "../draft-script";
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

test("draft_script accepts a complete authored scene contract", () => {
  const parsed = parseDraftScriptInput({
    authoredScript: {
      narration: "A new world, built on old sacrifices.",
      scenes: [{
        title: "The archive",
        summary: "Mara finds her grandmother's records.",
        narration: "The room remembers scarcity.",
        dialogue: [{ characterName: "Mara", text: "You lived like this?" }],
      }],
    },
  });
  assert.equal(parsed.authoredScript?.scenes[0]?.title, "The archive");
  assert.throws(
    () => parseDraftScriptInput({
      authoredScript: {
        scenes: [{ title: "Broken", summary: "Bad duration", durationSec: Number.POSITIVE_INFINITY }],
      },
    }),
    /scenes are incomplete/,
  );
  assert.throws(
    () => parseDraftScriptInput({
      authoredScript: { scenes: [{ title: "Empty", summary: "No script copy" }] },
    }),
    /scenes are incomplete/,
  );
  assert.throws(
    () => parseDraftScriptInput({
      authoredScript: {
        scenes: [{ title: "Broken", summary: "Bad narration", narration: 42 }],
      },
    }),
    /scenes are incomplete/,
  );
  assert.throws(
    () => parseDraftScriptInput({
      authoredScript: {
        scenes: [{ title: "Broken", summary: "Unknown field", camera: "wide" }],
      },
    }),
    /scenes are incomplete/,
  );
});

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
    getActiveProjectScriptDraft: async () => null,
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
        groundingInputs?: { assetId: string; role?: string; contentHash?: string }[];
      }
    | undefined;
  const tool = createDraftScriptTool({
    getActiveProjectBrief: async () => activeBrief,
    getActiveProjectScriptDraft: async () => null,
    getActiveProjectStoryBlueprint: async () => activeBlueprint,
    buildFootageGroundingContext: async () => ({ excerpts: [], promptText: null }),
    addProjectScriptDraft: async (input) => {
      persisted = {
        briefAssetId: input.briefAssetId,
        storyBlueprintId: input.storyBlueprintId,
        storyBlueprintAssetId: input.storyBlueprintAssetId,
        sceneCount: input.scriptDraft.scenes.length,
        groundingInputs: input.groundingInputs,
      };
      return {
        scriptDraftId: "script_1",
        scriptDraftAssetId: "script_asset_1",
      };
    },
  });

  const parsed = tool.parseInput({
    revisionInstruction: "make the banter sharper",
    revisedScript: "Every clone thinks they are captain, and every vote makes it worse.",
  });
  const result = (await tool.execute(parsed, { auth, projectId: "proj_1" })) as ToolCallResult;

  assert.equal(result.status, "succeeded");
  assert.deepEqual(persisted, {
    briefAssetId: "brief_asset_1",
    storyBlueprintId: "blueprint_1",
    storyBlueprintAssetId: "blueprint_asset_1",
    sceneCount: 2,
    groundingInputs: [],
  });
  if (result.status === "succeeded") {
    assert.deepEqual(result.resourceIds, ["script_1", "script_asset_1"]);
    assert.equal(
      (result.output as { scriptDraft?: { narration?: string } }).scriptDraft?.narration?.includes(
        "Every clone thinks they are captain, and every vote makes it worse."
      ),
      true
    );
  }
});

test("draft_script includes transcript excerpts and moment windows when present", async () => {
  const tool = createDraftScriptTool({
    getActiveProjectBrief: async () => activeBrief,
    getActiveProjectScriptDraft: async () => null,
    getActiveProjectStoryBlueprint: async () => activeBlueprint,
    buildFootageGroundingContext: async () => ({
      excerpts: [
        {
          assetId: "clip_asset_1",
          contentHash: "clip_hash_1",
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
      assert.deepEqual(input.groundingInputs, [
        {
          assetId: "clip_asset_1",
          relation: "input",
          role: "footage_grounding",
          position: 2,
          contentHash: "clip_hash_1",
        },
      ]);
      return {
        scriptDraftId: "script_1",
        scriptDraftAssetId: "script_asset_1",
      };
    },
  });

  const result = await tool.execute({}, { auth, projectId: "proj_1" });

  assert.equal(result.status, "succeeded");
});

test("draft_script preserves supplied script text exactly until the user requests a rewrite", () => {
  const supplied = "OPEN ON: A quiet kitchen.\n\nMAYA: We are out of popcorn.";
  const script = draftScriptFromState({
    brief: {
      ...activeBrief,
      brief: {
        ...activeBrief.brief,
        narration: { mode: "provided_text", script: supplied },
      },
    },
    blueprint: activeBlueprint,
  });

  assert.equal(script.narration, supplied);
  assert.equal(script.scenes[0]?.narration, supplied);
  assert.equal(script.scenes[0]?.dialogue.length, 0);
});

test("draft_script persists the model's complete revised script without annotations", () => {
  const revised = "OPEN ON: A loud kitchen.\n\nMAYA: The popcorn has escaped.";
  const script = draftScriptFromState({
    brief: activeBrief,
    blueprint: activeBlueprint,
    feedback: "Make it louder.",
    revisedScript: revised,
  });

  assert.equal(script.narration, revised);
  assert.equal(script.scenes[0]?.narration, revised);
  assert.doesNotMatch(script.narration ?? "", /Revision direction/);
});

test("draft_script refuses feedback-only revisions before reading or persisting state", async () => {
  let briefReads = 0;
  const tool = createDraftScriptTool({
    getActiveProjectBrief: async () => {
      briefReads += 1;
      return activeBrief;
    },
  });

  const result = await tool.execute(
    tool.parseInput({ feedback: "Make Maya more suspicious." }),
    { auth, projectId: "proj_1" },
  );

  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.error.kind, "invalid_input");
  assert.equal(briefReads, 0);
});
