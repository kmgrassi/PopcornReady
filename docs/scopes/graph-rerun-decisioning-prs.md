# Graph Rerun Decisioning PR Plan

## Objective

Replace coarse "restart from stage" behavior with graph-aware rerun proposals.
When a user asks for a change, the system should inspect the changed graph node,
compute candidate stale descendants, and let the agent propose the smallest
useful rerun plan before spending provider dollars.

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
- No model turn receives stale candidates, active selections, recent actions,
  user intent, and budget/cost context as one rerun-decision payload.
- No persisted action represents "proposed rerun plan; awaiting execution."
- No executor translates a proposal into targeted tool calls. The only generic
  escape hatch is stage restart.

## Product Behavior

For a user-visible edit such as "make beat 3 brighter":

1. Resolve the edit target to one or more changed graph assets or storyboard
   rows.
2. Compute stale candidates with `getStaleCandidates()` for each changed asset.
3. Build a proposal context: changed assets, candidates, active selections,
   recent run actions, user note, budget, and cheap cost estimates.
4. Ask the agent for a rerun plan, or return a deterministic placeholder while
   the LLM decision is behind a flag.
5. Persist the proposal as an `actions` row with no output assets yet.
6. Show the proposal in the UI: target assets, expected stages/tools, rough cost,
   and whether it falls back to a stage restart.
7. Execute only after explicit user approval when the plan is expensive,
   fan-out-heavy, or generated from a manual edit surface.

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
  changedAssetIds: string[];
  candidateAssetIds: string[];
  selectedCandidateAssetIds: string[];
  reason: string;
  userFacingSummary: string;
  estimatedCostUsd?: number;
  risk: "low" | "medium" | "high";
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

Response:

```json
{
  "proposalActionId": "uuid",
  "proposal": { "schemaVersion": "rerun_proposal.v1" },
  "context": {
    "changedAsset": {},
    "candidates": [],
    "currentSelections": [],
    "recentActions": []
  }
}
```

Later:

- `POST /api/v1/projects/:projectId/rerun-proposals/:proposalActionId/execute`
- `POST /api/v1/projects/:projectId/rerun-proposals/:proposalActionId/cancel`

## PR Plan

### PR 1 - Read-only Proposal Assembly

Add the `rerun-proposals` route and a service that assembles proposal context
from:

- `getStaleCandidates()`
- `current_selections`
- recent `actions` for the project/run
- the user note and changed asset summary

Return a deterministic proposal:

- `no_op` when there are no candidates.
- `regenerate_candidates` with all candidates selected when candidates exist.

No LLM call, no execution, no selection mutation.

Acceptance:

- Unit tests cover no-candidate and candidate payloads.
- The endpoint never calls provider/generation tools.
- The proposal is persisted as an `actions` row with status `proposed`.

### PR 2 - Agent Decision Behind A Flag

Add a rerun-decision model adapter that receives the assembled context and
returns the `RerunProposal` contract.

Guard it with an env flag such as `POPCORN_RERUN_PROPOSAL_LLM`.

Acceptance:

- Deterministic fallback remains the default.
- Tests verify invalid model output is rejected and falls back safely.
- The model cannot invent asset IDs outside changed/candidate/context IDs.

### PR 3 - Proposal UI Surface

Expose rerun proposals in the existing run/detail or asset-feedback UI.

Acceptance:

- User can inspect affected assets and rough cost.
- Expensive or multi-candidate proposals require explicit confirmation.
- Existing `restart-from` controls remain available as a fallback.

### PR 4 - Execution For One Asset Kind

Execute `regenerate_candidates` for one kind first, preferably keyframe/image
candidates that already map cleanly to existing generation tooling.

Acceptance:

- Execution records action input/output assets.
- New versions or new selected assets are created without mutating old assets.
- If execution cannot map a candidate to a tool, it refuses and suggests
  `restart_stage`.

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

## Open Questions

- Should proposals be project-level actions or run-level actions when no active
  run exists?
- What cost threshold requires approval in autonomous mode?
- Should `changedAssetId` accept multiple assets in PR 1, or should multi-target
  edits wait for the model-backed proposal?
