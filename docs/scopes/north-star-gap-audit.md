# North Star Gap Audit

> **Status:** Historical audit from 2026-06-23. The proposal foundation and
> Creative Director hierarchy it described as future work have since shipped.
> Use
> [`full-selective-regeneration-cutover-prs.md`](full-selective-regeneration-cutover-prs.md)
> for the current selective-regeneration gap and completion sequence.

Audit date: 2026-06-23

This audit follows the implementation gaps called out by the 2026-06-22
`docs/NORTH_STAR.md` status pass and checks them against the current
implementation. The intent is to separate shipped foundations from missing
runtime/product work before starting implementation PRs.

The legacy Next monolith retirement gap is intentionally excluded here because
PR #547 owns that cleanup by deleting the orphaned root `src/` tree, including
`src/app/api/oneshot`.

## Summary

| Gap | Current status | Recommendation |
| --- | --- | --- |
| Feed graph stale candidates into rerun decisions | Not implemented in the restart path. The graph query exists, but restart still uses fixed stage boundaries. | Start with [`graph-rerun-decisioning-prs.md`](graph-rerun-decisioning-prs.md). Add a graph-aware rerun proposal path before changing UI affordances. |
| Close the OODA prompt-feedback loop | Mostly not implemented. There are transient feedback and board-revision seams, but no first-class feedback entities or learned prompt context. | Use [`ooda-feedback-implementation-prs.md`](ooda-feedback-implementation-prs.md). Scope this as a feedback data-model/API track after rerun proposals have a stable target model. |
| Broaden regeneration coverage | Partial. Prompt-based image regeneration is shipped; video/audio/composite/storyboard semantic reruns are handled only through stage/tool reruns or board feedback. | Use [`regeneration-coverage-prs.md`](regeneration-coverage-prs.md). Treat broad regeneration as tool-specific rerun handlers, not as one generic media endpoint. |

## 1. Feed Graph Stale Candidates Into Rerun Decisions

Status: not implemented in the runtime restart path.

Evidence:

- The asset graph can compute stale candidates:
  `apps/api/src/lib/api/v1/store.ts#getStaleCandidates()` calls
  `downstream_assets`.
- The API exposes that query at
  `GET /api/v1/projects/:projectId/assets/:assetId/stale-candidates` in
  `apps/api/src/routes/v1/asset-graph.ts`.
- The restart route does not use `getStaleCandidates()`. It parses a
  `stageType`, maps that through `GENERATION_STAGE_ORDER`, supersedes actions at
  or after the stage, resets gates, and clears selection slots by stage-owned
  role/prefix in `apps/api/src/routes/v1/orchestrator-runs.ts`.
- Tests in `apps/api/src/routes/v1/__tests__/restart-from-stage.test.ts` assert
  the current fixed-stage behavior.

Gap:

The graph is available as a read primitive, but the orchestrator does not yet
receive changed nodes, stale candidates, provenance, and active selections as a
rerun-planning input. "Restart from stage" is still a coarse operational reset,
not an agent-proposed minimal rerun.

Proposed scope:

1. Add a rerun-proposal API that accepts a changed asset or storyboard target and
   returns a proposed rerun plan without spending provider dollars.
2. Build the proposal input from `getStaleCandidates()`, current selections,
   recent run actions, and the user note.
3. Teach the orchestrator model prompt/schema to choose one of: no-op, regenerate
   selected candidates, restart a stage, or ask for clarification.
4. Persist the proposal on an `action` before execution so the UI can show cost
   and blast radius.
5. Execute accepted proposals by calling specific tools or falling back to the
   existing fixed-stage restart only when the graph cannot identify a narrower
   plan.

Suggested first PR:

- Add a read-only `POST /api/v1/projects/:projectId/rerun-proposals` endpoint
  backed by `getStaleCandidates()` and unit tests. It should return the assembled
  candidate/provenance payload and a deterministic placeholder proposal. A later
  PR can put the LLM decision behind that stable contract.

Detailed scope: [`graph-rerun-decisioning-prs.md`](graph-rerun-decisioning-prs.md).

## 2. Close The OODA Prompt-Feedback Loop

Status: mostly not implemented.

Evidence:

- `docs/scopes/ooda-feedback-loop.md` defines `FeedbackEvent`,
  `FeedbackInsight`, `FeedbackDecision`, `FeedbackAction`,
  `WorkspacePreference`, and `PromptConfigVersion`, but the code search shows no
  implemented first-class store/API for those entities.
- Gate approve/reject routes exist in
  `apps/api/src/routes/v1/orchestrator-runs.ts`, but they only resolve the
  reached gate and resume the run.
- Targeted board feedback is recorded as an `actions` row with tool
  `board_feedback` and is threaded into the next orchestrator turn, but it is
  not aggregated into reusable learning.
- `videoQualityContextForPrompt()` is still imported as static prompt guidance
  in `apps/api/src/lib/agent/index.ts`,
  `apps/api/src/lib/agent/composition.ts`.

Gap:

The app can capture some run-local feedback and can send targeted board
revision instructions to the orchestrator, but it does not yet preserve feedback
as a reusable learning signal or inject approved learned context into future
prompts.

PR-sized next steps:

1. Add `feedback_events` as the Observe store, with links to workspace, project,
   run, action, asset, stage/tool, source, freeform text, and structured labels.
2. Capture events from gate approve/reject, board feedback, asset set-active
   changes, and generated review/critic outputs.
3. Add read APIs for project/workspace feedback so the review UI can show what
   has been captured.
4. Add `feedback_insights` and `feedback_decisions` only after capture volume and
   query shape are clear.
5. Convert `videoQualityContextForPrompt()` from static global text to a scoped
   helper that can append approved project/workspace prompt config versions.

Suggested first PR:

- Implement only `feedback_events` plus capture from gate approve/reject and
  board feedback. Leave Orient/Decide/Act as follow-up PRs.

Detailed scope:
[`ooda-feedback-implementation-prs.md`](ooda-feedback-implementation-prs.md).

## 3. Broaden Regeneration Coverage

Status: partial.

Evidence:

- Prompt-based image regeneration exists at
  `POST /api/v1/assets/:assetId/regenerate` and is implemented by
  `apps/api/src/lib/api/v1/regenerate-asset.ts`.
- That function explicitly rejects non-image assets because video/audio need
  different rerun inputs.
- `supabase/migrations/20260622150000_regenerate_asset_version_rpc.sql`
  atomically mints a new immutable image version and repoints storyboard panels
  plus active selections.
- Some orchestrator tools accept `feedback` inputs
  (`develop_story_blueprint`, `draft_script`, `plan_shots`,
  `plan_visual_anchors`, `generate_anchor`, `generate_keyframe`,
  `generate_audio`, `generate_storyboard`), but there is no unified per-asset
  regenerate handler for video, audio, composite cuts, or semantic storyboard
  changes.

Gap:

Image regeneration is a concrete endpoint. Other asset kinds rely on the
orchestrator/tool loop or fixed-stage restart behavior, which is correct as a
direction but not yet exposed as a granular, graph-aware regeneration contract.

PR-sized next steps:

1. Define kind-specific regeneration contracts for image, keyframe, clip, audio,
   storyboard beat/panel, and cut/composite assets.
2. Route non-image regeneration through orchestrator tools, not through the
   image regenerate endpoint.
3. Use the rerun-proposal contract from gap 2 to decide which downstream assets
   should be regenerated after a non-image change.
4. Persist every regenerate as an `action` with input/output asset ids and, when
   applicable, append new `selections`.

Suggested first PR:

- After the rerun-proposal endpoint exists, add a `regenerate_candidate` proposal
  type for one keyframe/clip/audio candidate and wire it to the matching existing
  tool. Keep image endpoint behavior unchanged.

Detailed scope: [`regeneration-coverage-prs.md`](regeneration-coverage-prs.md).

## Recommended Sequence

1. Graph rerun proposal contract.
2. Feedback event capture at existing approve/reject and board-feedback seams.
3. Non-image regenerate proposals for one asset kind, probably keyframes.
4. Broader OODA Orient/Decide/Act once feedback capture exists.

This sequence keeps the highest-risk runtime behavior behind explicit proposal
contracts before adding broader UI affordances.
