# Jobs And Processing Scope

<!-- agent-summary: Long-running API and orchestrator work is represented by durable jobs. -->
<!-- agent-summary: Production jobs persist in Supabase public.jobs, including progress JSONB. -->
<!-- agent-summary: heartbeatAt records worker liveness while lastProgressAt records meaningful advancement. -->
<!-- agent-summary: Async generation workers report current items and completed/total counts where practical. -->
<!-- agent-summary: Orchestrator actions reference durable job IDs and reconcile terminal state after restart. -->
<!-- agent-summary: Structured logs correlate workspace, project, run, action, job, item, and provider. -->
<!-- agent-summary: Polling remains the client transport; durable telemetry distinguishes slow work from stalls. -->

## Objective

Move long-running work out of synchronous request handlers so upload ingest,
media analysis, generation, revision, and export are reliable, retryable, and
observable.

## Job Types

- `asset_ingest`: validate media, extract metadata, create thumbnails.
- `asset_analysis`: optional transcript, scene detection, vision tags, quality
  scoring, embeddings.
- `generation`: plan beats, select clips, critique, create timeline variants.
- `revision`: apply conversational edits to the structured timeline and produce
  a new validated sibling timeline cut.
- `export`: render a timeline to an artifact.

## Job States

- `queued`
- `running`
- `succeeded`
- `failed`
- `canceled`

Each job should include progress metadata where practical:

```ts
interface JobProgress {
  currentStep?: string;
  percent?: number;
  message?: string;
  provider?: string;
  startedAt?: string;
  heartbeatAt?: string;
  lastProgressAt?: string;
  completedItems?: number;
  totalItems?: number;
  currentItem?: { id?: string; label: string; index?: number };
  attempt?: number;
  nextRetryAt?: string;
}
```

## Worker Requirements

- Jobs are idempotent or guarded by idempotency keys.
- Workers claim jobs atomically.
- Failed jobs capture typed failure codes and redacted diagnostics.
- Retry policies distinguish transient failures from invalid input.
- Render jobs run in an environment with a compatible browser and media codecs.
- Job logs include request IDs, project IDs, job IDs, and asset/timeline IDs.

## V1 Execution Model

For v1, workers run inside the Express API process, while production job state
is durable in Supabase `public.jobs`. This preserves polling and recovery across
API restarts without requiring a separate worker service yet.

- Job creation endpoints persist a Supabase job row and return `202 Accepted`.
- The API process can execute the job immediately after creation or through a
  lightweight in-process queue.
- Async orchestrator tools use the same durable store as their action/job
  references. The process-local `AgentApiStore` remains only for legacy
  compatibility surfaces and is not the production orchestrator job source.
- Each recoverable orchestrator job stores a typed, versioned execution
  envelope and recovery lease inside `jobs.progress`. The dispatcher-owned run
  lease is the outer single-owner boundary. Stale queued jobs can be reclaimed
  and replayed after an API-process crash. Stale running jobs are terminalized
  with a typed recoverable failure rather than replaying a possibly in-flight,
  billable provider request.
- In-process workers refresh the durable heartbeat every 30 seconds while a
  provider call is outstanding. Recovery claims expire, so another dispatcher
  can reclaim work if the recovering process also exits.
- Non-null idempotency keys are database-unique by workspace, project, and job
  type. Creation uses an atomic insert-or-read path rather than a paginated
  list-before-insert check.
- Browser clients have no direct RLS access to `public.jobs`; safe creator and
  operator projections come through the authenticated polling API. Execution
  envelopes and lease fields remain service-only control data. Active progress
  updates use a service-only SQL function that atomically JSONB-merges patches,
  rejects terminal jobs, and fences recovery writes by lease owner.
- Workers refresh `heartbeatAt` on operational writes. They update
  `lastProgressAt` only when an item finishes or another meaningful outcome is
  persisted, so recovery sweeps cannot masquerade as creative progress.
- Anchor, keyframe, and clip workers currently emit per-item lifecycle logs.
  Audio, storyboard, edit, and export emit durable heartbeats plus shared resume
  success/failure logs, but matching per-item lifecycle log depth remains a
  follow-up observability gap.
- The storyboard worker reaches `succeeded` only after persisted tile beat ids
  exactly match the active plan, the relational storyboard contains one selected
  panel per planned beat, and each panel resolves to a ready
  `beat_storyboard` image whose beat provenance and plan input edge match that
  slot. Storyboard attempts are built without moving the project pointer; only
  a validated attempt is marked handoff-ready and published. Partial attempts
  remain durable history and a later retry may supersede them; bounded,
  plan-scoped keyframe lookup skips unpublished or incomplete attempts.
- Generation and export should still be modeled as jobs even when execution is
  local, so the API contract does not change if a separate worker is introduced
  later.
- Revision should also be modeled as a job. V1 revisions should restitch from
  copied source assets using the updated structured timeline rather than trying
  to edit rendered media in place.
- Successful revision jobs should create a sibling `timelineId` and then enqueue
  an export job for that new timeline.
- A separate worker process is explicitly deferred until adoption or workload
  requires it.

## UI Requirements

- Show progress for uploads, generation, revision, and export.
- Allow canceling queued or running jobs where supported.
- Allow retrying failed jobs when the error is retryable.
- Keep the last successful project state visible while new jobs run.

## API Requirements

- Job creation endpoints return `202 Accepted` and a job object.
- Polling endpoints return current state and result pointers.
- Webhooks are out of scope for v1; clients poll job status.
- Terminal job states are immutable.

## Acceptance Criteria

- A generation request does not time out even if model calls take longer than a
  normal HTTP request.
- V1 can execute jobs locally in the API process while preserving the same job
  polling API that a future worker process would use.
- A render failure does not corrupt the timeline or delete previous artifacts.
- A revision job creates a new validated sibling timeline, preserves the previous
  valid cut, and auto-enqueues an export.
- A client can recover from network loss by polling a known job ID.
- Operators can diagnose failed jobs from logs without exposing customer secrets.
