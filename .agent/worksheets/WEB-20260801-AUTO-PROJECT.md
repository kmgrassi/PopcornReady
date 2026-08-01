# Worksheet: WEB-20260801-AUTO-PROJECT

<!-- agent-summary: Durable record for automatic project creation from global Create. -->
<!-- agent-summary: Review request creates a project only when the creator left project selection empty. -->
<!-- agent-summary: The existing server naming pipeline receives a bounded prompt and media context. -->
<!-- agent-summary: The returned project identifier is used directly so React state cannot go stale. -->
<!-- agent-summary: Loading and failure states preserve the creator's draft and prevent duplicate submission. -->
<!-- agent-summary: Browser coverage verifies selected-project and automatic-project paths. -->
<!-- agent-summary: Link independent reviews, validation, feedback, and the ready PR here. -->

## Goal and acceptance criteria

Let a creator with a written asset prompt proceed without first choosing or
manually creating a project. Review must create exactly one automatically named
project when selection is empty, continue with that returned project, preserve
the draft on failure, and leave the existing selected-project flow unchanged.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`
- `apps/web/PRODUCT.md`, `apps/web/DESIGN.md`
- `docs/ui-interaction-model.md`
- `apps/web/e2e/README.md`, `docs/testing/e2e-test-inventory-and-gaps.md`
- Impeccable product-register guidance

## Decisions

- Follow the explicit product request: an empty selection creates a new project
  even when other projects already exist.
- Reuse the API's existing AI display-name pipeline and deterministic fallback;
  do not build a second client-side random-name grammar or fake a video brief.
- Send naming prompt/context as bounded request-only fields. They are not stored
  as project metadata.
- Snapshot the submitted form and use the returned project ID directly.

## Changes

- Global Create now enables review from the prompt alone. If project selection
  is empty, it creates a project with bounded naming prompt/media context and
  navigates with the returned project ID.
- Project creation reuses the server AI display-name pipeline and deterministic
  fallback without storing a fake brief.
- Automatic creation has visible loading and inline error states, a synchronous
  duplicate-click guard, a stable `Idempotency-Key`, and locks project/media/
  prompt choices until the critical section completes.
- The Project rail explains that project selection is optional.
- API schema, naming, route-boundary, web browser, desktop, and mobile coverage
  document and verify the behavior.

## Validation evidence

- `pnpm agent:lint:fix` — passed.
- `pnpm --filter @popcorn/api typecheck` — passed.
- `pnpm --filter @popcorn/web typecheck` — passed.
- API naming/schema/route tests — 32 passed.
- Web unit suite — 54 passed.
- Focused Playwright matrix — 6 passed across Chromium, Mobile Safari, and
  Mobile Chrome; includes duplicate submit, stable retry idempotency, failure
  preservation, selected-project bypass, delayed manual creation, and overflow.
- A broad accidental Playwright run before the focused command completed with
  105 passes, 5 skips, and 2 failures in the new tests; both test defects were
  corrected and the focused matrix passed afterward.
- The broad API package test command exposed the repository's two documented
  guest-retention baseline failures; all 3 new naming tests passed in that run,
  and exact affected API files passed afterward.
- `pnpm agent:validate -- --scope all` — passed after the final race and
  idempotency fixes.

## Independent reviews

- Research: `/root/research_review` identified stale-state, duplicate-submit,
  bounded-input, and inline-error risks. Its suggestion to auto-create only for
  an empty workspace was intentionally not adopted because the user explicitly
  requested creation whenever no project is selected.
- Plan: `/root/research_review` approved reuse of the naming pipeline with the
  safeguards recorded above.
- Implementation: `/root/conflict_review` found manual/automatic selection
  races, missing client idempotency, and a route-boundary test gap. All three
  were addressed.
- Wrap-up: `/root/conflict_review` re-reviewed the fixed diff and reported no
  remaining actionable code, API-boundary, race, UX/accessibility, test, or
  source-of-truth documentation findings.

## Blockers and risks

- AI naming adds a short model-backed step before review. The existing naming
  helper catches provider failure and supplies a deterministic prompt-derived
  fallback, so creation remains available.

## Next action / handoff

Commit, tag, push, and open the ready PR.
