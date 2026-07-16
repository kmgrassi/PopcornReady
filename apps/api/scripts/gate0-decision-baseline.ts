// Gate-0 decision baseline report (specialist-agent-orchestration-prs.md, PR 1).
//
// Runs the full Gate-0 scenario matrix with repeated samples and prints the
// accuracy / unnecessary-turn / premature-done / repeated-failed-call
// baselines for:
//   - the FLAT PRODUCTION registry (the real orchestrator model + registry), and
//   - the FIXTURE-ONLY hierarchy simulation (proposed creative-director surface
//     with delegate_visuals/delegate_audio fixture tools; decisions only, no
//     tool execution, no live generation on either surface).
//
//   pnpm --filter @popcorn/api evals:gate0                      # both surfaces, REAL model (billable, opt-in)
//   pnpm --filter @popcorn/api evals:gate0 -- --samples 5       # repeated-sample baseline
//   pnpm --filter @popcorn/api evals:gate0 -- --surface flat    # flat production registry only
//   pnpm --filter @popcorn/api evals:gate0 -- --surface hierarchy
//   pnpm --filter @popcorn/api evals:gate0 -- --fixture         # offline plumbing check, NO model calls
//   pnpm --filter @popcorn/api evals:gate0 -- --json            # machine-readable report
//
// Real-model runs are OPT-IN exactly like evals:orchestrator: they require a
// provider API key (repo-root .env/.env.local) and every sample is a billable
// LLM call. Record results in docs/scopes/gate-0-decision-record.md.

import "../src/env";

import { resolveLlmConfig } from "../src/lib/llm";
import {
  describeGate0Report,
  runFlatBaseline,
  tagScenarios,
  type Gate0Report,
  type Gate0Scenario,
} from "../src/lib/orchestrator/evals/gate0-report";
import { GATE0_FLAT_SCENARIOS } from "../src/lib/orchestrator/evals/gate0-scenarios";
import {
  buildGate0Report,
  type SampleClassification,
} from "../src/lib/orchestrator/evals/gate0-report";
import {
  createRealFixtureDecisionModel,
  runHierarchyScenarios,
  HIERARCHY_SCENARIOS,
  type FixtureDecisionModel,
} from "../src/lib/orchestrator/evals/hierarchy-fixture";
import { APPROVAL, FORWARD_CHAIN, RECOVERY } from "../src/lib/orchestrator/evals/scenarios";
import type { OrchestratorModel } from "../src/lib/orchestrator/model";

interface CliOptions {
  samples: number;
  surface: "flat" | "hierarchy" | "both";
  fixture: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const samplesIndex = argv.indexOf("--samples");
  let samples = 1;
  if (samplesIndex >= 0) {
    const n = Number(argv[samplesIndex + 1]);
    if (Number.isFinite(n) && n > 0) samples = Math.floor(n);
  }
  const surfaceIndex = argv.indexOf("--surface");
  let surface: CliOptions["surface"] = "both";
  if (surfaceIndex >= 0) {
    const value = argv[surfaceIndex + 1];
    if (value === "flat" || value === "hierarchy" || value === "both") surface = value;
  }
  return {
    samples,
    surface,
    fixture: argv.includes("--fixture"),
    json: argv.includes("--json"),
  };
}

// The complete flat matrix: the pre-existing forward-chain/recovery/approval
// scenarios plus the six Gate-0 families, all against the production registry.
function flatMatrix(): Gate0Scenario[] {
  return [
    ...tagScenarios(FORWARD_CHAIN, "forward_chain"),
    ...tagScenarios(RECOVERY, "recovery"),
    ...tagScenarios(APPROVAL, "approval"),
    ...GATE0_FLAT_SCENARIOS,
  ];
}

// Offline plumbing check: a scripted model that always follows the scenario's
// own expectation. Verifies scenario wiring and report aggregation end-to-end
// with ZERO model calls; it is not a baseline measurement.
function fixtureFlatModel(scenarios: Gate0Scenario[]): OrchestratorModel {
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  return async ({ projectId }) => {
    const scenario = byId.get(projectId);
    if (!scenario || scenario.expect.type === "done") {
      return { type: "done", summary: "fixture", model: "gate0-fixture" };
    }
    return {
      type: "tool_call",
      toolName: scenario.expect.oneOf[0]!,
      input: {},
      model: "gate0-fixture",
    };
  };
}

function fixtureHierarchyModel(): FixtureDecisionModel {
  const byId = new Map(HIERARCHY_SCENARIOS.map((scenario) => [scenario.id, scenario]));
  return async ({ scenarioId }) => {
    const scenario = byId.get(scenarioId);
    if (!scenario || scenario.expect.type === "done") return { type: "done" };
    return { type: "tool_call", toolName: scenario.expect.oneOf[0]! };
  };
}

function printReport(report: Gate0Report, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(describeGate0Report(report));
    console.log("");
  }
}

function hasFailures(report: Gate0Report): boolean {
  const overall: Record<Exclude<SampleClassification, "acceptable">, number> = {
    wrong_tool: report.overall.wrongTool,
    premature_done: report.overall.prematureDone,
    unnecessary_turn: report.overall.unnecessaryTurns,
    repeated_failed_call: report.overall.repeatedFailedCalls,
  };
  return Object.values(overall).some((count) => count > 0);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const scenarios = flatMatrix();

  if (!options.fixture) {
    const provider = resolveLlmConfig().provider;
    const keyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    if (!process.env[keyName]) {
      console.error(
        `Missing ${keyName}. Real Gate-0 baseline runs are opt-in and billable; ` +
          "put a key in a repo-root .env/.env.local, or use --fixture for an offline plumbing check."
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `Gate-0 decision baseline — provider=${provider}, samples=${options.samples}, ` +
        `flat scenarios=${scenarios.length}, hierarchy scenarios=${HIERARCHY_SCENARIOS.length}\n`
    );
  } else {
    console.log(
      "Gate-0 OFFLINE plumbing check (--fixture): scripted decisions, no model calls, not a baseline.\n"
    );
  }

  let failed = false;

  if (options.surface !== "hierarchy") {
    const report = await runFlatBaseline(scenarios, {
      samples: options.samples,
      ...(options.fixture ? { model: fixtureFlatModel(scenarios) } : {}),
    });
    printReport(report, options.json);
    failed = failed || hasFailures(report);
  }

  if (options.surface !== "flat") {
    const scored = await runHierarchyScenarios(HIERARCHY_SCENARIOS, {
      model: options.fixture ? fixtureHierarchyModel() : createRealFixtureDecisionModel(),
      samples: options.samples,
    });
    const report = buildGate0Report("hierarchy_fixture", options.samples, scored);
    printReport(report, options.json);
    failed = failed || hasFailures(report);
  }

  // Baseline runs report; only the offline plumbing check treats any failure
  // as a hard error (the fixture model must reproduce every expectation).
  if (options.fixture && failed) {
    console.error("Fixture plumbing check produced unexpected classifications.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
