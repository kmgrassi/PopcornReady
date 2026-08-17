# Worksheet: ORCH-20260805-DOMAIN-OUTPUT-KINDS

<!-- agent-summary: Fix finite-domain completion validation against persisted graph asset kinds. -->
<!-- agent-summary: A successful creator-direct video run persisted a ready clip before validation rejected it. -->
<!-- agent-summary: Audit every semantic output kind and every consumer of the shared mapping. -->
<!-- agent-summary: Add deterministic regressions for completion inventory and rerun output authorization. -->
<!-- agent-summary: No database migration or production data mutation belongs in this fix. -->
<!-- agent-summary: Validate the focused orchestrator path and run the API locally before handoff. -->
<!-- agent-summary: Link independent reviews, feedback, validation, commit, tag, and ready pull request here. -->

## Goal and acceptance criteria

Prevent valid ready graph assets from being rejected when finite-domain completion validates their semantic output kinds. Reproduce the creator-direct video failure, align semantic output kinds with the graph kinds actually persisted by the API, cover every adjacent output kind, audit all mapping consumers, and preserve fail-closed role/ownership/readiness checks.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`, `docs/repository-structure.md`
- `docs/NORTH_STAR.md`, `docs/domain-agent-orchestration-contract.md`
- `docs/scopes/specialist-agent-orchestration-prs.md`
- `docs/agent-system/testing-policy.md`, `docs/agent-system/reviews.md`
- `apps/api/src/lib/tool-tests/README.md`

## Decisions

- Diagnose this as an application contract mismatch, not a database schema defect: production stored the expected graph kind and media.
- Keep database rows unchanged; update shared semantic-to-graph normalization and completion semantic classification together.
- Treat persisted graph kind as authoritative. Use intrinsic role only where one graph kind is intentionally overloaded: `keyframe` distinguishes storyboard roles, and `critique` distinguishes `audio_fit`.
- Preserve `act_mockup` as a storyboard role on the persisted `keyframe` graph kind.
- Return an explicit shared completion-output graph-kind subset rather than treating a narrower embedding union as database-wide authority.
- Keep exact required-role equality out of this patch: creator-direct task roles such as `primary` intentionally differ from persisted intrinsic roles. Tests instead lock graph-kind-first matching and the two documented overloaded role families.
- Update rerun output authorization because it consumes the same shared normalization at direct-Postgres finalization.

## Changes

- Added the explicit shared `DomainOutputAssetKind` subset and corrected semantic-to-graph normalization: poster, anchor, clip, and audio-track now retain their graph kinds; storyboard and keyframe both authorize `keyframe` rows.
- Reworked completion semantic classification to trust persisted graph kinds. Only `keyframe` roles distinguish storyboard from keyframe, while only `critique` with role `audio_fit` satisfies an audio-fit output.
- Typed completion inventory rows against the API's full `GraphAssetKind` union so unsupported graph kinds remain representable and fail closed.
- Updated completion-repair fixtures to use realistic anchor graph rows.
- Added an exhaustive shared mapping test, rerun-authorization regressions, the exact production creator-direct clip regression, a success matrix for every domain output kind, `act_mockup`, graph-kind-first disagreement cases, and fail-closed overloaded-role cases.

## Validation evidence

- Production run evidence: generation job succeeded, action applied, and ready `clip`/`video` asset persisted before terminal completion validation failed.
- Focused orchestrator tests: 24 passed with `pnpm exec tsx --test ...` from `apps/api`.
- Repository typecheck: 8 packages passed with `pnpm typecheck`.
- API validation gate passed with `pnpm agent:validate -- --scope api`, including agent lint, CI workflow tests, migration checks, database RPC/relation boundary checks, and API typecheck.
- Production build passed with `pnpm build` (API and web; existing web chunk-size warning only).
- Local API booted on port 4107 and `GET /api/v1/health` returned `status: ok`; the unconfigured background worker logged expected missing-Supabase errors in this isolated shell.
- Full API suite: 1,222 passed, 142 skipped, 3 TODO, and 4 unrelated baseline failures. The failures reference two absent historical guest-retention migrations, an existing story-snapshot projection expectation, and an existing UUID-shape assertion.
- Direct local-Postgres rerun test could not start because the local Supabase environment helper timed out waiting for Docker. The deterministic rerun authorization unit test passed.

## Independent reviews

- Research: `/root/research_review` confirmed the database graph/media split is correct, identified stale media-kind assumptions in both normalization and semantic classification, and found the same latent failure in poster, anchor, storyboard, keyframe, audio-track, and rerun finalization paths.
- Plan: `/root/plan_review` agreed no migration is needed; required `act_mockup` coverage, graph-kind-first classification, fail-closed overloaded roles, an explicit mapping return type, and rerun-consumer coverage. Those constraints are incorporated in the implementation plan.
- Implementation: `/root/plan_review` found that the initial bound-claim fixture had accidentally changed the anchor binding into an image binding. The fixture was restored, a positive correctly ordered anchor/image claim was added, the swapped negative was retained, and the reviewer verified the fix with no remaining findings.
- Wrap-up: `/root/research_review` independently reran the four changed orchestrator test files (24/24 passed), confirmed `git diff --check` is clean, and approved the code, scope, feedback, and validation evidence with no remaining findings after this worksheet state was refreshed.

## Blockers and risks

- `keyframe` graph rows represent both semantic keyframes and storyboards, so semantic classification must retain role-aware disambiguation.
- Completion validation must continue rejecting wrong-project, non-ready, unsupported, and role-incompatible outputs.

## Next action / handoff

- Commit the reviewed code, tests, worksheet, and feedback together; tag `worksheet/ORCH-20260805-DOMAIN-OUTPUT-KINDS`; push the dedicated branch; and open a ready pull request against `main`.
