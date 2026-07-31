# Worksheet: ORCH-20260731-PR851-REVIEW-FIXES

<!-- agent-summary: Durable record for resolving PR 851 review feedback. -->
<!-- agent-summary: Independent outputs fan out before assembly and critique run in dependency waves. -->
<!-- agent-summary: Revision-only model schemas round-trip stable story identities. -->
<!-- agent-summary: New story nodes use explicit markers and receive server-minted durable IDs. -->
<!-- agent-summary: Whole-blueprint and exact-beat relational content moves atomically with its pointer. -->
<!-- agent-summary: Unsupported aggregate storyboard and scene contracts fail before approval. -->
<!-- agent-summary: Use worksheet/ORCH-20260731-PR851-REVIEW-FIXES as the completion tag. -->

## Goal and acceptance criteria

Resolve all four unresolved P1 review threads on PR 851 without weakening the
proposal, binding, or immutable-graph authority boundaries. Completion requires
dependency-aware fan-in, identity-safe story revision, coherent relational
reads after pointer application, and executable storyboard bindings whose tool
policy and output cardinality agree.

## Research and plan

- The lifecycle launched every selected work item through one
  `Promise.allSettled`, so root assembly and critique raced provider callbacks.
- The story-pointer RPC moved asset IDs but not the relational semantic fields
  consumed by active readers.
- The original plan schema excluded IDs and `ensureBeatIds` minted by
  position/name, making positional identity reassignment unavoidable.
- `generate_storyboard` was authorized as keyframe output even though its
  semantic result is storyboard media; aggregate targets can emit multiple
  tiles for one binding.
- Independent research review identified the model-schema identity gap, the
  scene/storyboard relational identity conflict, and aggregate storyboard
  cardinality before implementation was finalized.

## Decisions and changes

- Execute independent media/story/Audio work concurrently, then assembly, then
  critique. A parked or failed wave prevents reservation of later waves.
- Add a revision-only structured-output schema with required scene/beat IDs.
  Existing IDs are retained by identity, `new:` markers receive deterministic
  server IDs, unknown/duplicate IDs fail, and the requested target must survive.
- Atomically update `story_blueprints.snapshot` or exact `story_beats` semantic
  columns with the approved asset pointer.
- Fail registry and database coverage for aggregate storyboard/scene semantic
  revisions until a dedicated relational mapping separates semantic and visual
  scene assets.
- Authorize `generate_storyboard` for `storyboard`, not `keyframe`, and accept
  storyboard media bindings only at exact beat/panel scope.

## Validation evidence

- API typecheck passed, and the API booted on port 4311 with
  `GET /api/v1/health` returning 200.
- Focused agent, policy, lifecycle, executor, root-service, visual-still, and
  migration tests passed after final lint hygiene (64/64).
- `pnpm agent:lint:fix` passed for all 21 changed files.
- `pnpm agent:validate -- --scope all` passed, including repository lint,
  workflow policy, migration validation, RPC/relation boundaries, and both
  web/API typechecks.
- A clean local Supabase reset applied all 93 migrations, including the revised
  atomic graph RPC. The direct lifecycle integration then passed (2/2) before
  the exact-beat projection assertion was added. Docker became unresponsive
  before that expanded assertion could be rerun; CI must execute the final
  database-backed test rather than treating a different stale local database
  as valid evidence.

## Independent reviews

- Research/plan review found no conflicting comments and required real
  revision-schema coverage, fail-closed aggregate projections, exact
  storyboard cardinality, and parked-wave coverage. Those findings changed the
  implementation before final validation.
- Implementation and wrap-up review approved the final diff with no actionable
  blockers. The reviewer independently confirmed the four fixes, a clean diff,
  the 64/64 focused suite, and API typecheck; the disclosed CI-only expanded
  database assertion was not considered a code blocker.

## Next action

- Commit, tag, and push the validated fixes to PR 851, then confirm the remote
  CI database run covers the expanded exact-beat projection assertion.
