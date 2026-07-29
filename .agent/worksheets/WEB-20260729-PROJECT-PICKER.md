# Worksheet: WEB-20260729-PROJECT-PICKER

<!-- agent-summary: Durable record for one bounded task. -->
<!-- agent-summary: Update this file as evidence arrives, then commit it with the work. -->
<!-- agent-summary: Use worksheet/WEB-20260729-PROJECT-PICKER as the git tag after completion. -->
<!-- agent-summary: Do not include secrets, private prompts, or customer data. -->
<!-- agent-summary: A successor agent should be able to continue from this document alone. -->
<!-- agent-summary: Keep command outcomes factual; do not imply checks that did not run. -->
<!-- agent-summary: Link related reviews, feedback entries, and PRs. -->

## Goal and acceptance criteria

Replace Asset Studio's native project select with an accessible, styled picker. Let
people create a named project without leaving `/create`, select it immediately, and
continue into cost review without losing their prompt.

Acceptance requires existing-project selection, inline first/new-project creation,
loading/error/retry states, proposal reset on project changes, keyboard Escape/focus
behavior, mobile-safe layout, and observable Playwright coverage.
PR review follow-up also requires stale project-create completions to preserve
newer selections and pagination failures to preserve already-loaded rows.

## Context and source-of-truth documents

- `AGENTS.md`
- `AGENT_WORKFLOW.md`
- `CLAUDE.md`
- `docs/repository-structure.md`
- `apps/web/PRODUCT.md`
- `apps/web/DESIGN.md`
- `docs/ui-interaction-model.md`
- `docs/testing/e2e-test-inventory-and-gaps.md`
- `apps/web/e2e/README.md`
- Impeccable `craft` workflow and existing Asset Studio visual register

## Decisions

- Use an inline disclosure rather than a native select or modal, matching the
  approved dark editorial Asset Studio direction.
- Keep project rows compact and name-only.
- Reserve the solid gold CTA for `Review cost`; project creation uses secondary
  actions.
- Filter only the loaded project pages and retain `Load more projects`.
- Select the mutation response immediately and invalidate the shared Asset Studio
  project-list query for canonical refresh.
- Build the approved mock entirely with semantic React/CSS; it requires no raster
  assets.

## Changes

- Added a route-scoped `ProjectPicker` component and CSS module with search,
  compact selection rows, inline creation, Escape/focus return, outside-click
  dismissal, pagination, and loading/error/empty/retry states.
- Integrated immediate named-project creation and selection into Asset Studio
  without clearing the asset prompt.
- Added a shared Asset Studio project query key, mutation invalidation, and
  individual-project cache seeding.
- Added a proposal request-version guard so a response cannot restore stale cost
  approval after the project, goal, or prompt changes.
- Expanded `asset-studio.spec.ts` for existing, first, and new projects; list and
  creation failures; stale in-flight proposals; keyboard behavior; and mobile
  layout.
- Updated the E2E README and inventory.
- Addressed all three PR #831 review threads: guarded delayed create completion,
  separated pagination failures from blocking initial-load errors, and replaced
  reviewed raw control heights with shared design tokens.
- Added delayed-create and next-page failure/retry Playwright regressions.

## Validation evidence

- `pnpm agent:lint:fix` — passed.
- `pnpm agent:validate -- --scope web` — passed, including agent lint,
  migration filename/history validation, and web typecheck.
- `pnpm --filter @popcorn/web typecheck` — passed.
- `pnpm exec playwright test e2e/asset-studio.spec.ts` from `apps/web` —
  9 passed across Chromium, mobile Chrome, and mobile Safari.
- In-app browser inspection at desktop and 390x844 mobile widths — picker and
  inline form matched the approved direction with no horizontal overflow; a
  clipped mobile create label was found, fixed, and rechecked.
- The local browser/E2E server logged the known unconfigured Supabase recovery
  worker noise; all Asset Studio browser requests under test were mocked.
- PR review follow-up: exact delayed-create Chromium regression passed 3/3
  repeated; the full focused Asset Studio suite passed 11/11 across Chromium,
  mobile Chrome, and mobile Safari.
- PR review follow-up: `pnpm agent:lint:fix` and
  `pnpm agent:validate -- --scope web` passed, including agent lint, migration
  tests (2/2), migration scan (85 migrations), and web typecheck.

## Independent reviews

- Research/plan: approved with conditions by the configured independent reviewer.
  Conditions incorporated: accessible disclosure semantics, cache invalidation,
  immediate selection, proposal reset, empty/error/retry/mobile states, and
  behavior-focused Playwright coverage.
- Implementation: initial review found a stale proposal race, incomplete custom
  listbox semantics, a misleading list-error label, and persistent creation
  errors. All four were fixed; re-review approved with no remaining actionable
  findings. Reviewer validation: clean diff check, web typecheck, and 7/7
  targeted Chromium Asset Studio tests.
- Wrap-up: approved with no findings. The reviewer independently reran web
  validation, confirmed the documentation and feedback claims, and found the
  final diff clean and ready for publication.
- PR review follow-up research/plan: approved with conditions around create
  attempt invalidation, usable-data error classification, cursor-specific retry,
  token scope, and settlement-aware tests; all conditions were incorporated.
- PR review follow-up implementation: initial review reproduced an Escape focus
  gap during pending creation. After moving Escape handling to the document
  while open and strengthening settlement evidence, re-review approved with no
  remaining findings.
- PR review follow-up wrap-up: approved with all three GitHub comments traced to
  code, observable regressions, documentation, and independently rerun web
  validation.

## Blockers and risks

- Client-side search covers loaded pages only; the UI must not imply server-wide
  search and must retain pagination.
- Changing projects after a proposal must invalidate that proposal and its
  idempotency key.

## Next action / handoff

Commit and push the fixes to PR #831, then report the three addressed threads
ready for reviewer verification and resolution.
