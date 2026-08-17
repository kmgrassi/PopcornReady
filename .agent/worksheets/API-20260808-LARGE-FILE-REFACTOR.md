# API-20260808-LARGE-FILE-REFACTOR

<!-- agent-summary: Tracks the daily large-file refactor scope and decisions. -->
<!-- agent-summary: Target is the API rerun decision-context orchestration module. -->
<!-- agent-summary: Loader and packet construction responsibilities are separated. -->
<!-- agent-summary: Existing rerun proposal behavior remains the compatibility contract. -->
<!-- agent-summary: Focused API tests and typecheck are required before handoff. -->
<!-- agent-summary: Lint and scoped agent validation results are recorded here. -->
<!-- agent-summary: Commit, worksheet tag, and open PR complete the workflow. -->

## Goal

Split the database-backed rerun decision-context loader from the packet builder so the oversized orchestration module has one clear responsibility.

## Research and plan

- Target: `apps/api/src/lib/orchestrator/rerun-decision-context.ts` (1,013 lines at start).
- Extract canonical timeline parsing, transcript loading, and packet loading into `rerun-decision-context-loader.ts`.
- Preserve existing exports used by tests and rerun proposal services by updating imports explicitly.
- Independent reviewer: unavailable; no configured independent reviewer command or delegated reviewer was available in this task context. Perform local diff review and record results below.

## Validation

| Check | Result |
| --- | --- |
| Focused rerun decision-context tests | passed: 11/11 |
| Rerun proposal service/route tests | passed: 8/8 |
| API typecheck | passed |
| `pnpm agent:lint:fix` | passed |
| `pnpm agent:validate -- --scope api` | passed |
| API runtime path | exercised through the v2 proposal service tests; no browser path applies |

## Review notes

Local implementation review passed: the extracted loader preserves canonical
story replacement, explicit transcript precedence, timeline normalization, and
all existing builder exports. Independent reviewer was unavailable because no
configured reviewer command or delegated reviewer was available.

## Changed files

- `apps/api/src/lib/orchestrator/rerun-decision-context.ts`
- `apps/api/src/lib/orchestrator/rerun-decision-context-loader.ts`
- `apps/api/src/lib/orchestrator/rerun-proposal-v2-service.ts`
- `apps/api/src/lib/orchestrator/__tests__/rerun-decision-context.test.ts`
- `.agent/feedback/API-20260808-LARGE-FILE-REFACTOR.md`
