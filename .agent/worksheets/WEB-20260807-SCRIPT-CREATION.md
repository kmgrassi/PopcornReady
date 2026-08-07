# Worksheet: WEB-20260807-SCRIPT-CREATION

<!-- agent-summary: Build a dedicated text-first script creation flow. -->
<!-- agent-summary: Keep script creation separate from full-video intake and media warnings. -->
<!-- agent-summary: Generate the story blueprint before the script and stop at script review. -->
<!-- agent-summary: Do not generate poster, storyboard media, audio, or video in the script-only run. -->
<!-- agent-summary: Update route, interaction-model, and E2E ownership documentation with the behavior. -->
<!-- agent-summary: Validate desktop and mobile browser states plus targeted API and Playwright coverage. -->
<!-- agent-summary: Commit the implementation, tests, documentation, worksheet, and feedback together. -->

## Goal and acceptance criteria

- Selecting Script from Create enters a dedicated script workspace, not `/projects/new`.
- Script intake asks for the story idea and lightweight writing direction without footage controls or video-cost warnings.
- The Creative Director creates a brief, high-level story blueprint, and script, then stops at script review.
- No poster, storyboard media, image, audio, or video generation begins as part of the script-only run.
- The ready script is readable and can be revised through the existing agent-mediated script review contract.
- Video production is a separate, explicit follow-up action.
- Desktop and mobile browser behavior is covered and manually exercised.

## Context and source-of-truth documents

- `AGENTS.md`
- `AGENT_WORKFLOW.md`
- `CLAUDE.md`
- `docs/repository-structure.md`
- `apps/web/PRODUCT.md`
- `apps/web/DESIGN.md`
- `docs/ui-interaction-model.md`
- `docs/NORTH_STAR.md`
- `docs/testing/e2e-test-inventory-and-gaps.md`
- `apps/web/e2e/README.md`
- `docs/agent-system/performance-and-visual-regression.md`
- `docs/scopes/api-contract-v1.md`

## Decisions

- Script creation is a distinct durable run scope, not a visual variant of full-video Studio.
- The MVP has one deliberate review boundary at the finished script. The story blueprint is still created first and is presented with the script; it is not a separately editable checkpoint, avoiding a second partially-built approval protocol.
- Script-scoped roots permanently expose only `create_or_load_brief`, `develop_story_blueprint`, and `draft_script`, including resume/recovery turns.
- Final script approval completes the script run and never dispatches poster, storyboard, specialist, audio, or video work.
- Script is removed from Asset Studio and becomes a first-class `/create/script` outcome.
- Research review found the current deterministic blueprint/script scaffolds insufficient for a writing product. Dedicated script runs require model-authored blueprint and script tool inputs; deterministic derivation remains fallback behavior for existing production paths and tests.

## Changes

- Added `/create/script` as a first-class Create outcome with idea, target length,
  optional writing direction, and explicit text-only scope.
- Removed Script from the single-asset workspace and retired its browser handoff
  coverage; Asset Studio now owns image, video, and soundtrack only.
- Added immutable `orchestrator_runs.creation_scope`, a script generation
  entrypoint, and a script-only Creative Director registry limited to brief,
  blueprint, and script tools.
- Extended blueprint and script tools with validated model-authored contracts while
  preserving deterministic fallback behavior for existing paths.
- Script review now treats outline-changing feedback as an outline revision plus
  redraft, refreshes both authoritative snapshots, and blocks every decision if
  either snapshot fails to load.
- Made final script approval complete a script-scoped run atomically, without
  dispatch or poster generation, and projected ready scripts distinctly from
  standalone media.
- Added the active story-blueprint read contract and displayed the outline and
  complete draft together at script review.
- Updated product, interaction, API, database-boundary, North Star, E2E inventory,
  worksheet, and feedback ownership documentation.
- PR review follow-up grants the production API role read access to the two
  outline-identity columns used by the review transaction, extends exact readiness
  coverage, and gives completed script runs script-specific success copy.

## Validation evidence

- Combined focused API tool, registry, transaction, entrypoint, approval-effects,
  and projection coverage: 81 passed.
- Web unit suite: 91 passed.
- API and web TypeScript checks: passed.
- Creation launcher/intake Playwright on Chromium and mobile Safari: 13 passed.
- Dedicated script revise/finish/reload/fail-closed Playwright: 5 passed; the
  completion test observes zero media-related writes.
- PR review follow-up readiness and projection suites: 53 passed.
- Migration parser/tests: passed for 103 migrations / 2 validator tests.
- RPC and relation boundaries: passed (48 production RPC targets; 438 literal
  relation calls; no retired relations).
- Manual browser, `http://localhost:3000/create` → `/create/script`:
  desktop 1440×1000 and mobile 390×844; verified focused intake, three distinct
  launcher outcomes, optional writing direction, enabled CTA, no dialog, no console
  error, and no horizontal overflow.
- Full API suite was also sampled inadvertently: 1,248 passed, 5 failed, 142
  skipped, and 3 todo. The five failures are pre-existing repository issues
  (two referenced-but-missing retention migration fixtures, graph snapshot
  undefined-field comparison, public-project UUID fixture, and legacy mounted-run
  mutation expectation); none touched this change.
- Local Supabase application is blocked by an unresponsive Docker socket. Static
  migration validation passes, but `supabase migration up --local` cannot reach
  `127.0.0.1:55522`, and the CLI cannot complete a container restart.

## Independent reviews

- Research review completed by `/root/research_review`: confirmed the existing UI-only handoff is unsafe and identified the deterministic writing-quality gap.
- Plan review completed by `/root/research_review`: required durable scope enforcement, authored content contracts, and final approval with zero media dispatch. The suggested separate blueprint approval was intentionally collapsed into the final script review for this bounded MVP; the outline remains visible and agent-authored.
- Implementation review completed by `/root/research_review`: found outline
  revision, fail-closed loading, nested authored-input validation, behavioral
  coverage, and terminal-navigation gaps. All five were addressed with focused
  tests before wrap-up review.
- Wrap-up review completed by `/root/research_review`: found outline/script
  identity consistency and empty-visible-copy gaps. The UI and approval
  transaction now fail closed on blueprint-id mismatch, authored scenes require
  narration or dialogue, and distinct top-level narration is rendered; focused
  mismatch and empty-copy tests pass.
- Final reviewer verification found one remaining race on script-scope rejection;
  Request Changes now performs the same atomic active-outline identity check as
  Finish, with a stale-outline rejection test. No other P0/P1 issue was reported.
- PR #900 automated review identified two actionable follow-ups: missing
  least-privilege outline-column grants and contradictory completed-script copy.
  Both are addressed with targeted readiness and projection tests.
- Independent PR follow-up review found no remaining P0/P1 issue and confirmed
  that migration manifests auto-enumerate the new grant migration; its combined
  readiness, transaction, and projection check passed 59/59.

## Blockers and risks

- Local migration execution remains blocked by the unhealthy Docker environment
  described above; parser, boundary, and repository validation are green.
- A future “turn into video” action must create a new full-video run rather than
  broadening the immutable completed script scope.

## Next action / handoff

- Commit and push the PR-review fixes, then report both addressed threads on PR #900.
