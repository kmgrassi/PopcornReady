import assert from "node:assert/strict";
import test from "node:test";
import type { DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";

import { buildDomainReportFromCompletion } from "../agent-definition";
import { projectDomainRecovery } from "../domain-recovery-projection";
import { selectDomainBlockedCandidate } from "../engine";
import { VISUALS_DECISION_SCENARIOS } from "../evals/visuals-scenarios";
import {
  buildFixtureSurfaces,
  runHierarchyScenarios,
} from "../evals/hierarchy-fixture";
import { VISUALS_PROFILE, VISUALS_SYSTEM_PROMPT } from "../visuals-profile";

const visualTask = {
  schemaVersion: "DomainTask.v1",
  domain: "visuals",
  taskKind: "visuals_revision",
  objective: "Revise the supplied beat without changing story or pacing.",
  instruction: "Keep the story intact and revise only the visual treatment.",
  targets: [{ kind: "beat", projectId: "project-1", beatId: "beat-1" }],
  requiredOutputs: [{ kind: "clip", role: "primary", minimumCount: 1 }],
  allowedOutputKinds: ["clip"],
  creativeConstraints: {},
  preserve: { assetIds: [], selections: [], fingerprints: [], pins: [] },
  candidateAffectedAssetIds: [],
  budgetUsd: 1,
  acceptanceCriteria: ["Preserve the supplied story beat."],
  origin: {
    kind: "creative_director",
    rootRunId: "root-run",
    rootActionId: "root-action",
    creatorMessageId: "message-1",
  },
  responseRecipient: { kind: "creative_director" },
} as unknown as DomainTaskV1;

test("Visuals profile keeps recovery local and root-owned judgments explicit", () => {
  assert.deepEqual(VISUALS_PROFILE.localRecoveryOrder, [
    "generate_storyboard",
    "generate_keyframe",
    "generate_clip",
  ]);
  assert.match(VISUALS_SYSTEM_PROMPT, /Standalone outputs remain pooled/);
  assert.match(VISUALS_SYSTEM_PROMPT, /missing creative-director anchor plan.*blocked/i);
  assert.match(VISUALS_SYSTEM_PROMPT, /story, pacing, approval.*question/i);
});

test("Visuals decision fixtures validate scoring against the real Visuals schemas", async () => {
  const expectedById = new Map(
    VISUALS_DECISION_SCENARIOS.map((scenario) => [scenario.id, scenario.expect])
  );
  const results = await runHierarchyScenarios(VISUALS_DECISION_SCENARIOS, {
    model: async ({ scenarioId }) => {
      const expected = expectedById.get(scenarioId);
      return expected?.type === "tool_call"
        ? { type: "tool_call", toolName: expected.oneOf[0]! }
        : { type: "done" };
    },
  });
  assert.equal(
    results.every((result) =>
      result.classifications.every((classification) => classification === "acceptable")
    ),
    true
  );
  assert.deepEqual(
    VISUALS_DECISION_SCENARIOS.map((scenario) => scenario.id),
    [
      "visuals_standalone_image",
      "visuals_standalone_video",
      "visuals_pinned_video_edit",
      "visuals_clip_missing_keyframe",
    ]
  );
  const surface = buildFixtureSurfaces().visuals;
  assert.equal(surface.length, 8);
  for (const scenario of VISUALS_DECISION_SCENARIOS) {
    if (scenario.expect.type !== "tool_call") continue;
    const expectedTool = scenario.expect.oneOf[0];
    const definition = surface.find(
      (candidate) => candidate.name === expectedTool
    );
    assert.ok(definition);
    assert.equal(definition.inputSchema.type, "object");
  }
});

test("Visuals emits an executable question when a revision requires a story judgment", async () => {
  const report = await buildDomainReportFromCompletion({
    runId: "visuals-question-run",
    projectId: "project-1",
    task: visualTask,
    actions: [],
    summary: JSON.stringify({
      outcome: "question",
      question: "Should the story beat change, or should Visuals preserve its pacing?",
      options: [
        {
          id: "preserve_story",
          label: "Preserve story",
          tradeoff: "Limits the revision to visual treatment.",
        },
        {
          id: "change_story",
          label: "Change story",
          tradeoff: "Requires a creative-director decision.",
        },
      ],
    }),
  });

  assert.equal(report.outcome.outcome, "question");
  if (report.outcome.outcome === "question") {
    assert.deepEqual(report.outcome.targets, visualTask.targets);
    assert.match(report.outcome.fingerprint, /^[a-f0-9]{64}$/);
  }
});

test("Visuals converts a missing root-owned plan into an executable blocked escalation", () => {
  const recovery = projectDomainRecovery({
    ownerRole: "visuals",
    projectId: "project-1",
    trustedTargets: visualTask.targets,
    error: {
      unmetRequirements: [
        {
          requirement: "visual_anchor_plan",
          because: "A root-owned anchor plan is required.",
          satisfyWith: { tool: "plan_visual_anchors", inputHint: {} },
        },
      ],
    },
  });

  assert.deepEqual(recovery.suggestedNextTools, []);
  assert.equal(
    selectDomainBlockedCandidate(recovery)?.requiredDomain,
    "creative_director"
  );
  assert.deepEqual(
    selectDomainBlockedCandidate(recovery)?.targets,
    [{ kind: "project", projectId: "project-1" }]
  );
});
