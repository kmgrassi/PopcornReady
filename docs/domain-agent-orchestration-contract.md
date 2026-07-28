# Domain-agent orchestration contract

<!-- agent-summary: This document owns the shared Visuals and Audio session, task, report, origin, and identity contract. -->
<!-- agent-summary: The immutable asset graph and relational story objects remain the only canonical creative state. -->
<!-- agent-summary: One persistent project/domain session contains sequenced finite orchestrator runs that reuse driveLoop. -->
<!-- agent-summary: DomainTask.v1 travels down and exactly one done, blocked, or question DomainReport.v1 returns at a turn boundary. -->
<!-- agent-summary: Creator-direct work and root-origin work share a serialized session but retain distinct trusted origins and recipients. -->
<!-- agent-summary: The creative-director hierarchy and two-level root/domain split remain conditional on the Gate 0 proceed decision. -->
<!-- agent-summary: The shared contract and API capability catalog are the executable TypeScript sources for this document. -->

> **Status:** Accepted contract for the standalone domain foundation and the
> proposed hierarchy boundary. Persistent Visuals/Audio sessions,
> creator-direct work, identities, and task/report semantics are active design
> constraints for PRs 3–13. The creative-director hierarchy is a conditional
> proposal until Gate 0 records `proceed`; this document does not amend the
> central-agent principles in [`NORTH_STAR.md`](NORTH_STAR.md).

## Contract source and scope

The executable contract is
[`packages/shared/src/domain-agent-contract.ts`](../packages/shared/src/domain-agent-contract.ts).
It defines `AgentRole`, stable canonical identifier envelopes,
`DomainTask.v1`, `DomainReport.v1`, direct and production task kinds, runtime
states, and the trusted-origin/recipient union. Compile-time fixtures live in
[`packages/shared/type-tests/domain-agent-contract.ts`](../packages/shared/type-tests/domain-agent-contract.ts).

The contract supports two independently useful product paths:

1. creator-direct Image, Video, Video Edit, Soundtrack, and Audio requests; and
2. root-origin domain work if Gate 0 later approves the creative-director
   hierarchy.

A Gate 0 `defer` decision blocks the second path and the root-specific work in
PR 14 and later. It does not invalidate the shared session/runtime contract or
the creator-direct path.

## Canonical identities

The runtime reuses existing durable identities. It must not introduce a second
finite-work or report identity.

| Concept | Canonical identity | Contract name |
| --- | --- | --- |
| Permanent project/domain continuity | `agent_sessions.id` | `AgentSessionId` |
| One finite assignment and `driveLoop` execution | `orchestrator_runs.id` | `OrchestratorRunId` |
| Any primitive invocation or terminal report | `actions.id` | `ActionId` |
| Terminal result | the existing `actions.id` whose tool is `domain_report` | `DomainReportActionId` alias |
| Leased queue execution | `orchestrator_dispatches.id` | runtime-internal; not a product ID |

The public creator-facing identity is exactly `{ sessionId, runId }`.
`DomainTask.v1` and `DomainReport.v1` are the persisted params and do not repeat
their enclosing session, run, or report action identity. Internal task/report
envelopes join those params to the canonical records; the report action ID
remains an internal audit/retrieval identifier. Do not add
`domain_assignments`, `domain_reports`, assignment-output IDs, a second queue,
or a free-form inter-agent message identity. A later schema PR may add the one
domain-specific `agent_sessions` table and the general `action_assets`
relationship described by the roadmap; all other lifecycle authority remains
on the existing runtime tables.

## Persistent session and finite runs

There is one permanent session for each `(project_id, domain)` pair. Visuals
owns both still and motion work; Audio owns narration, dialogue, music, sound,
and picture fitting. A session supplies continuity and an atomic monotonic
sequence, while each linked `orchestrator_runs` row is one finite, terminal
execution of the existing `driveLoop`.

Root-origin and creator-direct runs use the same session and serialize through
one active-run boundary. Their origins, pins, targets, budgets, continuations,
and recipients remain isolated. A direct run cannot supersede a root-origin
run or mutate its pinned selections. Terminal runs are never reopened to
simulate persistence; a follow-up creates a new sequenced run in the same
session.

The asset graph, selections, and relational story records are canonical state.
At every finite turn, the domain agent reads a fresh authorized projection by
stable ID. Tasks, reports, and compact session summaries must not copy or
become an alternative project snapshot.

## Trusted origins and recipients

The origin and response-recipient kind form one discriminated union, making a
root/creator route mismatch unrepresentable in TypeScript. Recipient causation
IDs are derived from the trusted origin instead of copied into a second object
where they could disagree.

| Origin | Required causation | Report recipient |
| --- | --- | --- |
| `creative_director` | originating root run, delegation action, and creator message IDs | the waiting creative-director run/delegation |
| `creator_direct` | authenticated actor, creator message, project entrypoint, request digest, idempotency key, and approval gate ID | that authenticated creator conversation |

Creator-direct work never fabricates a root run/action and never wakes a root
when it completes. Root-origin work applies its delegation and wakes its parent
exactly once. A `question` or `blocked` outcome closes the current finite run;
a fingerprinted answer or satisfied dependency creates a successor in the same
session.

## Downward task contract

`DomainTask.v1` is typed control/audit data stored on the finite run. It carries:

- domain, typed task kind, and exactly one trusted origin/recipient route; the
  enclosing run/session records supply their canonical IDs;
- objective and bounded instruction;
- project-scoped stable targets for a project, storyboard, scene, beat, panel,
  asset, lineage, timeline item, or export;
- required output kinds/roles and server-derived allowed output kinds;
- creative constraints, preserved assets/selections/fingerprints/pins, and
  graph-computed candidate affected asset IDs;
- the finite budget and optional approved proposal context; and
- acceptance criteria.

The public creator-direct API never accepts this structure directly. It accepts
a discriminated product request, authenticates the project/actor, validates
references, and derives domain, task kind, targets, graph closure, output scope,
origin, and recipient on the server.

Output capability is domain- and task-kind-bound in the type union: production
Visuals tasks may authorize image, anchor, keyframe, clip, composite, or render
outputs, while creator-direct `image_create` authorizes only `image`,
`video_create` authorizes `clip`, `composite`, or `render`, and `video_edit`
authorizes only `clip`. Audio may authorize only `audio_track`. A task cannot
list a sibling domain's output as required or allowed. Creator-direct tasks
require the confirmed approval context rather than relying only on prose or a
separate optional field.

Direct task kinds are fixed at the product boundary:

| Product request | Domain task kind |
| --- | --- |
| Image | Visuals `image_create` |
| Video | Visuals `video_create` |
| Video Edit with an authorized pinned source | Visuals `video_edit` |
| Soundtrack | Audio `soundtrack_create` |
| Other bounded sound work | Audio `audio_create` |

Root-origin work uses typed outcome-level production/revision kinds rather than
raw primitive tool names. The task kind and domain union prevents an Audio task
from entering Visuals or the reverse.

## Upward report contract

Exactly one terminal action with tool `domain_report` carries the persisted
`DomainReport.v1` params for a finite domain run. The enclosing report envelope
supplies the canonical session, run, and existing action IDs. The params do not
mint or repeat those identities. A report has exactly one agent-authored outcome:

- `done` — ordered output asset IDs with intrinsic roles, explicit selection
  changes, acceptance evidence, and a compact session summary;
- `blocked` — a domain-safe precondition projection, required domain/root,
  stable targets, and reason, without sibling primitive names; or
- `question` — one bounded creative question, relevant targets, options and
  tradeoffs, plus a fingerprint that must still match when answered.

`queued`, `running`, `waiting`, `succeeded`, `failed`, `canceled`, `timed_out`,
and `superseded` are runtime transport states, not report outcomes. `waiting`
has a queryable `media_job`, `domain`, or `approval` reason. A run is
`succeeded` only after its terminal report action is durably persisted. Runtime
failure, cancellation, timeout, or supersession cannot be recast as a domain
report outcome.

Creator-direct proposal state is separate from assignment transport. The
server creates a validated proposal/quote, records explicit confirmation
against an approved maximum, and only then enqueues a billable run. A pending
quote is not a queued run, and a creator-direct quote must not be represented
as `waiting` for runtime approval.

## Entry-path contract

Creator-direct requests are authenticated and project-scoped. A global Create
entry may choose or create a normal project; there is no hidden, temporary, or
workspace-global default project. The server follows proposal → explicit
confirmation → idempotent enqueue. Changed input cannot reuse the same request
digest/idempotency approval.

Untargeted outputs enter the project's immutable asset pool and do not move a
production selection. Only an explicitly targeted, pinned, and transactionally
revalidated request may append a selection. Follow-ups reuse the same domain
session. Before graph-scoped Request Changes lands, direct changes are limited
to unconsumed outputs or targets without downstream consumers.

## Capability ownership

The current flat production registry remains authoritative until Gate 0 says
`proceed`. The current executable primitive vocabulary and its ownership,
canonical labels/order, execution modes, cost classes, and approval-gate
metadata live in
[`apps/api/src/lib/orchestrator-tools/capability-catalog.ts`](../apps/api/src/lib/orchestrator-tools/capability-catalog.ts).
Every rich primitive definition is checked against that catalog when it is
registered, and the driver stubs and real-to-driver bridge consume the same
metadata. The existing flat `createDefaultToolRegistry()` remains the active
production source and retains its existing definitions and insertion order.
`regenerate_image_asset` is classified as synchronous media work: its live rich
handler and bridge were already synchronous, while the old dormant stub
incorrectly inferred asynchronous execution from a media-name set. The catalog
corrects that dormant inconsistency without changing active execution.

Explicit dormant builders now make the proposed boundary testable without
activating it:

- `root-registry.ts` exposes the ten current Creative Director-owned
  primitives, including optional catalog publication;
- `visuals-registry.ts` exposes only the six current image/motion primitives;
  and
- `audio-registry.ts` exposes only audio generation and picture fitting. A
  finite Audio run supplies its trusted `DomainTask.v1`, producing task-bound
  schemas/descriptions and scope-checked wrappers under those same canonical
  tool names; the flat default registry remains unchanged.

The three registries are an exact, disjoint partition of the current 18-tool
vocabulary. Domain registries contain no root, sibling, approval, assembly, or
dispatch capability. Standalone Audio generation is a task mode over
`generate_audio`, not a second primitive name. It reuses generated-assets
provider/job/storage/action/cost execution, creates one pooled `audio_track`,
and never fabricates a production selection. Creator-direct route construction
remains owned by PR 12.

Under the proposed hierarchy, responsibility is:

| Owner | Model-visible responsibility/capabilities |
| --- | --- |
| Creative director, conditional | current brief, story, script, shot and visual-anchor planning; timeline assembly and critique; approval, export, and optional catalog publication; future delegation and batched dispatch after their owning PRs |
| Visuals | current anchor, storyboard, keyframe, clip, immutable image regeneration, and content-aware video edit capabilities; future standalone image/video capabilities after their owning PR |
| Audio | exact-script narration/dialogue, production or standalone music/sound generation, immutable delivery revisions, and fitting authorized audio to current picture |
| Runtime, never model-facing | authorization, session/run claim, enqueue/lease, wait/resume, report acknowledgement, retry, cancellation, gate persistence, cost settlement, provider callback fencing |

Audio production speech never treats model-written tool input as approved copy:
the current script must resolve the exact requested project or beat segment.
Picture fitting likewise requires a current planned beat before picture duration
can refine its window. Immutable audio delivery revisions preserve the source's
trusted role, provider audio mode, and—when speech or dialogue—the exact spoken
words at both the generated-assets boundary and the locked lineage-mint RPC.

The conditional creative director retains coherence decisions; it is not only
a router. It owns cross-modality intent, story and pacing decisions, visual
anchor planning, assembly, critique, approval, budgets, export, and deciding
when a domain should work. Visuals and Audio self-heal only inside their own
capability boundary and return `blocked` or `question` across that boundary.

`domain-recovery-projection.ts` is the pure, dormant translation boundary for
that future specialist context. It projects both suggested recovery tools and
precondition satisfiers. Same-owner primitives remain actionable with only
exact server-authorized `DomainTarget` identities under a trusted project ID.
Hint strings cannot authorize targets: IDs must match the trusted target set,
pass bounded stable-ID validation, and fit bounded trusted-input and emitted
target caps, or the projection falls back to the trusted project target. Cross-owner primitive
names and raw hints are removed and replaced by a required domain, stable
targets, and a generic reason; duplicates collapse and unknown historical tool
strings fail closed. The raw error remains unchanged for audit. This projector
is not wired into the current flat model, engine, persistence, or action audit;
the domain runtime PRs own that activation.

## Two-level and deterministic boundaries

If Gate 0 approves the hierarchy, it has exactly two model-agent levels:

```text
creative director
  -> Visuals finite run
  -> Audio finite run
```

Domains cannot delegate, call sibling tools, or recursively create agents.
They may launch deterministic provider jobs through their allowed server-owned
tools. Provider calls, storage, queueing, rendering, authorization, graph writes,
and lifecycle transitions remain deterministic worker/runtime responsibilities;
they are not modeled as agents.

Within Audio, delivery, voice choice, warmth, bounded retiming, mix, and sound
design are local only while spoken words and meaning remain unchanged.
Production generations persist the current plan, brief, and script assets they
actually consume as typed graph inputs. A delivery revision uses an exact
authorized source asset/transcript, creates the next row in that immutable
lineage with a `source` edge, and never moves a selection implicitly. Delivery
presets map to typed provider voice settings rather than adding instructions to
the spoken text. Revision source, fit audio, fit picture, and fit beat must be
explicit trusted targets or pins; project-wide read authority is insufficient
for those operations. Missing current picture returns a typed cross-domain
prerequisite; a picture window too short for exact words becomes a `question`
about whether picture or meaning may change.

A future domain is admitted only when a cohesive tool cluster has a distinct
craft/context boundary and decision-evaluation evidence shows that separating
it improves routing or quality. New domains must reuse `driveLoop`, the same
task/report boundary, graph state, and the two-level limit. A convenient tool
group or a desire for recursive delegation is not sufficient.

## Related documents

- [`docs/scopes/specialist-agent-orchestration-prs.md`](scopes/specialist-agent-orchestration-prs.md)
  owns the proposed implementation order and Gate 0 dependencies.
- [`docs/NORTH_STAR.md`](NORTH_STAR.md) remains the active product architecture.
- [`docs/scopes/story-development-agent-handoff.md`](scopes/story-development-agent-handoff.md)
  is historical context; its fixed stages, standalone leaf-agent chain, legacy
  tables, and handoff payload are superseded by this contract.
