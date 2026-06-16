# Asynchronous Tool Calling — Framework Survey And Our Orchestrator

This document summarizes the relevant findings from `deep-research-report (20).md`
("Asynchronous Tool Calling in Continuous Agent Frameworks") and maps them to the
Popcorn Ready orchestrator engine (`apps/api/src/lib/orchestrator/`). The goal is
to (1) place our design in the report's taxonomy, (2) record where we already
follow its best practices, and (3) name the real gaps and the two questions that
actually matter for us: **are we passing too much back to the model, and is the
per-turn error surface a reliability risk?**

## The report's taxonomy (three families)

The report frames every design around three questions — **who owns the loop,
where pending work lives, and how tool outputs re-enter model context** — and
sorts real systems into three families:

1. **Turn-scoped tool loop.** Model emits a tool call → app executes → a second
   model call incorporates the result. Simple and legible, but blocks the turn on
   slow tools. (OpenAI function calling, Anthropic client tools, Semantic Kernel
   auto-invocation, Haystack `ToolInvoker`.)
2. **Deferred / event-driven completion.** Slow work is decoupled via webhooks,
   queues, futures, or durable signals; the pending result lives *outside* the
   model call and is injected back later. (OpenAI Background mode + Webhooks,
   Temporal Signals/Updates, Celery, Ray `ObjectRef`s, Kafka.)
3. **State-machine / workflow orchestration.** Execution is a graph / workflow /
   durable event history owned by a runtime, not by the conversation. Supports
   pauses, retries, approvals, parallel fan-out, and crash recovery. (LangGraph,
   LlamaIndex Workflows, AutoGen Core, Temporal.)

Headline recommendation: **treat the LLM as one participant in a larger runtime,
not as the runtime itself** — separate *conversation context* from *execution
state*, persist execution state durably, and pass compact references/summaries
(not bulky payloads) back to the model.

## Where our orchestrator sits

Our engine is not one family — it is a **hand-rolled durable workflow runtime
(family 3) that uses native provider function-calling (family 1) for the
per-turn decision and deferred completion (family 2) for async media jobs.**

| Report concept | Our `engine.ts` implementation |
|---|---|
| Who owns the loop | The engine (`driveLoop`), not the LLM call — the family-3 stance |
| Per-turn decision | `orchestratorModel` → `chooseTool` with `tool_choice: auto` (family 1) |
| Where pending work lives | `orchestrator_runs` + `actions` rows — a durable event history, not an in-memory thread |
| Tool outputs re-enter context | Each turn re-reads `actions` and projects them via `toPriorResult` into `priorResults` |
| Deferred completion | async tools return `accepted` + `jobId` → `park()` → `resumeOrchestratorRun` when the job is terminal (family 2) |
| Durable pause/resume | run flips to `status: "waiting"`; re-entry replays from persisted state |
| Human-in-the-loop | gate lifecycle `pending → reached → approved/rejected` = the report's "interrupt / signal wait" |

In one line: **a lightweight Temporal/LangGraph for video** — durable event
history, replay-based resume, parking, and gates — with the LLM owning only the
one-step-at-a-time decision.

## Are we passing too much back to the model?

**On context size: no, not at our scale — because we already do the report's #1
recommendation.** `toPriorResult` passes a compact projection per prior action —
`{ tool, status, outputAssetIds }`, plus error-guidance fields on failures — and
the heavy content (briefs, plans, media) stays in the asset pool, referenced **by
ID**. The report's "too much information" warning is specifically about *bulky
payloads, raw files, and verbose traces* in the prompt; we pass IDs and statuses,
not payloads. Ten prior results is on the order of ~1K tokens; the **tool
schemas** (the full catalog passed every turn) are a larger token cost than the
action history, and the report's mitigation there is deferred schema loading
(OpenAI `tool_search`) — a future option, not a present problem.

**The real caveat is unbounded growth on very long runs.** We replay *all* prior
actions verbatim every turn with no windowing or compaction. For a normal video
(~10–20 tool calls) this is fine. For the North Star's recursive composites (a
90-minute movie decomposed into many sub-videos), the action list could balloon,
and the report's guidance applies: add **compaction/summarization of older
actions** (cf. the OpenAI Agents SDK truncation/compaction thresholds) while
keeping call IDs for identity. Not urgent; worth a ticket before long-form.

## Is the per-turn error surface a reliability risk?

This is the more legitimate concern, and here the report **does** point to a more
robust framework than what we have today.

Each turn performs several I/O operations: `listRunActions` + `listRunGates` (two
DB reads), the model call, `executeRegisteredTool` (which may itself write to the
DB / call a provider), `recordInvocation` (write), and often `updateOrchestratorRun`
(write). More turns ⇒ more round-trips ⇒ more chances for a transient failure.

What we handle well today:

- A tool that throws, or returns an **unrecoverable** failure, is caught and the
  run is marked `failed` with a persisted error (never left stuck `running`).
- A **recoverable** failure is surfaced to the model (with `suggestedNextTools` /
  `unmetRequirements`) so it self-heals instead of blind-retrying — the report's
  "fail early and visibly" guardrail pattern.
- Parked runs survive crashes: `resumeOrchestratorRun` replays from the durable
  `actions`, and a sweeper re-enters runs whose worker died.

Where the report is stronger (the gap):

- **No per-step retry/backoff policy on transient infra errors.** If a *store*
  call (`listRunActions`/`recordInvocation`/`updateOrchestratorRun`) or a provider
  blips, `driveGuarded` catches it and fails the **whole run** — there is no
  automatic retry-with-backoff on the individual step. This is exactly the
  family-3 durability that Temporal Activities (retry policies + timeouts +
  replay) and LangGraph provide out of the box. Our "retry" today is coarse:
  resume a parked run, or the model decides to call a tool again.

Practical implication: the per-turn error surface is **not** a reason to pass less
to the model (size isn't the issue); it is a reason to **make each step's I/O
durable/retryable**. The cheapest robustness wins, in order:

1. Wrap the store calls and provider calls in bounded retry-with-backoff for
   transient/5xx/serialization errors before failing the run.
2. Give async tool jobs explicit timeouts + a retry policy (today they park and
   rely on the worker).
3. Only if/when long-form runs land: add action compaction so the replayed
   history stays bounded.

None of these change the loop's shape — they harden the steps, which is precisely
the report's "treat every tool call as a first-class state object with retry
metadata" checklist item.

## Other gaps vs. the report (for the backlog)

- **One tool per turn — no parallel fan-out.** The system prompt says "call at
  most one tool," and `driveLoop` executes strictly one per turn. The report
  devotes a section to concurrency (OpenAI/Anthropic multi-tool calls; LangGraph
  parallel super-steps with reducers). Our **North Star Principle 8 (compose
  recursively; generate in parallel)** wants exactly this for beat-clips and
  sub-videos. The report's caution applies: parallelism "shifts the problem from
  latency to state consistency," so the asset-pool + selections model (immutable
  assets, moving active pointers) is the right substrate to build fan-out/fan-in
  on — it is our reducer.
- **Staleness of propagated IDs.** We pass `outputAssetIds` forward, but the
  North Star fingerprint/`stale` model is not wired, so a late result is attached
  by `jobId` without a version check. Fine today; relevant once selective
  regeneration runs concurrently with in-flight work.

## Bottom line

The report would classify our orchestrator as a **state-machine/workflow runtime
using native function-calling for decisions** — the most robust of the three
families — and we already follow its central recommendation (externalize state,
pass compact ID references). **Context volume is not our risk.** The two worth
acting on are (1) **per-step durability/retries** for the multi-I/O turn, and
(2) **parallel multi-tool execution**, which our own North Star is already pushing
toward.

## Source & related reading

- Source: `deep-research-report (20).md`, "Asynchronous Tool Calling in
  Continuous Agent Frameworks" (uploaded 2026-06-16).
- [NORTH_STAR](../NORTH_STAR.md) — Principle 7 (tool contracts self-heal),
  Principle 8 (parallel recursive composition), the durable-run model.
- Engine: `apps/api/src/lib/orchestrator/engine.ts` (`driveLoop`, `park`,
  `resumeOrchestratorRun`, `toPriorResult`); model: `.../orchestrator/model.ts`.
