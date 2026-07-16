// Gate-0 decision baseline report (specialist-agent-orchestration-prs.md, PR 1).
//
// Thin CLI over src/lib/orchestrator/evals/gate0-baseline-runner.ts. Runs the
// PAIRED Gate-0 scenario matrix with repeated samples: every scenario is
// scored on the FLAT PRODUCTION registry and, via its deterministic
// projection, on the FIXTURE-ONLY hierarchy surface (same ids/samples/
// provider), so the adoption-gate comparison is apples-to-apples. Hand-written
// hierarchy-only cases run as labeled diagnostics excluded from the gate
// comparison. Decisions only — no tool execution, no live generation.
//
//   pnpm --filter @popcorn/api evals:gate0                      # both surfaces, REAL model (billable, opt-in)
//   pnpm --filter @popcorn/api evals:gate0 -- --samples 5       # repeated-sample baseline
//   pnpm --filter @popcorn/api evals:gate0 -- --surface flat    # flat production registry only
//   pnpm --filter @popcorn/api evals:gate0 -- --surface hierarchy
//   pnpm --filter @popcorn/api evals:gate0 -- --fixture         # offline plumbing check, NO model calls
//   pnpm --filter @popcorn/api evals:gate0 -- --json            # ONE parseable JSON document on stdout
//
// Real-model runs are OPT-IN exactly like evals:orchestrator: they require a
// provider API key (repo-root .env/.env.local) and every sample is a billable
// LLM call. With --json, stdout carries exactly one JSON document and all
// banners go to stderr. Record results in docs/scopes/gate-0-decision-record.md.

import "../src/env";

import {
  runGate0Baseline,
  type Gate0RunnerOptions,
} from "../src/lib/orchestrator/evals/gate0-baseline-runner";

function parseArgs(argv: string[]): Gate0RunnerOptions {
  const samplesIndex = argv.indexOf("--samples");
  let samples = 1;
  if (samplesIndex >= 0) {
    const n = Number(argv[samplesIndex + 1]);
    if (Number.isFinite(n) && n > 0) samples = Math.floor(n);
  }
  const surfaceIndex = argv.indexOf("--surface");
  let surface: Gate0RunnerOptions["surface"] = "both";
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

async function main(): Promise<void> {
  const result = await runGate0Baseline(parseArgs(process.argv.slice(2)), {
    out: (text) => console.log(text),
    err: (text) => console.error(text),
  });
  process.exitCode = result.exitCode;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
