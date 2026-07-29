# Full Selective-Regeneration Cutover — PR Roadmap

<!-- agent-summary: This is the authoritative roadmap for completing the asset-generation migration. -->
<!-- agent-summary: The Creative Director owns blast radius and delegates bounded Visuals and Audio revisions. -->
<!-- agent-summary: Every revision uses immutable graph assets, pinned inputs, selections, and auditable actions. -->
<!-- agent-summary: Kind-specific executors replace fixed-stage restart without duplicating provider logic. -->
<!-- agent-summary: Work starts immediately; no OODA, production-user, or live-provider gate blocks the first PR. -->
<!-- agent-summary: The cutover deletes restart-from-stage, the flat-root fallback, and obsolete compatibility UI. -->
<!-- agent-summary: Completion requires graph-focused tests, Request Changes E2E, migration validation, and a controlled smoke. -->

> **Status:** Accepted implementation scope. Start with PR 1 immediately.
> This document supersedes the incomplete sequencing in
> [`graph-rerun-decisioning-prs.md`](graph-rerun-decisioning-prs.md) and
> [`regeneration-coverage-prs.md`](regeneration-coverage-prs.md). Those documents
> remain as historical design detail only.

## 1. Outcome

Complete the move from coarse generation-stage restarts to one agent-owned,
graph-aware revision path for every production object:

```text
Request Changes
  -> resolve stable targets and load fresh graph context
  -> Creative Director proposes the smallest coherent revision
  -> creator approves when cost or fan-out requires it
  -> Visuals, Audio, and/or root tools execute bounded assignments
  -> immutable assets are added and authorized selections move by CAS
  -> the Creative Director reconciles, critiques, and completes
```

After cutover:

- the user never chooses a pipeline stage to restart;
- a revision never deletes or mutates an existing creative asset;
- only assets and selections named by an approved, freshly revalidated proposal
  can change;
- Visuals and Audio may run in parallel when their assignments are independent;
- a timeline/cut is a graph composite rebuilt from active selections, not the
  mutable source of truth;
- every decision, provider job, produced asset, and selection change is
  attributable through durable actions and graph edges; and
- no production route can fall back to the old flat all-tools root.

## 2. Current State On `main`

### Shipped and retained

- New full-video roots default to the Creative Director hierarchy.
- The Creative Director, persistent Visuals session, persistent Audio session,
  typed `DomainTask.v1` / `DomainReport.v1`, parallel domain dispatch, and fresh
  graph projections are active.
- `assets`, `asset_edges`, `selections`, and `actions` are the canonical creative
  state. Assets are immutable and carry stable lineage/version identities,
  recorded inputs, content hashes, and input fingerprints.
- `downstream_assets()` and `getStaleCandidates()` expose deterministic
  descendant candidates and their active selection references.
- `POST /api/v1/projects/:projectId/rerun-proposals` persists a
  `rerun_proposal` action with `RerunProposal.v1`, graph pins, a checklist, and
  image-coverage metadata.
- Image regeneration can mint immutable pooled alternatives. Visuals can also
  generate anchors, storyboards, keyframes, clips, standalone images/videos, and
  pinned video edits; Audio can generate and fit audio; the root can assemble and
  critique a cut.
- Object-scoped Request Changes and hierarchical run projections have shipped
  foundation pieces.

### Remaining gaps

1. **The proposal is not an agent decision.** The service deterministically
   selects only the requested image, marks downstream candidates unchanged, and
   always returns `executable: false`.
2. **The decision packet is too narrow.** It lacks the complete bounded upstream,
   sibling, story, selection, prior-action, domain-report, cost, and capability
   context required for semantic blast-radius reasoning.
3. **There is no proposal lifecycle executor.** Approval, rejection, stale-pin
   failure, reservation, dispatch, fan-in, application, and terminal failure are
   not one idempotent state machine.
4. **Regeneration coverage is uneven.** Image alternatives exist, but keyframe,
   clip, audio, storyboard/story, and cut revisions do not share one typed,
   proposal-driven execution contract.
5. **Selection authority is inconsistent.** Some flat-root tools still move
   selections as part of generation. Domain jobs correctly leave alternatives
   pooled, but approved targeted moves need one transactional expected-selection
   contract.
6. **Request Changes is not the only production edit path.** The web still
   exposes restart-from-stage behavior.
7. **The old runtime remains recoverable.** An expiring environment fallback can
   still create flat-root runs, and legacy rows can still resolve the all-tools
   registry.
8. **The completion docs are fragmented.** Older scopes describe already-shipped
   proposal and hierarchy work as missing and explicitly preserve the fallback
   this roadmap must remove.
9. **Request Changes bypasses the proposal.** The current asset-revision route
   writes `board_feedback` as already applied, revives a prior run, and enqueues
   it immediately. The web modal calls that route directly, so no graph closure,
   estimate, approval, or pin protects the change.
10. **Delegation drops graph scope.** The current domain task builder emits a
    project-only target with empty candidate, preservation, fingerprint, and
    selection-pin fields even though `DomainTask.v1` can carry them.
11. **A flat-era shortcut runs before role routing.** Deterministic board-tile
    feedback maps directly to the leaf `regenerate_image_asset` tool before the
    role-owned decision path. That tool is not part of the Creative Director
    registry and must not bypass proposal/delegation.

## 3. Non-Negotiable Design Rules

### 3.1 One writer and one decision owner

All semantic changes enter through the agent system. The Creative Director owns
project-wide intent, blast radius, cross-modality tradeoffs, approval, and
completion. Visuals and Audio execute only typed, bounded domain assignments.
Direct selection among existing assets remains the narrow UI carve-out already
defined by the interaction model, and downstream reconciliation still goes
through the Creative Director when that selection has consumers.

### 3.2 Candidates are evidence, not policy

`downstream_assets()` supplies a deterministic candidate set. It does not decide
the final work. The Creative Director may:

- prune descendants whose semantic inputs are unaffected;
- start upstream at a beat, anchor, script, or story snapshot;
- include siblings that share a character, setting, scene, or audio constraint;
- request clarification when the graph context cannot resolve intent; or
- return `no_op` when the selected state already satisfies the request.

The model may select only server-authorized stable IDs present in its bounded
context. It cannot invent IDs, widen project scope, or name provider settings the
server did not authorize.

### 3.3 Preview is inert; execution is fenced

Creating or revising a proposal cannot mutate story rows, assets, selections,
gates, or jobs. Execution must atomically:

1. claim the approved proposal once;
2. re-read every asset hash/fingerprint and selection sequence pin;
3. fail stale before any billable work;
4. reserve the approved cost ceiling;
5. create bounded domain/root assignments with the approved targets; and
6. record the exact causal action relationships.

Late provider results may add pooled assets but may not move a selection unless
the proposal, active session claim, and expected selection still match.

### 3.4 Generate alternatives, then select

Every revision creates a new immutable asset or relational story snapshot.
Provider work never overwrites an existing asset. The execution result lists:

- created asset IDs;
- preserved asset IDs;
- expected and actual selection changes;
- downstream candidates intentionally left unchanged; and
- any follow-up root reconciliation or cut assembly.

Selection changes are append-only compare-and-swap operations. Failure of one
selection pin must prevent a partially applied multi-selection revision.

### 3.5 Reuse canonical tools

The migration adds orchestration and kind adapters, not duplicate generators.
Executors call the existing Visuals, Audio, story, assembly, critique, edit, and
export tool services. Routes do not implement provider behavior. Kind adapters
normalize target resolution and required inputs; they do not form a second
orchestrator.

### 3.6 No external waiting gates

The PR sequence has internal ordering, but no external dependency blocks work:

- OODA prompt learning is separate and is not required for correct reruns.
- Live providers are not required for merge; deterministic fake providers and
  local storage prove behavior, followed by one explicitly budgeted smoke before
  fallback deletion.
- Historical flat runs are not a reason to preserve flat creation or resumption.
  Terminal history stays readable; nonterminal test history may be canceled or
  superseded by a new hierarchy root during cutover.
- The product has no production-user migration requirement. Do not add dual
  writes, indefinite feature flags, or compatibility tables.

## 4. Target Contracts

### 4.1 `RerunProposal.v2`

Replace the intentionally non-executable `RerunProposal.v1` with a complete
server-owned contract:

```ts
interface RerunProposalBaseV2 {
  schemaVersion: "RerunProposal.v2";
  projectId: string;
  rootRunId: string;
  source: "request_changes" | "autonomous_review";
  userIntent: string;
  targets: RerunTarget[];
  inspectedAssetIds: string[];
  candidateAffectedAssetIds: string[];
  preservedAssetIds: string[];
  checklist: RerunChecklistItem[];
  pins: {
    assets: AssetFingerprintPin[];
    selections: SelectionSequencePin[];
    storySnapshots: StorySnapshotPin[];
  };
  estimate: {
    costUsd: number;
    maxCostUsd: number;
    latencyClass: "interactive" | "media";
  };
  risk: "low" | "medium" | "high";
  requiresApproval: boolean;
  rationale: string;
  userFacingSummary: string;
}

type RerunProposalV2 =
  | (RerunProposalBaseV2 & {
      outcome: "no_op";
      selectedWork: [];
      plannedSelectionMoves: [];
      plannedStoryPointerMoves: [];
      requiresApproval: false;
      clarification?: never;
    })
  | (RerunProposalBaseV2 & {
      outcome: "ask_clarification";
      selectedWork: [];
      plannedSelectionMoves: [];
      plannedStoryPointerMoves: [];
      requiresApproval: false;
      clarification: {
        question: string;
        targets: RerunTarget[];
        options: Array<{
          id: string;
          label: string;
          tradeoff: string;
        }>;
        answerFingerprint: string;
      };
    })
  | (RerunProposalBaseV2 & {
      outcome: "revision";
      selectedWork: [RerunWorkItem, ...RerunWorkItem[]];
      plannedSelectionMoves: PlannedSelectionMove[];
      plannedStoryPointerMoves: PlannedStoryPointerMove[];
      requiresApproval: boolean;
      clarification?: never;
    });
```

The action ID is the proposal envelope identity and is returned separately as
`{ actionId, proposal }`; it is not copied into immutable proposal JSON.
Reuse the canonical `DomainTarget` union and add the two graph locations it does
not currently express:

```ts
type RerunTarget =
  | DomainTarget
  | {
      kind: "selection";
      projectId: string;
      slotOwnerLineageId: string | null;
      slotRole: string;
    }
  | {
      kind: "transcript_segment";
      projectId: string;
      transcriptSegmentId: string;
    };

interface AssetFingerprintPin {
  assetId: string;
  contentHash: string | null;
  inputsFingerprint: string | null;
}

interface SelectionSequencePin {
  slotOwnerLineageId: string | null;
  slotRole: string;
  expectedActiveAssetId: string | null;
  expectedSeq: number;
}

interface StorySnapshotPin {
  rowKind: "story_blueprint" | "story_scene" | "story_beat";
  rowId: string;
  expectedSnapshotAssetId: string | null;
}

interface RerunChecklistItem {
  target: RerunTarget;
  decision: "change" | "preserve" | "clarify";
  reason: string;
}
```

Each work item has a stable proposal-local ID and explicit required-output
bindings, so two clips or audio segments with the same kind/role cannot be
confused:

```ts
interface BoundRequiredOutput {
  bindingId: string;
  workItemId: string;
  target: RerunTarget;
  kind: string;
  role: string;
  ordinal: number;
}

type RerunWorkItem =
  | {
      workItemId: string;
      owner: "creative_director";
      kind: "revise_story" | "reassemble_cut" | "critique_cut";
      targets: RerunTarget[];
      requiredOutputs: BoundRequiredOutput[];
    }
  | {
      workItemId: string;
      owner: "visuals";
      kind: "revise_visuals";
      targets: RerunTarget[];
      requiredOutputs: BoundRequiredOutput[];
    }
  | {
      workItemId: string;
      owner: "audio";
      kind: "revise_audio";
      targets: RerunTarget[];
      requiredOutputs: BoundRequiredOutput[];
    };
```

PR 2 extends `DomainRequiredOutput` and `DomainReport` output entries with the
server-issued `bindingId`, `workItemId`, target, and ordinal. A report cannot
claim a binding outside its task. `PlannedSelectionMove` and
`PlannedStoryPointerMove` are server-derived and reference those bindings:

```ts
interface PlannedSelectionMove {
  bindingId: string;
  slotOwnerLineageId: string | null;
  slotRole: string;
  expectedActiveAssetId: string | null;
  expectedSeq: number;
}

interface PlannedStoryPointerMove {
  bindingId: string;
  rowKind: "story_blueprint" | "story_scene" | "story_beat";
  rowId: string;
  expectedSnapshotAssetId: string | null;
}
```

For an absent selection slot, the pin uses
`expectedActiveAssetId: null, expectedSeq: 0`; the final transaction succeeds
only if no current selection exists. Existing slots require exact active ID and
sequence equality. A draft story row with no current snapshot uses
`expectedSnapshotAssetId: null`; its pointer move succeeds only while that
column remains null.

These names map to the live canonical relational spine:
`story_blueprints.asset_id`, `story_blueprint_scenes.scene_asset_id`, and
`story_beats.beat_asset_id`. `story_panels` has image/prompt references and
selection state, but no semantic snapshot pointer, so panel media changes use
asset/selection bindings rather than a `PlannedStoryPointerMove`.

The model proposes selected work, target IDs, rationale, preservation choices,
and bounded clarification content. The server validates the ID/capability
allowlist and derives selection moves, cost/max cost, risk, approval policy,
and the clarification `answerFingerprint`; model output is never authority for
those policy fields. The fingerprint is a canonical digest of the normalized
question, targets, options, and all asset, selection, and story freshness pins.
Domain agents retain latitude to select their allowed primitive tools inside
the approved boundary.

### 4.2 Proposal lifecycle

Use the existing global `action_status` values; do not widen that enum for this
feature:

```text
proposed -> approved -> running -> applied
                              \-> failed
proposed -> rejected
```

Claim/lease ownership lives in a separate token-fenced execution reservation,
not in action status. A stale pin is `failed` with a typed `stale_proposal`
error. Allowed transitions are database-enforced and idempotent. A revised
proposal is a new action whose params name the prior proposal action; decision
JSON is never updated in place. `applied` requires a terminal root
reconciliation record, not merely a successful provider job.

Deterministic terminal policy:

- `no_op` is persisted and immediately marked `applied` without approval or
  provider execution.
- `ask_clarification` remains `proposed` and creates one bounded creator-facing
  question with explicit options and an `answerFingerprint`. The submitted
  answer must match that fingerprint and creates a new proposal linked to the
  old action; it never mutates the original proposal.
- Every `request_changes` proposal with selected mutation work requires explicit
  approval.
- An `autonomous_review` proposal may auto-run only when it is low risk,
  zero-provider-cost, single-domain, and moves at most one selection. Any
  provider cost, story mutation, cross-domain work, or multiple selection moves
  requires approval.
- The server computes these outcomes after validating selected work and cost; a
  model cannot lower risk or bypass approval.

### 4.3 Execution result

Persist one separate terminal action with `tool: "rerun_execution"` after
fan-in. Its immutable params carry `RerunExecution.v1` and the originating
proposal action ID; its input/output assets and `action_assets` links preserve
the detailed lineage. The proposal action changes lifecycle fields only.

```ts
interface RerunExecutionV1 {
  schemaVersion: "RerunExecution.v1";
  proposalActionId: string;
  outcome: "applied" | "failed";
  childRunIds: string[];
  outputAssetIds: string[];
  movedSelections: SelectionMove[];
  preservedAssetIds: string[];
  failedWorkItems: FailedWorkItem[];
  actualCostUsd: number;
  reconciliationActionId?: string;
}
```

Primitive provenance continues to live on ordinary actions and
`action_assets`; this summary points to those durable records rather than
copying provider responses.

Domain/root tools running under a proposal may create pooled outputs but may not
move production selections. Domain reports bind validated output asset IDs and
intrinsic roles to `plannedSelectionMoves`. One coordinator transaction applies
all moves only after every required work item succeeds and the pins still match.
The terminal `rerun_execution` action is created for both success and failure;
its own status is `applied` or `failed`, and `reconciliationActionId` is present
only when reconciliation ran. On partial failure, successful outputs remain
pooled and auditable, the proposal becomes `failed` with per-item results, and
no planned selection or story-pointer moves apply. A retry uses the same fenced
execution when safe or creates a refreshed proposal when pins/context changed;
it never launches a second unfenced execution.

Assembly, critique, and dependent media consume the proposal’s bound prospective
output asset IDs and staged story snapshot IDs explicitly, not only
`current_selections` or currently pointed story rows. They create pooled outputs
against those prospective inputs. One final transaction applies every child,
cut, and story-pointer move after required generation, assembly, and critique
succeed. No relational story pointer or production selection moves early.

### 4.4 Kind ownership

| Target or output | Decision owner | Executor | Selection/application rule |
| --- | --- | --- | --- |
| Brief, blueprint, script, shot/beat semantics | Creative Director | Existing root story tools | Mint relational snapshot assets; never mutate semantic history |
| Anchor, storyboard image, keyframe, generic image | Creative Director | Visuals | Pool new version; move only proposal-named slots |
| Clip, generic video, content-aware edit | Creative Director | Visuals | Pool new clip with input edges; move only proposal-named clip slots |
| Voiceover, dialogue, soundtrack, fit | Creative Director | Audio | Pool typed audio asset/segment; move only proposal-named audio slots |
| Cut/composite | Creative Director | Root assembly | Build from prospective bound child outputs; activate only in the final transaction |
| Critique/export | Creative Director | Root critique/export | Critique may create follow-up proposal; export never silently regenerates |

## 5. Implementation Plan

Every PR below is mergeable on its own. PR 0 and PR 1 start in parallel now.
PRs 3A, 3B, and 3C can proceed in parallel after PR 2 because they own distinct
kind adapters and test fixtures. No PR is hidden behind a future product
decision.

### PR 0 — Lock every root and revision to the hierarchy

This safety cleanup is independent of selective-regeneration execution and
starts immediately beside PR 1.

**Deliver:**

- Remove the environment-controlled ability to create new flat roots.
- Make ordinary, anonymous, resumed, and revision entry paths create or reuse
  only `creative_director` roots.
- Never revive a historical null/flat root for Request Changes. Create a fresh
  hierarchy root when follow-up work is needed. Canonical graph state supplies
  project history; the new proposal action names only that new root and does not
  invent a cross-root follow-up relation.
- Mark nonterminal flat/null test-history runs canceled or superseded; keep
  terminal history readable. Do this with an additive, replay-tested migration,
  not an operator script.
- Preserve the profile column temporarily only as historical evidence until the
  final schema cleanup.
- Make retry-after-credit, gate approve/reject continuation, board revision,
  recovery-worker resume, and explicit run resume refuse flat/null roots. Where
  continuing creator intent is valid, terminalize the old run and create a new
  hierarchy root; never mutate the old run’s immutable profile.

**Acceptance tests:**

- Every root creation helper persists `creative_director`.
- Request Changes against a project whose last run is flat creates a new
  hierarchy root instead of reopening it.
- Retry-after-credit, approve/reject, board revision, recovery, and explicit
  resume cannot execute a flat/null root.
- No environment variable changes root ownership.
- Existing domain and creator-direct session serialization remains unchanged.

### PR 1 — Complete the decision packet and model-backed proposal

**Replace:** the deterministic, image-only selection in
`rerun-proposal-service.ts`.

**Deliver:**

- Add `RerunProposal.v2` and strict structured-output validation.
- Resolve one or more stable targets from asset, scene, beat, panel, selection,
  timeline-item, or audio-segment IDs.
- Build a bounded context containing:
  - target summaries and active selection references;
  - upstream inputs and edge relations;
  - downstream stale candidates with depth;
  - same-lineage versions and shared anchor/story/scene siblings;
  - relevant relational story rows and snapshot IDs;
  - recent causal actions and terminal domain reports;
  - available root/domain outcome capabilities;
  - current spend, budget, and server-derived estimates; and
  - asset, selection, and story snapshot pins.
- Add a Creative Director decision adapter that returns `no_op`,
  `ask_clarification`, or typed work items.
- Add the v2 proposal/decision endpoint and services beside the live revision
  path. Existing asset-revision and board-feedback routes, response shapes, web
  callers, immediate enqueueing, and run polling remain unchanged until PR 6
  ships the usable lifecycle UI and performs the atomic route cutover.
- Reject invented, cross-project, disallowed-kind, or unpinned targets.
- Persist proposals as immutable `rerun_proposal` actions.
- Remove the image-only `executable`/`unavailableKinds` placeholder semantics.
- Specify the deterministic board-feedback-to-leaf-tool shortcut as PR 6
  deletion work. It stays live with the compatibility route until every caller
  moves to Creative Director proposals.

**Acceptance tests:**

- “Brighten this shot” selects its keyframe/clip path but preserves unrelated
  beats and the character anchor.
- “Make this character older” may select the shared anchor and all affected
  active descendants.
- “Shorten the narration” selects Audio plus cut reassembly, not Visuals.
- A mixed pacing request selects parallel Visuals/Audio work plus root assembly.
- Insufficient context produces a bounded clarification, not a stage restart.
- Invalid model output cannot invent IDs or bypass approval.
- Proposal creation performs zero provider calls and zero selection writes.
- The explicit v2 preview API is inert, while current Request Changes HTTP
  responses and UI polling behavior remain unchanged.
- Parser tests reject `no_op` with work, clarification without a question,
  revision with no work, and model-authored policy fields including the answer
  fingerprint; server tests prove every clarification/pin change alters the
  derived fingerprint.
- Cross-workspace/project targets, unrelated root IDs, and flat/null roots fail
  closed before the service-role action write.
- Project-scoped Request Changes server-selects or creates its hierarchy root.
  A run-scoped board request may use only the path-authorized hierarchy run.

### PR 2 — Durable proposal lifecycle and executor interfaces

**Deliver:**

- Add approve, reject, refresh, and execute endpoints around one shared service.
- Database-enforce lifecycle transitions and immutable decision fields.
- Revalidate all pins and budget before enqueueing any billable child work.
- Reserve a proposal execution idempotency key and approved maximum cost.
- Define the kind-executor registry, output-binding contract, and coordinator
  state machine. Land deterministic fake executors for lifecycle tests.
- Extend `DomainRequiredOutput` and domain-report outputs with the exact
  server-issued work-item/output binding identity.
- Keep every real work item non-executable until PR 5 activates its tested
  adapter together with atomic application; approval cannot silently fall back
  to stage restart.
- Extend delegation inputs and server derivation to carry exact stable targets,
  candidate affected IDs, preserved assets/selections/fingerprints, proposal
  causation, approval identity, and cost ceiling into `DomainTask.v1`.
- Link proposal -> delegation actions -> child runs -> primitive actions ->
  output assets using existing durable identities and `action_assets`.
- Make cancellation, worker retry, duplicate approval, and duplicate provider
  callback safe.

**Acceptance tests:**

- Ten concurrent execute requests against a fake-supported plan create one
  execution reservation and one fake dispatch.
- A changed asset fingerprint or selection sequence returns `stale` before
  provider execution.
- Real kinds return `coverage_unavailable` before approval, reservation, or
  spend until PR 5 activates the complete path.
- Changed-input idempotency-key reuse is rejected.
- Root-run/project and target/project/workspace mismatches fail closed.
- Actors cannot approve, reject, refresh, or execute another workspace’s
  proposal.
- Clarification answer and refresh preserve causation by action ID.

### PR 3A — Visual still, storyboard, and keyframe coverage

**Deliver:**

- Add kind adapters for generic images, posters, character/scene anchors,
  storyboard panels/tiles, and beat keyframes.
- Implement and test these adapters behind PR 2’s executor interface, but do not
  register them in the production executor registry before PR 5.
- Resolve-or-generate from proposal targets while preserving unselected and
  uploaded assets.
- Mint immutable versions with complete beat/anchor/story input edges.
- Support semantic storyboard/beat changes through new relational snapshots
  before dependent media work.
- Keep new snapshots staged and pooled; do not repoint stable relational rows
  until PR 5’s final atomic application.
- Leave outputs pooled until PR 5’s final atomic application applies them.

**Acceptance tests:**

- One keyframe revision leaves every other beat selection unchanged.
- Anchor revision regenerates only proposal-selected dependent frames.
- A storyboard semantic edit creates a new snapshot and never mutates the old
  row’s semantic history.
- Minor likeness routing, provider normalization, storage, cost, and embedding
  behavior continue through canonical tool services.
- No production route can dispatch these adapters or incur provider spend before
  PR 5.

### PR 3B — Visual clip and video-edit coverage

**Deliver:**

- Add kind adapters for beat clips, generic video, and pinned content-aware
  video edits.
- Implement and test these adapters behind PR 2’s executor interface, but do not
  register them in the production executor registry before PR 5.
- Load the approved beat, keyframe, anchor, duration, aspect, and source pins.
- Mint `generated_from` or `edited_from` edges without overwriting source clips.
- Fence long-running provider callbacks with the proposal/session claim.

**Acceptance tests:**

- Revising clip 3 does not regenerate or repoint clips 1, 2, or 4.
- A source/keyframe change before callback prevents the late clip from becoming
  active.
- Video edits preserve the original and affect only explicitly named slots.
- Provider retries do not duplicate billable jobs or output selection moves.
- No production route can dispatch these adapters or incur provider spend before
  PR 5.

### PR 3C — Audio and picture-fit coverage

**Deliver:**

- Add kind adapters for per-beat voice/dialogue, narration, soundtrack, sound
  effects, and fit-to-picture outputs.
- Implement and test these adapters behind PR 2’s executor interface, but do not
  register them in the production executor registry before PR 5.
- Preserve typed segment/story/script inputs and timing edges.
- Allow Audio-only work to run without waking Visuals.
- Return cross-domain timing or story preconditions to the Creative Director,
  which may revise the plan rather than broadening Audio’s authority.

**Acceptance tests:**

- A voiceover revision touches one approved segment and the derived fit/cut
  only.
- A soundtrack change preserves all visual selections.
- Multi-scene fixtures prove targeted audio never consumes unrelated script
  scenes.
- Missing picture duration returns a typed root-owned prerequisite without
  repeated blind retries.
- No production route can dispatch these adapters or incur provider spend before
  PR 5.

### PR 4 — Root story, assembly, critique, and reconciliation

**Deliver:**

- Execute root-owned story/plan/beat revisions through relational snapshots and
  graph edges.
- Preserve stable relational scene/beat/panel row IDs. A semantic update stages
  a new immutable snapshot asset; PR 5 later points the row to it atomically
  with the approved selection moves, and the prior snapshot preserves history.
- Implement and test root story, assembly, and critique adapters behind PR 2’s
  executor interface, but do not register them in production before PR 5.
- Reassemble a cut only when approved child selections or story timing changed.
- Assemble and critique from prospective bound child/snapshot IDs while they
  remain pooled; do not require early active-selection or story-pointer moves.
- Run whole-cut critique after fan-in when acceptance criteria require it.
- Let critique produce a new proposal, never an unapproved recursive provider
  loop.
- Define completion when approved work, selection application, assembly, and
  required critique all reach terminal durable states.

**Acceptance tests:**

- A story-only wording change with no media effect can end as `no_op` for media.
- A duration change updates only affected audio/clip timing and the composite.
- Reassembly creates a new cut and preserves the prior cut.
- Critique failure is visible and retryable without replaying completed media.
- No production route can dispatch these adapters before PR 5.

### PR 5 — Activate fan-out, atomic application, and reconciliation

**Deliver:**

- Register the tested PR 3/4 adapters in production only in this PR, in the same
  deploy that enables their final atomic application.
- Dispatch registered typed Visuals/Audio assignments, including atomic parallel
  dispatch for mixed-domain plans, and park the root on durable fan-in.
- Validate every child output kind, target, intrinsic role, proposal causation,
  and active session claim before accepting it for an output binding.
- Apply all planned selection changes in one transaction by expected active
  asset, sequence, proposal reservation, and current agent-session claim.
- Apply all planned stable story-row snapshot pointers in that same final
  transaction.
- Persist the terminal `rerun_execution` action only after required root
  reconciliation.
- Settle actual cost against the reservation and root budget.
- Keep completed child outputs pooled on cancellation or partial failure without
  applying any selection move.

**Acceptance tests:**

- Mixed Visuals/Audio work overlaps, fans in once, applies all moves atomically,
  and assembles one new cut.
- A stale late child output remains pooled but cannot move a selection.
- Cancellation after one child output leaves every production selection
  unchanged.
- Mixed-domain failure cannot leave half of a multi-selection plan applied.
- Child outputs with the wrong kind, role, target, or causation are rejected.
- Root-versus-creator-direct contention in the same domain serializes without
  origin leakage.
- Reserved and actual spend cannot exceed the approved maximum or root budget.
- Worker death and resume finish or fail the same lifecycle exactly once.

### PR 6 — Make Request Changes the only production revision path

This is UI work and must follow the Impeccable skill, product/design docs, and
browser validation requirements.

**Deliver:**

- Route asset, storyboard, audio, timeline, and project-level Request Changes
  through `RerunProposal.v2`.
- Atomically switch every existing revision/board-feedback caller from the
  immediate-enqueue compatibility route to the proposal lifecycle, then remove
  the old mutation behavior and deterministic leaf-tool shortcut.
- Show the agent’s checklist, preserved objects, affected objects, estimated
  maximum cost, risk, and domain assignments before approval.
- Support clarification, revise-proposal, approve, reject, stale-refresh,
  executing, partial-failure, and applied states.
- Project child-agent work and fan-in without exposing private reasoning.
- Remove user-facing restart-stage controls and stage-selection language.
- Invalidate/update TanStack Query keys after proposal lifecycle mutations.

**Acceptance tests:**

- Desktop and mobile E2E cover visual-only, audio-only, mixed, clarification,
  stale proposal, rejection, retry, and successful application.
- Expensive work cannot start before explicit confirmation.
- A merely proposed action never produces the old “Sent”/“revising” success
  state; UI status comes from the actual proposal lifecycle.
- The UI may submit the visible object’s stable reference. The server resolves
  and authorizes it; clients cannot submit graph closure, selected work, costs,
  provider/tool calls, or approval policy.
- Keyboard, focus, live-status, and error recovery behavior meet the design and
  accessibility contracts.

### PR 7 — Forward cutover and delete the old paths

**Deliver:**

- Delete `POST .../generation-runs/:runId/restart-from`, its route helpers,
  stage-clearing selection logic, API client method, web controls, and tests that
  encode stage restart as supported behavior.
- Delete any revision-route compatibility helpers left after PR 6’s atomic
  caller cutover.
- Delete the now-unused flat profile resolver, schema variants, and historical
  health metadata left after PR 0.
- Stop resolving null/`flat` root profiles to the all-tools registry.
- Replace the `createOwnedToolRegistry(createDefaultToolRegistry(...))` filtering
  pattern with canonical primitive definitions and role-owned builders that
  never construct an all-tools registry. Remove the constructible flat registry
  from production and tests.
- Delete the flat `ORCHESTRATOR_SYSTEM_PROMPT`, deterministic board-feedback
  router, and any verified-unused `POPCORN_ORCHESTRATOR_TOOL_LOOP` / `driver.ts`
  compatibility path after role-specific routing owns all callers.
- Migrate nonterminal historical/test flat roots to `canceled` or `superseded`;
  keep terminal rows readable as history but never resumable.
- Drop `root_execution_profile` and its shared TypeScript type after all
  nonterminal flat/null rows are terminalized. Terminal run/action history
  remains readable without routing metadata.
- Delete obsolete stage-order UI projections that exist only to drive restart.
- Update North Star, interaction, run-projection, testing inventory, operations,
  and rollout docs to describe the single remaining path.

**Cutover checks:**

- Repository search finds no production call to restart-from-stage.
- Repository search finds no flat-root creation, resumption, flag, or all-tools
  production registry path.
- New, resumed, Request Changes, anonymous, and creator-direct flows all use the
  hierarchy and graph contracts.
- The deleted restart endpoint returns `404` and no web client references it.
- Registry invariants prove the root exposes zero leaf media tools and every
  primitive has exactly one owner.
- A controlled provider-neutral full-video smoke and a budget-approved targeted
  media smoke pass before deletion deploys.
- Rollback is a forward deploy of the last hierarchy/graph-compatible
  application version. The pre-drop deploy must already ignore
  `root_execution_profile`; never redeploy code that expects a removed column.

## 6. Verification Matrix

### Unit and contract

- Proposal schema parsing, bounded IDs, capability ownership, approval policy,
  estimates, and lifecycle transitions.
- Every kind adapter’s preconditions, graph inputs, outputs, and preserved IDs.
- Selection compare-and-swap and asset/story fingerprint pins.

### Database and authorization

- Full migration-chain replay plus RLS for proposals, actions, child runs,
  assets, and selections.
- Cross-workspace/project targets fail closed.
- Immutability, no-delete guards, action lifecycle guards, and exactly-once
  claims hold under concurrency.

### API integration

- Proposal -> approval -> parallel dispatch -> domain reports -> selection
  apply -> assembly -> critique -> applied.
- Stale, cancellation, timeout, partial domain failure, worker recovery, budget
  exhaustion, and duplicate-request paths.
- At least two scenes, repeated anchors, reused assets, uploaded assets, and
  multiple audio segments in fixtures.

### Decision evaluations

Maintain a required scenario set for:

- local visual change;
- shared character/setting change;
- audio-only change;
- pacing/cross-modality change;
- upstream story change;
- no-op;
- clarification;
- stale proposal;
- insufficient budget; and
- preservation of explicitly pinned assets.

The pass condition is observable correctness: selected work contains every
necessary object, excludes unrelated objects, respects ownership, and never
finishes prematurely. Do not score only tool-name selection.

### Browser

- Run the real web/API path at desktop and mobile widths.
- Mock providers for the complete state matrix.
- Run one explicitly approved provider-backed targeted revision before final
  cutover; preserve its project/run/action evidence.
- Update `docs/testing/e2e-test-inventory-and-gaps.md`.

### Required commands per implementation PR

Each PR runs the narrow package tests plus the affected path. Before handoff:

```sh
pnpm agent:lint:fix
pnpm db:migrations:validate
pnpm --filter @popcorn/api typecheck
pnpm --filter @popcorn/web typecheck
pnpm agent:validate -- --scope all
```

Provider-backed commands require explicit budget approval; their absence does
not block earlier mergeable implementation slices using deterministic fakes.

## 7. Cutover Definition Of Done

The migration is complete only when all statements are true:

- Every new or resumed full-video root uses the Creative Director hierarchy.
- Every production change request creates a graph-scoped Creative Director
  proposal or a bounded clarification.
- Visual, audio, story, and cut revisions all have immutable, typed execution
  coverage.
- Approved execution revalidates pins, reserves cost, dispatches exactly once,
  and applies selection changes transactionally.
- Unaffected assets and selections remain byte-for-byte and pointer-for-pointer
  unchanged in integration fixtures.
- The final cut is assembled from active graph selections and linked to its
  child inputs.
- The stage-restart endpoint/UI and flat-root fallback no longer exist.
- Historical flat runs cannot be resumed.
- The E2E inventory, North Star status, operational docs, and source scopes agree
  with the shipped single path.

## 8. Explicit Non-Goals

- Do not block this cutover on feedback learning or self-modifying prompts.
- Do not build one generic provider endpoint that accepts arbitrary asset kinds.
- Do not let clients submit raw tool calls, provider settings, graph closure, or
  approval policy.
- Do not mutate existing assets, semantic story snapshots, or action decisions.
- Do not auto-cascade every deterministic descendant.
- Do not preserve restart-from-stage or flat-root behavior as undocumented
  emergency compatibility.
- Do not add another agent level below Visuals or Audio.
- Do not copy project state into tasks, reports, or proposal JSON when stable IDs
  and canonical relational/graph reads already own it.

## 9. Ownership And Immediate Start

The migration has one product owner: Creative Systems. Suggested implementation
ownership minimizes merge conflicts:

| Lane | Files/boundary | Starts |
| --- | --- | --- |
| Hierarchy lock | root creation/resume/revision profile enforcement | Immediately |
| Decision | shared proposal contract, graph context, Creative Director adapter/evals | Immediately |
| Coordinator foundation | proposal lifecycle, DB transitions, executor interfaces/fakes | After PR 1 contract lands |
| Visual still | image/storyboard/keyframe adapters | After PR 2 execution interface lands |
| Visual motion | clip/video-edit adapters | After PR 2 execution interface lands |
| Audio | audio/fit adapters | After PR 2 execution interface lands |
| Root reconciliation | story/assembly/critique completion | After kind result contract lands |
| Production activation | adapter registration, dispatch/fan-in, atomic pointer/selection CAS | After PR 3/4 adapters are tested |
| Web | Request Changes proposal lifecycle | Against mock PR 1/2 contracts, in parallel |
| Cutover | deletion, operations, inventory, final smoke | After all coverage lanes are green |

PR 0 and PR 1 have no unresolved design question or external prerequisite.
Begin both implementation lanes from this document.
