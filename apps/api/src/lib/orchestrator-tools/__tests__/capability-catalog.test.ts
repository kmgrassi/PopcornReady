import assert from "node:assert/strict";
import test from "node:test";

import { createToolRegistry as createDriverRegistry } from "@/lib/orchestrator/registry";
import { createAudioToolRegistry } from "../audio-registry";
import {
  assertExactlyOneToolOwner,
  getToolCapability,
  DISPATCH_TOOL_NAMES,
  DOMAIN_TOOL_NAMES,
  PRODUCTION_TOOL_NAMES,
  TOOL_CAPABILITY_CATALOG,
  TOOL_NAMES,
  type ToolName,
} from "../capability-catalog";
import { createDefaultToolRegistry } from "../default-registry";
import { createRootToolRegistry } from "../root-registry";
import { ToolRegistry } from "../registry";
import { createVisualsToolRegistry } from "../visuals-registry";

const expectedProductionVocabulary: ToolName[] = [
  "create_or_load_brief",
  "develop_story_blueprint",
  "draft_script",
  "plan_shots",
  "plan_visual_anchors",
  "generate_anchor",
  "generate_storyboard",
  "generate_keyframe",
  "generate_clip",
  "regenerate_image_asset",
  "edit_video_asset",
  "generate_audio",
  "fit_audio_to_picture",
  "assemble_timeline",
  "critique_timeline",
  "request_approval",
  "export_video",
  "publish_to_catalog",
];

// Root-only dispatch tools (PR 6) join the catalog AFTER the production
// vocabulary so legacy display orders are unchanged; they never appear on any
// flat production surface.
const expectedDispatchVocabulary: ToolName[] = ["delegate_visuals", "delegate_audio"];
const expectedDomainVocabulary: ToolName[] = [
  "generate_image_asset",
  "generate_video_asset",
];

const expectedVocabulary: ToolName[] = [
  ...expectedProductionVocabulary.slice(0, 11),
  ...expectedDomainVocabulary,
  ...expectedProductionVocabulary.slice(11),
  ...expectedDispatchVocabulary,
];

const expectedDefaultRegistryOrder: ToolName[] = [
  "create_or_load_brief",
  "develop_story_blueprint",
  "draft_script",
  "plan_shots",
  "plan_visual_anchors",
  "generate_anchor",
  "generate_audio",
  "generate_storyboard",
  "generate_keyframe",
  "generate_clip",
  "regenerate_image_asset",
  "edit_video_asset",
  "fit_audio_to_picture",
  "critique_timeline",
  "export_video",
  "request_approval",
  "assemble_timeline",
  "publish_to_catalog",
];

const expectedDriverDefinitions = [
  ["create_or_load_brief", "Create a new video brief from the prompt or load the active brief.", "sync"],
  ["develop_story_blueprint", "Develop a structured story blueprint for the project.", "sync"],
  ["draft_script", "Draft narration, dialogue, and scene copy from the story blueprint.", "sync"],
  ["plan_shots", "Plan scenes and beats with stable ids from the brief or script.", "sync"],
  ["plan_visual_anchors", "Identify recurring characters, locations, props, and required visual anchors.", "sync"],
  ["generate_anchor", "Generate a reusable visual anchor asset for a character, location, or prop.", "async"],
  ["generate_storyboard", "Generate storyboard or previsualization assets for planned beats.", "async"],
  ["generate_keyframe", "Generate a keyframe image for a beat.", "async"],
  ["generate_clip", "Generate a motion clip for a beat.", "async"],
  ["regenerate_image_asset", "Regenerate one existing image asset from a replacement prompt, minting a new immutable version under the caller's surface policy.", "sync"],
  ["edit_video_asset", "Edit existing uploaded footage or a generated clip in place conceptually, producing a new video asset linked to the source.", "async"],
  ["generate_audio", "Generate narration, dialogue, music, or sound assets.", "async"],
  ["fit_audio_to_picture", "Fit generated audio to a beat window and persist a sync critique.", "sync"],
  ["assemble_timeline", "Assemble available assets into a deterministic timeline.", "sync"],
  ["critique_timeline", "Review the assembled timeline and identify targeted fixes.", "sync"],
  ["request_approval", "Create a user approval gate before an expensive or user-visible stage.", "approval"],
  ["export_video", "Export the current approved timeline to a video artifact.", "async"],
  ["publish_to_catalog", "Publish a generated image, character, or story to the shared public catalog under the system publisher.", "sync"],
] as const;

function names(registry: ToolRegistry): ToolName[] {
  return registry.list().map((definition) => definition.name);
}

test("catalog is the immutable, ordered vocabulary with production/domain/dispatch surfaces", () => {
  assert.deepEqual(TOOL_NAMES, expectedVocabulary);
  assert.deepEqual(PRODUCTION_TOOL_NAMES, expectedProductionVocabulary);
  assert.deepEqual(DISPATCH_TOOL_NAMES, expectedDispatchVocabulary);
  assert.deepEqual(DOMAIN_TOOL_NAMES, expectedDomainVocabulary);
  assert.equal(Object.isFrozen(TOOL_NAMES), true);
  assert.equal(Object.isFrozen(PRODUCTION_TOOL_NAMES), true);
  assert.equal(Object.isFrozen(DISPATCH_TOOL_NAMES), true);
  assert.equal(Object.isFrozen(DOMAIN_TOOL_NAMES), true);
  assert.equal(Object.isFrozen(TOOL_CAPABILITY_CATALOG), true);
  assert.equal(Object.isFrozen(TOOL_CAPABILITY_CATALOG.request_approval.gate), true);
  assert.throws(() => (TOOL_NAMES as ToolName[]).push("plan_shots"));
  assert.throws(() => {
    (TOOL_CAPABILITY_CATALOG.request_approval.gate as { kind: string }).kind = "none";
  });
  // Dispatch tools are root-owned and keep the neutral projection fallback.
  for (const name of expectedDispatchVocabulary) {
    const metadata = getToolCapability(name);
    assert.equal(metadata.ownerRole, "creative_director", name);
    assert.deepEqual(metadata.runProjection, { label: null, order: null }, name);
  }
});

test("ownership validation fails for unowned, multiply owned, and unknown tools", () => {
  const claims = TOOL_NAMES.map((name) => ({
    name,
    ownerRole: getToolCapability(name).ownerRole,
  }));
  assert.doesNotThrow(() => assertExactlyOneToolOwner(claims));
  assert.throws(() => assertExactlyOneToolOwner(claims.slice(1)), /has 0/);
  assert.throws(
    () => assertExactlyOneToolOwner([...claims, claims[0]]),
    /has 2/
  );
  assert.throws(
    () =>
      assertExactlyOneToolOwner([
        ...claims,
        { name: "historical_tool", ownerRole: "visuals" },
      ]),
    /Unknown tool ownership claim/
  );
});

test("approval execution and gate metadata cannot drift", () => {
  for (const name of TOOL_NAMES) {
    const metadata = getToolCapability(name);
    assert.equal(
      metadata.execution === "approval",
      metadata.gate.kind === "approval",
      name
    );
    if (metadata.gate.kind === "approval") {
      assert.equal(metadata.ownerRole, "creative_director");
      assert.equal(metadata.gate.rootOnly, true);
    }
  }
  const regeneration = getToolCapability("regenerate_image_asset");
  assert.equal(regeneration.execution, "sync");
  assert.equal(regeneration.costClass, "media");
});

test("driver stubs preserve the flat production vocabulary, descriptions, and schemas", () => {
  const registry = createDriverRegistry();
  assert.deepEqual([...registry.keys()], expectedProductionVocabulary);
  assert.deepEqual(
    [...registry.values()].map(({ name, description, mode }) => [name, description, mode]),
    expectedDriverDefinitions
  );
  for (const definition of registry.values()) {
    assert.deepEqual(definition.inputSchema, {
      type: "object",
      additionalProperties: true,
      properties: {
        projectId: {
          type: "string",
          description: "Project id the tool should operate on.",
        },
        revisionInstruction: {
          type: "string",
          description: "Optional instruction when retrying or revising a stage.",
        },
      },
    });
    assert.deepEqual(definition.outputSchema, {
      type: "object",
      additionalProperties: true,
    });
  }
});

test("flat default registry keeps its existing order and catalog metadata", () => {
  const registry = createDefaultToolRegistry();
  assert.deepEqual(names(registry), expectedDefaultRegistryOrder);
  for (const definition of registry.list()) {
    const metadata = getToolCapability(definition.name);
    assert.equal(definition.capability, metadata.capability);
    assert.equal(definition.ownerRole, metadata.ownerRole);
    assert.equal(definition.label, metadata.label);
    assert.equal(definition.displayOrder, metadata.displayOrder);
    assert.equal(definition.execution, metadata.execution);
    assert.equal(definition.costClass, metadata.costClass);
    assert.deepEqual(definition.gate, metadata.gate);
  }
});

test("role registries form an exact disjoint 12/8/2 partition", () => {
  const root = names(createRootToolRegistry());
  const visuals = names(createVisualsToolRegistry());
  const audio = names(createAudioToolRegistry());

  assert.deepEqual(root, [
    "create_or_load_brief",
    "develop_story_blueprint",
    "draft_script",
    "plan_shots",
    "plan_visual_anchors",
    "critique_timeline",
    "export_video",
    "request_approval",
    "assemble_timeline",
    "publish_to_catalog",
    // Root-only dispatch adapters (PR 6): registered here and ONLY here.
    "delegate_visuals",
    "delegate_audio",
  ]);
  assert.deepEqual(visuals, [
    "generate_anchor",
    "generate_storyboard",
    "generate_keyframe",
    "generate_clip",
    "regenerate_image_asset",
    "edit_video_asset",
    "generate_image_asset",
    "generate_video_asset",
  ]);
  assert.deepEqual(audio, ["generate_audio", "fit_audio_to_picture"]);

  const combined = [...root, ...visuals, ...audio];
  assert.equal(new Set(combined).size, TOOL_NAMES.length);
  assert.deepEqual(new Set(combined), new Set(TOOL_NAMES));
  for (const domainTool of [...visuals, ...audio]) {
    assert.notEqual(domainTool, "request_approval");
    assert.notEqual(domainTool, "assemble_timeline");
    assert.equal(DISPATCH_TOOL_NAMES.includes(domainTool), false);
  }
  assert.equal(visuals.some((name) => audio.includes(name)), false);

  // Nothing user-visible changes in production: the flat default registry
  // never contains a dispatch tool.
  const flat = names(createDefaultToolRegistry());
  for (const dispatchTool of DISPATCH_TOOL_NAMES) {
    assert.equal(flat.includes(dispatchTool), false, dispatchTool);
  }
});

test("rich registry rejects cross-domain or execution metadata drift", () => {
  const definition = createDefaultToolRegistry().get("plan_shots");
  const wrongOwner = new ToolRegistry();
  assert.throws(
    () => wrongOwner.register({ ...definition, ownerRole: "visuals" }),
    /ownerRole/
  );
  const wrongExecution = new ToolRegistry();
  assert.throws(
    () => wrongExecution.register({ ...definition, execution: "async" }),
    /execution/
  );
  assert.throws(
    () => createDriverRegistry({ plan_shots: { ownerRole: "visuals" } }),
    /ownerRole/
  );
});
