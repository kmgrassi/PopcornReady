# OODA Feedback Implementation PR Plan

## Objective

Turn run-local feedback into reusable, scoped learning without letting raw
feedback silently mutate future generation. This implements the first concrete
slice of [`ooda-feedback-loop.md`](ooda-feedback-loop.md): capture feedback as
first-class records, then classify and approve any learned prompt/config changes
through explicit stages.

This scope closes gap 2 from
[`north-star-gap-audit.md`](north-star-gap-audit.md).

## Current State

Shipped:

- Gate approve/reject routes exist on orchestrator runs.
- Targeted board feedback is recorded as an `actions` row with tool
  `board_feedback` and is threaded into the next model turn.
- Several tools accept a `feedback` or `revisionInstruction` input.
- `videoQualityContextForPrompt()` provides static quality guidance.

Missing:

- No `FeedbackEvent`, `FeedbackInsight`, `FeedbackDecision`, or
  `PromptConfigVersion` store exists.
- Gate approvals/rejections do not persist structured learning records.
- Board feedback is useful for the current run, but not aggregated across runs.
- Prompt context is static and not scoped by project/workspace learning.

## Principles

- Capture first. Classification and prompt changes come later.
- Raw feedback is immutable evidence, not policy.
- Project-level learning is safer than workspace-level learning; global changes
  require explicit human approval.
- Feedback records must link back to assets, actions, runs, tools, and prompts
  where possible.
- Historical outputs are never mutated by feedback. Feedback can only influence
  future context versions or follow-up jobs.

## Data Model

### `feedback_events`

First PR table. Append-only.

Core columns:

- `id uuid primary key`
- `workspace_id uuid not null`
- `project_id uuid`
- `orchestrator_run_id uuid`
- `action_id uuid`
- `asset_id uuid`
- `stage text`
- `tool text`
- `source text not null`
- `sentiment text`
- `message text`
- `structured jsonb not null default '{}'`
- `created_by uuid`
- `created_at timestamptz not null default now()`

Suggested `source` values:

- `gate_approve`
- `gate_reject`
- `board_feedback`
- `asset_set_active`
- `critic_report`
- `video_snapshot_review`
- `provider_error`

Suggested `sentiment` values:

- `positive`
- `negative`
- `neutral`
- `operational`

### Later Tables

- `feedback_insights`: classification, scope, confidence, related event IDs.
- `feedback_decisions`: proposed action, approval status, target scope.
- `feedback_actions`: applied change, version pointer, rollback metadata.
- `prompt_config_versions`: approved prompt/rubric/config additions.

## API Shape

PR 1:

- `POST /api/v1/projects/:projectId/feedback-events`
- `GET /api/v1/projects/:projectId/feedback-events`

Internal capture helpers should be used by existing routes so every source does
not hand-roll inserts.

PR 2+:

- `POST /api/v1/projects/:projectId/feedback-events/:eventId/orient`
- `GET /api/v1/projects/:projectId/feedback-insights`
- `POST /api/v1/projects/:projectId/feedback-insights/:insightId/decisions`
- `POST /api/v1/feedback-decisions/:decisionId/approve`
- `POST /api/v1/feedback-decisions/:decisionId/act`

## Capture Sources

### Gate Approve/Reject

In `apps/api/src/routes/v1/orchestrator-runs.ts`, when a reached gate is
approved or rejected, capture:

- run ID
- gate/tool/stage
- action ID of the latest relevant tool result if available
- feedback note if the request body carries one
- sentiment: `positive` for approve, `negative` for reject

### Board Feedback

When `board_feedback` action is created, also create a feedback event:

- source: `board_feedback`
- message: user revision message
- action ID: the created `board_feedback` action
- asset IDs from the target context

### Asset Set-Active

When the UI/API repoints an active selection away from an agent-produced asset,
capture an implicit preference event:

- source: `asset_set_active`
- structured payload includes prior active asset and new active asset
- sentiment negative for replaced asset, positive for selected asset

### Critic / Snapshot Review

Persist generated quality signals as operational feedback:

- source: `critic_report` or `video_snapshot_review`
- sentiment from recommended action where available
- structured payload stores rubric scores and recommendations

## PR Plan

### PR 1 - Feedback Events Foundation

Add `feedback_events` migration, RLS, store helpers, and project list/create
routes.

Acceptance:

- Events are append-only.
- Project owners can read their project feedback.
- API validates source/sentiment values.
- Tests cover insert/list and authorization.

### PR 2 - Capture Existing Human Feedback

Wire capture into gate approve/reject and board feedback.

Acceptance:

- Approving a gate creates a positive event.
- Rejecting a gate with a note creates a negative event with the note.
- Board feedback creates both the existing action and a feedback event.
- Existing run behavior is unchanged.

### PR 3 - Feedback Event UI Read Surface

Show captured events in a simple project/run developer-facing panel or admin
surface.

Acceptance:

- Events are visible with source, message, linked asset/run/action, and time.
- Empty and loading states are handled.
- No editing or deletion controls.

### PR 4 - Orient Classification

Add `feedback_insights` and an Orient job/model that classifies events.

Acceptance:

- Classifier output is schema-validated.
- One event can produce zero or more insights.
- Low-confidence insights are stored but not actionable by default.

### PR 5 - Decisions And Approval

Add `feedback_decisions` and approval routes.

Acceptance:

- Decisions can propose project context, workspace preference, prompt config, or
  "no action."
- Workspace/global decisions require approval before Act.
- Decisions are linked to supporting insights/events.

### PR 6 - Prompt Context Versions

Add approved `prompt_config_versions` and make
`videoQualityContextForPrompt(scope)` return static base guidance plus approved
project/workspace additions.

Acceptance:

- Existing prompts still receive the base guidance.
- Scoped additions are deterministic and versioned.
- Future generation records which prompt config version it used.

## Non-Goals

- Do not make raw feedback automatically alter prompts.
- Do not implement global self-modifying code behavior.
- Do not replace targeted board feedback or rerun proposal flows.
- Do not build a large analytics dashboard in the foundation PR.

## Dependencies

- Rerun proposals can consume feedback events later, but PR 1 and PR 2 here can
  land independently.
- Prompt context closure should wait until there is at least one approved
  decision path.
