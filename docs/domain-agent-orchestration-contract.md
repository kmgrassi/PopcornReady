# Domain-agent orchestration contract

<!-- agent-summary: This document owns the shared Visuals and Audio session, task, report, origin, and identity contract. -->
<!-- agent-summary: The immutable asset graph and relational story objects remain the only canonical creative state. -->
<!-- agent-summary: One persistent project/domain session contains sequenced finite orchestrator runs that reuse driveLoop. -->
<!-- agent-summary: DomainTask.v1 travels down and exactly one done, blocked, or question DomainReport.v1 returns at a turn boundary. -->
<!-- agent-summary: Creator-direct work and root-origin work share a serialized session but retain distinct trusted origins and recipients. -->
<!-- agent-summary: The accepted creative-director hierarchy has a two-level root/domain split after Gate 0 proceed. -->
<!-- agent-summary: The shared contract and API capability catalog are the executable TypeScript sources for this document. -->

> **Status:** Accepted contract with the internal Visuals profile active on the
> shared finite-run runtime. Persistent Visuals/Audio sessions,
> creator-direct work, identities, and task/report semantics are active design
> constraints. Gate 0 recorded `proceed` on 2026-07-16, so the accepted
> creative-director hierarchy is now implemented behind its temporary rollout
> flag and the active principles in [`NORTH_STAR.md`](NORTH_STAR.md) reflect it.

## Contract source and scope

The executable contract is
[`packages/shared/src/domain-agent-contract.ts`](../packages/shared/src/domain-agent-contract.ts).
It defines `AgentRole`, stable canonical identifier envelopes,
`DomainTask.v1`, `DomainReport.v1`, direct and production task kinds, runtime
states, and the trusted-origin/recipient union. Compile-time fixtures live in
[`packages/shared/type-tests/domain-agent-contract.ts`](../packages/shared/type-tests/domain-agent-contract.ts).

The contract supports two independently useful product paths:

1. creator-direct Image, Video, Video Edit, Soundtrack, and Audio requests; and
2. root-origin domain work through the active Creative Director hierarchy.

Gate 0 recorded `proceed`; both paths share this session/runtime contract.

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

The Creative Director hierarchy is the production default for new root work.
The executable primitive vocabulary and its ownership, canonical labels/order,
execution modes, cost classes, and approval-gate metadata live in
[`apps/api/src/lib/orchestrator-tools/capability-catalog.ts`](../apps/api/src/lib/orchestrator-tools/capability-catalog.ts).
Every rich primitive definition is checked against that catalog when it is
registered, and the role-owned registries consume the same metadata. The
remaining constructible flat registry is compatibility debt, not production
authority; its deletion is owned by
[`scopes/full-selective-regeneration-cutover-prs.md`](scopes/full-selective-regeneration-cutover-prs.md).
`regenerate_image_asset` is classified as synchronous media work: its live rich
handler and bridge were already synchronous, while the old dormant stub
incorrectly inferred asynchronous execution from a media-name set. The catalog
corrects that historical inconsistency.

Role builders make the hierarchy boundary executable:

- `root-registry.ts` exposes the ten current Creative Director-owned
  primitives, including optional catalog publication;
- `visuals-registry.ts` owns eight image/motion primitives: the six production
  and revision tools plus standalone `generate_image_asset` and
  `generate_video_asset`; the trusted task kind narrows model visibility to one
  standalone tool for `image_create`, `video_create`, or `video_edit`;
  and
- `audio-registry.ts` exposes only audio generation and picture fitting.

The three role registries are an exact, disjoint 12/8/2 partition of the
current 22-tool catalog. The two standalone tools have a specialist-only
catalog surface and remain absent from `PRODUCTION_TOOL_NAMES`, driver stubs,
the flat default registry, and root evals. Domain registries contain no root,
sibling, approval, assembly, or dispatch capability.

Under the active hierarchy, responsibility is:

| Owner | Model-visible responsibility/capabilities |
| --- | --- |
| Creative director | current brief, story, script, shot and visual-anchor planning; timeline assembly and critique; approval, export, optional catalog publication, and domain delegation |
| Visuals | anchor, storyboard, keyframe, clip, immutable pooled image regeneration, pinned content-aware video edit, and standalone pooled image/video generation |
| Audio | current narration/dialogue/music/sound generation and fitting audio to picture |
| Runtime, never model-facing | authorization, session/run claim, enqueue/lease, wait/resume, report acknowledgement, retry, cancellation, gate persistence, cost settlement, provider callback fencing |

The Creative Director retains coherence decisions; it is not only a router. It
owns cross-modality intent, story and pacing decisions, visual
anchor planning, assembly, critique, approval, budgets, export, and deciding
when a domain should work. Visuals and Audio self-heal only inside their own
capability boundary and return `blocked` or `question` across that boundary.

`domain-recovery-projection.ts` is the translation boundary for specialist
context. It projects both suggested recovery tools and
precondition satisfiers. Same-owner primitives remain actionable with only
exact server-authorized `DomainTarget` identities under a trusted project ID.
Hint strings cannot authorize targets: IDs must match the trusted target set,
pass bounded stable-ID validation, and fit bounded trusted-input and emitted
target caps, or the projection falls back to the trusted project target. Cross-owner primitive
names and raw hints are removed and replaced by a required domain, stable
targets, and a generic reason; duplicates collapse and unknown historical tool
strings fail closed. The raw error remains unchanged for audit. Cross-domain
blocking takes precedence when one error also advertises a local recovery, so
required root/Audio work cannot disappear into a Visuals retry loop.

Visuals and Audio execution are enabled through explicit role allowlists.
Before an invocation action exists, the engine
loads a fresh graph snapshot, verifies preserve pins, parses the selected tool
once, and authorizes its stable IDs against the trusted task scope. The
canonical parsed value is then reused for persistence, cost estimation, and
execution. The rich bridge preserves the domain task, scope, snapshot, and
session claim generation so a stale reclaimed worker cannot regain authority.

Standalone image/video wrappers call the canonical generated-assets job,
provider, storage, action, cost, content-hash, and embedding path. Provider and
model settings are server-derived; minor likenesses route deterministically to
Gemini. Untargeted results and domain revisions remain pooled. A direct video
edit requires an asset target, an asset pin, and a trusted fingerprint that
matches the fresh graph. It mints an `edited_from` clip and never swaps every
selection that happens to reference the source.

Visuals media jobs carrying a domain session claim also leave generated
anchors, keyframes, and clips pooled. Their exact claim fences provider work,
but it is not authority to replace an active project slot after a long-running
provider call. Approved graph-scoped revisions require explicit output bindings,
expected selections, and active-claim checks; the final atomic application and
flat-path deletion are specified in
[`scopes/full-selective-regeneration-cutover-prs.md`](scopes/full-selective-regeneration-cutover-prs.md).
Later tools in the same claimed finite run can resolve pooled prerequisites only
through asset creation actions attributed to that exact run and stable
beat/anchor identity. This preserves anchor → keyframe → clip self-healing
without reading another run's pooled alternatives.

The graph `image` kind is the default only for genuinely generic stills.
`poster`, `character_anchor`, `scene_anchor`, `beat_keyframe`,
`beat_storyboard`, `scene_storyboard`, and `act_mockup` keep their explicit
production mappings. Generic images participate in media delivery, embeddings,
semantic search, catalog snapshot/clone, and immutable pooled regeneration.

## Two-level and deterministic boundaries

The active hierarchy has exactly two model-agent levels:

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
