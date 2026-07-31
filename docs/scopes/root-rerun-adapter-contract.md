# Root selective-regeneration adapter contract

<!-- agent-summary: This document owns the activated root rerun adapter boundary. -->
<!-- agent-summary: Root story outputs stage immutable snapshots for exact stable relational rows. -->
<!-- agent-summary: Assembly and critique consume approved prospective bindings before activation. -->
<!-- agent-summary: No adapter in this slice moves a selection or relational story pointer. -->
<!-- agent-summary: Critique may create inert successor metadata but never uses it as output causation. -->
<!-- agent-summary: Fenced work completion alone applies the shared rerun dispatch action. -->
<!-- agent-summary: Safe root retries retain one fenced reservation and reuse one idempotent durable result. -->

> **Status:** Implemented and activated through the production rerun registry.

## Boundary

`createRootRerunExecutors()` returns three capability-granular adapters:

| Executor | Work/output | Durable input |
| --- | --- | --- |
| `root-story-snapshot.v1` | `revise_story` / `story_snapshot` | one exact story pointer move and its matching freshness pin |
| `root-prospective-assembly.v1` | `reassemble_cut` / `composite` | every approved prerequisite binding plus explicitly preserved pinned assets |
| `root-prospective-critique.v1` | `critique_cut` / `critique` | the approved prospective composite, or an exactly pinned existing cut |

The adapters accept canonical services through
`RootRerunExecutorServices`. This is deliberate: PR 4 proves authorization,
binding, cost, replay, and fan-in semantics without registering a second copy
of the existing story, assembly, or critique implementations. PR 5 supplies
the reviewed service wiring when it activates the adapters.

## Story snapshots

A story binding must own exactly one `PlannedStoryPointerMove`, and that move
must match both the stable target and a `StorySnapshotPin`:

- project target → `story_blueprints.asset_id`;
- storyboard compatibility target → the same blueprint row's pinned plan
  pointer;
- scene target → `story_blueprint_scenes.scene_asset_id`;
- beat target → `story_beats.beat_asset_id`.

Each `revise_story` work item owns exactly one target and one matching
`story_snapshot` output. A revision that changes multiple story rows expresses
them as separate work items so registry preflight, execution, and pointer
application agree on cardinality. Crafted aggregate work fails coverage before
approval, while the executor retains the same check as a direct-call backstop.

The service receives this row kind, stable row ID, predecessor asset ID, and
idempotency key. It stages the new asset without changing the relational row.
Stored graph kinds are target-aware: whole story uses `story_blueprint`,
storyboard/scene snapshots use `plan`, and beat snapshots use `beat`. PR 5
later performs the row-pointer compare-and-swap together with selection moves.

## Prospective fan-in

Assembly never reads a newly generated child through an active selection. It
resolves completed durable bindings, rejects unknown or changed binding
metadata, requires every approved prerequisite, and passes their pooled asset
IDs to the canonical assembly service. Existing assets may participate only
through the proposal's preserved-and-pinned set.

Critique follows the same rule. If the proposal includes reassembly, critique
must consume that prospective composite binding. Otherwise it may inspect only
an explicitly targeted and pinned cut. A missing prerequisite returns a typed
root-owned precondition; PR 5 owns dependency-aware scheduling so this adapter
is not activated before fan-in can satisfy it.

## Cost and follow-up

Deterministic story staging and deterministic assembly reserve and settle an
explicit zero-cost child ledger entry. Critique supplies an approved estimate
and a measured actual cost through its canonical service. A zero-recorded-spend
transient failure retains its approved reservation and parks the work for the
same fenced idempotent retry. If the service durably stages its output but
settlement acknowledgement is ambiguous, the same output and immutable
settlement payload replay. A failure with recorded spend but no durable output
settles that spend and remains terminal; re-running it under the same immutable
reservation could double-charge or conflict. Permanent ledger errors remain
terminal; only connection, serialization, deadlock, and timeout-class settlement
failures are ambiguous enough to park. Once a canonical service returns,
measured spend settles before an estimate overage is surfaced; admission
estimates cannot erase provider cost or strand a reserved child ledger entry.

Critique may persist an inert successor `rerun_proposal` action. Its ID is
stored in the callback's durable provider metadata, while the action remains
proposed. It is deliberately excluded from `primitiveActionIds`: the successor
did not cause the critique output. The adapter cannot approve it, call another
executor, or start a recursive provider loop.

## Dispatch ownership

The root adapters use the existing `rerun_work_item_dispatch` action as their
primitive identity, but they never apply or fail it directly. A canonical
service may attach its pooled output through `action_assets` while the action is
still running. The fenced `completeWork` transaction accepts that exact running
dispatch as causation, validates its settled budget and output binding, marks
the work complete, and only then applies the action atomically.

Proposal-origin domain turns follow the same boundary. Their
`approvalContext.rerunCallback` lets the child terminalize and report without
owning the shared dispatch lifecycle. A database trigger preserves an active
rerun dispatch if generic domain finalization attempts to apply or fail it;
`completeWork` and `failWork` become eligible only after changing the durable
work row to the matching terminal state.

## Activation contract

PR 5 must:

1. wire these adapters to the canonical story, assembly, and critique services;
2. schedule assembly after required child/story bindings and critique after
   assembly;
3. register them only in the deploy that also applies all approved selection
   and story-pointer moves atomically;
4. validate primitive action/output attribution and aggregate already-settled
   measured child costs; and
5. preserve pooled outputs when execution is canceled or fails.
