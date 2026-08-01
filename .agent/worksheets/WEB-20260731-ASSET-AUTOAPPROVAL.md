# Worksheet: WEB-20260731-ASSET-AUTOAPPROVAL

<!-- agent-summary: Durable record for one bounded task. -->
<!-- agent-summary: Update this file as evidence arrives, then commit it with the work. -->
<!-- agent-summary: Use worksheet/WEB-20260731-ASSET-AUTOAPPROVAL as the git tag after completion. -->
<!-- agent-summary: Do not include secrets, private prompts, or customer data. -->
<!-- agent-summary: A successor agent should be able to continue from this document alone. -->
<!-- agent-summary: Keep command outcomes factual; do not imply checks that did not run. -->
<!-- agent-summary: Link related reviews, feedback entries, and PRs. -->

## Goal and acceptance criteria

Move Asset Studio prompt refinement off the creation form and onto a dedicated
review route. The review route must show prompt-refinement progress, present the
finished proposal with an **Approve this** action, and automatically confirm the
proposal after a visible 10-second countdown if the creator does not act first.
Manual approval and automatic approval must dispatch at most once and transition
to the durable run-status view.

## Context and source-of-truth documents

- `AGENT_WORKFLOW.md`
- `CLAUDE.md`
- `docs/repository-structure.md`
- `apps/web/PRODUCT.md`
- `apps/web/DESIGN.md`
- `docs/ui-interaction-model.md`
- `docs/NORTH_STAR.md`
- `docs/scopes/specialist-agent-orchestration-prs.md`
- `docs/testing/e2e-test-inventory-and-gaps.md`
- `apps/web/e2e/README.md`
- Impeccable product-register guidance

## Decisions

- Add `/create/review` as a dedicated route and navigate there before the
  proposal/refinement request begins.
- Start the 10-second countdown only after the proposal and effective prompt are
  visible. Explain the timed launch in both the creation form and review page.
- Use one synchronous ref-guarded confirmation function for manual and timed
  approval; replace the review history entry after confirmation so Back cannot
  reopen an auto-approving proposal.
- Preserve the draft through React Router navigation state when revising. A
  direct review URL without valid state fails closed and performs no mutation.
- Preserve a validated successful proposal on its review history entry so
  browser Forward restores it without replaying the proposal POST. Store no
  authority in the URL or persistent browser storage.
- A confirmation failure does not automatically retry; it keeps the proposal
  visible and makes manual retry possible, including after Back/Forward.

## Changes

- Added validated router-state helpers for Asset Studio review requests and
  revision drafts, with focused unit tests. Successful proposals and their
  automatic-approval policy are also validated before history restoration.
- Added `/create/review` and a dedicated responsive review page that owns prompt
  refinement progress, proposal display, manual approval, the visible
  wall-clock 10-second countdown, at-most-once confirmation, failure recovery,
  and safe invalid-state recovery.
- Updated `/create` to preserve its draft history entry, navigate before prompt
  refinement begins, and restore the draft through Revise or browser Back.
- Expanded Asset Studio Playwright coverage for navigation/loading, exact prompt
  review, manual/timed races, timer boundary, visible-proposal revision,
  confirmation retry, invalid state, draft restoration, Back/Forward proposal
  recovery, stale restored proposals, and mobile overflow.
- Updated the UI interaction model, Asset Studio scope, prompt-enhancement
  contract, E2E inventory, and E2E README for the timed-confirmation exception.

## Validation evidence

- `pnpm --filter @popcorn/web typecheck` — passed.
- `pnpm --filter @popcorn/web test` — review follow-up: 51 passed.
- `pnpm --filter @popcorn/web exec playwright test e2e/asset-studio.spec.ts
  --project=chromium` — final review follow-up: 19 passed.
- `pnpm --filter @popcorn/web exec playwright test e2e/asset-studio.spec.ts
  --project=mobile-safari --project=mobile-chrome` — final run: 4 passed.
- Browser inspection at 1280x800 and 390x844 verified the refinement and
  proposal/countdown views, full-width mobile actions, and zero horizontal
  overflow. The visual fixture intercepted only the creator-direct proposal;
  unrelated local API calls logged expected connection failures because the
  standalone Vite inspection server had no API process.
- Review-follow-up browser inspection at 1280x800 and 390x844 verified the
  expired-proposal recovery copy, inline alert hierarchy, 48px full-width mobile
  action, and zero horizontal overflow. The local API remained intentionally
  absent, so unrelated account/credit requests logged expected proxy failures.
- `pnpm agent:lint:fix` — passed.
- `pnpm agent:validate -- --scope web` — passed (agent lint, workflow policy,
  migration checks, and web typecheck).

## Independent reviews

- Research review (independent agent): confirmed `/create/review` as the narrow
  route boundary; required visible countdown, ref-guarded at-most-once
  confirmation, safe invalid-state handling, draft-preserving revision,
  replace-navigation after confirmation, documentation updates, and focused
  Playwright coverage. All findings accepted into the plan.
- Plan review (independent agent): added Strict Mode proposal guarding,
  goal-aware loading, absolute-deadline semantics, calm screen-reader behavior,
  failure recovery, fresh proposal authority after revision, and race coverage.
- Implementation review (independent agent): found missing browser-Back draft
  restoration, missing announcement when the proposal/countdown appears,
  overclaimed revise/retry coverage, stale gap text, and permissive router-state
  validation. All findings were fixed and covered or documented.
- Wrap-up review (independent agent): confirmed the earlier findings were
  resolved and found one interval that stayed active on confirmation failure.
  The countdown now disarms when either approval path starts, cleaning up its
  interval and timeout before success or preserved-error recovery. A final
  read-only review confirmed that fix and reported no remaining release blocker.
- PR-comment research and plan review (independent agent): confirmed that the
  successful proposal belongs in validated review-entry history state, required
  manual-only restoration after failed confirmation, expiry safety, and focused
  Back/Forward coverage. Both review comments were accepted.
- PR-comment implementation review (independent agent): found misleading
  assistive and visible stale-state copy plus a manual-only request policy that
  could be re-enabled after proposal success. Follow-up review found that the
  first policy fix incorrectly labeled a fresh manual-only proposal stale; expiry
  validity and automation policy are now separate, and all findings are covered
  by focused unit or browser tests.

## Blockers and risks

- Resolved: authoritative docs record Asset Studio's narrow disclosed
  timed-confirmation exception for billable work.
- Resolved: manual and timed paths share a synchronous single-flight guard, and
  tests prove a click/timer race dispatches once.
- Resolved: invalid or missing navigation state fails closed without proposal or
  confirmation calls; draft history is restored through Revise and browser Back.
- Resolved: browser Forward restores the exact validated proposal without a
  second proposal POST; stale proposals and failed confirmations cannot silently
  re-arm automatic approval.
- `/create/review` without usable browser history state intentionally fails
  closed; server-backed recovery remains documented as a future gap.

## Next action / handoff

Commit and push the validated review fixes to PR #863, then report both threads
ready for reviewer resolution.
