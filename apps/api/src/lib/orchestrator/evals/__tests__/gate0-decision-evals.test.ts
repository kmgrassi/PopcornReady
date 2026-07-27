// Deterministic Gate-0 harness tests: every model is a scripted fixture, so no
// test here can perform a network/billable call. Assertions target observable
// eval outcomes — scenario integrity, classification results, and aggregated
// report numbers — not that a mock was invoked.

import "@/env";

import assert from "node:assert/strict";
import test from "node:test";

import { TOOL_CAPABILITY_CATALOG } from "@/lib/orchestrator-tools/capability-catalog";
import { TOOL_NAMES, type ToolName } from "../../types";
import type { OrchestratorModel } from "../../model";
import {
  buildGate0Report,
  classifyDecision,
  GATE0_FAMILIES,
  lastFailedTool,
  runFlatBaseline,
  scoreScenarioSamples,
  tagScenarios,
  type Gate0Report,
  type Gate0Scenario,
} from "../gate0-report";
import {
  CROSS_MODALITY,
  GATE0_FLAT_SCENARIOS,
  GATE0_RECOVERY,
  LONG_CONTEXT,
  PREMATURE_DONE,
  SELECTIVE_REGENERATION,
  TOOL_OVERLOAD,
} from "../gate0-scenarios";
import {
  buildFixtureRoutingContext,
  buildFixtureSurfaces,
  DELEGATE_AUDIO_FIXTURE,
  DELEGATE_VISUALS_FIXTURE,
  HIERARCHY_ROOT_SCENARIOS,
  HIERARCHY_SCENARIOS,
  runHierarchyScenarios,
  type FixtureDecisionModel,
} from "../hierarchy-fixture";
import { flatMatrix, runGate0Baseline } from "../gate0-baseline-runner";
import { buildPairedMatrix, projectToHierarchy } from "../paired-projection";
import { buildRoutingContext } from "../../model";
import { ALL_SCENARIOS, RECOVERY } from "../scenarios";

const TOOL_NAME_SET = new Set<string>(TOOL_NAMES);

function familyBaseline(report: Gate0Report, family: string) {
  const baseline = report.families.find((entry) => entry.family === family);
  assert.ok(baseline, `report has a ${family} family baseline`);
  return baseline;
}

// ---------------------------------------------------------------------------
// Scenario integrity
// ---------------------------------------------------------------------------

test("gate0 flat scenarios cover all six new Gate-0 families", () => {
  const families = new Set(GATE0_FLAT_SCENARIOS.map((scenario) => scenario.family));
  for (const family of [
    "long_context",
    "tool_overload",
    "cross_modality",
    "selective_regeneration",
    "premature_done",
    "recovery",
  ] as const) {
    assert.ok(families.has(family), `missing family: ${family}`);
    assert.ok(GATE0_FAMILIES.includes(family));
  }
  // Each new family carries more than one scenario so a baseline is not a
  // single-sample anecdote.
  for (const group of [
    LONG_CONTEXT,
    TOOL_OVERLOAD,
    CROSS_MODALITY,
    SELECTIVE_REGENERATION,
    PREMATURE_DONE,
    GATE0_RECOVERY,
  ]) {
    assert.ok(group.length >= 3, "every family has at least 3 scenarios");
  }
});

test("gate0 flat scenarios only reference the real production vocabulary", () => {
  for (const scenario of GATE0_FLAT_SCENARIOS) {
    for (const tool of scenario.availableTools) {
      assert.ok(TOOL_NAME_SET.has(tool), `${scenario.id}: unknown tool ${tool}`);
    }
    if (scenario.expect.type === "tool_call") {
      assert.ok(scenario.expect.oneOf.length > 0, `${scenario.id}: empty acceptable set`);
      for (const tool of scenario.expect.oneOf) {
        assert.ok(
          scenario.availableTools.includes(tool),
          `${scenario.id}: expected tool ${tool} not exposed to the model`
        );
      }
    }
    for (const prior of scenario.priorResults) {
      assert.ok(TOOL_NAME_SET.has(prior.tool), `${scenario.id}: unknown prior tool ${prior.tool}`);
    }
  }
});

test("gate0 scenario ids are unique, including against the pre-existing matrix", () => {
  const ids = [
    ...ALL_SCENARIOS.map((scenario) => scenario.id),
    ...GATE0_FLAT_SCENARIOS.map((scenario) => scenario.id),
    ...HIERARCHY_SCENARIOS.map((scenario) => scenario.id),
  ];
  assert.equal(new Set(ids).size, ids.length, "duplicate scenario id");
});

test("gate0 recovery scenarios end in a failure whose remedy is the expected tool", () => {
  for (const scenario of GATE0_RECOVERY) {
    const failed = lastFailedTool(scenario.priorResults);
    assert.ok(failed, `${scenario.id}: latest prior result must be a failure`);
    assert.equal(scenario.expect.type, "tool_call");
    if (scenario.expect.type !== "tool_call") continue;
    assert.ok(
      !scenario.expect.oneOf.includes(failed as ToolName),
      `${scenario.id}: retrying the failed tool must never be acceptable`
    );
    const latest = scenario.priorResults.at(-1)!;
    const remedies = (latest.error?.unmetRequirements ?? []).map((miss) => miss.satisfyWith.tool);
    for (const tool of scenario.expect.oneOf) {
      assert.ok(remedies.includes(tool), `${scenario.id}: expectation must match satisfyWith`);
    }
  }
});

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

test("classifyDecision maps decisions onto the Gate-0 failure taxonomy", () => {
  const toolExpect = { type: "tool_call" as const, oneOf: ["generate_keyframe"] };
  assert.equal(
    classifyDecision({ expect: { type: "done" }, sample: { decision: "done" } }),
    "acceptable"
  );
  assert.equal(
    classifyDecision({
      expect: { type: "done" },
      sample: { decision: "tool_call", toolName: "generate_clip" },
    }),
    "unnecessary_turn"
  );
  assert.equal(
    classifyDecision({ expect: toolExpect, sample: { decision: "done" } }),
    "premature_done"
  );
  assert.equal(
    classifyDecision({
      expect: toolExpect,
      sample: { decision: "tool_call", toolName: "generate_keyframe" },
    }),
    "acceptable"
  );
  assert.equal(
    classifyDecision({
      expect: toolExpect,
      sample: { decision: "tool_call", toolName: "generate_clip" },
      lastFailedTool: "generate_clip",
    }),
    "repeated_failed_call"
  );
  assert.equal(
    classifyDecision({
      expect: toolExpect,
      sample: { decision: "tool_call", toolName: "plan_shots" },
      lastFailedTool: "generate_clip",
    }),
    "wrong_tool"
  );
});

// ---------------------------------------------------------------------------
// Flat baseline report against the production registry (fixture models only)
// ---------------------------------------------------------------------------

function scriptedFlatModel(
  decide: (scenarioId: string) => { tool: ToolName } | "done"
): OrchestratorModel {
  return async ({ projectId }) => {
    const decision = decide(projectId);
    if (decision === "done") return { type: "done", summary: "fixture", model: "fixture" };
    return { type: "tool_call", toolName: decision.tool, input: {}, model: "fixture" };
  };
}

function perfectModel(scenarios: Gate0Scenario[]): OrchestratorModel {
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  return scriptedFlatModel((scenarioId) => {
    const scenario = byId.get(scenarioId);
    if (!scenario || scenario.expect.type === "done") return "done";
    return { tool: scenario.expect.oneOf[0]! };
  });
}

test("flat baseline: a model that matches every expectation scores 100% with zero failure counts", async () => {
  const report = await runFlatBaseline(GATE0_FLAT_SCENARIOS, {
    model: perfectModel(GATE0_FLAT_SCENARIOS),
    samples: 2,
  });
  assert.equal(report.surface, "flat_production");
  assert.equal(report.samplesPerScenario, 2);
  assert.equal(report.overall.samples, GATE0_FLAT_SCENARIOS.length * 2);
  assert.equal(report.overall.accuracy, 1);
  assert.equal(report.overall.wrongTool, 0);
  assert.equal(report.overall.prematureDone, 0);
  assert.equal(report.overall.unnecessaryTurns, 0);
  assert.equal(report.overall.repeatedFailedCalls, 0);
  assert.deepEqual(report.failures, []);
  // Every family appears with its own scenario count.
  assert.equal(familyBaseline(report, "recovery").scenarios, GATE0_RECOVERY.length);
  assert.equal(familyBaseline(report, "long_context").scenarios, LONG_CONTEXT.length);
});

test("flat baseline: a model that always says done is charged with premature-done on every remaining-work scenario", async () => {
  const report = await runFlatBaseline(GATE0_FLAT_SCENARIOS, {
    model: scriptedFlatModel(() => "done"),
    samples: 1,
  });
  const doneExpected = GATE0_FLAT_SCENARIOS.filter((s) => s.expect.type === "done").length;
  const toolExpected = GATE0_FLAT_SCENARIOS.length - doneExpected;
  assert.equal(report.overall.prematureDone, toolExpected);
  assert.equal(report.overall.acceptable, doneExpected);
  assert.equal(report.overall.unnecessaryTurns, 0);
  assert.equal(familyBaseline(report, "premature_done").prematureDone, PREMATURE_DONE.length);
});

test("flat baseline: blindly retrying the failed tool is counted as repeated-failed-call recovery misses", async () => {
  const byId = new Map(GATE0_RECOVERY.map((scenario) => [scenario.id, scenario]));
  const report = await runFlatBaseline(GATE0_RECOVERY, {
    model: scriptedFlatModel((scenarioId) => ({
      tool: lastFailedTool(byId.get(scenarioId)!.priorResults) as ToolName,
    })),
    samples: 1,
  });
  assert.equal(report.overall.repeatedFailedCalls, GATE0_RECOVERY.length);
  assert.equal(report.overall.accuracy, 0);
  for (const failure of report.failures) {
    assert.equal(failure.classification, "repeated_failed_call");
  }
});

test("flat baseline: calling any tool after export is an unnecessary turn", async () => {
  const finished = GATE0_FLAT_SCENARIOS.filter((s) => s.expect.type === "done");
  assert.ok(finished.length >= 2, "matrix keeps completed-run scenarios");
  const report = await runFlatBaseline(finished, {
    model: scriptedFlatModel(() => ({ tool: "publish_to_catalog" })),
    samples: 1,
  });
  assert.equal(report.overall.unnecessaryTurns, finished.length);
  assert.equal(report.overall.accuracy, 0);
  for (const failure of report.failures) {
    assert.equal(failure.classification, "unnecessary_turn");
    assert.equal(failure.got, "publish_to_catalog");
  }
});

test("flat baseline: repeated samples are scored individually", () => {
  const scenario = GATE0_RECOVERY[0]!;
  const failed = lastFailedTool(scenario.priorResults)!;
  const expected =
    scenario.expect.type === "tool_call" ? scenario.expect.oneOf[0]! : ("done" as never);
  const scored = scoreScenarioSamples(scenario, [
    { decision: "tool_call", toolName: expected, ok: true },
    { decision: "tool_call", toolName: failed, ok: false },
    { decision: "done", ok: false },
  ]);
  assert.deepEqual(scored.classifications, [
    "acceptable",
    "repeated_failed_call",
    "premature_done",
  ]);
  const report = buildGate0Report("flat_production", 3, [scored]);
  assert.equal(report.overall.samples, 3);
  assert.equal(report.overall.acceptable, 1);
  assert.ok(Math.abs(report.overall.accuracy - 1 / 3) < 1e-9);
});

test("tagScenarios folds the pre-existing matrix into the report without mutating it", () => {
  const tagged = tagScenarios(ALL_SCENARIOS, "forward_chain");
  assert.equal(tagged.length, ALL_SCENARIOS.length);
  assert.ok(tagged.every((scenario) => scenario.family === "forward_chain"));
  assert.ok(!("family" in ALL_SCENARIOS[0]!));
});

// ---------------------------------------------------------------------------
// Fixture-only hierarchy simulation
// ---------------------------------------------------------------------------

test("fixture surfaces mirror catalog ownership: root gets coherence + dispatch tools, domains get only their own leaves", () => {
  const surfaces = buildFixtureSurfaces();
  const names = {
    root: new Set(surfaces.root.map((tool) => tool.name)),
    visuals: new Set(surfaces.visuals.map((tool) => tool.name)),
    audio: new Set(surfaces.audio.map((tool) => tool.name)),
  };

  assert.ok(names.root.has("delegate_visuals"));
  assert.ok(names.root.has("delegate_audio"));

  for (const [tool, entry] of Object.entries(TOOL_CAPABILITY_CATALOG)) {
    if (entry.ownerRole === "creative_director") {
      assert.ok(names.root.has(tool), `root surface missing ${tool}`);
      assert.ok(!names.visuals.has(tool), `visuals surface must not expose root tool ${tool}`);
      assert.ok(!names.audio.has(tool), `audio surface must not expose root tool ${tool}`);
    }
    if (entry.ownerRole === "visuals") {
      assert.ok(names.visuals.has(tool), `visuals surface missing ${tool}`);
      assert.ok(!names.root.has(tool), `root surface must not expose leaf tool ${tool}`);
      assert.ok(!names.audio.has(tool), `audio surface must not expose visuals tool ${tool}`);
    }
    if (entry.ownerRole === "audio") {
      assert.ok(names.audio.has(tool), `audio surface missing ${tool}`);
      assert.ok(!names.root.has(tool), `root surface must not expose leaf tool ${tool}`);
      assert.ok(!names.visuals.has(tool), `visuals surface must not expose audio tool ${tool}`);
    }
  }
  // Domain surfaces never see dispatch tools (no re-delegation).
  for (const surface of ["visuals", "audio"] as const) {
    assert.ok(!names[surface].has(DELEGATE_VISUALS_FIXTURE.name));
    assert.ok(!names[surface].has(DELEGATE_AUDIO_FIXTURE.name));
  }
  // Fixture definitions carry no execution capability at all.
  for (const tool of [...surfaces.root, ...surfaces.visuals, ...surfaces.audio]) {
    assert.ok(!("execute" in tool), `${tool.name}: fixture tools must not be executable`);
    assert.equal(typeof tool.description, "string");
    assert.ok(tool.description.length > 0);
  }
});

test("hierarchy scenarios only expect tools that exist on their simulated surface", () => {
  const surfaces = buildFixtureSurfaces();
  for (const scenario of HIERARCHY_SCENARIOS) {
    const surfaceTools = new Set(surfaces[scenario.surface].map((tool) => tool.name));
    if (scenario.expect.type === "tool_call") {
      for (const tool of scenario.expect.oneOf) {
        assert.ok(surfaceTools.has(tool), `${scenario.id}: ${tool} not on ${scenario.surface}`);
      }
    }
  }
});

function scriptedHierarchyModel(
  decide: (scenarioId: string, tools: string[]) => string | "done"
): FixtureDecisionModel {
  return async ({ scenarioId, tools }) => {
    const decision = decide(
      scenarioId,
      tools.map((tool) => tool.name)
    );
    if (decision === "done") return { type: "done" };
    return { type: "tool_call", toolName: decision };
  };
}

test("hierarchy simulation: a delegating root model scores 100% and receives only surface tools", async () => {
  const seenToolNames: string[][] = [];
  const byId = new Map(HIERARCHY_SCENARIOS.map((scenario) => [scenario.id, scenario]));
  const model: FixtureDecisionModel = async (input) => {
    seenToolNames.push(input.tools.map((tool) => tool.name));
    const scenario = byId.get(input.scenarioId)!;
    if (scenario.expect.type === "done") return { type: "done" };
    return { type: "tool_call", toolName: scenario.expect.oneOf[0]! };
  };

  const scored = await runHierarchyScenarios(HIERARCHY_SCENARIOS, { model, samples: 2 });
  const report = buildGate0Report("hierarchy_fixture", 2, scored);
  assert.equal(report.surface, "hierarchy_fixture");
  assert.equal(report.overall.samples, HIERARCHY_SCENARIOS.length * 2);
  assert.equal(report.overall.accuracy, 1);
  assert.deepEqual(report.failures, []);

  // The model was only ever offered the simulated surface: root decisions see
  // dispatch tools, never leaf media tools.
  const rootCalls = seenToolNames.filter((names) => names.includes("delegate_visuals"));
  assert.ok(rootCalls.length > 0);
  for (const names of rootCalls) {
    assert.ok(!names.includes("generate_clip"), "root surface leaked a leaf media tool");
    assert.ok(!names.includes("generate_audio"), "root surface leaked a leaf media tool");
  }
});

test("hierarchy simulation: re-dispatching the blocked domain counts as a repeated failed call", async () => {
  const blocked = HIERARCHY_ROOT_SCENARIOS.find(
    (scenario) => scenario.id === "hier_root_visuals_blocked_on_audio"
  )!;
  const scored = await runHierarchyScenarios([blocked], {
    model: scriptedHierarchyModel(() => "delegate_visuals"),
    samples: 1,
  });
  const report = buildGate0Report("hierarchy_fixture", 1, scored);
  assert.equal(report.overall.repeatedFailedCalls, 1);
  assert.equal(report.overall.accuracy, 0);
});

test("hierarchy simulation: stopping mid-production and dispatching after export are charged to the right metrics", async () => {
  const dispatchNeeded = HIERARCHY_ROOT_SCENARIOS.find(
    (scenario) => scenario.id === "hier_root_plan_ready_dispatch_visuals"
  )!;
  const finished = HIERARCHY_ROOT_SCENARIOS.find(
    (scenario) => scenario.id === "hier_root_done_after_export"
  )!;
  const scored = await runHierarchyScenarios([dispatchNeeded, finished], {
    model: scriptedHierarchyModel((scenarioId) =>
      scenarioId === dispatchNeeded.id ? "done" : "delegate_visuals"
    ),
    samples: 1,
  });
  const report = buildGate0Report("hierarchy_fixture", 1, scored);
  assert.equal(report.overall.prematureDone, 1);
  assert.equal(report.overall.unnecessaryTurns, 1);
  assert.equal(report.overall.acceptable, 0);
});

// ---------------------------------------------------------------------------
// Paired scenario matrix (review finding 1): the gate comparison scores the
// SAME scenarios on both surfaces via deterministic projection.
// ---------------------------------------------------------------------------

test("paired matrix projects every flat scenario onto the hierarchy surface with the same id", () => {
  const scenarios = flatMatrix();
  const pairs = buildPairedMatrix(scenarios);
  assert.equal(pairs.length, scenarios.length);
  for (const pair of pairs) {
    assert.equal(pair.hierarchy.id, pair.flat.id, "pair ids must match for row-by-row comparison");
    assert.equal(pair.hierarchy.family, pair.flat.family);
    // done expectations survive projection; tool expectations stay non-empty.
    if (pair.flat.expect.type === "done") {
      assert.equal(pair.hierarchy.expect.type, "done");
    } else {
      assert.equal(pair.hierarchy.expect.type, "tool_call");
      if (pair.hierarchy.expect.type === "tool_call") {
        assert.ok(pair.hierarchy.expect.oneOf.length > 0, `${pair.flat.id}: empty projected set`);
      }
    }
  }
});

test("paired projections only expect and reference tools available on their simulated surface", () => {
  const surfaces = buildFixtureSurfaces();
  const surfaceNames = {
    root: new Set(surfaces.root.map((tool) => tool.name)),
    visuals: new Set(surfaces.visuals.map((tool) => tool.name)),
    audio: new Set(surfaces.audio.map((tool) => tool.name)),
  };
  for (const pair of buildPairedMatrix(flatMatrix())) {
    const names = surfaceNames[pair.hierarchy.surface];
    if (pair.hierarchy.expect.type === "tool_call") {
      for (const tool of pair.hierarchy.expect.oneOf) {
        assert.ok(names.has(tool), `${pair.hierarchy.id}: ${tool} not on ${pair.hierarchy.surface}`);
      }
    }
    for (const prior of pair.hierarchy.priorResults) {
      assert.ok(
        names.has(prior.tool),
        `${pair.hierarchy.id}: prior ${prior.tool} not on ${pair.hierarchy.surface}`
      );
    }
  }
});

test("root projection collapses leaf media history into dispatches that keep stable asset ids", () => {
  const flat = GATE0_FLAT_SCENARIOS.find(
    (scenario) => scenario.id === "long_context_export_after_many_beats"
  )!;
  const projected = projectToHierarchy(flat);
  assert.equal(projected.surface, "root");
  const tools = projected.priorResults.map((result) => result.tool);
  // One consecutive visuals run (anchor..clip8) collapses to ONE dispatch.
  assert.equal(tools.filter((tool) => tool === "delegate_visuals").length, 1);
  assert.equal(tools.filter((tool) => tool === "delegate_audio").length, 1);
  assert.ok(!tools.includes("generate_clip"), "leaf tools must not survive root projection");
  // Root-owned results pass through unchanged, in order.
  assert.deepEqual(
    tools.filter((tool) => tool !== "delegate_visuals" && tool !== "delegate_audio"),
    [
      "create_or_load_brief",
      "develop_story_blueprint",
      "draft_script",
      "plan_shots",
      "plan_visual_anchors",
      "assemble_timeline",
      "critique_timeline",
    ]
  );
  // The collapsed dispatch result still carries the produced stable graph ids.
  const dispatch = projected.priorResults.find((result) => result.tool === "delegate_visuals")!;
  assert.ok(dispatch.outputAssetIds.includes("beat1_keyframe"));
  assert.ok(dispatch.outputAssetIds.includes("beat8_clip"));
  assert.deepEqual(projected.expect, { type: "tool_call", oneOf: ["export_video"] });
});

test("cross-domain recovery projects to a root decision whose remedy is the owning dispatch", () => {
  const flat = GATE0_FLAT_SCENARIOS.find(
    (scenario) => scenario.id === "recover_cross_domain_missing_audio"
  )!;
  const projected = projectToHierarchy(flat);
  assert.equal(projected.surface, "root");
  const latest = projected.priorResults.at(-1)!;
  // The failed tool is root-owned, so it stays; its remedies map to dispatch.
  assert.equal(latest.tool, "assemble_timeline");
  assert.equal(latest.status, "failed");
  assert.deepEqual(
    latest.error?.suggestedNextTools?.map((call) => call.tool),
    ["delegate_audio"]
  );
  assert.deepEqual(
    latest.error?.unmetRequirements?.map((miss) => miss.satisfyWith.tool),
    ["delegate_audio"]
  );
  assert.deepEqual(projected.expect, { type: "tool_call", oneOf: ["delegate_audio"] });
});

test("in-domain recovery projects onto the specialist surface with only in-domain history", () => {
  const flatVisuals = tagScenarios(RECOVERY, "recovery").find(
    (scenario) => scenario.id === "recover_missing_keyframe"
  )!;
  const visuals = projectToHierarchy(flatVisuals);
  assert.equal(visuals.surface, "visuals");
  // Root planning history is stripped; the failed leaf stays last.
  assert.ok(visuals.priorResults.every((result) =>
    ["generate_anchor", "generate_storyboard", "generate_keyframe", "generate_clip",
     "regenerate_image_asset", "edit_video_asset"].includes(result.tool)
  ));
  assert.equal(visuals.priorResults.at(-1)!.tool, "generate_clip");
  assert.equal(visuals.priorResults.at(-1)!.status, "failed");
  assert.deepEqual(visuals.expect, { type: "tool_call", oneOf: ["generate_keyframe"] });

  const flatAudio = GATE0_FLAT_SCENARIOS.find(
    (scenario) => scenario.id === "recover_fit_audio_missing_track"
  )!;
  const audio = projectToHierarchy(flatAudio);
  assert.equal(audio.surface, "audio");
  assert.equal(audio.priorResults.at(-1)!.tool, "fit_audio_to_picture");
  assert.deepEqual(audio.expect, { type: "tool_call", oneOf: ["generate_audio"] });
});

test("paired scoring: both surfaces produce identical scenario/sample totals", async () => {
  const pairs = buildPairedMatrix(flatMatrix());
  const flat = await runFlatBaseline(pairs.map((pair) => pair.flat), {
    model: perfectModel(pairs.map((pair) => pair.flat)),
    samples: 1,
  });
  const byId = new Map(pairs.map((pair) => [pair.hierarchy.id, pair.hierarchy]));
  const scored = await runHierarchyScenarios(pairs.map((pair) => pair.hierarchy), {
    model: async ({ scenarioId }) => {
      const scenario = byId.get(scenarioId)!;
      return scenario.expect.type === "done"
        ? { type: "done" }
        : { type: "tool_call", toolName: scenario.expect.oneOf[0]! };
    },
    samples: 1,
  });
  const hierarchy = buildGate0Report("hierarchy_fixture", 1, scored);
  assert.equal(flat.overall.scenarios, hierarchy.overall.scenarios);
  assert.equal(flat.overall.samples, hierarchy.overall.samples);
  assert.equal(flat.overall.accuracy, 1);
  assert.equal(hierarchy.overall.accuracy, 1);
});

// ---------------------------------------------------------------------------
// Fixture routing context (review finding 2): dispatch failures must reach the
// hierarchy model with the same latestFailure/nextToolHint signal flat gets.
// ---------------------------------------------------------------------------

test("fixture routing context preserves dispatch failures and their recovery hint", () => {
  const blocked = HIERARCHY_ROOT_SCENARIOS.find(
    (scenario) => scenario.id === "hier_root_visuals_blocked_on_audio"
  )!;
  // Since PR 6 the dispatch tools are real catalog names, so the production
  // builder preserves the failure too (before PR 6 it dropped unknown names);
  // the fixture-aware wrapper keeps equivalent signals either way.
  const production = buildRoutingContext(blocked.priorResults);
  assert.equal(production.latestFailure?.tool, "delegate_visuals");
  const context = buildFixtureRoutingContext(blocked.priorResults);
  assert.equal(context.latestFailure?.tool, "delegate_visuals");
  assert.deepEqual(context.latestFailure?.unmetRequirements, ["narration_track"]);
  assert.deepEqual(context.latestFailure?.requiredRecoveryTools, ["delegate_audio"]);
  assert.equal(context.nextToolHint?.tool, "delegate_audio");
  // Applied dispatch history counts as completed work.
  assert.ok(context.completedTools.includes("create_or_load_brief"));
  const applied = buildFixtureRoutingContext([
    { tool: "delegate_visuals", status: "applied", outputAssetIds: ["visuals_report"] },
  ]);
  assert.deepEqual(applied.completedTools, ["delegate_visuals"]);
});

test("fixture routing context matches production semantics for real-tool failures", () => {
  const selfHeal = HIERARCHY_SCENARIOS.find(
    (scenario) => scenario.id === "hier_visuals_self_heal_keyframe"
  )!;
  const production = buildRoutingContext(selfHeal.priorResults);
  const fixture = buildFixtureRoutingContext(selfHeal.priorResults);
  // Real ToolName failures flow through the production builder unchanged —
  // including the special-cased keyframe hint.
  assert.deepEqual(fixture.latestFailure, production.latestFailure);
  assert.deepEqual(fixture.nextToolHint, production.nextToolHint);
  assert.equal(fixture.nextToolHint?.tool, "generate_keyframe");
  assert.deepEqual(fixture.completedTools, production.completedTools);
});

// ---------------------------------------------------------------------------
// Runner output contract (review finding 3): --json emits exactly one
// parseable document on stdout; banners go to stderr.
// ---------------------------------------------------------------------------

test("gate0 runner --json emits exactly one parseable document on stdout with paired totals", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const result = await runGate0Baseline(
    { samples: 2, surface: "both", fixture: true, json: true },
    { out: (text) => out.push(text), err: (text) => err.push(text) }
  );
  assert.equal(result.exitCode, 0);
  assert.equal(out.length, 1, "stdout must carry exactly one JSON document");
  const document = JSON.parse(out[0]!);
  assert.equal(document.mode, "offline_fixture");
  assert.equal(document.comparison, "paired_scenarios");
  assert.equal(document.samplesPerScenario, 2);
  assert.equal(document.pairedScenarioCount, flatMatrix().length);
  // The gate comparison is paired: identical scenario/sample totals per side.
  assert.equal(document.flat.overall.scenarios, document.pairedScenarioCount);
  assert.equal(document.hierarchy.overall.scenarios, document.pairedScenarioCount);
  assert.equal(document.flat.overall.samples, document.hierarchy.overall.samples);
  // Unpaired diagnostics are reported separately from the gate comparison.
  assert.equal(document.hierarchyDiagnostics.overall.scenarios, HIERARCHY_SCENARIOS.length);
  // Banners never contaminate stdout.
  assert.ok(err.length > 0, "banners go to stderr");
  assert.deepEqual(result.document, document);
});

test("gate0 runner human mode still prints reports on stdout and banners on stderr", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const result = await runGate0Baseline(
    { samples: 1, surface: "flat", fixture: true, json: false },
    { out: (text) => out.push(text), err: (text) => err.push(text) }
  );
  assert.equal(result.exitCode, 0);
  assert.ok(out.some((text) => text.includes("paired gate comparison — flat side")));
  assert.ok(err.some((text) => text.includes("OFFLINE plumbing check")));
  assert.equal(result.document.hierarchy, undefined);
});
