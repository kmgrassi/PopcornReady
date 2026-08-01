# Worksheet: WEB-20260801-VIDEO-PROMPT-QUALITY

<!-- agent-summary: Durable record for extending Asset Studio prompt enhancement to video creation. -->
<!-- agent-summary: Video prompts receive motion-aware direction while preserving creator intent. -->
<!-- agent-summary: The original prompt remains editable and visible beside the effective prompt. -->
<!-- agent-summary: Enhancement remains inside the idempotent proposal operation and cost boundary. -->
<!-- agent-summary: Video editing and soundtrack requests remain outside this creator-direct policy. -->
<!-- agent-summary: Targeted API, web, browser, and application-path evidence is recorded here. -->
<!-- agent-summary: Link independent reviews, validation, feedback, and the ready PR before handoff. -->

## Goal and acceptance criteria

Extend the existing default-on Asset Studio prompt enhancement from image
creation to video creation. Use a motion-aware prompt policy for `video_create`,
preserve exact bypass behavior, show the original and effective prompts before
approval, and retain the existing proposal idempotency, provenance, cost, and
failure boundaries.

## Context and source-of-truth documents

`AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`,
`docs/repository-structure.md`, `docs/NORTH_STAR.md`,
`docs/ui-interaction-model.md`, `apps/web/PRODUCT.md`,
`apps/web/DESIGN.md`, `docs/scopes/image-prompt-enhancement.md`,
`docs/scopes/agent-video-generation-api.md`,
`docs/scopes/specialist-agent-orchestration-prs.md`,
`docs/testing/e2e-test-inventory-and-gaps.md`, `apps/web/e2e/README.md`, and
the Impeccable product-interface guidance.

## Decisions

- Scope enhancement to creator-direct `video_create`. `video_edit` remains an
  exact, source-aware minimal-delta instruction and needs a separate policy that
  can inspect the pinned source.
- Add a distinct versioned video policy rather than reuse image art direction,
  while retaining the existing proposal preparation and provenance contract.
- Keep `improvePrompt` default-on for Image and Video in Asset Studio and omit it
  from soundtrack requests.
- Preserve the public 4,000-character prompt contract even though the downstream
  standalone video tool accepts a larger agent-authored prompt.
- Default to one coherent eight-second shot, prohibit invented reference-asset
  details, and keep `video_edit` source-aware and untouched.

## Changes

- Added the versioned `video_motion_direction_v1` policy, structured output
  validation, and project cost recording.
- Extended creator-direct proposal preparation, task binding, provenance, and
  visible failure behavior to enhanced `video_create` requests.
- Added the default-on Video control, motion-specific review copy, effective-
  prompt preview, and draft-preserving revision behavior in Asset Studio.
- Added targeted API, web unit, and Playwright coverage plus the authoritative
  video scope and reconciled image/E2E documentation.

## Validation evidence

- Prompt/API targeted suite — 16/16 passed across the image policy, new video
  policy, creator-direct binding, exclusions, failure ordering, and idempotency.
- Web unit suite — 52/52 passed.
- API and web TypeScript checks — passed.
- Asset Studio Playwright on desktop Chromium and mobile Chrome — 23/23 passed,
  including independent visual defaults, motion-specific progress, preview,
  revision, and mobile behavior.
- Local API application path on port 4191 returned health 200. The changed
  proposal request reached the live Express stack but could not pass the
  idempotency store because this worktree has no `.env.local` or configured
  Supabase service credentials; it returned the expected environment-level 500
  before route work. Browser/API fixtures and direct service tests made no
  provider calls.
- In-app browser control could not be initialized because the required browser
  JavaScript control tool was unavailable in this session. Desktop/mobile
  Playwright interaction and overflow coverage served as the UI inspection.
- `pnpm agent:lint:fix` — passed for 16 changed files.
- `pnpm agent:validate -- --scope all` — passed, including workflow, migration,
  RPC/relation-boundary, lint, and API/web type checks.
- `git diff --check` — passed.

## Independent reviews

- Research review approved the creator-direct `video_create` boundary and
  required a motion-specific policy, exact pass-through for video edits/audio,
  distinct version provenance, failure-before-persistence behavior, and dynamic
  UI/browser coverage.
- Plan review approved the boundary and required the single-shot/eight-second
  default, uninspected-reference guard, explicit modality dependency, exact
  excluded-path tests, and goal-switch/revision browser coverage; all are in
  the implementation and test plan.
- Implementation review found shared Image/Video preference state and image-only
  boundary tests. Separate per-modality state, a goal-switch browser assertion,
  and real video-enhancer failure/idempotency tests resolved both findings;
  follow-up implementation review approved the corrected diff with no remaining
  finding.
- Wrap-up review approved correctness, scope, tests, records, and ready-PR
  status after requesting the E2E inventory reconciliation date be advanced to
  2026-08-01; the date is corrected.

## Blockers and risks

- No delivery blocker remains.
- A video policy must direct temporal action and camera motion without adding
  story beats, subjects, dialogue, text, or implausible simultaneous actions.
- Existing image behavior, exact opt-out, idempotency, provenance, and failure
  ordering must remain intact.

## Next action / handoff

Complete wrap-up review, commit the implementation/docs/worksheet/feedback,
create the worksheet tag, push, and open a ready PR.
