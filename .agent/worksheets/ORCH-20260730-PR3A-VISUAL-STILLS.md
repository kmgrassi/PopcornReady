# Worksheet: ORCH-20260730-PR3A-VISUAL-STILLS

<!-- agent-summary: Durable record for selective-regeneration roadmap PR 3A. -->
<!-- agent-summary: This slice adds visual still adapters behind the PR 2 executor interface. -->
<!-- agent-summary: Generic images, posters, anchors, storyboard tiles, and keyframes are covered. -->
<!-- agent-summary: Exact proposal bindings and graph inputs constrain every generated output. -->
<!-- agent-summary: Outputs remain immutable and pooled; this slice never moves selections or story pointers. -->
<!-- agent-summary: The production executor registry remains empty until roadmap PR 5. -->
<!-- agent-summary: Use worksheet/ORCH-20260730-PR3A-VISUAL-STILLS as the completion tag. -->

## Goal and acceptance criteria

Implement roadmap PR 3A as a stacked, independently mergeable adapter slice.
The adapters must resolve only proposal-authorized visual-still targets, reuse
canonical image services, preserve immutable graph inputs and unrelated/uploaded
assets, and return exact PR 2 output bindings. No production path may register
or dispatch these adapters before PR 5.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`
- `docs/repository-structure.md`, `docs/NORTH_STAR.md`
- `docs/scopes/full-selective-regeneration-cutover-prs.md`
- `apps/api/src/lib/tool-tests/README.md`

## Decisions

- Keep PR 3A files under a visual-still-specific executor boundary so PR 3B,
  PR 3C, and PR 4 do not edit the same adapters.
- Support only `revise_visuals` outputs whose kind is `image`, `poster`,
  `anchor`, `storyboard`, or `keyframe`.
- Treat a pinned active asset as the canonical revision source. Its immutable
  input edges, provider normalization, storage, cost, minor-safety routing, and
  embedding behavior stay owned by the canonical image service.
- For an absent selection, require a resolver-produced, proposal-bounded create
  specification with explicit graph inputs; never infer an arbitrary slot or
  consume unpinned project state.
- Return the exact server-issued binding, target, role, and ordinal. The
  adapter may not synthesize or widen binding authority.
- Dispatch one bounded Visuals child with the persisted approval fingerprint,
  exact pins/bindings, and fenced callback metadata. Return its durable handle
  as accepted work; the child worker owns claiming, primitives, and reporting.
- Persist proposal asset pins in the canonical job and revalidate both content
  hash and inputs fingerprint after the provider claim and before spend.
- Use one canonical provider/model estimate, one proposal-child reservation,
  and the generated-asset job's replay-safe settlement path.
- Never move a selection, panel image pointer, or semantic story pointer in
  this slice. PR 5 owns the final atomic application.
- Leave the production executor registry empty. Tests instantiate the exported
  adapter explicitly with deterministic canonical-service fakes.

## Changes

- Added an unregistered `visual-stills.v1` PR 2 executor for generic images,
  posters, character/scene anchors, storyboard tiles, and beat keyframes.
- The accepted child assignment carries exact asset, selection, and story pins
  plus the server-issued still output bindings; it never reparses model prose.
- The canonical generated-asset path now supports durable, idempotent immutable
  image revisions and exact post-claim asset-pin revalidation for child tools.
- Minor likeness prompts route to Gemini; all other still work stays on the
  proposal-quoted OpenAI image default.
- A deterministic generated-asset job/action key makes a work retry reuse the
  same completed output instead of repeating the provider call.
- Provider primitives and parent-linked reservations belong to the bounded
  Visuals child. Terminal domain-report callback processing derives their exact
  applied action/output/budget causation before PR 2 completes the work.
- Updated the domain contract and accepted cutover roadmap with the inert
  adapter boundary and PR 4/5 ownership.

## Validation evidence

- Hardened adapter plus canonical still-tool regression set: 63 passed
  (62 canonical/adapter tests, then the added mixed-target regression).
- Generated-asset regression file: 10 DB-gated tests discovered; the local
  non-DB run skipped them as designed.
- `pnpm --filter @popcorn/api typecheck` — passed after hardening.
- `pnpm db:migrations:validate` — passed (90 migrations).
- API application smoke on port 4013 returned `200` from `/api/v1/health` with
  the Creative Director hierarchy enabled.
- `pnpm agent:lint:fix` — passed.
- `pnpm agent:validate -- --scope all` — passed.

## Independent reviews

- Independent implementation review rejected the first synchronous adapter for
  repeat-provider crash windows, incorrect reservation ownership, freshness
  TOCTOU, root-dispatch causation, and estimate-only accounting. The hardened
  design uses the canonical durable job, a child action/run, provider-bound pin
  validation, and one parent-linked budget.
- Independent re-review then required the persisted approval fingerprint and
  the shared accepted-child/domain-report callback path. Both are now present.
- Final independent wrap-up review found and verified one last mixed-work
  scoping fix: child targets are derived only from the assigned output subset.
  Reviewer verdict: approved with no remaining findings.

## Blockers and risks

- PR 4 owns the shared proposal-child finalization exception that leaves the
  PR 2 dispatch action pending for fenced `completeWork`; PR 3A consumes that
  contract before PR 5 activation. Its registry remains inert meanwhile.
- Production activation and final atomic selection/story-pointer application
  intentionally remain PR 5.

## Next action / handoff

- Refresh final validation, then commit/tag/push and open the ready stacked PR.
