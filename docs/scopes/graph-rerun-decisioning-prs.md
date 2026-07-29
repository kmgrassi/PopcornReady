# Graph Rerun Decisioning PR Plan

> **Status:** Historical partial scope. The read-only proposal foundation
> described here has shipped, and this document's decision to retain
> `restart-from` is no longer current. Use
> [`full-selective-regeneration-cutover-prs.md`](full-selective-regeneration-cutover-prs.md)
> for all remaining implementation and deletion work.

## Objective

Replace coarse "restart from stage" behavior with graph-aware rerun proposals.
When a user asks for a change, the system should inspect the changed graph node,
compute graph context around that node, and let the agent propose the smallest
useful rerun plan before spending provider dollars. The changed node is the
user's starting point, not a command to rerun only descendants: the agent may
decide the right fix starts upstream, downstream, or across sibling assets that
share a story element or character anchor.

This scope closes gap 1 from
[`north-star-gap-audit.md`](north-star-gap-audit.md): `downstream_assets()` is
available, but `apps/api/src/routes/v1/orchestrator-runs.ts` still resets from
fixed `GENERATION_STAGE_ORDER` boundaries and clears selection slots by stage.

## Current State

Shipped:

- `downstream_assets()` exists in the asset graph migration and is wrapped by
  `getStaleCandidates()` in `apps/api/src/lib/api/v1/store.ts`.
- `GET /api/v1/projects/:projectId/assets/:assetId/stale-candidates` exposes
  changed asset plus downstream candidates and current-selection references.
- Orchestrator runs persist actions, gates, status, budget, and tool results.
- `restart-from` can supersede downstream actions, reset gates, clear active
  selections, and resume the run.

Missing:

- No API accepts a semantic change target and produces a rerun proposal.
- No model turn receives stale candidates, upstream inputs, related active
  selections, recent actions, user intent, and budget/cost context as one
  rerun-decision payload.
- No persisted action represents "proposed rerun plan; awaiting execution."
- No executor translates a proposal into targeted tool calls. The only generic
  escape hatch is stage restart.

## Product Behavior

For a user-visible edit such as "make beat 3 brighter":

1. Resolve the edit target to exactly one graph asset in PR 1. Storyboard rows
   resolve through their `*_asset_id` snapshot; if the UI cannot identify a
   backing asset, the API returns `ask_clarification` rather than guessing.
   Multi-target edits are a later contract extension.
2. Compute stale candidates with `getStaleCandidates()` for the changed asset.
3. Build a proposal context: changed asset, downstream candidates, direct input
   assets, related active selections, recent run actions, user note, budget, and
   cheap cost estimates.
4. Ask the agent for a rerun plan, or return a deterministic placeholder while
   the LLM decision is behind a flag.
5. Persist the proposal as an `actions` row with no output assets yet.
6. Show the proposal in the UI: target assets, expected stages/tools, rough cost,
   and whether it falls back to a stage restart.
7. Execute only after explicit user approval when the plan is expensive,
   fan-out-heavy, or generated from a manual edit surface.

Approval is required when any of these are true:

- `estimatedCostUsd` is greater than `0`.
- More than one active selection would be repointed.
- The proposal falls back to `restart_stage`.
- The proposal was requested from a user edit surface rather than from an
  already-autonomous run loop.

The only proposals that may auto-execute in autonomous mode are `no_op` and
single-target `regenerate_candidates` proposals with `estimatedCostUsd` equal to
`0`, `risk: "low"`, and a server-derived source of `"autonomous_run"`.

## Blast-Radius Semantics

`downstream_assets()` is a deterministic stale-candidate primitive, not the full
rerun policy. The proposal service should separate:

- **Target asset:** the graph asset the user pointed at.
- **Downstream candidates:** assets that consume the target directly or
  transitively and may now be stale.
- **Upstream context:** direct input assets, story rows, prompts, anchors, or
  other semantic inputs that explain how the target was produced.
- **Related context:** active selections or assets sharing a lineage, anchor,
  character/story element, slot role, or storyboard scene/beat with the target.
- **Project ID map:** a compact project-wide index of assets, story rows,
  selections, anchors, and notable actions so the agent can notice affected
  objects outside the immediate graph neighborhood.
- **Selected work:** the actual assets/tools the agent proposes to regenerate,
  rewrite, swap, or leave alone.

For example, if the user says "make this character look older" while pointing at
a generated keyframe, the proposal should be allowed to target the character
anchor or likeness prompt first, then regenerate every selected scene/keyframe/
clip that depends on that anchor. Conversely, if the user says "brighten this
shot," the agent may keep the upstream beat and anchor unchanged and regenerate
only the selected image/clip descendants.

PR 1 can return a deterministic downstream-only placeholder because there is no
model decision yet. Starting in PR 2, the model-backed decision must treat the
downstream list as evidence, not a boundary. It may add upstream or related
targets from the supplied context, but it still cannot invent ids outside the
context; if the context is insufficient, it returns `ask_clarification` or
`restart_stage`.

## Agent Decision Payload

The graph query does not decide the rerun. It assembles the packet the agent
needs to decide. Starting in PR 2, the rerun-decision model call should receive a
single structured payload with:

- **User intent:** the original message, the server-derived source
  (`user_edit` or `autonomous_run`), and the UI surface/object the user pointed
  at.
- **Target summary:** id, kind, role, lineage/version, active selection slots,
  content hash/fingerprint, and a compact semantic summary of the target asset.
- **Prompt/story context:** relevant prompt text, storyboard scene/beat/panel
  rows, character/story element labels, and any saved provider prompt or params
  needed to understand what the target represents.
- **Downstream candidates:** ids, kinds, roles, depths, active selection refs,
  and compact summaries for assets that may need regeneration.
- **Upstream inputs:** direct input/anchor/child assets with relation metadata
  and compact summaries, so the agent can decide whether the fix should start at
  a prompt, beat, anchor, or other source asset.
- **Project ID map:** most or all project asset IDs, storyboard scene/beat/panel
  IDs, selection slots, character/story element IDs, anchor IDs, and current
  active asset IDs, each with kind, role/name, short description, and key
  lineage/relationship markers. This is the agent's broad lookup table for
  determining what else might need to change.
- **Focused related context:** expanded detail for same-lineage versions, shared
  anchor/character/story element assets, sibling scene/beat assets, and other
  active selections that could be affected even if they are not descendants of
  the target.
- **Recent decisions:** recent `actions`, tool outputs, failures, approvals, and
  rejections for the run/project, limited to the window needed to understand the
  current state.
- **Execution constraints:** available tools, known fallback stage mapping,
  run budget/spend, cheap cost estimates, approval rules, and context pins for
  fingerprints and selection `seq` values.

IDs alone are not enough. The agent needs enough typed, compact semantic context
to answer: "what did the user mean, what object did they point at, which
upstream facts define it, which downstream/related assets would become
inconsistent, and which tool sequence is the smallest coherent fix?"

If the payload cannot answer that question, the agent must return
`ask_clarification` or `restart_stage`; it should not guess from an incomplete
graph slice. The payload should include broad project identifiers and compact
descriptions, but it should stay bounded by omitting heavy content, raw provider
responses, full media analysis, and long action histories unless the agent asks
for a narrower follow-up context fetch.

## Proposal Review Step

The rerun proposal is the intermediate checkpoint before anything is updated.
It is effectively the agent's checklist of what it believes must change:

- assets, story rows, selections, prompts, anchors, or stages it proposes to
  update;
- assets it inspected but intentionally leaves unchanged;
- why each selected object is in or out of scope;
- expected tools/stages, rough cost, risk, and approval requirement;
- fallback reason if the agent cannot produce a narrower graph-aware plan.

Preview/proposal creation never mutates assets, selections, storyboard rows, or
run gates. The UI should show this checklist before execution for user-initiated
edits, and execution should only operate on IDs listed in the approved proposal.

## Resolved Decisions

- **Ownership:** Persist every proposal as a project-level `actions` row with
  `tool: "rerun_proposal"` and `status: "proposed"`. Set
  `orchestratorRunId` only when the request names an active run; proposals
  remain valid for project edits when no run exists.
- **Immutability:** The proposal action's decision fields are immutable. Approval
  or execution changes only lifecycle fields (`status`, costs, jobs, outputs,
  error), matching the existing `actions` guard.
- **Preview mode:** PR 1 supports only `"preview"`. Preview assembles context and
  persists a proposed action; it never calls provider tools, mutates selections,
  supersedes actions, or resets gates.
- **Input cardinality:** PR 1 accepts one `changedAssetId`. Multi-asset changes
  should be added later as `changedAssetIds` only after the single-asset
  proposal and execution flow is tested.
- **Target resolution:** The API takes graph asset ids, not freeform storyboard
  ids. UI code that starts from a scene/beat/panel must resolve that row to its
  current snapshot asset before calling the endpoint.
- **Cost threshold:** Any non-zero estimated provider spend requires approval.
  Later autonomous policies can raise this threshold after budget enforcement and
  UI confirmation are proven.

## Proposal Contract

Add a typed proposal shape that can be stored in `actions.proposal`.

```ts
type RerunProposalKind =
  | "no_op"
  | "regenerate_candidates"
  | "restart_stage"
  | "ask_clarification";

interface RerunProposal {
  schemaVersion: "rerun_proposal.v1";
  kind: RerunProposalKind;
  targetAssetId: string;
  changedAssetIds: string[];
  inspectedAssetIds: string[];
  candidateAssetIds: string[];
  upstreamAssetIds: string[];
  relatedAssetIds: string[];
  unchangedAssetIds: string[];
  selectedCandidateAssetIds: string[];
  selectedUpstreamAssetIds: string[];
  selectedRelatedAssetIds: string[];
  checklist: Array<{
    id: string;
    objectType: "asset" | "storyboard_row" | "selection" | "stage" | "prompt";
    decision: "update" | "leave_unchanged" | "needs_clarification";
    reason: string;
  }>;
  contextPins: {
    assetFingerprints: Record<string, string>;
    selectionSeqs: Array<{
      slotOwnerLineageId: string | null;
      slotRole: string;
      seq: number;
    }>;
  };
  reason: string;
  userFacingSummary: string;
  estimatedCostUsd?: number;
  risk: "low" | "medium" | "high";
  requiresApproval: boolean;
  approvalReasons: string[];
  execution?: RerunExecutionPlan;
}

type RerunExecutionPlan =
  | {
      type: "tool_calls";
      calls: Array<{
        tool: string;
        targetAssetId?: string;
        targetSelection?: {
          slotOwnerLineageId: string | null;
          slotRole: string;
        };
        input: Record<string, unknown>;
      }>;
    }
  | {
      type: "restart_from_stage";
      stageType: string;
      fallbackReason: string;
    };
```

The proposal should not mutate selections or supersede actions. Execution is a
separate step.

## API Shape

Start with an internal, project-scoped endpoint:

- `POST /api/v1/projects/:projectId/rerun-proposals`

Request:

```json
{
  "changedAssetId": "uuid",
  "message": "Make beat 3 brighter.",
  "runId": "uuid optional",
  "mode": "preview"
}
```

Rules:

- `changedAssetId` must belong to `projectId`; otherwise return `404`.
- `runId`, when provided, must belong to `projectId`; otherwise return `400`.
- `mode` must be `"preview"` in PR 1. Unknown modes return `400`.
- `source` is not accepted from the request body because it affects approval
  policy. The public route always derives `source: "user_edit"` server-side.
  A future autonomous-run caller must use a trusted internal code path or
  server-only route that derives `source: "autonomous_run"` from authenticated
  run context.
- `message` is user intent for the proposal rationale, not direct mutation
  instructions.

Response:

```json
{
  "proposalActionId": "uuid",
  "proposal": { "schemaVersion": "rerun_proposal.v1" },
  "context": {
    "changedAsset": {},
    "projectIdMap": {},
    "candidates": [],
    "upstreamInputs": [],
    "relatedAssets": [],
    "currentSelections": [],
    "recentActions": [],
    "agentPayload": {}
  }
}
```

The persisted action uses:

```json
{
  "tool": "rerun_proposal",
  "status": "proposed",
  "params": {
    "schemaVersion": "rerun_proposal_params.v1",
    "changedAssetId": "uuid",
    "message": "Make beat 3 brighter.",
    "mode": "preview",
    "source": "user_edit"
  },
  "inputAssetIds": ["uuid"],
  "proposal": { "schemaVersion": "rerun_proposal.v1" }
}
```

If a previous identical preview exists, PR 1 may either create another proposal
action or add idempotency later; do not update an existing action in place.

Later:

- `POST /api/v1/projects/:projectId/rerun-proposals/:proposalActionId/execute`
- `POST /api/v1/projects/:projectId/rerun-proposals/:proposalActionId/cancel`

Execution should transition the proposal action from `proposed` to `approved`,
then `running`, then `applied` or `failed`. Cancellation marks it `rejected`.
Those endpoints must reject proposals whose pinned fingerprints or selection
sequence numbers no longer match the preview context, forcing the user/agent to
create a fresh proposal.

## PR Plan

### PR 1 - Read-only Proposal Assembly

Add the `rerun-proposals` route and a service that assembles proposal context
from:

- `getStaleCandidates()`
- the changed asset's direct graph inputs
- `current_selections`
- recent `actions` for the project/run
- the user note and changed asset summary
- a compact project ID map for all project assets/story rows/selections that
  might be useful for blast-radius reasoning
- compact semantic summaries/prompt excerpts for target, candidate, upstream,
  and related assets

Return a deterministic proposal:

- `no_op` when there are no candidates.
- `regenerate_candidates` with all candidates selected when candidates exist,
  `estimatedCostUsd: 0`, and `requiresApproval: false` only when
  the server-derived source is `"autonomous_run"`, there is at most one selected
  candidate, and that candidate has at most one active selection. Public
  user-edit requests therefore require approval even if the client sends a
  forged `source`. Otherwise the same deterministic proposal sets
  `requiresApproval: true` and explains the approval reason.
- `restart_stage` is not returned by the deterministic PR 1 placeholder. It is
  reserved for the model-backed decision path or explicit execution fallback.

No LLM call, no execution, no selection mutation.

Acceptance:

- Unit tests cover no-candidate and candidate payloads.
- The endpoint never calls provider/generation tools.
- The proposal is persisted as an `actions` row with status `proposed`.
- The endpoint rejects cross-project `changedAssetId`/`runId` mismatches.
- The endpoint ignores or rejects any client-provided `source`; approval policy
  uses only the server-derived source.
- The persisted proposal includes approval fields and enough context pins to
  detect stale execution later.
- The persisted proposal includes an explicit checklist of selected and
  intentionally unchanged IDs.
- The response includes upstream input context even though the deterministic
  PR 1 proposal only selects downstream candidates.
- The response includes the structured agent payload PR 2 will pass to the
  model, even though PR 1 does not call the model.

### PR 2 - Agent Decision Behind A Flag

Add a rerun-decision model adapter that receives the assembled context and
returns the `RerunProposal` contract.

Guard it with an env flag such as `POPCORN_RERUN_PROPOSAL_LLM`.

Acceptance:

- Deterministic fallback remains the default.
- Tests verify invalid model output is rejected and falls back safely.
- The model cannot invent asset IDs outside changed/candidate/upstream/related
  context IDs or the project ID map.
- The model cannot mark a proposal approval-free unless it satisfies the
  approval rules above.
- The model response must include a checklist explaining selected updates and
  intentionally unchanged assets.
- Tests cover a user request that points at a generated asset but proposes an
  upstream anchor or prompt change plus dependent downstream regeneration.
- Tests cover insufficient context returning `ask_clarification` instead of
  guessing.

### PR 3 - Proposal UI Surface

Expose rerun proposals in the existing run/detail or asset-feedback UI.

Acceptance:

- User can inspect affected assets and rough cost.
- Expensive or multi-candidate proposals require explicit confirmation.
- Existing `restart-from` controls remain available as a fallback.
- The UI treats proposal actions as read-only until the user approves, cancels,
  or asks the agent for a revised proposal.

### PR 4 - Execution For One Asset Kind

Execute `regenerate_candidates` for image assets first by wrapping the existing
`regenerateImageAsset()` / `regenerate_asset_version` path used by
`POST /api/v1/assets/:assetId/regenerate`.

Scope this to candidate assets whose API asset kind is `"image"` and whose graph
candidate is actively selected. The execution path should call the existing
image regeneration service, let it create the `regenerate_asset` action and new
immutable asset version, then link the new output asset back to the proposal
action lifecycle. Do not add video, audio, composite, or storyboard semantic
execution in this PR.

Acceptance:

- Execution records action input/output assets.
- New versions or new selected assets are created without mutating old assets.
- If execution receives a non-image candidate, it refuses and suggests
  `restart_stage`.
- Execution rechecks pinned fingerprints and selection `seq` values before any
  tool call or selection append.

### PR 5 - Stage Restart Fallback Integration

Allow accepted `restart_stage` proposals to call the existing `restart-from`
logic through a shared service instead of duplicating route code.

Acceptance:

- Existing `restart-from` tests still pass.
- Proposal execution logs why the coarse fallback was used.

## Non-Goals

- Do not remove `restart-from` in this scope.
- Do not add first-class OODA learning tables here.
- Do not create a generic media regenerate endpoint for all kinds.
- Do not auto-execute expensive proposals without an approval path.
- Do not add preview idempotency in PR 1. Repeated previews may create repeated
  `rerun_proposal` actions; a later UI PR can add an explicit idempotency key if
  live typing makes duplicates noisy.
