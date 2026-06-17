// Run the orchestrator decision evals against the REAL LLM and print a report.
// Pure routing check — fabricated state in, next-tool decision out; no engine
// loop, no tool execution, no DB. See docs/scopes/orchestrator-decision-evals.md.
//
//   pnpm --filter @popcorn/api evals:orchestrator
//   pnpm --filter @popcorn/api evals:orchestrator -- --samples 3
//   LLM_PROVIDER=anthropic pnpm --filter @popcorn/api evals:orchestrator
//
// Requires a provider API key (loaded from repo-root .env/.env.local). Exits 1 if
// any scenario fails, so it can gate CI when run deliberately.

import "../src/env";

import { resolveLlmConfig } from "../src/lib/llm";
import { describeOutcome, runScenarios } from "../src/lib/orchestrator/evals/run-decision-eval";
import { ALL_SCENARIOS } from "../src/lib/orchestrator/evals/scenarios";

function parseSamples(argv: string[]): number {
  const i = argv.indexOf("--samples");
  if (i >= 0) {
    const n = Number(argv[i + 1]);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 1;
}

async function main(): Promise<void> {
  const provider = resolveLlmConfig().provider;
  const keyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  if (!process.env[keyName]) {
    console.error(`Missing ${keyName}. Put it in a repo-root .env/.env.local or pass it inline.`);
    process.exitCode = 1;
    return;
  }

  const samples = parseSamples(process.argv.slice(2));
  console.log(
    `Orchestrator decision evals — provider=${provider}, samples=${samples}, scenarios=${ALL_SCENARIOS.length}\n`
  );

  const results = await runScenarios(ALL_SCENARIOS, { samples });
  for (const result of results) console.log("  " + describeOutcome(result));

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed.`);
  if (failed.length > 0) {
    console.log("Failed:");
    for (const f of failed) console.log(`  • ${f.scenario.id} — ${f.scenario.description}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
