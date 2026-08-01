# Worksheet: WEB-20260801-CREATE-ARCHITECTURE

<!-- agent-summary: Durable record for the first production creation-architecture alignment PR. -->
<!-- agent-summary: Global Create remains the asset-oriented Image, Video, or Audio workspace. -->
<!-- agent-summary: The desktop creation canvas uses a 30/70 context-to-prompt topology. -->
<!-- agent-summary: Dashboard, Activity, Library, desktop, and mobile entry points use consistent creation language. -->
<!-- agent-summary: Generation, review, draft, timed-approval, regeneration, and full-video contracts remain unchanged. -->
<!-- agent-summary: A quiet route-local recent-project switcher reuses the Asset Studio project query. -->
<!-- agent-summary: Use worksheet/WEB-20260801-CREATE-ARCHITECTURE as the git tag after completion. -->

## Goal and acceptance criteria

Implement the confirmed split creation workspace. The global Create action opens
the existing asset-oriented `/create` flow for Image, Video, or Audio creation;
full-video creation remains a separate `/projects/new` flow. Reshape `/create`
around a roughly 30/70 desktop layout with media type and project context in the
left rail and the prompt/review-request canvas as the visual protagonist. Align
desktop and mobile shell, Dashboard, Activity, and Library entry points, remove
the circular Library empty action, and use consistent creator-facing terminology.

Acceptance requires preserving the existing project picker, inline project
creation, prompt enhancement, proposal/review navigation, status polling, draft,
generation, and API contracts. Timed approval, direct regeneration, and
full-video flow internals are explicitly outside this PR. Behavior-focused
Playwright coverage must prove the aligned entry points and responsive creation
workspace at desktop and mobile widths.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`, `docs/repository-structure.md`
- `apps/web/PRODUCT.md`, `apps/web/DESIGN.md`, `docs/ui-interaction-model.md`
- `docs/NORTH_STAR.md`
- `docs/testing/e2e-test-inventory-and-gaps.md`, `apps/web/e2e/README.md`
- Impeccable `shape` and product-register guidance
- Approved creation-workspace mock and Warm Workshop palette contract supplied
  in the task handoff

## Decisions

- Preserve `/create` as the canonical global Image, Video, or Audio creation
  workspace; do not redirect global creation to `/projects/new`.
- Keep `/projects/new` and all full-video internals unchanged.
- Implement the approved mock with semantic React and CSS Modules; generated
  raster assets are reference-only and are not shipped.
- Use real project data for project context and thumbnails when available, with
  truthful loading, error, empty, and no-poster fallbacks.
- Add the approved mock's top Recent projects switcher as a route-local control
  backed by the already-loaded Asset Studio project query. Selecting a recent
  project must use the same proposal-reset path as the full picker; do not add a
  second global recent-work tray or another server query.
- Give the prompt canvas about 70% of desktop width; collapse media/project
  context responsively on narrower screens without duplicating the mobile gold
  action.
- Retain one gold CTA on the creation screen: `Review request`.
- Route both Library Projects actions—the persistent header action and the empty
  state action—to `/create`; test the nonempty and empty collection states.
- Record the split creation routes in `docs/ui-interaction-model.md`: global
  Dashboard, Activity, and Library creation enters the asset-oriented `/create`,
  while full-video creation remains distinct at `/projects/new`.

## Changes

- Rebuilt `/create` as a responsive split workspace with a route-local Recent
  projects switcher, media context rail, real selected-project context, large
  prompt canvas, and a single `Review request` action.
- Preserved the existing project picker and creation, prompt enhancement,
  proposal/review, status, draft, generation, and API paths.
- Aligned desktop and mobile navigation plus Dashboard, Activity, and both
  Library project actions on the asset-oriented `/create` entry point while
  keeping `/projects/new` distinct and Library-active.
- Made desktop Create a neutral subtree-aware navigation link, kept the page's
  ambient treatment neutral, and sorted the route-local recent list by valid
  `updatedAt` descending with stable input-order fallback for ties or invalid
  timestamps.
- Added explicit next-action unit coverage and behavior-focused Playwright
  coverage for workspace layout, loading, entry points, mobile semantics, and
  the existing proposal lifecycle.
- Updated the interaction model, E2E README, and test inventory to record the
  split creation routes and coverage.

## Validation evidence

- Branch/worktree check: `codex/create-architecture` in
  `/Users/kevingrassi/.codex/worktrees/af8b/popcornready-create-architecture`
  matches current `origin/main` at `796b0337` before implementation.
- Approved mock and palette contract were inspected at original resolution.
- `pnpm --filter @popcorn/web typecheck` — passed.
- `pnpm --filter @popcorn/web test` — passed, 54 tests.
- Final combined Playwright matrix (`creation-entry-points.spec.ts` and
  `asset-studio.spec.ts`) — passed, 32 tests: Chromium 26 plus Mobile Chrome 3
  and Mobile Safari 3.
- The final combined mobile run used isolated ports 3101/4101 because another
  agent's Vite server owned port 3100; both projects passed, 6 tests total.
- In-app browser inspection at 1440×1000 and 390×844 confirmed the split
  hierarchy, responsive context collapse, readable prompt canvas, neutral mobile
  Create tab, and disabled-action/loading/error presentation. The local manual
  server had no configured Supabase store, so populated-project visuals remain
  covered by mocked Playwright assertions rather than this manual session.
- Final visual comparison retained the approved Direction B ingredients: quiet
  Recent projects band, 30/70 desktop context-to-prompt hierarchy, compact
  Image/Video/Audio and Project rail, large prompt protagonist, one Review
  action, and a structural mobile stack.
- Impeccable detector on all changed UI source and module files — passed with no
  findings (`[]`).
- `pnpm agent:lint:fix` — passed for 18 changed files; resulting diff reviewed.
- `pnpm agent:validate -- --scope web` — passed, including agent lint, workflow
  policy tests, migration validation, and web typecheck.
- `git diff --check` — passed after repository hygiene.
- Playwright's local API worker logged the expected missing-Supabase warning;
  all affected browser requests were mocked and the test processes passed.

## Independent reviews

- Research/shape review completed in the production-audit follow-up and the user
  confirmed the split-workspace direction.
- Plan review: approved after adding both Library action fixes, the route-local
  Recent projects switcher, the interaction-model documentation update, and
  explicit zero-project/idle-workspace next-action tests.
- Implementation review found four issues: undefined recent-project ordering,
  a gold ambient glow competing with the CTA, missing desktop Create current
  semantics, and E2E claims ahead of responsive/fallback assertions. All four
  were resolved with focused coverage; independent re-review approved.
- Wrap-up review: approved with no findings after final browser, detector,
  targeted-test, repository-lint, scoped-validation, documentation, worksheet,
  and feedback evidence review.

## Blockers and risks

- No implementation blocker is known.
- No product, test, documentation, or validation blocker is known.
- No review checkpoint or implementation blocker remains.

## Next action / handoff

Commit the complete in-scope diff, create the annotated worksheet tag, push the
branch and tag, and open the ready-for-review pull request to `main` with audit
PR #864 linked as context.
