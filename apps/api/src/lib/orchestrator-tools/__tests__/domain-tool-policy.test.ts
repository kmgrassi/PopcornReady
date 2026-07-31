import assert from "node:assert/strict";
import test from "node:test";

import type { DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";
import type { ProjectGraphSnapshot } from "@/lib/orchestrator-context/graph-snapshot";
import { buildDomainTargetScope } from "@/lib/orchestrator-context/target-scope";
import {
  allowedVisualToolNames,
  assertPreparedDomainToolInput,
} from "../domain-tool-policy";

function task(taskKind: string, sourceAssetId = "asset-source"): DomainTaskV1 {
  const direct = taskKind === "image_create" || taskKind === "video_create" || taskKind === "video_edit";
  return {
    schemaVersion: "DomainTask.v1",
    domain: "visuals",
    taskKind,
    objective: "Create the requested visual.",
    instruction: "Create the requested visual.",
    targets: direct && taskKind === "video_edit"
      ? [{ kind: "asset", projectId: "project-1", assetId: sourceAssetId }]
      : [{ kind: "project", projectId: "project-1" }],
    requiredOutputs: [],
    allowedOutputKinds:
      taskKind === "image_create" ? ["image"] : taskKind === "video_edit" || taskKind === "video_create"
        ? ["clip"]
        : ["image", "anchor", "storyboard", "keyframe", "clip", "composite", "render"],
    creativeConstraints: {},
    preserve: {
      assetIds: direct && taskKind === "video_edit" ? [sourceAssetId] : [],
      selections: [],
      fingerprints: direct && taskKind === "video_edit"
        ? [{ assetId: sourceAssetId, value: "hash-source" }]
        : [],
      pins: direct && taskKind === "video_edit"
        ? [{ kind: "asset", id: sourceAssetId, fingerprint: "hash-source" }]
        : [],
    },
    candidateAffectedAssetIds: [],
    budgetUsd: 2,
    approvalContext: direct ? {
      proposalActionId: "proposal",
      approvedBudgetUsd: 2,
      approvalFingerprint: "approval",
    } : undefined,
    acceptanceCriteria: ["Visual exists."],
    origin: direct ? {
      kind: "creator_direct",
      actorId: "actor",
      creatorMessageId: "message",
      entrypoint: "project_api",
      requestDigest: "digest",
      idempotencyKey: "key",
      approvalGateId: "gate",
    } : {
      kind: "creative_director",
      rootRunId: "root-run",
      rootActionId: "root-action",
      creatorMessageId: "message",
    },
    responseRecipient: direct
      ? { kind: "creator_conversation" }
      : { kind: "creative_director" },
  } as unknown as DomainTaskV1;
}

const snapshot = {
  workspaceId: "workspace-1",
  projectId: "project-1",
  assets: [{
    id: "asset-source",
    projectId: "project-1",
    lineageId: "lineage-source",
    kind: "clip",
    media: "video",
    role: "primary_footage",
    status: "ready",
    contentHash: "hash-source",
    inputs: [],
    createdAt: "2026-07-27T00:00:00.000Z",
  }],
  selections: [],
  storyboards: [],
  scenes: [],
  beats: [],
  panels: [],
} as unknown as ProjectGraphSnapshot;

test("Visuals registry policy is partitioned exactly by trusted task kind", () => {
  assert.deepEqual(allowedVisualToolNames(task("image_create")), ["generate_image_asset"]);
  assert.deepEqual(allowedVisualToolNames(task("video_create")), ["generate_video_asset"]);
  assert.deepEqual(allowedVisualToolNames(task("video_edit")), ["edit_video_asset"]);
  assert.deepEqual(allowedVisualToolNames(task("visuals_revision")), [
    "generate_anchor",
    "generate_storyboard",
    "generate_keyframe",
    "generate_clip",
    "regenerate_image_asset",
    "edit_video_asset",
    "generate_video_asset",
  ]);
  assert.deepEqual(allowedVisualToolNames(task("visuals_production")), [
    "generate_anchor",
    "generate_storyboard",
    "generate_keyframe",
    "generate_clip",
    "regenerate_image_asset",
    "edit_video_asset",
  ]);
});

test("storyboard assignments authorize storyboard generation without keyframe authority", () => {
  const storyboardTarget = { kind: "project", projectId: "project-1" } as const;
  const storyboardTask = {
    ...task("visuals_revision"),
    targets: [storyboardTarget],
    requiredOutputs: [{
      bindingId: "storyboard-binding",
      workItemId: "storyboard-work",
      target: storyboardTarget,
      kind: "storyboard",
      role: "beat_storyboard",
      ordinal: 0,
      minimumCount: 1,
    }],
    allowedOutputKinds: ["storyboard"],
  } as DomainTaskV1;
  const scope = buildDomainTargetScope({
    snapshot,
    targets: storyboardTask.targets,
  });

  assert.doesNotThrow(() =>
    assertPreparedDomainToolInput({
      toolName: "generate_storyboard",
      parsedInput: {},
      task: storyboardTask,
      scope,
      snapshot,
    })
  );
  assert.throws(
    () => assertPreparedDomainToolInput({
      toolName: "generate_keyframe",
      parsedInput: {},
      task: storyboardTask,
      scope,
      snapshot,
    }),
    /keyframe output is outside/
  );
});

test("selective standalone video uses server-owned provider settings", () => {
  const revisionTask = task("visuals_revision");
  const scope = buildDomainTargetScope({
    snapshot,
    targets: revisionTask.targets,
  });

  assert.doesNotThrow(() =>
    assertPreparedDomainToolInput({
      toolName: "generate_video_asset",
      parsedInput: { prompt: "A restrained camera move." },
      task: revisionTask,
      scope,
      snapshot,
    })
  );
  assert.throws(
    () =>
      assertPreparedDomainToolInput({
        toolName: "generate_video_asset",
        parsedInput: {
          prompt: "A restrained camera move.",
          provider: "mock",
        },
        task: revisionTask,
        scope,
        snapshot,
      }),
    /derives provider settings server-side/
  );
  assert.throws(
    () =>
      assertPreparedDomainToolInput({
        toolName: "generate_clip",
        parsedInput: { model: "custom-model" },
        task: revisionTask,
        scope,
        snapshot,
      }),
    /derives provider settings server-side/
  );
  const editRevisionTask = {
    ...task("video_edit"),
    taskKind: "visuals_revision",
  } as DomainTaskV1;
  assert.throws(
    () =>
      assertPreparedDomainToolInput({
        toolName: "edit_video_asset",
        parsedInput: {
          sourceAssetId: "asset-source",
          instruction: "Add fog.",
          provider: "mock",
        },
        task: editRevisionTask,
        scope: buildDomainTargetScope({
          snapshot,
          targets: editRevisionTask.targets,
        }),
        snapshot,
      }),
    /derives provider settings server-side/
  );
});

test("bound selective video assignments expose only their canonical primitive", () => {
  const cases = [
    {
      target: { kind: "beat", projectId: "project-1", beatId: "beat-1" },
      expected: ["generate_clip"],
    },
    {
      target: { kind: "asset", projectId: "project-1", assetId: "asset-source" },
      expected: ["edit_video_asset"],
    },
    {
      target: { kind: "project", projectId: "project-1" },
      expected: ["generate_video_asset"],
    },
  ] as const;
  for (const example of cases) {
    const boundTask = {
      ...task("visuals_revision"),
      targets: [example.target],
      requiredOutputs: [{
        bindingId: "binding-clip",
        workItemId: "work-video",
        target: example.target,
        kind: "clip",
        role: "clip",
        ordinal: 0,
        minimumCount: 1,
      }],
      allowedOutputKinds: ["clip"],
    } as DomainTaskV1;
    assert.deepEqual(allowedVisualToolNames(boundTask), example.expected);
  }
});

test("video edit requires an authorized target, trusted pin, and fresh fingerprint", () => {
  const editTask = task("video_edit");
  const scope = buildDomainTargetScope({ snapshot, targets: editTask.targets });
  assert.doesNotThrow(() =>
    assertPreparedDomainToolInput({
      toolName: "edit_video_asset",
      parsedInput: { sourceAssetId: "asset-source", instruction: "Add fog." },
      task: editTask,
      scope,
      snapshot,
    })
  );
  assert.throws(() =>
    assertPreparedDomainToolInput({
      toolName: "edit_video_asset",
      parsedInput: {
        sourceAssetId: "asset-source",
        instruction: "Add fog.",
        provider: "gemini",
      },
      task: editTask,
      scope,
      snapshot,
    }), /derive provider settings/
  );
  const current = task("video_edit");
  const stale = {
    ...current,
    preserve: {
      ...current.preserve,
      fingerprints: [{ assetId: "asset-source", value: "stale-hash" }],
    },
  } as DomainTaskV1;
  assert.throws(() =>
    assertPreparedDomainToolInput({
      toolName: "edit_video_asset",
      parsedInput: { sourceAssetId: "asset-source", instruction: "Add fog." },
      task: stale,
      scope,
      snapshot,
    }), /pinned source/
  );
});

test("project-wide Visuals primitives receive trusted beat filters", () => {
  const scopedSnapshot = {
    ...snapshot,
    scenes: [{
      id: "scene-1",
      projectId: "project-1",
      storyboardId: "storyboard-1",
    }],
    beats: [{
      id: "beat-1",
      projectId: "project-1",
      sceneId: "scene-1",
      beatAssetId: null,
    }],
    panels: [{
      id: "panel-1",
      projectId: "project-1",
      beatId: "beat-1",
      imageAssetId: null,
      promptAssetId: null,
    }],
  } as unknown as ProjectGraphSnapshot;
  const base = task("visuals_production");
  const scopedTask = {
    ...base,
    targets: [{ kind: "panel", projectId: "project-1", panelId: "panel-1" }],
  } as DomainTaskV1;
  const scope = buildDomainTargetScope({
    snapshot: scopedSnapshot,
    targets: scopedTask.targets,
  });
  assert.deepEqual(
    assertPreparedDomainToolInput({
      toolName: "generate_keyframe",
      parsedInput: { feedback: "Make the targeted beat warmer." },
      task: scopedTask,
      scope,
      snapshot: scopedSnapshot,
    }),
    {
      feedback: "Make the targeted beat warmer.",
      targetBeatIds: ["beat-1"],
      targetSceneIds: ["scene-1"],
    }
  );
  const assetOnly = {
    ...base,
    targets: [{
      kind: "asset",
      projectId: "project-1",
      assetId: "asset-source",
    }],
  } as DomainTaskV1;
  const assetScope = buildDomainTargetScope({
    snapshot: scopedSnapshot,
    targets: assetOnly.targets,
  });
  assert.throws(
    () =>
      assertPreparedDomainToolInput({
        toolName: "generate_storyboard",
        parsedInput: {},
        task: assetOnly,
        scope: assetScope,
        snapshot: scopedSnapshot,
      }),
    /beat-bound asset target/
  );
});
