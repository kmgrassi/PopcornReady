# Selective-regeneration activation contract

<!-- agent-summary: Production selective regeneration uses the immutable asset graph and durable proposal lifecycle. -->
<!-- agent-summary: The production registry composes Visuals, Audio, video, and root adapter families in one module. -->
<!-- agent-summary: Independent media/story/audio work fans out before assembly and critique run in dependent waves. -->
<!-- agent-summary: Generated outputs stay pooled until one terminal transaction applies every approved graph move. -->
<!-- agent-summary: Selection moves append a CAS-checked head; story moves update only typed snapshot pointers. -->
<!-- agent-summary: Reconciliation, actual cost, terminal action, and graph moves commit or roll back together. -->
<!-- agent-summary: Cancellation, stale state, partial failure, or cost overage applies no graph move. -->

## Production boundary

`rerun-production-registry.ts` is the only production composition point. It
registers the reviewed still, video, Audio, story-snapshot, prospective
assembly, and prospective critique adapters. Registry preflight requires
exactly one executor for each approved output binding before approval can
create budget authority.

Provider-backed adapters dispatch bounded child domain runs. Root adapters
reuse the canonical story-planning, timeline-assembly, and timeline-critique
semantics against exact prospective inputs, then stage pooled graph artifacts.
Neither adapter family may update a selection, stable story row, proposal
status, or terminal execution action. Each output is immutable and attributed
to the exact work dispatch action.

## Fan-out and fan-in

The lifecycle runs independent media, story, and Audio work concurrently. Only
after every binding in that wave completes does it reserve and execute
prospective assembly; critique runs in a final wave after assembly. Completed
steps are persisted immediately and skipped after a process restart. Accepted
provider work parks the execution before any dependent wave starts, until the
exact fenced callback arrives.

Failure, cancellation, and late callbacks are terminally fenced. Outputs that
were already generated remain valid pooled assets, but are not active product
state.

## Atomic application

After every approved binding has completed, finalization:

1. locks the execution and completed work rows;
2. derives the complete move set from exact durable binding IDs;
3. verifies every output kind, target, proposal role, intrinsic asset role,
   primitive action, child run, and settled child reservation;
4. revalidates selection asset/sequence heads and typed story snapshot heads;
5. creates the exact reconciliation and running terminal action;
6. appends selection heads and updates story snapshot pointer columns;
7. records moved-before/moved-after state and settled actual cost; and
8. terminalizes the proposal, execution reservation, budget, and owned root.

All eight steps share one Postgres transaction. A stale pointer, duplicate
selection sequence, causation mismatch, reconciliation replay mismatch, or
actual-cost overage rolls the transaction back. The lifecycle then records a
failed terminal execution without graph moves.

Selection writers are serialized by a transaction-scoped advisory lock on the
logical project/owner/role key. The append-only unique `(slot, seq)` index is
the final compare-and-set arbiter for other writers. The application role has no
raw story-table UPDATE. A fixed-shape security-definer function verifies the
live reservation, running terminal action, immutable approved move, completed
exact binding, destination asset, and expected head before changing only
`story_blueprints.asset_id` plus its typed `snapshot`, or
`story_beats.beat_asset_id` plus its typed semantic columns. Aggregate
storyboard/scene semantic revisions fail registry coverage before approval
until their relational identity mapping is explicit. Storyboard media outputs
are similarly exact beat/panel bindings, never one aggregate binding for many
tiles.

## Accounting and reconciliation

Estimates are admission authority; model-backed root calls and provider-backed
domain calls receive nonzero ceilings, while settled child reservations are the
accounting source of truth. Measured spend is settled even when it exceeds the
approved estimate, after which application fails with no active-state move.
The immutable settlement replay key covers actual cost, billing user, and
billable cost. Terminal reconciliation records the exact selection and story
before/after set, causal input/output assets, and actual cost; replays must match
the entire durable payload.

## Validation

Provider-neutral tests cover exact production registry ownership, concurrent
Visuals/Audio fan-out, durable callback replay, stale and over-budget failure
recovery, wrong role/binding rejection, and root-service pooling. The local
`popcorn_api` integration covers mixed selection/story commit, reconciliation,
least-privilege access, and rollback of an earlier selection append when a
later story-pointer compare-and-set fails.
