# Creative-director and domain-agent orchestration — architecture and PR roadmap

<!-- agent-summary: Proposed roadmap for a creative director, persistent domain agents, and standalone domain creation. -->
<!-- agent-summary: The creative director owns planning, cross-modality coherence, timeline assembly, critique, approval, routing, and export. -->
<!-- agent-summary: Visuals and Audio reuse the existing driveLoop and the same project-scoped session from either root or creator-direct work. -->
<!-- agent-summary: Inter-agent communication occurs only at durable turn boundaries through done, blocked, or question reports. -->
<!-- agent-summary: The immutable asset graph is the only canonical creative-state channel; tasks and reports carry intent and stable IDs. -->
<!-- agent-summary: Creator-direct image, video, and soundtrack work uses typed project APIs and a calm agent-directed Asset Studio UI. -->
<!-- agent-summary: One domain-specific agent_sessions table plus one general action_assets relation extend the existing runtime instead of duplicating it. -->
<!-- agent-summary: Each finite domain assignment remains an orchestrator run, and its typed terminal report is a unique action. -->
<!-- agent-summary: Nineteen ordered PRs cover evaluation, contracts, durability, agents, standalone creation, hierarchy, rollout, and cleanup. -->

> **Status:** Proposed implementation scope. This document does not describe
> shipped behavior. It records the target decision and an independently
> reviewable PR sequence for approval before implementation.
>
> **Sources of truth:** [`NORTH_STAR.md`](../NORTH_STAR.md),
> [`ui-interaction-model.md`](../ui-interaction-model.md), and the asset-graph
> rules in [`CLAUDE.md`](../../CLAUDE.md) remain authoritative. PR 2 records the
> shared domain contracts without overriding the central-agent principle; the
> hierarchy-specific North Star amendment moves to Gate-0-approved PR 14.

## Objective

Keep one agent responsible for the **creative whole** without forcing that
agent to reason over every media-generation tool.

The root orchestrator is the project's **creative director and router**. It
owns the brief, story development, shot planning, cross-modality coherence,
timeline assembly, critique, approval, blast radius, and final export. It
delegates bounded generation assignments to persistent domain agents and
reconciles their results into one coherent production.

Domain agents own execution craft. They can also be invoked directly from a
project-scoped API and UI for a bounded image, video, or soundtrack request,
without starting a full creative-director production. "Independent" means
independent of the full production flow, not detached from a project, asset
graph, provenance, authorization, budget, or durable session.

The first cut has two domains because that
is the smallest partition supported by the current tool vocabulary:

- **Visuals** owns the complete still-to-motion chain, including anchors,
  storyboards, keyframes, clips, and visual revisions.
- **Audio** owns voice, dialogue, music, sound, fitting, and audio revisions.

Each agent is the same durable `driveLoop` configured with a different prompt,
tool registry, context source, and completion policy. This roadmap does not add
a second agent runtime or turn creative choices into an opaque server workflow.

## The decision

### One creative director, persistent domain agents, no deeper hierarchy

```mermaid
flowchart TD
  Creator["Creator request"] --> Root["Creative director driveLoop"]
  Creator --> Studio["Asset Studio or typed project API"]
  Graph["Assets + edges + selections + actions"] --> Root
  Graph --> Studio

  Root --> RootTools["Planning + assemble + critique + approval + export"]
  Root --> Visuals["Persistent Visuals session per project"]
  Root --> Audio["Persistent Audio session per project"]
  Studio --> Visuals
  Studio --> Audio

  Visuals --> VisualTools["Visual primitive tools"]
  Audio --> AudioTools["Audio primitive tools"]
  VisualTools --> Jobs["Async provider jobs"]
  AudioTools --> Jobs
  Jobs --> Graph
  RootTools --> Graph
```

The hierarchy stops at two agent levels, while creator-direct work enters at
the domain level:

- The creative director may dispatch work to a domain session.
- The creator may request a bounded domain outcome through the typed API/UI.
  Image and Video are task kinds in Visuals; Soundtrack is a task kind in
  Audio. They are not separate agents or separate sessions.
- A domain agent may call its own primitive tools but may not dispatch another
  agent or silently broaden its assignment.
- A cross-domain prerequisite returns as `blocked`. For root-origin work, the
  creative director decides whether to dispatch a sibling. For creator-direct
  work, the UI offers an explicit choice to attach a valid dependency or hand
  the request to the full-production flow; it never silently starts one.
- A creative judgment outside a domain's authority returns as `question`. The
  response is addressed to the creative director for root-origin work and to
  the creator-facing conversation for creator-direct work. The answer creates a
  successor assignment in the same domain session.

There is no free-form agent chat and no mid-flight message injection. Every
inter-agent exchange is a persisted, replayable turn boundary.

### The creative director is not a router alone

Routing is one responsibility, not the identity of the root agent. The root
must retain the tools and context where project-wide coherence is decided:

- brief, story, script, shot, and visual-anchor planning;
- visual tone versus audio mood;
- narration duration versus picture duration;
- pacing, cuts, and timeline assembly;
- whole-cut critique and repair prioritization;
- approval proposals and budget tradeoffs;
- export readiness and completion.

The root delegates detailed media execution and provider-level recovery. It
does not delegate ownership of the creative whole.

### Same loop, different agents

The existing engine in `apps/api/src/lib/orchestrator/engine.ts` already:

1. loads a durable run and its prior actions;
2. asks a model to choose one available tool or finish;
3. executes and records the tool call;
4. parks on an async job or approval gate; and
5. resumes by applying the same loop to persisted state.

It also already accepts injected `model` and `registry` dependencies. The new
architecture turns those injection seams into an explicit production
configuration:

```text
AgentDefinition = role prompt + scoped registry + context source + outcome policy
Agent invocation = existing driveLoop + AgentDefinition + durable run
```

The current system effectively runs:

```text
driveLoop(one root prompt, one flat history, all primitive tools)
```

The target runs the same implementation in three configurations:

```text
driveLoop(creative-director prompt, root context, root tools)
driveLoop(visuals prompt, Visuals session context, visual tools)
driveLoop(audio prompt, Audio session context, audio tools)
```

Reusing the loop does **not** mean the work is configuration-only. Durable
sessions, assignment provenance, turn-boundary scheduling, typed outcomes,
scope enforcement, and tree-wide controls still require implementation. It
means parking, resumption, action recording, job waiting, provider-key context,
and failure handling remain one shared engine rather than multiple forks.

### Responsibilities

| Agent or layer | Owns | Does not own |
| --- | --- | --- |
| Creative director | User intent, brief/story/script/shot/visual-anchor planning, cross-modality coherence, routing, blast radius, timeline assembly, critique, approval, budget tradeoffs, export, completion | Provider parameters, fine-grained media generation, in-domain prerequisite sequences |
| Visuals | Anchor-image generation, storyboard tiles, keyframes, clips, still/video revisions, visual continuity inside an assignment | Story/anchor-plan rewrites, audio, timeline assembly, approval, cross-project decisions |
| Audio | Voice, dialogue, music, sound, fitting audio to picture, audio continuity inside an assignment | Story rewrites, visuals, timeline assembly, approval, cross-project decisions |
| Durable runtime | Turn execution, persistence, dispatch claims, waiting, retry, cancellation, authorization, cost settlement, gates | Creative routing, aesthetic judgment, hidden workflow sequencing |
| Providers/workers | Deterministic execution of a chosen tool, storage, rendering | Agent decisions, delegation, project interpretation |

`export_video` remains deterministic execution invoked by the creative
director. `publish_to_catalog` remains an explicit optional distribution action
outside the core video-production path.

Future domain agents are possible, but a new domain must be justified by a
cohesive tool cluster and decision-eval evidence. The design does not target a
particular number of dispatch tools.

## Decision Gate 0 — resolved: proceed with the root hierarchy

> **Decision recorded 2026-07-16: PROCEED.** The creative-director hierarchy is
> adopted on engineering and product grounds rather than on a measured
> decision-quality comparison:
>
> - **Modularity:** each agent carries a small role-scoped prompt and registry,
>   which is easier to program, test, and debug than one all-tools decision
>   surface.
> - **Observability:** creators cannot currently see what background generation
>   is doing. Persistent domain sessions plus typed `done | blocked | question`
>   reports give the observe-first UI
>   ([`ui-interaction-model.md`](../ui-interaction-model.md), PR 17) a real
>   hierarchy to narrate — which agent is working, on what, and what was handed
>   off.
> - Both architectures are judged capable of routing correctly; raw capability
>   was not the deciding question.
>
> Consequences: PR 14 depends only on PRs 10–11 and no longer waits on a
> billable baseline study. The "defer" branch of this gate is retired.

The decision-eval harness remains required — repurposed from adoption gate to
**non-inferiority regression bar**. Before PR 18 enables creative-director
routing by default, the hierarchy surface must route **at least as well as**
the flat root on the same paired repeated-sample scenario matrix, covering:

- wrong next-tool or premature-done decisions;
- performance as project history and available tools grow;
- cross-modality coherence decisions;
- recovery from within-domain and cross-domain precondition misses;
- unnecessary turns and repeated failed calls; and
- selective-regeneration decisions with stable graph IDs.

PRs 2–13 establish the shared domain runtime and independently requested Asset
Studio on their own product merits. Do not run both root architectures against
live billable providers for comparison; compare decisions with fixtures or
mocked execution.

## Current baseline

As of 2026-07-14, the production orchestrator is one durable all-tools agent:

- `apps/api/src/lib/orchestrator/model.ts` gives one model every registered tool
  schema and asks it to choose at most one tool per turn.
- `apps/api/src/lib/orchestrator/engine.ts` implements the durable `driveLoop`,
  records actions, parks on an async job or approval gate, and resumes from
  persisted state.
- `EngineDeps` already injects a model and tool registry, but production uses
  one root prompt and the default all-tools registry.
- The root model still receives `inputSummary`, compact prior actions, and tool
  schemas rather than a stable-ID project-state projection.
- `orchestrator_runs` already supplies the finite durable run identity needed
  for a domain assignment, but has no agent role, persistent domain session,
  task kind/spec, trusted origin, parent/continuation link, or domain wait state.
- `actions` links invocations to one run, but action append is not idempotently
  retryable and does not attribute a decision through root action, domain
  session, finite child run, job, and produced assets.
- The leased `orchestrator_dispatches` queue provides the detached execution
  foundation that domain assignment runs should reuse.
- The current vocabulary is defined by the code-owned registry. Documentation
  and UI projections contain older hand-maintained counts, so authoritative
  prose must not treat a count as a contract.
- Run projections assume one flat history and impose a static tool order.
- Project-attributable OpenAI and Anthropic text calls now write estimated token
  costs to `model_call_costs`, including successful structured-output retries;
  root decisions retain the durable run ID but no action ID. Provider cache
  tokens affect the estimate, although the current ledger schema persists only
  raw input/output token fields. This is post-hoc cost visibility: it neither
  reserves an LLM budget before a request nor settles user credits. The rate
  table is a checked global-tier estimate, so provider invoices remain the
  reconciliation source. Calls without a project scope (for example global
  naming and embeddings) remain intentionally outside this ledger until their
  ownership is explicit.
- `spent_usd` and model/provider cost records do not yet form one complete async
  cost ledger across every provider and background workflow.
- Request Changes still relies partly on fixed stage boundaries rather than
  graph-scoped creative-director decisions.

### Data-model reuse decision

Do not create a parallel persistence stack for domain work. The current schema
already owns nearly every finite lifecycle or provenance concept the hierarchy
needs:

| Need | Existing source to extend or reuse |
| --- | --- |
| Finite domain assignment | `orchestrator_runs` |
| Primitive invocation and terminal domain report | `actions` |
| Worker queue, lease, wake, retry | `orchestrator_dispatches` |
| Creator/root approval | `orchestrator_run_gates` plus `actions.proposal` |
| API retry protection | `idempotency` |
| Provider/model work | `jobs` and the generated-assets service |
| Cost and credits | `model_call_costs` plus the credit ledger |
| Outputs and provenance | `assets`, `assets.created_by_action_id`, `asset_edges`, plus one general `action_assets` relation |
| Active project choices and optimistic concurrency | `selections` |
| Optional unsent UI form draft | `studio_drafts`, never authoritative agent state |

The only new **domain-specific** table is `agent_sessions`: the permanent
project/domain identity, compact continuity summary/version, atomic sequence
allocator, active-run lock boundary, and durable claim generation with a unique
`(project_id, domain)` key. A finite assignment is an ordinary
`orchestrator_runs` row linked to that session. Existing root runs use the same
table with their own role and no domain-session link.

Extend `orchestrator_runs` rather than adding `domain_assignments`. The exact
column names land in PR 4, but the relational/queryable concepts are:

- agent role and optional `agent_session_id`;
- monotonic sequence unique within a session;
- task kind plus schema-marked `DomainTask.v1` control/audit payload;
- trusted origin kind and either root parent/action causation or authenticated
  creator-direct causation;
- parent root and predecessor/continuation run links; and
- any additional run states required for explicit supersession or domain waits.

Do not duplicate session, assignment, role, or origin foreign keys onto every
action. `actions.orchestrator_run_id` already joins every child invocation to
the finite run, which joins to its session and trusted origin. Add a
`parent_action_id` only if a concrete nested-action query cannot be answered by
that run link; it is not a first-cut provenance requirement.

Emit `DomainReport.v1` as one final schema-marked action with tool
`domain_report`. Its params contain `done | blocked | question`, evidence, and
fingerprint. A partial unique index on `actions(orchestrator_run_id)` where
`tool = 'domain_report'` enforces one report per finite domain run. Root
acknowledgement compare-and-sets the existing delegation action and wakes its
parent dispatch; creator-direct completion has no parent wake.

The report action is a retrieval/control record, not the provenance spine.
Output assets remain immutable, point to their primitive creating action, and
carry typed input edges. Existing `input_asset_ids`/`output_asset_ids` arrays
lack foreign keys and cannot express a per-action role/ordinal safely. Add one
general `action_assets` table with project, action, asset, `input | output`
direction, role, and ordinal; enforce composite same-project foreign keys and
unique action/direction/ordinal. Backfill or dual-write the legacy arrays during
an explicit compatibility period, assert agreement, then let all tools—not only
domain agents—use the relation. Do not add `domain_assignment_outputs`.

The existing `POST /projects/:projectId/generated-assets` service already
validates and executes image, video, and audio provider jobs, records actions
and costs, and writes graph assets. Visuals and Audio should call its internal
service through agent-owned tool wrappers rather than fork provider execution.
Its public provider-heavy request shape is not the Asset Studio contract.

One asset-model correction is required: current generic generated images are
coerced to `anchor` or `keyframe`, which falsely gives a standalone image a
production-specific meaning. PR 10 adds a generic graph `image` kind and
updates the enum, kind/media constraint, ref trigger, shared types, mappings,
embeddings, and projections. Generated standalone video continues to use
`clip` (or `composite` plus `render` when assembled), and soundtrack uses
`audio_track`.

Reuse requires privacy hardening. Raw `orchestrator_runs` and `actions` rows are
currently publicly readable for public projects, but domain task specs, reports,
creator questions, actor/request metadata, and approval material are not public
project content. PR 4 removes public access to those raw control records and
provides explicit sanitized public projections for any progress fields the
public project experience still needs.

### Related scopes to reuse, not fork

- [`orchestrator-decision-evals.md`](orchestrator-decision-evals.md) provides
  the existing real-model, no-execution routing harness that Gate 0 extends.
- [`graph-rerun-decisioning-prs.md`](graph-rerun-decisioning-prs.md) owns the
  graph candidate set, semantic pruning, fingerprint pins, and costed rerun
  proposal. PR 15 integrates that contract rather than inventing another blast-
  radius model.
- [`regeneration-coverage-prs.md`](regeneration-coverage-prs.md) owns immutable-
  version regeneration coverage. Domain agents call that vocabulary; they do
  not create mutable replacement paths.
- [`ooda-feedback-loop.md`](ooda-feedback-loop.md) and
  [`ooda-feedback-implementation-prs.md`](ooda-feedback-implementation-prs.md)
  own critique-to-revision learning and feedback capture. The creative
  director's critique supplies structured findings to that loop.
- [`orchestrator-step-durability.md`](orchestrator-step-durability.md) owns the
  existing bounded store retry work. PR 5 closes its deferred idempotent-action
  gap.
- [`story-development-agent-handoff.md`](story-development-agent-handoff.md) is
  historical context with pre-asset-graph assumptions. PR 2 must mark
  superseded sections instead of treating it as current implementation.

## Tool ownership

The primitive tools survive intact. PR 3 makes this ownership executable
metadata rather than prompt-only convention.

| Role | Model-visible tools |
| --- | --- |
| Creative director | `create_or_load_brief`, `develop_story_blueprint`, `draft_script`, `plan_shots`, `plan_visual_anchors`, `assemble_timeline`, `critique_timeline`, `request_approval`, `export_video`, `delegate_visuals`, `delegate_audio`, PR 16's batched `delegate_domains`, optional `publish_to_catalog`, and model `done` |
| Visuals | `generate_anchor`, `generate_storyboard`, `generate_keyframe`, `generate_clip`, `generate_image_asset`, `generate_video_asset`, `regenerate_image_asset`, `edit_video_asset`, and domain `done` / report outcomes |
| Audio | `generate_audio`, `fit_audio_to_picture`, and domain `done` / report outcomes |
| Runtime-owned, not model-facing | Session/run claim, wait/resume, report acknowledgement, retry, cancellation, authorization, cost settlement, gate persistence |

The exact root tool count is not a design target. The reliability hypothesis is
that root generation choices collapse into a small number of domain dispatches
while coherence tools remain available where they belong.

`request_approval` stays a **root-only model tool**. The creative director
decides what a root-origin proposal should contain and why. Creator-direct work
uses a runtime-owned two-phase quote/approval gate before any billable dispatch:
proposal first, explicit confirmation or an approved maximum second, then an
idempotent enqueue. Domain agents cannot create arbitrary approval gates or
charge work before that confirmation.

### In-domain self-healing

The Visuals registry intentionally spans still and motion generation:

```text
Visuals calls generate_clip
  -> tool reports missing beat_keyframe
  -> generate_keyframe is in the same Visuals registry
  -> Visuals generates the keyframe and retries generate_clip
  -> Visuals returns done with the produced asset IDs
```

That sequence remains inside one session because it is one visual craft problem.
Changing the story to avoid a difficult shot is outside Visuals authority and
returns `question` or `blocked` to the origin-specific recipient.

## Two entry modes, one domain system

### Full-production entry

The creator starts or resumes a production. The creative director owns the
project-wide plan and dispatches root-origin assignments to Visuals and Audio.
Domain reports return to the waiting root, which reconciles the graph and
continues the whole production.

### Creator-direct Asset Studio entry

The creator asks for one bounded product outcome without starting the full
production flow:

- **Image** maps to Visuals task kind `image_create`.
- **Video** maps to Visuals task kind `video_create`; editing an existing video
  is the distinct `video_edit` kind and requires a pinned source asset.
- **Soundtrack** maps to Audio task kind `soundtrack_create`; other bounded
  sound work may use `audio_create`.

Every request belongs to a normal authorized project. A global Create entry may
let the creator choose an existing project or create a normal blank project, but
there is no workspace-global, temporary, or hidden “default” asset container.
Both entry modes reuse the single persistent `(project_id, domain)` session.
Assignments from the root and creator therefore serialize through one session
queue, while their origin, task kind, inputs, outputs, pins, and recipients stay
isolated and auditable.

The public API accepts a discriminated product request, not raw `DomainTask.v1`,
raw tool names, provider parameters, or client-declared authorization scope.
The server derives the domain, task kind, allowed output kinds, trusted origin,
targets, and scope. A request supplies intent, references, a target or pinned
source where required, creative constraints, and an optional budget preference.
It follows this two-phase lifecycle:

1. create a server-validated proposal/quote without billable generation;
2. explicitly confirm the proposal or approved maximum; and
3. idempotently enqueue the finite domain run.

The idempotency key is bound to project, actor, request digest, and approval
token. Reusing it with changed input is rejected. Direct questions and blocked
dependencies use fingerprinted one-use successor operations so a stale answer
cannot resume changed work.

Standalone generation must be semantically genuine. Do not fabricate a dummy
storyboard, beat, timeline slot, or retired legacy row just to satisfy a
production-shaped primitive. Visuals exposes graph-backed generic image and
video agent tools over the existing generated-assets execution service where
the storyboard/keyframe/clip tools cannot represent the request. Audio exposes
a freeform soundtrack mode over the same service. These outputs are immutable
graph assets with typed input edges and primitive creating actions.

Untargeted results enter the project's asset pool and the terminal report
action records their ordered IDs; intrinsic output meaning stays on
`assets.role`. They do not silently move a production selection. Only an
explicitly targeted, pinned, and transactionally revalidated request may append
a selection; “Use in project” uses the existing explicit selection carveout and
reconciliation rules. Before PR 15's graph-rerun integration, the direct path
is restricted to unconsumed standalone outputs and
empty/no-downstream-consumer selection targets. Once an asset is selected or
consumed by production work, changing or replacing it must hand off to the
graph-scoped Request Changes path.

The UI is one calm, outcome-oriented **Asset Studio**, not three toy generators
or cards exposing internal sub-agent names. It uses one Image / Video /
Soundtrack goal selector, one intent prompt, optional references and constraints,
a clear cost proposal, and one primary action. After confirmation it becomes an
observe-first progress view with durable status, provenance, costs, alternatives,
outputs, and the creator-facing conversation. Follow-up requests stay in the
same session and use the existing Request Changes interaction pattern. Advanced
provider, seed, and raw model controls remain hidden.

## Turn-boundary communication contract

### Down: `DomainTask.v1`

Every domain invocation is a typed, versioned assignment. Trusted causation is
an exactly-one origin union:

- `creative_director` — originating root run, root action, and creator message
  IDs; or
- `creator_direct` — authenticated creator, creator message, API/UI entrypoint,
  request digest, and idempotency/approval IDs.

There is no synthetic root run or root action for direct work. The task includes:

- `domain` — `visuals | audio`;
- `taskKind` — server-derived `image_create`, `video_create`, `video_edit`,
  `soundtrack_create`, or `audio_create` for direct work, or a typed root-origin
  production kind;
- `origin` — the trusted discriminated causation union above;
- `objective` — the requested outcome;
- `instruction` — creator intent rewritten for the bounded domain assignment;
- `target` — stable project, storyboard, scene, beat, panel, asset, lineage, or
  timeline IDs, never position-only references;
- `requiredOutputs` — output roles and asset kinds that define completion;
- `allowedOutputKinds` — a server-derived capability boundary, never supplied
  by the client;
- `creativeConstraints` — tone, mood, pacing, continuity, and other constraints
  set by the creative director;
- `preserve` — approved assets, selections, fingerprints, or pins that must not
  change;
- `candidateAffectedAssetIds` — graph-computed candidates the domain may
  inspect, not permission to regenerate all of them;
- `budgetUsd` — maximum allocation for the assignment;
- `approvalContext` — an approved proposal/fingerprint token when relevant;
- `acceptanceCriteria` — concise checks the domain must satisfy before `done`;
- `responseRecipient` — creative director for root-origin work or authenticated
  creator conversation for creator-direct work.

The task is typed control/audit data, so schema-marked JSONB on the finite
`orchestrator_runs` row is appropriate. Stable creator-facing storyboards,
beats, panels, timelines, approvals, and creative state remain relational and
graph-backed.

### Up: `DomainReport.v1`

A domain turn emits exactly one agent-authored outcome:

- `done` — includes ordered output asset IDs, intrinsic asset roles, explicitly
  changed selection roles, acceptance evidence, and a compact session summary.
  Creator-direct completion returns to its API/UI caller and never wakes a root
  run;
- `blocked` — carries a domain-safe projection of the existing
  `PreconditionMiss` shape plus the required domain, stable targets, and why the
  current domain cannot satisfy it. Raw sibling primitive names in
  `satisfyWith` or `suggestedNextTools` remain in the action audit but are
  translated before the domain model sees or emits the report;
- `question` — carries one bounded creative question, relevant target IDs,
  available options/tradeoffs, and the fingerprint that must still match when
  the answer is applied.

`failed`, `canceled`, `timed_out`, `queued`, and `superseded` remain runtime
assignment states, not additional agent-to-agent report vocabulary. A missing
tool/graph prerequisite is `blocked`; a creative judgment outside domain
authority is `question`.

Every finite run has a durable session sequence and idempotency scope. Its
terminal report action is uniquely persisted. For root-origin work, an atomic
compare-and-set applies the existing delegation action and wakes the parent
dispatch exactly once. A creator-direct report never wakes a root or finalizes
a delegation action. Root-origin questions go to the creative director, which
answers from current project constraints or uses its existing recommended
approval path. Creator-direct questions go to the creator-facing conversation.
A fingerprinted, one-use answer creates the next finite run in the same
session. It may spend only within the already approved ceiling; a materially
changed or more expensive successor requires a new proposal. Same-domain
prerequisites self-heal before either origin receives an escalation.

For a creator-direct `blocked` report, the UI may offer only explicit, validated
actions: attach an authorized project asset that satisfies the typed dependency,
or involve the creative director/dependency domain. Attachment validates project
ownership, asset kind, graph relationship, and current pins. No blocked report
may silently start a sibling agent or a full production.

### The asset graph is the real communication channel

Tasks and reports carry control flow, intent, constraints, and stable IDs. They
do not copy creative state between agents.

At the start of every domain turn, the agent re-reads the authorized projection
of current assets, edges, selections, pins, and relational story objects. It
writes results as new immutable assets/actions and moves selections through
existing append-only mechanisms. The next agent observes those graph writes.

Session history may retain recent instructions, answers, unresolved questions,
and compact summaries for conversational continuity. It is routing context,
never an alternate source of creative truth. Compaction must retain referenced
asset/action IDs and must not preserve stale copied project snapshots.

## Durable session and run model

A persistent session is an identity and continuity boundary; the existing
orchestrator run is the finite, replayable assignment execution of `driveLoop`.
Do not add another finite-work identity.

The persistence identities are deliberately distinct but minimal:

- `agent_sessions.id` identifies the permanent project/domain continuity record;
  there is exactly one for each `(project_id, domain)` for the project's
  lifetime. The row owns atomic next-sequence allocation, active-run ownership,
  and summary-through-sequence/version state.
- `orchestrator_runs.id` identifies one root-to-domain or creator-to-domain
  assignment turn. It contains the typed task, session sequence, trusted origin,
  parent/continuation links, and ordinary finite run lifecycle.
- `actions.id` identifies every primitive invocation and the one terminal
  `domain_report` action. `jobs.action_id`, `assets.created_by_action_id`, and
  general `action_assets` rows provide enforced reverse attribution.
- `orchestrator_dispatches.id` remains the leased execution record for that
  finite run.

There is no `domain_assignments`, `domain_reports`, or free-form message table
in the first cut. The task lives on the finite run; the report is its terminal
action.

```text
trusted origin (creative-director action OR creator-direct request metadata)
  -> agent_sessions (project_id + domain, persistent)
      -> orchestrator_runs N (finite assignment + DomainTask.v1)
          -> primitive actions
              -> async jobs
              -> immutable assets + typed edges
          -> unique domain_report action (DomainReport.v1)
              -> action_assets (ordered output roles)
      -> compact session context for run N+1
  -> origin-specific completion
      -> apply delegation + wake root OR update creator-direct API/UI
```

Do not reopen a terminal child run to simulate persistence. One persistent
session exists per `(project_id, domain)`; every linked run receives its sequence
from the session row, never `max(sequence) + 1`. Multiple runs may be queued, but
only one confirmed finite run per session may hold active ownership. An
unconfirmed quote run does not occupy the session execution slot.

Required invariants:

1. A finite domain run is created idempotently from exactly one trusted origin
   before execution begins. Root-origin work also creates its delegation action
   atomically.
2. Every domain run links to one session plus either the originating root
   run/action or authenticated creator-direct causation, never both and never
   neither. The run itself is the assignment.
3. Origin, session, run, parent run/action, actions, jobs, `action_assets`, and
   assets always share project/workspace authorization. Composite same-project
   foreign keys or equivalent triggers enforce every new link. A dispatch's
   workspace is derived server-side and must match its run project's workspace.
   A domain run's role matches its session domain, root-origin action belongs
   to the declared parent run, and hierarchy depth never exceeds two.
4. A domain registry cannot contain dispatch, root coherence, or sibling tools.
5. Every primitive call is checked against the task's stable targets; a
   restricted registry alone is not authorization for the whole project.
6. Runs in one persistent session are serialized across both origins. A new
   atomic database claim selects the earliest eligible sequence while locking
   and reserving the session, retains active ownership across media/job waits,
   and clears it only on terminal completion, cancellation, or supersession.
   Queued state is visible; creator-direct work cannot supersede or invalidate
   a root-origin run's pins.
7. A partial unique index permits exactly one `domain_report` action per finite
   domain run. One idempotent transaction inserts the report/action-assets,
   terminalizes the child, advances the guarded session summary, clears active
   ownership, compare-and-sets the root delegation when applicable, and wakes
   the parent exactly once. Direct completion has no parent wake.
8. A late completion from sequence N cannot mutate active selections or revive
   work after sequence N+1 supersedes it.
9. Costs remain in existing model/provider cost and credit records, are charged
   once, and aggregate across a root run family without copying charges.
10. Sessions are permanent continuity identities and are never canceled. Root
    cancellation cascades only through its parent/child run links; a
    creator-direct cancellation affects only that run and its continuations.
    Both cancel their causally linked jobs. Provider callbacks verify the
    durable session claim generation copied onto the job, active run, current
    pins, and terminal/supersession state before applying outputs.
11. Root-origin approval uses the existing root run gate. Creator-direct work
    creates its finite run and proposal action without enqueueing provider work,
    then reuses an extended run gate bound to actor, request digest, budget
    ceiling, and one-use token before the existing dispatch is enqueued.
12. Assets remain immutable; changes mint versions and append selections.
13. Session compaction preserves control continuity and stable IDs without
    becoming a second creative-state store. `summary_through_sequence` or an
    equivalent version CAS prevents an older run from overwriting newer context.
14. Existing action, edge, selection, job, cost, and asset provenance remains
    visible even though the root consumes a compact report.
15. General `action_assets` rows own per-action input/output direction, role,
    and ordinal; `assets.created_by_action_id` and typed asset edges retain
    immutable creation/dependency provenance. Legacy UUID arrays agree during
    compatibility and never become a second source of truth.
16. Untargeted creator-direct outputs never move active selections. Targeted
    selection movement requires explicit intent, pinned current state, and one
    transactional revalidation.
17. Raw task specs, reports, questions, actor/request metadata, and approval
    material are owner/service-only. Public projects receive only sanitized
    progress/media projections, never raw control rows.

## PR dependency map

```mermaid
flowchart TD
  P1["PR 1 — Decision-eval regression bar"]
  P2["PR 2 — Architecture contract"]
  P2 --> P3["PR 3 — Tool ownership"]
  P2 --> P4["PR 4 — Session + run extensions"]
  P4 --> P5["PR 5 — Idempotent provenance wiring"]
  P3 --> P6["PR 6 — Turn-boundary dispatch"]
  P5 --> P6
  P3 --> P7["PR 7 — Graph context + scope"]
  P4 --> P7
  P6 --> P8["PR 8 — Reused driveLoop profiles"]
  P7 --> P8
  P8 --> P9["PR 9 — Budget + runtime controls"]
  P9 --> P10["PR 10 — Visuals"]
  P9 --> P11["PR 11 — Audio"]
  P10 --> P12["PR 12 — Creator-direct API"]
  P11 --> P12
  P12 --> P13["PR 13 — Asset Studio UI"]
  P10 --> P14["PR 14 — Creative director"]
  P11 --> P14
  P12 --> P15["PR 15 — Request Changes"]
  P14 --> P15
  P15 --> P16["PR 16 — Parallel dispatch"]
  P16 --> P17["PR 17 — Hierarchical projection"]
  P13 --> P18["PR 18 — Root rollout"]
  P17 --> P18
  P1 --> P18
  P18 --> P19["PR 19 — Cleanup"]
```

PRs 10 and 11 intentionally own distinct domain files and can proceed in
parallel after PR 9. PRs 12–13 form the standalone product track and were never
contingent on Gate 0. Gate 0 recorded "proceed" (2026-07-16), so PR 14 depends
only on PRs 10–11 and may proceed in parallel with that track; PR 1's eval work
gates the PR 18 default-on rollout as the non-inferiority regression bar, not
PR 14. PR 17 is predominantly an extension of the
root run projection; Asset Studio does not wait for it because PR 12 owns its
stable session/run/status/output API.

### Requirements for every implementation PR

Every PR below follows [`AGENT_WORKFLOW.md`](../../AGENT_WORKFLOW.md): keep a
worksheet and feedback entry, add a targeted observable test, exercise the real
affected app/API path, request the required independent reviews, run
`pnpm agent:lint:fix` and scoped `pnpm agent:validate`, and open a ready PR.
Documentation-only contract PRs record why runtime execution is not applicable.
PRs 13 and 17 additionally use TanStack Query for server state and co-located
CSS Modules for new UI styling.

## PR roadmap

### PR 1 — Baseline decision evals and adoption gate

**Depends on:** this scope being approved.

**Deliver:**

- Extend the existing decision-eval harness with long-context, tool-overload,
  cross-modality, selective-regeneration, premature-done, and recovery cases.
- Run repeated samples against the flat production registry and record accuracy,
  unnecessary-turn, and recovery baselines.
- Add fixture-only simulations of the proposed creative-director/domain
  decision surface; never duplicate live billable generation.
- Record the agreed non-inferiority threshold for the PR 18 cutover bar. The
  proceed decision itself was recorded 2026-07-16 on design grounds (see
  Decision Gate 0); this PR's record captures the regression threshold and
  baseline, not an adoption verdict. Record standalone domain creation as a
  separate required product track rather than making it contingent on the eval
  result.

**Acceptance:** the team can state which failure modes the regression bar
protects against and what non-inferiority result clears the PR 18 cutover.

**Validation:** deterministic eval unit tests plus repeated opt-in real-model
decision reports.

### PR 2 — Shared domain-agent contract and proposed hierarchy record

**Depends on:** this scope being approved. It may proceed in parallel with PR 1
and does not require the hierarchy result to be “proceed.”

**Deliver:**

- Add a shared contract record establishing persistent Visuals/Audio sessions,
  one reused `driveLoop`, graph-as-state, turn-boundary communication, both
  trusted origins, and the creator-direct entry path.
- Record the creative-director hierarchy, two-level limit, root coherence
  ownership, and proposed North Star changes as **conditional on Gate 0**. Do
  not amend the active central-agent principle or present the hierarchy as an
  approved architecture when Gate 0 is deferred.
- Define `AgentRole`, `DomainTask.v1`, `DomainReport.v1`, report payloads, and
  runtime assignment states in a focused shared module.
- Define the domain assignment identifier as the finite
  `orchestrator_runs.id`, the result identifier as its unique terminal
  `actions.id`, and the public API identifiers as `sessionId` plus `runId`.
  Prohibit redundant domain-assignment/report identifiers and tables.
- Define the trusted `creative_director | creator_direct` origin union, direct
  task kinds, shared-session rule, origin-specific report recipients, and
  project-scoped standalone UI/API interaction contract.
- Document the root coherence tools, domain dispatches, deterministic worker
  boundary, and future-domain admission rule.
- Remove hard-coded tool counts from authoritative prose.

**Acceptance:** reviewers can classify every current tool and outcome, use the
shared domain/direct contracts independently, and distinguish a proposed
hierarchy from the active North Star architecture.

**Validation:** shared-package type tests, documentation links, and
`pnpm agent:validate -- --scope docs`.

### PR 3 — Canonical capability ownership and restricted registries

**Depends on:** PR 2.

**Implementation status:** implemented as an active-behavior-compatible boundary. The
canonical current 18-tool catalog, exact dormant 10/6/2 role registries, bridge
metadata, projection parity, and pure domain-recovery translation are covered
by executable contract tests. The flat production registry remains active;
specialist routing is not enabled by this PR.

**Deliver:**

- Add required `ownerRole`/capability metadata to primitive definitions.
- Replace duplicated tool-name unions with one canonical capability catalog
  that also owns label, execution mode, cost class, and gate metadata.
- Create explicit registry builders for `root`, `visuals`, and `audio`; avoid a
  catch-all `index.ts`.
- Assert every primitive tool has exactly one model-facing owner.
- Prevent domain registries from containing root, sibling, or dispatch tools.
- Translate both cross-domain `suggestedNextTools` and
  `unmetRequirements[].satisfyWith` into domain/stable-target `blocked`
  candidates instead of exposing hidden sibling primitive tools.
- Derive run/UI labels from the same metadata where practical.

**Acceptance:** registry tests prove the mapping in [Tool ownership](#tool-ownership)
and fail on unowned, multiply owned, or cross-domain tools.

**Validation:** registry unit tests and tool-test bridge tests.

### PR 4 — Persistent session and finite-run extension schema

**Depends on:** PR 2. Can proceed in parallel with PR 3.

**Deliver:**

- Add the one new domain-specific table, `agent_sessions`, with project, domain,
  atomic next sequence, active run, durable claim generation, schema-marked compact summary,
  summary-through-sequence/version, timestamps, and a unique
  `(project_id, domain)` identity.
- Extend `orchestrator_runs` so a finite run can carry agent role, optional
  session, monotonic session sequence, task kind, schema-marked `DomainTask.v1`,
  parent/root-action/continuation links, pins, trusted origin causation,
  queryable wait reason, and supersession timestamp. Keep the existing run
  status transport-oriented: `succeeded` means a terminal report was persisted;
  `done | blocked | question` remains report outcome. Add immutable-field guards
  and do not add a separate assignment table.
- Enforce exactly one trusted origin for a domain run: root run/action or
  authenticated creator-direct actor/request metadata. Derive its completion
  recipient from that origin.
- Add a partial unique index permitting one `domain_report` action per finite
  domain run. Keep `DomainReport.v1` in that action's schema-marked params and
  mirror legacy result arrays only during compatibility. Allow the report only
  on a domain-role run and make its params, output links/arrays, and fingerprint
  immutable once inserted.
- Add the general `action_assets` relation with project, action, asset,
  direction, role, and ordinal; composite same-project foreign keys; ordering
  uniqueness; RLS; and an explicit backfill/dual-write/assert/cutover plan for
  action UUID arrays.
- Add nullable `jobs.action_id` with an enforced same-project relation plus a
  nullable domain-session claim generation for callback fencing. PR 5
  preallocates the canonical action and supplies the active generation before
  the existing generated-assets service creates its provider job.
- Add composite same-project constraints for session, parent run/action,
  continuation, action/job, asset creator action, and any new asset references.
  Derive `orchestrator_dispatches.workspace_id` from its run and reject any
  dispatch/run/project workspace mismatch. Add maximum-depth and
  no-self-parenting checks. Enforce origin XOR, role/domain agreement,
  parent-action ownership, same-session terminal continuation, and one-use
  question/block successor rules with constraints/triggers.
- Extend RLS through existing project/workspace ownership helpers. Make sessions
  and raw runs, task specs, report/actions, jobs, actor/request metadata, and gate
  material owner/service-only; replace current public-row access with sanitized
  public progress/media projections where needed.
- Keep dispatch, gate, job, cost, idempotency, asset, edge, and selection tables
  unchanged except for focused columns/constraints needed by this contract.
- Explicitly do not add `domain_assignments`, `domain_reports`,
  `domain_assignment_outputs`, or a second queue/approval/job/cost table.

**Acceptance:** DB tests create/reuse one Visuals session, allocate concurrent
root/direct sequences without collision, enforce active ownership, immutable
identity, one trusted origin, valid parent/continuation links, one terminal
immutable report action, general action/job/asset attribution, public denial of
  raw control data, and cross-project/cross-workspace rejection without a
  synthetic root or duplicate domain tables.

**Validation:** local Supabase migration check, migration/RLS/tenancy tests, and
no migration-history rewrite.

### PR 5 — Idempotent action lifecycle, session store, and provenance wiring

**Depends on:** PR 4.

**Deliver:**

- Preallocate stable action/tool-call IDs before mutating tools execute.
- Make invocation creation idempotently retryable within a run.
- Record `running` before external work launches, then patch lifecycle fields.
- Upgrade the existing idempotency table/helper from find-then-save to an atomic
  reservation/consume transaction suitable for multiple API instances; bind
  project, actor, request digest, and operation scope without adding a new table.
- Add a compare-and-set job claim before provider execution. Pass the
  preallocated canonical action ID into the existing generated-assets service
  and persist it through `jobs.action_id` so retries cannot launch duplicate
  provider work or unrelated leaf actions.
- Extend store queries for session lookup/create, finite-run enqueue/claim,
  role-aware history reads, unique report append, origin-specific completion,
  and root-family projection.
- Pass the canonical root/session/run/action provenance context into
  primitive, job, asset, edge, and selection paths instead of minting unrelated
  wrapper identities.
- Derive action role/session/origin through `actions.orchestrator_run_id`; do not
  stamp redundant domain assignment columns onto actions.
- Same-project validate every task/report `input_asset_ids` and
  `output_asset_ids` write while preserving intrinsic asset roles and typed
  asset edges.
- Include invocation recording in bounded store retry without duplicate action
  rows, and preserve immutable decision fields and append-only audit behavior.

**Acceptance:** concurrent request/job crash-retry tests prove one logical
invocation creates one action and one provider launch, session claims are
stable, one immutable report action closes one domain run, direct completion
never wakes a root, and every generated asset can be traced through its
primitive action and finite run to the trusted origin.

**Validation:** API store, concurrency, engine retry, provenance integration,
and action immutability tests.

### PR 6 — Turn-boundary dispatch, reports, and origin-specific completion

**Depends on:** PRs 3 and 5.

**Deliver:**

- Implement one internal domain-run service plus root-only `delegate_visuals`
  and `delegate_audio` adapters. The service accepts only server-derived trusted
  origin/scope; public creator-direct routes arrive in PR 12.
- In one database transaction, reserve the idempotency key, allocate the next
  session sequence, create the task-bearing finite run and root delegation
  action where applicable, persist any required gate, and enqueue the existing
  dispatch row. A replay returns those same identities.
- Add a domain-wait state distinct from media-job and approval waits.
- Finalize a domain turn in one idempotent transaction: insert the immutable
  `done | blocked | question` report action and `action_assets`, terminalize the
  child, compare-and-set the session summary/version, clear active ownership,
  apply the root delegation when applicable, and wake its parent dispatch once.
  Creator-direct completion has no parent mutation or wake.
- Resume a questioned/blocked session through a later sequenced finite run,
  never an out-of-band message.
- Define continuation semantics explicitly: `blocked`/`question` closes the
  current finite run, and the answer creates a successor with
  `continues_run_id`, current pins, and a new session sequence.
- Add attempt/cycle limits so two domains cannot bounce the same unmet
  requirement indefinitely.
- Extend the existing dispatch claim transaction to select the earliest
  eligible confirmed sequence, lock/reserve the `agent_sessions` row, serialize
  one active finite run per session across origins, and expose queued state. An
  unconfirmed quote does not occupy this slot, while an active run retains
  ownership across media-job waits.
- Increment a durable session claim generation when active ownership changes
  and copy it onto every provider job. Worker-owned starts and transitions must
  also prove the current dispatch lease; async callbacks, report finalization,
  and selection writes compare-and-set the durable claim generation, active
  run, current pins, and terminal state so a reclaimed worker cannot commit
  late even after its transient dispatch lease expires.
- Define safe queue/supersession policy: creator-direct work cannot invalidate
  an orchestrated run's pins; joins remain isolated by origin and child run;
  stale completions are fenced.
- Fence cancellation, inline completion, reclaimed dispatches, duplicate
  callbacks, supersession, and late reports before any domain can run live.
- Enforce depth, per-root child-run, report, continuation, and turn limits.
- Keep this PR at the durable transport boundary: use a fake domain report
  producer in lifecycle tests. Production `driveLoop` report emission lands in
  PR 8, so no domain profile can be enabled here.

**Acceptance:** a transport test executes root → persistent session → child
orchestrator run → fake terminal report action → root resume across processes,
then sends follow-up feedback through a successor run without duplication.
Concurrent creation, reclaimed-lease, media-wait, callback, and report/wake
races preserve one sequence owner, one report, and one parent wake.

**Validation:** engine, task/report transport, recovery-worker, dispatch-lease, race,
cancellation, and idempotency tests.

### PR 7 — Fresh graph context, task scope, and session compaction

**Depends on:** PRs 3 and 4. Can proceed in parallel with PRs 5–6 after the
schema contract is stable.

**Deliver:**

- Build a typed root projection containing active assets/selections, relational
  story objects, domain status, approvals, graph stale candidates, and pins.
- Build role-filtered domain projections from the current graph at the start of
  every finite domain turn.
- Mark run origin and active selection status in domain context. Direct
  pool experiments may remain discoverable graph assets but must not be framed
  as root-approved creative truth or active production requirements unless they
  are explicitly selected/targeted.
- Keep tasks and reports ID-based; never copy a project snapshot into session
  memory as canonical state.
- Make target scope explicit for project, storyboard, scene, beat, panel, asset,
  lineage, timeline item, or export requests.
- Reject primitive inputs outside the run task's stable targets.
- Enforce allowed-target and authorized graph-closure checks server-side for
  every selection append, edge, and minted asset—not only in prompts or parsed
  tool inputs. Narrow project-wide primitives before a domain can call them.
- Separate trusted instructions from creator/project content and enforce
  workspace/project authorization before context assembly.
- Compact long session histories while preserving unresolved questions,
  constraints, report summaries, and referenced asset/action IDs.

**Acceptance:** fixtures prove every role sees current authorized graph state,
not stale copied state, distinguishes pooled experiments from active production
truth, and cannot inspect secrets, hidden tools, unrelated assets, or another
project.

**Validation:** projection, tenancy, prompt-boundary, target-scope, compaction,
token-size, and stale-pin fixtures.

### PR 8 — Role-configured reuse of the existing driveLoop

**Depends on:** PRs 6 and 7.

**Deliver:**

- Introduce `AgentDefinition` with role prompt, registry, context builder, and
  completion/report policy. Keep it declarative and prohibit dispatch tools in
  every non-root definition.
- Parameterize the existing production engine entrypoint to run a root or
  domain definition; do not create a generalized second agent engine.
- Keep one implementation of parking, resumption, action recording, job
  waiting, provider-key context, timeout, and error handling.
- Reject recursive delegation from domain definitions.
- Convert out-of-domain `PreconditionMiss` failures to `blocked`; expose a
  bounded `question` completion for creative escalation.
- Connect production domain completion to PR 6's durable report transport and
  prove `done | blocked | question` emission through the shared loop.
- Split evaluations into root creative/routing decisions and domain leaf-tool
  decisions, using one shared fake-store harness.
- Run the existing flat-root engine and decision suite unchanged through the
  parameterized entrypoint before any domain profile depends on it.

**Acceptance:** the current root behavior/evals pass unchanged through the
parameterized entrypoint; fixture definitions run through that exact production
`driveLoop`, see only their registries/context, self-heal in-domain, and emit a
typed report without a forked runtime.

**Validation:** model, engine, registry-isolation, report-contract, decision-eval,
and opt-in real-provider routing tests.

### PR 9 — Budget, approval, cancellation, and recovery across finite runs

**Depends on:** PR 8.

**Implementation status:** implemented on the finite-run runtime. Budget admission
is keyed to the existing run/action/job identities; cost and credit records stay
canonical; creator-direct confirmation is durable and one-use; and causal
cancellation/recovery controls are wired before domain profiles can use live
provider work.

**Deliver:**

- Reserve child-run budget atomically against the root/direct ceiling before
  billable work starts and settle actual spend exactly once through existing
  cost and credit records. Key reservation and settlement to existing stable
  run/action/job identities so concurrent fan-out cannot overspend.
- Extend `orchestrator_run_gates` for the runtime-owned creator-direct
  proposal/confirmation gate. Create the finite run and proposed action first,
  but do not enqueue its dispatch until the gate records kind, subject proposal
  action, actor, project, request digest, approved maximum, expiry, and a hashed
  one-use token consumed with compare-and-set.
- Reconcile existing job/provider and `model_call_costs` records into one
  root-family projection; do not create an assignment cost ledger. Keep
  `orchestrator_runs.spent_usd` as own-run spend and compute tree totals from
  descendant cost rows so charges are never copied or double-counted.
- Keep `request_approval` as a root-only creative-director tool while the
  runtime persists/enforces root and creator-direct gates with distinct actors
  and recipients.
- Keep sessions permanent and non-cancelable. Cascade root cancellation only to
  causally linked child runs/jobs; cancel a creator-direct run only with its
  continuations/jobs. Ignore late completion after cancellation or
  supersession.
- Define retry/re-dispatch policy for recoverable finite-run failure and
  terminal policy for non-recoverable failure. Gate consumption, budget
  reservation, dispatch enqueue, and idempotency consume share one transaction.
- Extend recovery sweeps to domain waits, unacknowledged reports, active claims,
  existing dispatch leases, unique terminal report actions, and parent wake-up.

**Acceptance:** tests cover insufficient credits, budget exhaustion, root and
direct approval/rejection, changed-input idempotency-key reuse, cancellation,
worker crash, question/resume, blocked/resume, late completion, and exactly-once
cost/report settlement.

**Validation:** engine/store/credit/gate/recovery tests plus a local mocked API
cancel-and-resume smoke.

No domain agent may be enabled against live provider work before this PR.

### PR 10 — Visuals domain profile

**Depends on:** PR 9.

**Implementation status:** implemented on the shared finite-run runtime.
Visuals-only activation is role-gated; task-kind registries, standalone
generated-asset wrappers, generic graph images, pre-invocation target/pin
authorization, pooled revisions, and mixed recovery precedence are wired.
Audio, creator-direct HTTP routes/UI, root delegation cutover, and graph-wide
Request Changes remain in their owning later PRs.

Scoped production targeting keeps relational storyboard IDs distinct from
ShotPlan IDs and translates only through the exact plan-bound positional
mapping. Partial storyboard work preserves validated untargeted tiles and
publishes a full immutable attempt. Claimed storyboard graph/relational writes
and the current pointer become visible in one idempotent, exact-claim-fenced
transaction with plan, pointer, and preserved-panel compare-and-set checks.
The transaction validates full selected-plan beat coverage and exact
beat-to-asset provenance before inserting anything. Job-deterministic IDs plus
a persisted bundle fingerprint make lost-response and terminal-state replay
return the original committed result. Exact scene coverage, graph inputs, and
canonical fingerprints are enforced too, and pointer publication plus job
success share the same commit.

**Owns:** new Visuals prompt/config/evals and Visuals registry file.

**Deliver:**

- Scope Visuals to generated anchors, storyboards, keyframes, clips, immutable
  image regeneration, and content-aware video edits; visual-anchor planning
  remains with the creative director.
- Add agent-facing `generate_image_asset` and `generate_video_asset` tool
  wrappers over the existing generated-assets request/job/storage/action/cost
  service for genuine standalone outcomes with no storyboard/beat prerequisite.
  The wrappers derive provider settings server-side. Keep `video_create` and
  `video_edit` distinct; edit requires an authorized, pinned source asset.
- Add the generic graph `image` kind end to end with an additive enum migration,
  kind/media constraint and reference-trigger updates, shared `GraphAssetKind`
  and embedding support, storage mappings, generated-asset projections,
  catalog/search/regeneration support, and migration/API tests. Preserve
  explicit production mappings such as `anchor`, `beat_keyframe`,
  `beat_storyboard`, `scene_storyboard`, and `act_mockup`; only a genuinely
  standalone still defaults to `image`. Do not enable standalone image work
  before this migration lands.
- Continue to use `clip` for a generated video segment and `composite` plus
  `render` for an assembled standalone video.
- Narrow project-wide primitives with explicit beat, panel, anchor, source
  asset, or lineage targets.
- Keep storyboard → keyframe → clip prerequisite recovery inside the session.
- Preserve anchor identity, selected slots, immutable source links, content
  hashes, provider/duration constraints, and uploaded-footage grounding.
- Keep minor/photorealistic-provider policy in deterministic tool contracts.
- Return `blocked` for missing root-owned visual-anchor plans or required Audio
  work, and `question` when the visual change requires story, pacing, or
  approval judgment. Route the report to the origin-specific recipient.
- Prove root-origin and creator-direct image/video runs reuse the same
  serialized Visuals session without contaminating pins or origin joins.

**Acceptance:** first-pass production visuals, standalone image/video assets,
targeted still revision, new clip, uploaded-footage edit, missing keyframe
recovery, and creative escalation all run through one persistent Visuals
session with correct lineage and selection behavior.

**Validation:** Visuals decision evals, tool batteries, provider-policy tests,
graph/selection assertions, follow-up-session tests, and opt-in media smoke.

### PR 11 — Audio domain profile

**Depends on:** PR 9. Can proceed in parallel with PR 10.

**Owns:** new Audio prompt/config/evals and Audio registry file.

**Implementation status:** implemented as a task-bound Audio profile over the
shared finite-run engine and canonical `generate_audio` /
`fit_audio_to_picture` vocabulary. Production work records exact
plan/brief/script dependencies; standalone creation uses the generated-assets
service without a fabricated plan or selection; and source-targeted delivery
revisions mint a new immutable audio lineage version. The creator-direct HTTP
entrypoint remains intentionally owned by PR 12. Production speech fails closed
without server-resolved script copy, picture fitting requires a current planned
beat, and the generated-assets plus locked RPC boundaries preserve revision
subtype, role, and exact spoken words.

**Deliver:**

- Scope Audio to narration, dialogue, music, sound generation, and fitting audio
  to picture.
- Add `soundtrack_create` and freeform `audio_create` modes that can generate a
  graph-backed `audio_track` without a timeline slot or fabricated plan. Reuse
  the existing generated-assets audio job/provider/storage/action/cost service
  beneath the Audio tool wrapper.
- Add explicit narration, dialogue, music, beat, asset, or timeline-slot targets
  where current tools accept only project-wide intent.
- Preserve typed mix/alignment metadata, active selections, timing constraints,
  and immutable graph inputs.
- Distinguish regenerating delivery/fitting from changing spoken meaning, which
  becomes `question` for the creative director.
- Return `blocked` when current picture assets are a hard prerequisite.
- Prove root-origin and creator-direct soundtrack work reuses the same
  serialized Audio session with distinct origin joins and recipients.

**Acceptance:** voiceover, production music, standalone soundtrack/audio,
refit, “redo warmer,” dialogue-meaning change, and picture-too-short scenarios
produce correct local work or typed escalation across one persistent Audio
session.

**Validation:** Audio decision evals, alignment tests, tool batteries,
asset-edge/selection assertions, follow-up-session tests, and opt-in audio smoke.

### PR 12 — Creator-direct domain API and follow-up contract

**Depends on:** PRs 10 and 11. This is part of the standalone track and does
not require Gate 0 to say proceed.

**Owns:** a focused protected route such as `agent-creations.ts`, its
smallest protected mount, shared request/response types, and web client/query
primitives. It does not add a broad route `index.ts`.

**Deliver:**

- Add project-scoped, authenticated endpoints to propose and quote a typed
  Image, Video, Video Edit, Soundtrack, or Audio request; explicitly confirm it;
  and idempotently enqueue it through PR 6's single internal domain-run service.
- Use a discriminated server-validated request shape. The server maps product
  kind to Visuals/Audio, derives `taskKind`, trusted creator-direct origin,
  authorized targets/closure, and allowed output kinds. It never infers edit
  intent from prompt text or accepts raw `DomainTask.v1` from the client.
- Require a pinned authorized source asset for `video_edit`; validate project
  ownership and current fingerprints for every reference or target.
- Bind proposal confirmation and idempotency to project, actor, request digest,
  approved maximum, and one-use approval token. Return `202` with stable
  session and finite run IDs only after confirmation.
- Add stable session/run/status/report/output/provenance reads sufficient
  for Asset Studio; do not make PR 13 depend on the later root-tree projection.
- Add fingerprinted, one-use creator-direct question answers, validated blocked
  dependency attachment/escalation, cancel, and direct follow-up Request Changes
  operations. Every answer/follow-up creates a successor run in the same
  session; only creator-direct questions are answerable by these routes. Before
  PR 15, follow-ups are limited to unselected, unconsumed standalone outputs;
  return a typed production-change handoff for anything with downstream use.
- Save untargeted output to the project asset pool without changing active
  selections. Explicit targeted selection movement must revalidate pins and
  commit transactionally. Before PR 15, “Use in project” may fill only an
  eligible empty target with no downstream consumers; replacing or invalidating
  production structure remains disabled.
- Keep authorization in the protected route and existing project/workspace RLS;
  never trust a client-declared domain, owner role, origin, scope, or recipient.

**Acceptance:** API tests cover direct image, video, video edit, soundtrack, and
follow-up creation; changed-input idempotency-key reuse; quote rejection;
creator question/answer; blocked attach/escalate; cancel; queued root/direct
contention; output retrieval; selection non-movement; and cross-project denial.
A direct completion cannot wake a root or finalize a delegation action.

**Validation:** protected-route, request-union, RLS, proposal/gate, idempotency,
successor, queue, graph-scope, selection, and mocked-provider integration tests.

### PR 13 — Asset Studio standalone creation UI

**Depends on:** PR 12. This is part of the standalone track and does not require
Gate 0 to say proceed.

**Owns:** an outcome-oriented route such as `/create` and
`StandaloneCreationPage.tsx`, co-located CSS Modules, typed query hooks, and
small launch points from authenticated product surfaces.

**Deliver:**

- Add one Asset Studio with an Image / Video / Soundtrack goal selector, normal
  destination-project choice/creation, one intent prompt, optional references
  and bounded creative constraints, a cost proposal, and one primary action.
- Label outcomes in creator language; do not expose internal agent names, raw
  provider/model/seed controls, tool names, or a raw domain-task editor.
- Require explicit proposal confirmation before launch. Show cost/credit impact
  and allow rejection or revision without dispatching billable work.
- Transition into an observe-first session view with skeleton/loading states,
  queued/active/waiting/blocked/failed/canceled states, durable progress,
  provenance, cost, alternatives, and immutable outputs.
- Make completed outputs discoverable through the existing project asset
  library as well as stable Asset Studio deep links; do not create a second
  client-only gallery or standalone asset store.
- Answer creator-direct questions in the same conversation. For blocked work,
  offer only validated dependency attachment or an explicit handoff to the full
  production flow. Never auto-start a sibling or hidden production.
- Use Request Changes for safe unconsumed-output follow-ups in the same shared
  domain session. Offer “Use in project” only for PR 12's eligible empty target;
  otherwise explain that the full production-change path is required.
- Use TanStack Query for server state, typed client functions next to the API
  module, CSS-variable tokens, and co-located CSS Modules. Cover keyboard,
  screen-reader, reduced-motion, empty, error, desktop, and mobile behavior.
- Ship behind a standalone-specific feature flag and enable only after the
  direct API/media smoke and UX acceptance checks pass; it is independent of
  the creative-director rollout flag.

**Acceptance:** a creator can make, inspect, revise, and reuse an image, video,
or soundtrack without starting a full production; the result remains in the
chosen project's asset graph with complete provenance and does not silently
replace any selected production asset.

**Validation:** web unit/query tests, accessibility checks, desktop/mobile
browser QA, behavior-focused Playwright, real route/API smoke with mocked
providers, and E2E inventory updates.

### PR 14 — Creative-director profile and root tool surface

**Depends on:** PRs 10 and 11. Gate 0 recorded "proceed" on 2026-07-16 (see
Decision Gate 0), so no baseline study blocks this PR. It may run in
parallel with PRs 12–13 because all three reuse the same stable domain contracts.

**Deliver:**

- Promote PR 2's conditional hierarchy record to accepted status and amend
  `docs/NORTH_STAR.md` Principles 1, 3, 6, 7, and 10: the creative director owns
  the whole flow; one engine means one `driveLoop` shared by all agents; domains
  self-heal only in-lane; graph state moves between agents by ID; and the agent
  system remains the only writer.
- Replace the flat all-tools root registry with the exact root ownership in
  [Tool ownership](#tool-ownership).
- Add a creative-director prompt that explicitly owns story, cross-modality
  constraints, visual-anchor planning, assembly, critique, approval, blast
  radius, and completion.
- Feed the root current graph state, compact origin-filtered domain reports,
  unresolved questions, active/queued child runs, costs, gates, and pins.
- Make the root choose between its coherence tools and domain dispatch, never a
  leaf media/provider tool.
- Support fresh projects, partial projects, resumes, multi-domain requests,
  blocked prerequisites, creative questions, and queued creator-direct work.
- Ship behind a temporary hierarchy feature flag, off by default.
- Compare decisions only; never execute flat and hierarchical billable work in
  shadow mode.

**Acceptance:** root evals preserve creative coherence and choose the correct
root tool/domain/done across the scenario matrix; the registry cannot name a
leaf Visuals or Audio tool, and creator-direct history does not masquerade as
root-approved project truth.

**Validation:** creative-director/routing evals, end-to-end fake child runs,
entry-route tests, concurrent-origin fixtures, and a mocked-provider API smoke.

### PR 15 — Request Changes and graph-scoped selective regeneration

**Depends on:** PRs 12 and 14; `graph-rerun-decisioning-prs.md` PR 1 (read-only
proposal assembly) and PR 2 (agent decision/pinned-ID contract); and
`regeneration-coverage-prs.md` PR 1 plus the enabled kind-specific coverage PRs
(PR 2 keyframe, PR 3 clip, PR 4 audio, PR 5 cut, PR 6 storyboard). A scenario
must remain disabled until its corresponding immutable regeneration path exists.
Reuse graph-rerun PR 4/5 execution/fallback contracts where they have landed;
do not duplicate them here. Safe unconsumed creator-direct follow-ups already
exist in PR 12; this PR owns root-directed multi-domain selective regeneration
and unlocks direct changes/reselection after an output has production consumers.

**Deliver:**

- Route every production object-scoped Request Changes message through a
  new/revived root turn with stable target IDs and current provenance.
- Replace fixed restart-stage boundaries with `downstream_assets()` candidates
  plus creative-director semantic pruning.
- Reuse the appropriate persistent domain session for follow-up feedback such
  as “redo beats 3–5 warmer,” while preserving origin/run isolation.
- Propose a costed root work plan before expensive/fan-out revisions.
- Preserve unaffected assets/selections and fence work with current
  fingerprints.
- Keep approval, rejection, and selection among existing assets as the existing
  explicit UI carve-outs.
- Extend creator-direct Request Changes and “Use in project” from PR 12's safe
  unconsumed subset to selected/consumed outputs only through the same
  blast-radius, fingerprint, proposal, and downstream reconciliation contracts.

**Acceptance:** visual-only, audio-only, pacing-only, upstream-story, and mixed
requests regenerate only the approved graph region and remain auditable.

**Validation:** API integration with graph fixtures, Request Changes E2E, stale-
candidate/pruning evals, origin-isolation, and persistent-session follow-up tests.

### PR 16 — Cross-session parallel dispatch and deterministic fan-in

**Depends on:** PR 15. Serial delegation must be stable first.

**Deliver:**

- Add one root-only batched `delegate_domains` capability. A single model tool
  call atomically creates independent Visuals/Audio child runs and parks the
  root on their durable join; separate parking delegate calls cannot implement
  fan-out because the first would stop the current root turn.
- Reuse PR 6's one-active-run session guarantee while allowing different
  domain sessions to run in parallel. Creator-direct work in the same domain is
  visibly queued and cannot join, supersede, or invalidate root-origin work.
- Reserve budget so concurrent child runs cannot exceed the root ceiling.
- Resume only when required reports arrive; keep optional/failed branches
  explicit.
- Reconcile immutable assets/selections using fingerprints so late results
  cannot overwrite newer choices.
- Keep within-domain beat/provider fan-out in server-owned jobs.

**Acceptance:** Visuals and Audio overlap, survive a worker restart, respect
budget/session locks, isolate origin joins, and fan into root assembly/critique
exactly once.

**Validation:** concurrency, lease, session-lock, origin-join,
budget-reservation, fingerprint-conflict, and timed mocked-media tests.

### PR 17 — Hierarchical session/run API and observe-first production UI

**Depends on:** PR 16. It extends PR 12's stable domain projection rather than
replacing it; web fixture work may begin earlier.

**Deliver:**

- Extend run-detail APIs with the root tree, persistent domain sessions, finite
  child runs, terminal report actions, and primitive action/job drill-down.
- Project creator-facing progress from creative work and domain outcomes rather
  than a numbered primitive-tool pipeline.
- Show active/queued/waiting/blocked/failed states and root handling of
  root-origin domain questions without exposing reasoning traces or presenting
  internal sessions as unrelated user conversations.
- Keep the production page's one creator-facing root feedback/approval loop and
  no direct-edit controls; creator-direct question mutations remain confined to
  Asset Studio and creator-direct run authorization.
- Use TanStack Query for polling, cache updates, and invalidation.
- Add route/component CSS Modules only; do not grow legacy global styles.

**Acceptance:** users can understand what the creative director delegated,
which domain is active or queued, what it produced, and which root proposal
needs creator approval on desktop/mobile, while standalone runs retain
their correct direct recipient.

**Validation:** API projection, origin-recipient, web unit, browser
desktop/mobile, behavior-focused Playwright, and E2E inventory updates.

### PR 18 — Creative-director default-on rollout and soak

**Depends on:** PR 17, green parity/evaluation evidence, and PR 13 so every
production surface understands shared domain-session contention.

**Deliver:**

- Enable creative-director/domain routing by default while retaining a
  time-bounded emergency fallback flag. Do not couple the independently managed
  Asset Studio flag to this root-cutover flag.
- Define soak duration, success/error/cost thresholds, rollback owner, and
  monitoring for decisions, child runs, cross-origin session contention, and
  exports.
- Exercise every production entrypoint and Request Changes path through the new
  default without executing duplicate billable work.
- Record the explicit cleanup decision after thresholds hold for the soak.

**Acceptance:** the new root path is default-on, all production entrypoints meet
the agreed soak thresholds, standalone creation remains intact, and rollback is
verified without data-shape divergence.

**Validation:** production-like API/E2E smoke, cross-entry contention tests,
monitoring queries, rollback rehearsal, and recorded soak evidence.

### PR 19 — Remove the flat root surface and synchronize as-built docs

**Depends on:** PR 18 completed soak and cleanup decision.

**Deliver:**

- Remove the fallback flag and delete primitive media exposure from the root
  prompt while keeping primitive implementations for domain registries and
  creator-direct runs.
- Remove fixed stage-restart logic replaced by graph-scoped feedback.
- Update `NORTH_STAR.md`, async-orchestrator research, tool docs, manual tests,
  and operator runbooks to the as-built architecture and both entry modes.
- Replace sequential pipeline diagrams with product architecture,
  runtime/session, and data/lineage views. Do not market the hierarchy as
  shipped before cutover.
- Remove stale tool counts and derive detailed registry docs from ownership
  metadata where practical.

**Acceptance:** every full-production entrypoint uses the creative-director
profile; root cannot call leaf media tools; direct API/UI requests still use the
same domain profiles; each primitive has exactly one owner; domain follow-ups
reuse persistent sessions; no flat fallback or stale flag remains.

**Validation:** full API tests, provider-neutral E2E, standalone and production
entry smokes, selected opt-in tool smokes, migration status, docs validation,
browser QA, and deployment smoke.

## Required scenario matrix

| Creator/project state | Expected system decision |
| --- | --- |
| Standalone image request | Creator-direct `image_create` in the project's Visuals session; immutable pooled output, no automatic selection |
| Standalone video request | Creator-direct `video_create` in the project's Visuals session with no fabricated beat/storyboard |
| Existing video edit | Creator-direct `video_edit` with an authorized pinned source asset, never inferred from prompt text |
| Standalone soundtrack request | Creator-direct `soundtrack_create` in the project's Audio session with no fabricated timeline slot |
| Direct request before approved cost | Return proposal/quote; do not enqueue billable work until explicit confirmation |
| Direct question | Address the creator conversation; fingerprinted answer creates a successor in the same session |
| Direct cross-domain block | Offer validated dependency attachment or explicit full-production handoff; do not auto-start it |
| Direct follow-up (“warmer”) | Same-session successor while the output is unconsumed; otherwise graph-scoped production Request Changes after PR 15 |
| Direct output completes | Add to project asset pool; terminal report action lists ordered IDs and assets retain role/lineage; do not move a selection unless explicitly targeted and revalidated |
| Later full production uses a direct asset | Root observes the existing graph asset and may explicitly select/reuse it; session continuity remains shared |
| Root and direct request target one domain | Serialize visibly; direct work cannot supersede or invalidate root pins or join state |
| Fresh idea | Use root brief/story/script/shot-planning tools |
| Visual-first short with sufficient brief | Root plans shots/visual anchors or dispatches Visuals based on graph state |
| Shot plan without storyboard/keyframes | Dispatch Visuals |
| Keyframes without clips | Dispatch or continue Visuals |
| Visuals discovers a missing keyframe for a clip | Self-heal inside Visuals and retry |
| Clips without required audio | Dispatch Audio |
| Media ready, no timeline | Root calls `assemble_timeline` |
| Timeline ready, not reviewed | Root calls `critique_timeline` |
| Expensive approved repair proposed | Root calls `request_approval` before dispatch |
| Reviewed/approved timeline | Root calls deterministic `export_video` |
| “Redo beats 3–5 warmer” | Successor run in the existing Visuals session |
| “Remove the logo from this footage” | Visuals, scoped to the source asset |
| “Shorten this narration” | Audio if delivery/fitting; root story planning if meaning changes |
| “Make the opening faster” | Root assembly/pacing decision; dispatch only if source coverage changes |
| “Rename the protagonist everywhere” | Root story decision, then graph-scoped Visuals/Audio follow-ups |
| Visuals requires an Audio asset | `blocked(PreconditionMiss)` → root dispatches Audio → resumes Visuals |
| Visuals asks whether realism or style should win | `question` → root answers/resumes; if necessary, root proposes one recommended creator approval |
| User cancels during domain media work | Root/session child-run cancel; late result is fenced |
| Two independent repairs | Parallel Visuals/Audio child runs, serialized per session, deterministic fan-in |

## Merge-conflict plan

- PRs 10 and 11 own separate domain prompt, registry, and eval files.
- PR 3 creates role-specific registry boundaries before domain work so agents do
  not all edit `default-registry.ts`.
- PR 4 alone owns the `agent_sessions` table, general `action_assets` relation,
  run/job extensions, and their constraints. PRs 5–6 own store/lifecycle logic
  sequentially; PR 10 alone owns the generic-image enum and mappings.
- PR 12 owns one explicit creator-direct API route group and shared projection;
  PR 13 owns standalone web route/components in distinct files.
- PR 14 owns the root prompt/config after domain profiles stabilize.
- PR 17 extends the production projection/UI without replacing PR 12's Asset
  Studio contract.
- PR 18 owns only root rollout/soak; PR 19 is the only broad cleanup and as-built
  documentation synchronization PR.
- Avoid new route/feature `index.ts` aggregators; use explicit names such as
  `root-agent.ts`, `visuals-agent.ts`, `audio-agent.ts`,
  `domain-session-store.ts`, `agent-creations.ts`,
  `standalone-agent-creation.ts`, and `session-run-projection.ts`.

## Rollout gates

Standalone API/UI activation and creative-director cutover use separate flags
and gates. Do not enable billable standalone creation until PRs 2–13 meet their
security, proposal, provenance, UX, and media-smoke acceptance. Do not enable
creative-director routing by default until all are true:

1. Gate 0 recorded "proceed" (2026-07-16); root decision evals meet the agreed
   non-inferiority bar against the flat root on the paired repeated-sample
   matrix.
2. Visuals and Audio have registry-isolation and leaf-tool decision evals.
3. A provider-neutral end-to-end run reaches export through persistent sessions.
4. Request Changes passes visual, audio, pacing, and upstream multi-domain cases.
5. Finite-run crash recovery, serialization, cancellation, approval, and budget
   tests pass.
6. Late/superseded child-run results cannot mutate current selections.
7. The production UI accurately projects active/queued/waiting/blocked/failed
   work, root handling of root-origin domain questions, and creator-facing root
   approvals. Asset Studio separately handles only creator-direct recipients.
8. No leaf domain tool is exposed to the root or multiply owned.
9. Session memory is bounded and demonstrably not a second creative-state store.
10. Atomic idempotency, provider-job claim, durable session-generation fencing,
    worker lease fencing, immutable report finalization, and exactly-once
    parent wake pass concurrent tests.
11. Raw tasks, reports, questions, jobs, gates, and actor/request metadata are
    not readable through public-project policies.
12. No retired schema surface, untyped product JSONB, or direct-edit UI is added.
13. The default-on path completes its defined soak before the flat path is
    deleted.

## Non-goals

- Replacing the immutable asset graph or relational storyboard model.
- Moving creative decisions into deterministic server workflows.
- Building a new agent loop, workflow engine, or per-domain fork of `driveLoop`.
- Creating a separate Story, Edit, or Review agent in the first cut.
- Splitting still-image and motion generation into separate agents in the first
  cut; Visuals owns their prerequisite chain.
- Letting domains chat directly, delegate recursively, or receive mid-flight
  messages.
- Treating session memory as canonical creative state.
- Passing raw media, provider responses, secrets, or full action histories into
  model context.
- Wrapping providers, queues, storage, selection writes, or rendering in agents.
- Reintroducing a fixed forward-only pipeline or stage tables.
- Adding direct content-edit controls to the dashboard.
- Supporting arbitrary third-party domain plugins in the first cutover.
- Creating workspace-global, temporary, or hidden default projects/assets for
  standalone work.
- Creating separate “image agent” and “video agent” sessions; both are task
  kinds in the project's one Visuals session.
- Exposing raw provider/model/seed controls or treating generation as an opaque
  prompt-to-URL endpoint.
- Fabricating dummy storyboards, beats, timeline slots, or retired legacy data
  to make standalone generation fit a production primitive.
- Adding domain-specific assignment, report, output, dispatch, gate, job, or
  cost tables when the existing finite-run/action/runtime records own the same
  lifecycle.
- Treating legacy action UUID arrays as an integrity-enforced replacement for
  the general `action_assets` relation.

## Definition of done

- The root is demonstrably a creative director plus router, not a router alone.
- Root retains planning, assembly, critique, approval, export, and completion.
- Visuals and Audio run the exact shared durable `driveLoop` with restricted
  registries, prompts, graph context, and persistent project/domain sessions.
- A creator can independently request, inspect, revise, and reuse an Image,
  Video, or Soundtrack through a typed project API and Asset Studio without
  starting a full production.
- Root-origin and creator-direct finite runs reuse the same serialized
  project/domain session while preserving trusted origin, pins, recipients,
  joins, approvals, and completion behavior.
- Inter-agent communication is limited to durable tasks and
  `done | blocked | question` reports at turn boundaries.
- The asset graph remains the only canonical creative-state channel.
- Every root decision, finite domain run, primitive action, job, asset, edge,
  selection, cost, and report remains attributable across restarts.
- `agent_sessions` is the only domain-specific table; existing runs, actions,
  dispatches, gates, idempotency, jobs, costs, and graph tables retain their
  lifecycle authority, with general `action_assets` closing the attribution
  gap for every tool.
- Creator feedback reuses the correct session, proposes a graph-scoped plan, and
  regenerates only approved affected assets.
- Visuals and Audio can run concurrently while each session remains serialized.
- Standalone outputs are immutable project assets with typed lineage and do not
  silently move production selections.
- The UI presents one understandable creative production plus one calm,
  outcome-oriented Asset Studio, both observe-first and without direct content
  mutation or raw provider controls.
- The flat all-tools root prompt, fixed restart boundaries, stale counts, and
  sequential public diagram are removed after cutover.
