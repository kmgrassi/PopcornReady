# Worksheet: WEB-20260730-IMAGE-PROMPT-QUALITY

<!-- agent-summary: Durable record for the default-on Asset Studio image-prompt enhancement pass. -->
<!-- agent-summary: The user's original prompt remains editable and is never overwritten silently. -->
<!-- agent-summary: A fast text model rewrites image prompts before the cost proposal is created. -->
<!-- agent-summary: The UI shows the exact effective prompt and provides a default-on bypass toggle. -->
<!-- agent-summary: Video and soundtrack requests remain unchanged. -->
<!-- agent-summary: Tests cover enhancement policy constraints, bypass, stale responses, and provenance. -->
<!-- agent-summary: Link independent reviews, validation evidence, feedback, and the ready PR here. -->

## Goal and acceptance criteria

Make Asset Studio image generation more resistant to generic AI aesthetics by
default. Before creating an image-generation proposal, use the configured fast
text model to turn the creator's request into a concrete, coherent art-direction
prompt while preserving intent. Expose a default-on Image-only UI toggle, allow
an exact pass-through when disabled, show the effective prompt before explicit
generation confirmation, and retain the existing proposal/cost boundary.

## Context and source-of-truth documents

`AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`,
`docs/repository-structure.md`, `docs/NORTH_STAR.md`,
`docs/ui-interaction-model.md`, `apps/web/PRODUCT.md`,
`apps/web/DESIGN.md`, `docs/scopes/specialist-agent-orchestration-prs.md`,
`docs/testing/e2e-test-inventory-and-gaps.md`, `apps/web/e2e/README.md`,
and the user-provided image-prompt quality rubric.

## Decisions

- Use the active authenticated `/create` Asset Studio rather than the landing
  video composer or legacy regeneration dialogs.
- Keep the original prompt in the textarea and show the enhanced effective
  prompt only in the pre-generation review.
- Run enhancement inside the idempotent proposal operation so retries replay one
  effective prompt and the proposal digest, task, run summary, action provenance,
  and review UI all bind the exact prompt the user approves.
- Scope enhancement to `image_create`; video and soundtrack behavior remains
  unchanged.
- Require the proposal idempotency key before project/reference validation or
  text-model spend. Enhancement failure returns a typed error before any
  creator-direct run, action, or gate is created; it never silently bypasses.
- Record prompt-refinement model usage against the project, while keeping the
  proposal maximum explicitly scoped to later asset generation.

## Changes

- Added a versioned image art-direction policy using the configured minimal-
  effort fast LLM lane, structured output, a 4,000-character cap, and the shared
  LLM cost recorder.
- Extended creator-direct image proposals with a strict `improvePrompt` request
  flag and `effectivePrompt` / `enhancementApplied` response fields.
- Bound the effective prompt through the request digest, domain task, run
  summary, proposal rationale, and action provenance while retaining the
  original prompt and policy version.
- Added the default-on Image-only checkbox and read-only Original / Refined
  prompt review to Asset Studio, with exact bypass and stale-response guards.
- Added API and browser coverage for policy constraints, output validation,
  prompt propagation, bypass, failure, and stale toggle changes.
- Added the image-prompt enhancement scope and updated the Asset Studio and E2E
  sources of truth.

## Validation evidence

- `pnpm --filter @popcorn/api exec tsx --test
  src/lib/api/v1/__tests__/image-prompt-enhancement.test.ts
  src/routes/v1/__tests__/agent-creations.test.ts` — 11/11 passed.
- `pnpm --filter @popcorn/api typecheck` — passed.
- `pnpm --filter @popcorn/web typecheck` — passed.
- `pnpm --filter @popcorn/web test` — 36/36 passed after adding direct proposal-
  payload mapping coverage.
- `pnpm --filter @popcorn/web build` — passed; retained the existing large-
  chunk warning for the 1.82 MB application bundle.
- `pnpm --filter @popcorn/web exec playwright test
  e2e/asset-studio.spec.ts --project=chromium --project=mobile-chrome` — 14/14
  passed across desktop and mobile.
- Manual in-app browser inspection at desktop and 390-by-844 mobile widths
  confirmed the default-on control, readable hierarchy, mobile bottom-nav
  clearance, and no horizontal overflow (`scrollWidth === clientWidth === 390`).
- Real local API application-path smoke on port 4105 with `AUTH_MODE=local`
  returned health 200 and sent an authenticated POST to the changed creator-
  direct proposal route. The request intentionally omitted `Idempotency-Key`
  and received the expected 400 `validation_failed` response from the new
  pre-model guard. A minimal local Supabase REST stand-in supplied only the
  deterministic dev workspace because the running local PostgREST service was
  unresponsive; no provider call or persistence was attempted.
- Full API suite — 1,032 passed, 123 skipped, 3 todo, and 4 unrelated baseline
  failures in untouched guest-retention migration-history, public-project UUID,
  and projection-metadata tests. All image-prompt enhancement tests passed.
- `pnpm agent:lint:fix` — passed for 14 changed files.
- `pnpm agent:validate -- --scope all` — passed, including migration, RPC,
  relation-boundary, and both workspace typechecks.

## Independent reviews

- Research review approved the `/create` image-only default-on boundary and
  required proposal-bound effective-prompt preview, original/effective
  provenance, cost recording, output limits, and stale-response coverage.
- Plan review required explicit idempotency and failure semantics. The existing
  mutation wrapper reserves the entire keyed proposal operation; the route now
  requires that key before the model call. Typed enhancement failure precedes
  all run/action/gate persistence and exposes the opt-out path.
- Implementation review identified a stale late-error leak and insufficient
  orchestration-level coverage. Version-guarded local errors, suppressed global
  mutation toasts, delayed-failure browser coverage, and injectable service
  tests for ordering, no-persistence failure, provenance, and idempotent replay
  resolved both findings. Follow-up review found no remaining regression.
- Wrap-up review required an API application-path smoke, clarified that the
  policy forbids inventing visible text rather than descriptive vocabulary, and
  identified stale worksheet bookkeeping. The local HTTP smoke above, policy
  wording/assertion update, and this final worksheet pass resolve all findings.
  The reviewer found no other correctness, authorization, cost, idempotency,
  stale-response, accessibility, or provenance defect.
- A later PR-record audit aligned the scope wording with the visible-text
  policy and documented dedicated delayed prompt/goal changes as a focused E2E
  gap; project and enhancement-toggle invalidation remain directly covered.
- A parallel PR implementation audit split API, web, and records into distinct
  ownership lanes. API and UI behavior required no correction; the web lane
  added unit coverage for image enable/bypass payloads and non-image omission,
  while the records lane made the precision updates above. The combined
  follow-up passed web tests, agent lint, all-scope validation, and diff checks.

## Blockers and risks

- Prompt enhancement adds one text-model request to the Image “Review cost”
  action.
- The model must not invent brand facts, text, logos, subjects, or creative
  constraints the user did not request.
- Stale enhancement/proposal responses must not replace newer user input.

## Next action / handoff

Ready PR: https://github.com/kmgrassi/PopcornReady/pull/845
