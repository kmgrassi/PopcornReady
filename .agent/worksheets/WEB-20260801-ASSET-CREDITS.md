# Worksheet: WEB-20260801-ASSET-CREDITS

<!-- agent-summary: Durable record for per-asset charged-credit visibility in asset detail views. -->
<!-- agent-summary: The UI must show actual ledger debits, never provider-cost estimates. -->
<!-- agent-summary: Only unambiguous single-output action attribution is eligible for display. -->
<!-- agent-summary: Owner-scoped request clients preserve credit-ledger and action RLS. -->
<!-- agent-summary: Targeted API, web, and Playwright coverage verify the behavior. -->
<!-- agent-summary: Desktop and mobile browser inspection are required before handoff. -->
<!-- agent-summary: Link independent reviews, validation, feedback, commit, tag, and PR here. -->

## Goal and acceptance criteria

Show the exact credits charged for a generated asset when its detail viewer is
opened. Use the immutable credit transaction delta, preserve owner-only billing
privacy, omit the value when historical or multi-output attribution is
ambiguous, and cover both the project media and owned Library asset viewers.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`
- `docs/repository-structure.md`
- `apps/web/PRODUCT.md`, `apps/web/DESIGN.md`
- `docs/ui-interaction-model.md`
- `docs/supabase-identity-and-rls.md`
- `docs/scopes/database-access-boundary.md`
- `docs/testing/e2e-test-inventory-and-gaps.md`, `apps/web/e2e/README.md`
- `docs/agent-system/performance-and-visual-regression.md`

## Decisions

- Show user-facing `creditsCharged`, not raw provider `costUsd`.
- Resolve billing only after a detail view opens instead of adding an N+1 cost
  lookup to asset-list endpoints.
- Attribute a debit only when its linked action has exactly one output asset.
- Keep missing/ambiguous historical attribution nullable and visually absent.

## Changes

- Added an owner-only asset-detail billing projection that reads
  request-scoped `actions` and `credit_transactions`, sums gross negative
  generation debits, and returns `null` for missing or multi-output attribution.
- Added a TanStack Query detail fetch on viewer open for project media and the
  owned Library; public discovery neither requests nor renders billing data.
- Added quiet, localized `credit(s) used` metadata to the shared media viewer.
- Added a nested-settlement ownership tally so the outer orchestrator only
  charges the remaining platform cost and records its debit against the action.
- Updated UI, database-boundary, E2E inventory, and test-harness documentation.

## Validation evidence

- `pnpm --filter @popcorn/api typecheck` — passed.
- `pnpm --filter @popcorn/api exec tsx --test
  src/lib/api/v1/__tests__/asset-credit-usage.test.ts
  src/lib/provider-keys/__tests__/provider-keys.test.ts
  src/lib/orchestrator/__tests__/engine.test.ts` — 58 passed.
- `pnpm --filter @popcorn/web typecheck` — passed.
- `pnpm --filter @popcorn/web exec playwright test
  e2e/specs/library-collections.spec.ts --project=chromium` — 1 passed; the
  browser fixture showed 84 credits for an owned asset and proved the public
  viewer made no billing request and rendered no credit value. The same flow
  opened `/projects/proj-alpha/media`, observed its real detail request, and
  showed 84 credits in the project-media viewer.
- In-app browser inspection at 1280×800 and 390×844 on
  `/dev/media-gallery?asset-detail=credits` confirmed readable hierarchy,
  wrapping, and no horizontal overflow.
- `pnpm agent:lint:fix` — passed for 23 changed files after the final test.
- `pnpm agent:validate -- --scope all` — passed after the final test, including workflow,
  migration, RPC/relation-boundary, API typecheck, and web typecheck checks.
- A live local Supabase policy test was unavailable: `supabase status` did not
  return from the inactive local stack. Privacy is covered structurally by the
  request-scoped client, owner-resolving route, public no-request E2E, and the
  repository's existing RLS policies; a real owner/outsider policy test remains
  worthwhile when the local database harness is running.

## Independent reviews

- Research: `/root/research_review` confirmed that existing UI only exposes a
  generic ledger debit and prospective maximum cost. It also identified the
  legacy multi-output attribution constraint that shaped the nullable contract.
- Plan: `/root/research_review` required nullable unknowns, gross-debit
  semantics, owner-only detail fetching, explicit public suppression, and
  proof that nested generation settlement cannot be charged again outside.
- Implementation: first pass found action attribution on a non-canonical join,
  a cached-data public rendering risk, and missing engine-level settlement
  coverage. The implementation now follows `actions.output_asset_ids`, gates
  public rendering independently, covers mixed/full nested settlement, and
  canonicalizes slug-based asset references before the UUID-array query. A
  second review found no remaining actionable issue.
- Wrap-up: first pass found that the dev visual harness did not prove the
  project-media route wiring. A route-level Playwright assertion now covers the
  actual project gallery detail fetch and rendered credit value. The follow-up
  review cleared the final tree with no remaining findings.

## Blockers and risks

- Older run-scoped debits without `action_id` cannot be assigned honestly to an
  individual asset and will not display a fabricated split.

## Next action / handoff

- Commit, rebase onto current `origin/main`, retest, add the worksheet tag,
  push, and open a ready PR.
