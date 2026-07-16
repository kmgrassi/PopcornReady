import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const enums = readFileSync(
  resolve(
    testDir,
    "../../../../../../supabase/migrations/20260716082700_agent_session_run_enums.sql"
  ),
  "utf8"
);
const migration = readFileSync(
  resolve(
    testDir,
    "../../../../../../supabase/migrations/20260716082800_agent_sessions_and_finite_runs.sql"
  ),
  "utf8"
);

test("agent_sessions is the only new domain table and owns the session invariants", () => {
  assert.match(migration, /create table public\.agent_sessions/);
  assert.match(
    migration,
    /constraint agent_sessions_project_domain_uidx unique \(project_id, domain\)/,
    "one permanent session per (project, domain)"
  );
  assert.match(migration, /next_sequence\s+integer\s+not null default 1/);
  assert.match(migration, /claim_generation\s+bigint\s+not null default 0/);
  assert.match(
    migration,
    /summary ->> 'schemaVersion' is not distinct from 'AgentSessionSummary\.v1'/,
    "the compact summary is a schema-marked payload"
  );
  assert.match(migration, /summary_through_sequence < next_sequence/);
  assert.match(
    migration,
    /agent session next_sequence is monotonic/,
    "sequence allocation may never roll back"
  );
  assert.match(migration, /agent session claim_generation is monotonic/);
  assert.match(migration, /agent sessions are permanent and are never deleted/);
  // The scope explicitly forbids a parallel persistence stack.
  for (const forbidden of [
    "domain_assignments",
    "domain_reports",
    "domain_assignment_outputs",
  ]) {
    assert.doesNotMatch(migration, new RegExp(`create table [^\\n]*${forbidden}`));
    assert.doesNotMatch(enums, new RegExp(`create table [^\\n]*${forbidden}`));
  }
});

test("sequence allocation is atomic, session-owned, and service-only", () => {
  assert.match(
    migration,
    /create or replace function public\.allocate_agent_session_sequence/
  );
  assert.match(
    migration,
    /on conflict \(project_id, domain\) do update\s+set next_sequence = s\.next_sequence \+ 1/,
    "allocation must be a single upsert, never max(sequence) + 1"
  );
  assert.doesNotMatch(migration, /max\(\s*session_sequence\s*\)/i);
  assert.match(
    migration,
    /revoke all on function public\.allocate_agent_session_sequence\(uuid, public\.agent_domain\)\s+from public, anon, authenticated;/
  );
  assert.match(
    migration,
    /grant execute on function public\.allocate_agent_session_sequence\(uuid, public\.agent_domain\)\s+to service_role;/
  );
});

test("finite runs carry the assignment identity with exactly one trusted origin", () => {
  for (const column of [
    "agent_role",
    "agent_session_id",
    "session_sequence",
    "task_kind",
    "task_params",
    "origin_kind",
    "parent_run_id",
    "root_action_id",
    "origin_actor_id",
    "origin_request",
    "continues_run_id",
    "pins",
    "wait_reason",
    "superseded_at",
  ]) {
    assert.match(
      migration,
      new RegExp(`add column ${column} `),
      `orchestrator_runs must gain ${column}`
    );
  }
  assert.match(migration, /constraint orchestrator_runs_origin_xor check/);
  assert.match(
    migration,
    /origin_kind = 'creative_director'\s+and parent_run_id is not null and root_action_id is not null\s+and origin_actor_id is null and origin_request is null/
  );
  assert.match(
    migration,
    /origin_kind = 'creator_direct'\s+and origin_actor_id is not null and origin_request is not null\s+and parent_run_id is null and root_action_id is null/
  );
  assert.match(
    migration,
    /completion_recipient text generated always as/,
    "the completion recipient is derived from the trusted origin, never stored independently"
  );
  assert.match(migration, /task_params ->> 'schemaVersion' is not distinct from 'DomainTask\.v1'/);
  assert.match(
    migration,
    /orchestrator run assignment identity is immutable/,
    "immutable-field guard on the run's assignment identity"
  );
  assert.match(migration, /constraint orchestrator_runs_no_self_parent check/);
  assert.match(
    migration,
    /parent run must be a creative-director root run/,
    "maximum hierarchy depth of two"
  );
  assert.match(migration, /run role % must match its session domain/);
  assert.match(migration, /root origin action must belong to the declared parent run/);
  assert.match(migration, /continuation must stay in the same session/);
  assert.match(migration, /continuation predecessor must be terminal/);
  assert.match(
    migration,
    /create unique index orchestrator_runs_session_sequence_uidx\s+on public\.orchestrator_runs \(agent_session_id, session_sequence\)/
  );
  assert.match(
    migration,
    /create unique index orchestrator_runs_one_successor_uidx\s+on public\.orchestrator_runs \(continues_run_id\)/,
    "a question/blocked answer is one-use"
  );
  assert.match(migration, /\(status = 'superseded'\) = \(superseded_at is not null\)/);
  assert.match(enums, /add value if not exists 'timed_out'/);
  assert.match(enums, /add value if not exists 'superseded'/);
});

test("one immutable domain_report action closes one finite domain run", () => {
  assert.match(
    migration,
    /create unique index actions_one_domain_report_per_run_uidx\s+on public\.actions \(orchestrator_run_id\)\s+where tool = 'domain_report'/
  );
  assert.match(migration, /domain_report is only valid on a domain-role run/);
  assert.match(
    migration,
    /schema-marked DomainReport\.v1 payload/,
    "report params must be schema-marked"
  );
  // The shared TS contract owns the envelope key: the DB checks validate the
  // camelCase `schemaVersion` verbatim (no snake_case domain payloads), and
  // the generic action marker check recognizes the contract key.
  assert.match(
    migration,
    /coalesce\(new\.params ->> 'schemaVersion',\s+new\.params #>> '\{report,schemaVersion\}'\) is distinct from 'DomainReport\.v1'/
  );
  assert.doesNotMatch(migration, /'schema_version'[^\n]*'Domain(Task|Report)\.v1'/);
  // A CHECK treats NULL as pass, so the mark comparisons must be null-safe or
  // a payload simply MISSING the key would slip through.
  assert.doesNotMatch(migration, /->> 'schemaVersion' = '/);
  assert.match(
    migration,
    /params \? 'schema' or params \? 'schema_version' or params \? 'schemaVersion'/,
    "the generic actions marker check must accept the contract-cased key"
  );
  assert.match(migration, /domain_report output links are immutable once inserted/);
});

test("general action_assets relation with composite same-project links", () => {
  assert.match(migration, /create table public\.action_assets/);
  assert.match(
    migration,
    /constraint action_assets_order_uidx unique \(action_id, direction, ordinal\)/
  );
  assert.match(
    migration,
    /foreign key \(action_id, project_id\)\s+references public\.actions \(id, project_id\) on delete cascade/
  );
  assert.match(
    migration,
    /foreign key \(asset_id, project_id\)\s+references public\.assets \(id, project_id\) on delete cascade/
  );
  assert.match(migration, /action_assets rows are append-only/);
  // The documented compatibility plan for the legacy UUID arrays.
  assert.match(migration, /backfill \/ cutover plan/i);
  assert.match(migration, /dual-write/);
  assert.doesNotMatch(
    migration,
    /insert into public\.action_assets[\s\S]*?select[\s\S]*?unnest/i,
    "PR 4 documents the backfill; PR 5 executes it with the dual-write"
  );
});

test("jobs gain canonical action attribution and durable claim fencing", () => {
  assert.match(migration, /add column action_id uuid/);
  assert.match(migration, /add column session_claim_generation bigint/);
  assert.match(
    migration,
    /jobs_action_project_fk\s+foreign key \(action_id, project_id\)\s+references public\.actions \(id, project_id\)/
  );
});

test("dispatch workspace identity is derived from the run and mismatches rejected", () => {
  assert.match(
    migration,
    /create or replace function public\.orchestrator_dispatches_enforce_workspace/
  );
  assert.match(
    migration,
    /dispatch workspace does not match run project workspace/
  );
  assert.match(
    migration,
    /before insert or update of workspace_id, orchestrator_run_id\s+on public\.orchestrator_dispatches/
  );
});

test("raw control rows are owner/service-only with a sanitized public projection", () => {
  assert.match(
    migration,
    /drop policy if exists orchestrator_runs_public_read on public\.orchestrator_runs;/
  );
  assert.match(
    migration,
    /drop policy if exists orchestrator_run_gates_public_read on public\.orchestrator_run_gates;/
  );
  assert.match(migration, /drop policy if exists actions_public_read on public\.actions;/);
  assert.match(migration, /alter table public\.agent_sessions enable row level security;/);
  assert.match(migration, /alter table public\.action_assets\s+enable row level security;/);
  // Ownership flows through the existing helpers, never raw auth.uid().
  assert.match(migration, /public\.owns_project\(project_id\)/);
  assert.doesNotMatch(migration, /auth\.uid\(\)/);
  // The sanitized projection exposes progress fields only.
  assert.match(
    migration,
    /create or replace function public\.public_orchestrator_run_progress/
  );
  const projection = migration.slice(
    migration.indexOf("public_orchestrator_run_progress")
  );
  for (const secret of [
    "input_summary",
    "task_params",
    "origin_request",
    "origin_actor_id",
    "error",
    "budget_usd",
    "pins",
  ]) {
    assert.ok(
      !projection.includes(secret),
      `sanitized projection must not expose ${secret}`
    );
  }
});
