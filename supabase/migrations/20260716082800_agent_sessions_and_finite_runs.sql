-- Specialist-agent orchestration PR 4 — persistent session + finite-run
-- extension schema (docs/scopes/specialist-agent-orchestration-prs.md).
--
-- Adds the ONE new domain-specific table (`agent_sessions`), the general
-- `action_assets` attribution relation, and extends the existing finite-run
-- records (`orchestrator_runs`, `actions`, `jobs`, `orchestrator_dispatches`,
-- `assets`) instead of creating a parallel persistence stack. Explicitly NOT
-- added: `domain_assignments`, `domain_reports`, `domain_assignment_outputs`,
-- or any second queue/approval/job/cost table — the finite run IS the
-- assignment; its unique terminal `domain_report` action IS the report.
--
-- Store/lifecycle logic (idempotent action preallocation, sequence claims,
-- turn finalization, wakes) belongs to PR 5/6; this migration owns only the
-- durable shapes and invariants.
--
-- ---------------------------------------------------------------------------
-- Legacy action UUID arrays -> action_assets: backfill / cutover plan
-- ---------------------------------------------------------------------------
-- `actions.input_asset_ids` / `actions.output_asset_ids` (and `job_ids`) are
-- unconstrained uuid[] snapshots: no FKs, no per-entry role/ordinal, no
-- same-project enforcement. The general `action_assets` relation created here
-- replaces them in four explicit phases:
--   1. PR 4 (this migration): create the relation + composite same-project
--      FKs + ordering uniqueness + RLS. No data movement — between PR 4 and
--      PR 5 the arrays remain the only written surface, so a one-shot
--      backfill here would immediately go stale and masquerade as truth.
--   2. PR 5 (dual-write + backfill): the store writes every new action's
--      input/output links to BOTH the arrays and `action_assets` in the same
--      transaction, and runs an idempotent service-role backfill
--      (insert ... select unnest(...) with ordinality, joined to same-project
--      assets, on conflict do nothing) over historical actions.
--   3. Assert: a scheduled/CI check compares array contents against the
--      relation per action and fails on divergence; the arrays are frozen as
--      read-only mirrors ("legacy arrays agree during compatibility and never
--      become a second source of truth").
--   4. Cutover (PR 5+ follow-up): readers move to `action_assets`; the array
--      columns are dropped in a later additive migration once no caller reads
--      them. Per the asset-graph migration rule they are never restored.
-- ---------------------------------------------------------------------------

set check_function_bodies = off;

-- ===========================================================================
-- A. Composite same-project foreign-key targets.
--    Every new cross-table link carries (id, project_id) so tenancy agreement
--    is enforced by the database, not by convention.
-- ===========================================================================
alter table public.actions
  add constraint actions_id_project_uidx unique (id, project_id);
alter table public.assets
  add constraint assets_id_project_uidx unique (id, project_id);
alter table public.orchestrator_runs
  add constraint orchestrator_runs_id_project_uidx unique (id, project_id);

-- ===========================================================================
-- B. agent_sessions — the ONE new domain-specific table: the permanent
--    project/domain continuity identity. Owns atomic next-sequence
--    allocation, active-run ownership, the durable claim generation, and the
--    guarded compact summary. Exactly one row per (project_id, domain) for
--    the project's lifetime; sessions are never canceled or deleted.
-- ===========================================================================
create table public.agent_sessions (
  id                       uuid                not null primary key default gen_random_uuid(),
  schema_version           text                not null default 'agent_session.v1',
  project_id               uuid                not null references public.projects (id) on delete cascade,
  domain                   public.agent_domain not null,
  -- Atomic sequence allocator: the next unallocated session sequence. Every
  -- linked run receives its sequence from this row (via
  -- allocate_agent_session_sequence), never from max(sequence) + 1.
  next_sequence            integer             not null default 1,
  -- Single active-ownership slot: at most one confirmed finite run holds the
  -- session execution slot. The composite FK (added in section D after
  -- orchestrator_runs grows its session link) proves the active run belongs
  -- to THIS session.
  active_run_id            uuid,
  -- Durable claim generation for callback fencing: incremented whenever
  -- active ownership changes (PR 6); copied onto provider jobs
  -- (jobs.session_claim_generation) so a reclaimed worker cannot commit late.
  claim_generation         bigint              not null default 0,
  -- Schema-marked compact continuity summary. Routing context only — never an
  -- alternate source of creative truth (typed, versioned JSONB payload).
  summary                  jsonb,
  -- CAS guards so an older run cannot overwrite newer compacted context.
  summary_through_sequence integer             not null default 0,
  summary_version          integer             not null default 0,
  created_at               timestamptz         not null default now(),
  updated_at               timestamptz         not null default now(),
  constraint agent_sessions_project_domain_uidx unique (project_id, domain),
  constraint agent_sessions_id_project_uidx unique (id, project_id),
  constraint agent_sessions_next_sequence_positive check (next_sequence >= 1),
  constraint agent_sessions_claim_generation_nonneg check (claim_generation >= 0),
  constraint agent_sessions_summary_schema check (
    summary is null
    or summary ->> 'schemaVersion' is not distinct from 'AgentSessionSummary.v1'
  ),
  constraint agent_sessions_summary_bounds check (
    summary_through_sequence >= 0
    and summary_through_sequence < next_sequence
    and summary_version >= 0
  )
);

create index agent_sessions_active_run_idx on public.agent_sessions (active_run_id)
  where active_run_id is not null;

create trigger agent_sessions_set_updated_at
  before update on public.agent_sessions
  for each row execute function public.set_updated_at();

-- Identity is immutable; the allocator/claim/summary counters are monotonic.
create or replace function public.agent_sessions_guard()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
     or new.project_id is distinct from old.project_id
     or new.domain is distinct from old.domain
  then
    raise exception 'agent session identity is immutable'
      using errcode = 'check_violation';
  end if;
  if new.next_sequence < old.next_sequence then
    raise exception 'agent session next_sequence is monotonic'
      using errcode = 'check_violation';
  end if;
  if new.claim_generation < old.claim_generation then
    raise exception 'agent session claim_generation is monotonic'
      using errcode = 'check_violation';
  end if;
  if new.summary_version < old.summary_version
     or new.summary_through_sequence < old.summary_through_sequence
  then
    raise exception 'agent session summary version/sequence is monotonic'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger agent_sessions_guard
  before update on public.agent_sessions
  for each row execute function public.agent_sessions_guard();

-- Sessions are permanent continuity identities (service/admin escape hatch
-- only, mirroring assets_guard_delete).
create or replace function public.agent_sessions_guard_delete()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'agent sessions are permanent and are never deleted'
      using errcode = 'insufficient_privilege';
  end if;
  return old;
end;
$$;

create trigger agent_sessions_guard_delete
  before delete on public.agent_sessions
  for each row execute function public.agent_sessions_guard_delete();

-- Atomic create-or-reuse + sequence allocation. One statement, so concurrent
-- root/creator-direct callers on the same (project, domain) serialize on the
-- unique row and can never receive the same sequence.
create or replace function public.allocate_agent_session_sequence(
  p_project_id uuid,
  p_domain public.agent_domain
)
returns table (
  session_id uuid,
  allocated_sequence integer,
  claim_generation bigint
)
language sql
security definer
set search_path = public
as $$
  insert into public.agent_sessions as s (project_id, domain, next_sequence)
  values (p_project_id, p_domain, 2)
  on conflict (project_id, domain) do update
    set next_sequence = s.next_sequence + 1,
        updated_at = now()
  returning s.id, s.next_sequence - 1, s.claim_generation;
$$;

revoke all on function public.allocate_agent_session_sequence(uuid, public.agent_domain)
  from public, anon, authenticated;
grant execute on function public.allocate_agent_session_sequence(uuid, public.agent_domain)
  to service_role;

-- ===========================================================================
-- C. orchestrator_runs — finite-run extensions. A domain assignment is an
--    ordinary orchestrator_runs row linked to its session; existing root runs
--    keep their own role and no session link. No assignment table.
-- ===========================================================================
alter table public.orchestrator_runs
  -- Who this run executes as; existing rows are root runs.
  add column agent_role public.agent_role not null default 'creative_director',
  -- Optional persistent session link (domain runs only).
  add column agent_session_id uuid,
  -- Monotonic sequence allocated by the session row; unique within a session.
  add column session_sequence integer,
  -- Relational task kind + schema-marked DomainTask.v1 control/audit payload.
  add column task_kind public.domain_task_kind,
  add column task_params jsonb,
  -- Trusted-origin causation: root parent run/action XOR authenticated
  -- creator-direct actor/request metadata.
  add column origin_kind public.trusted_origin_kind,
  add column parent_run_id uuid,
  add column root_action_id uuid,
  -- Cascade matches the anonymous-user retention purge; the run's project
  -- cascade removes these rows in the common teardown path anyway.
  add column origin_actor_id uuid references public.users (id) on delete cascade,
  add column origin_request jsonb,
  -- Predecessor link for question/blocked successors (same session).
  add column continues_run_id uuid,
  -- Fingerprint pins the run must preserve (typed, versioned payload).
  add column pins jsonb,
  -- Queryable wait reason distinguishing media-job/domain/approval waits.
  add column wait_reason public.orchestrator_run_wait_reason,
  -- Explicit supersession timestamp (paired with status = 'superseded').
  add column superseded_at timestamptz;

-- Completion recipient DERIVED from the trusted origin — never stored
-- independently, so it cannot disagree with the origin. (Separate ALTER: the
-- generation expression must reference an already-committed column.)
alter table public.orchestrator_runs
  add column completion_recipient text generated always as (
    case origin_kind
      when 'creative_director' then 'creative_director'
      when 'creator_direct' then 'creator_conversation'
    end
  ) stored;

-- Composite same-project links (MATCH SIMPLE: enforced only when set).
alter table public.orchestrator_runs
  add constraint orchestrator_runs_session_project_fk
    foreign key (agent_session_id, project_id)
    references public.agent_sessions (id, project_id) on delete cascade,
  add constraint orchestrator_runs_parent_project_fk
    foreign key (parent_run_id, project_id)
    references public.orchestrator_runs (id, project_id) on delete cascade,
  add constraint orchestrator_runs_root_action_project_fk
    foreign key (root_action_id, project_id)
    references public.actions (id, project_id) on delete cascade,
  add constraint orchestrator_runs_continues_project_fk
    foreign key (continues_run_id, project_id)
    references public.orchestrator_runs (id, project_id) on delete cascade;

-- Root role <=> no session; domain role <=> complete assignment identity.
alter table public.orchestrator_runs
  add constraint orchestrator_runs_role_session check (
    (agent_role = 'creative_director') = (agent_session_id is null)
  ),
  add constraint orchestrator_runs_domain_shape check (
    (agent_session_id is null
       and session_sequence is null
       and task_kind is null
       and task_params is null
       and origin_kind is null
       and continues_run_id is null
       and pins is null)
    or (agent_session_id is not null
       and session_sequence is not null
       and task_kind is not null
       and task_params is not null
       and origin_kind is not null)
  ),
  -- Exactly one trusted origin: root run/action XOR creator-direct metadata.
  add constraint orchestrator_runs_origin_xor check (
    (origin_kind is null
       and parent_run_id is null and root_action_id is null
       and origin_actor_id is null and origin_request is null)
    or (origin_kind = 'creative_director'
       and parent_run_id is not null and root_action_id is not null
       and origin_actor_id is null and origin_request is null)
    or (origin_kind = 'creator_direct'
       and origin_actor_id is not null and origin_request is not null
       and parent_run_id is null and root_action_id is null)
  ),
  add constraint orchestrator_runs_no_self_parent check (
    parent_run_id is null or parent_run_id <> id
  ),
  add constraint orchestrator_runs_no_self_continuation check (
    continues_run_id is null or continues_run_id <> id
  ),
  add constraint orchestrator_runs_session_sequence_positive check (
    session_sequence is null or session_sequence >= 1
  ),
  -- Relational role/task-kind agreement (mirrors the shared contract union).
  add constraint orchestrator_runs_task_kind_role check (
    task_kind is null
    or (agent_role = 'visuals' and task_kind in
        ('image_create', 'video_create', 'video_edit',
         'visuals_production', 'visuals_revision'))
    or (agent_role = 'audio' and task_kind in
        ('soundtrack_create', 'audio_create',
         'audio_production', 'audio_fit', 'audio_revision'))
  ),
  -- Typed, versioned JSONB payloads only (schema-marked envelopes).
  add constraint orchestrator_runs_task_schema check (
    task_params is null
    or task_params ->> 'schemaVersion' is not distinct from 'DomainTask.v1'
  ),
  add constraint orchestrator_runs_origin_request_schema check (
    origin_request is null
    or origin_request ->> 'schemaVersion' is not distinct from 'CreatorDirectOrigin.v1'
  ),
  add constraint orchestrator_runs_pins_schema check (
    pins is null
    or pins ->> 'schemaVersion' is not distinct from 'DomainRunPins.v1'
  ),
  -- Wait reason: domain runs must declare why they wait; everything else
  -- carries none.
  add constraint orchestrator_runs_wait_reason_shape check (
    case
      when agent_session_id is null then wait_reason is null
      when status = 'waiting' then wait_reason is not null
      else wait_reason is null
    end
  ),
  -- Supersession is explicit: the timestamp and the status travel together.
  add constraint orchestrator_runs_superseded_shape check (
    (status = 'superseded') = (superseded_at is not null)
  );

-- One sequence owner per session; one successor per questioned/blocked run.
create unique index orchestrator_runs_session_sequence_uidx
  on public.orchestrator_runs (agent_session_id, session_sequence)
  where agent_session_id is not null;
create unique index orchestrator_runs_one_successor_uidx
  on public.orchestrator_runs (continues_run_id)
  where continues_run_id is not null;

create index orchestrator_runs_session_status_idx
  on public.orchestrator_runs (agent_session_id, status)
  where agent_session_id is not null;
create index orchestrator_runs_parent_run_idx
  on public.orchestrator_runs (parent_run_id)
  where parent_run_id is not null;
create index orchestrator_runs_root_action_idx
  on public.orchestrator_runs (root_action_id)
  where root_action_id is not null;

-- Composite target for the session's active-run FK: proves the active run is
-- linked to that very session.
alter table public.orchestrator_runs
  add constraint orchestrator_runs_id_session_uidx unique (id, agent_session_id);

-- Cross-row validation that CHECK constraints cannot express:
-- role/domain agreement, parent-role depth (max depth two), parent-action
-- ownership, same-session terminal continuation, task payload agreement.
create or replace function public.orchestrator_runs_validate_agent_links()
returns trigger
language plpgsql
as $$
declare
  v_session_domain public.agent_domain;
  v_parent_role public.agent_role;
  v_action_run uuid;
  v_prev_session uuid;
  v_prev_status public.orchestrator_run_status;
begin
  if new.agent_session_id is not null then
    select s.domain into v_session_domain
    from public.agent_sessions s
    where s.id = new.agent_session_id;
    if v_session_domain::text is distinct from new.agent_role::text then
      raise exception 'run role % must match its session domain %',
        new.agent_role, v_session_domain
        using errcode = 'check_violation';
    end if;
    if new.task_params ->> 'domain' is distinct from new.agent_role::text
       or new.task_params ->> 'taskKind' is distinct from new.task_kind::text
    then
      raise exception 'task payload domain/taskKind must agree with the run''s relational columns'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.parent_run_id is not null then
    select r.agent_role into v_parent_role
    from public.orchestrator_runs r
    where r.id = new.parent_run_id;
    if v_parent_role is distinct from 'creative_director'::public.agent_role then
      raise exception 'hierarchy depth exceeds two: parent run must be a creative-director root run'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.root_action_id is not null then
    select a.orchestrator_run_id into v_action_run
    from public.actions a
    where a.id = new.root_action_id;
    if v_action_run is distinct from new.parent_run_id then
      raise exception 'root origin action must belong to the declared parent run'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.continues_run_id is not null then
    select r.agent_session_id, r.status into v_prev_session, v_prev_status
    from public.orchestrator_runs r
    where r.id = new.continues_run_id;
    if v_prev_session is distinct from new.agent_session_id then
      raise exception 'continuation must stay in the same session'
        using errcode = 'check_violation';
    end if;
    if v_prev_status not in ('succeeded', 'failed', 'canceled', 'timed_out', 'superseded') then
      raise exception 'continuation predecessor must be terminal'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger orchestrator_runs_validate_agent_links
  before insert or update on public.orchestrator_runs
  for each row
  when (
    new.agent_session_id is not null
    or new.parent_run_id is not null
    or new.root_action_id is not null
    or new.continues_run_id is not null
  )
  execute function public.orchestrator_runs_validate_agent_links();

-- Immutable-field guard: assignment identity may not be rewritten after
-- insert. Pins are written once with the assignment; lifecycle fields
-- (status, spent, error, timestamps, wait_reason) stay mutable.
create or replace function public.orchestrator_runs_guard_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.project_id is distinct from old.project_id
     or new.agent_role is distinct from old.agent_role
     or new.agent_session_id is distinct from old.agent_session_id
     or new.session_sequence is distinct from old.session_sequence
     or new.task_kind is distinct from old.task_kind
     or new.task_params is distinct from old.task_params
     or new.origin_kind is distinct from old.origin_kind
     or new.parent_run_id is distinct from old.parent_run_id
     or new.root_action_id is distinct from old.root_action_id
     or new.origin_actor_id is distinct from old.origin_actor_id
     or new.origin_request is distinct from old.origin_request
     or new.continues_run_id is distinct from old.continues_run_id
     or (old.pins is not null and new.pins is distinct from old.pins)
  then
    raise exception 'orchestrator run assignment identity is immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger orchestrator_runs_guard_immutable
  before update on public.orchestrator_runs
  for each row execute function public.orchestrator_runs_guard_immutable();

-- ===========================================================================
-- D. agent_sessions.active_run_id -> the run holding the execution slot.
--    The composite FK proves the active run belongs to this session.
-- ===========================================================================
alter table public.agent_sessions
  add constraint agent_sessions_active_run_fk
    foreign key (active_run_id, id)
    references public.orchestrator_runs (id, agent_session_id)
    on delete set null (active_run_id);

-- ===========================================================================
-- E. actions — the unique terminal domain_report action + same-project run
--    link. DomainReport.v1 lives in the action's schema-marked params; there
--    is no domain_reports table.
-- ===========================================================================
-- Replace the single-column run FK with a composite same-project link so an
-- action can never attach to a run in another project. NOT VALID first so a
-- (never expected) legacy mismatch cannot brick the deploy; validation is
-- attempted immediately and downgraded to a loud warning if it fails.
alter table public.actions
  drop constraint actions_orchestrator_run_id_fkey;
alter table public.actions
  add constraint actions_orchestrator_run_project_fk
    foreign key (orchestrator_run_id, project_id)
    references public.orchestrator_runs (id, project_id)
    on delete set null (orchestrator_run_id)
    not valid;
do $$
begin
  alter table public.actions validate constraint actions_orchestrator_run_project_fk;
exception when others then
  raise warning 'actions_orchestrator_run_project_fk left NOT VALID: % — clean cross-project action/run links, then VALIDATE CONSTRAINT', sqlerrm;
end;
$$;

-- The shared contract (packages/shared/src/domain-agent-contract.ts) owns the
-- domain envelopes and marks them with a camelCase `schemaVersion` key — the
-- DB checks match that key verbatim. The generic marker-presence check on
-- actions predates the contract and only recognized `schema`/`schema_version`;
-- recreate it recognizing the contract key too so a verbatim DomainReport.v1
-- payload is insertable. Strictly more permissive than the old check, so
-- revalidation of existing rows is safe.
alter table public.actions
  drop constraint actions_params_schema_check;
alter table public.actions
  add constraint actions_params_schema_check
  check (
    params = '{}'::jsonb
    or (
      jsonb_typeof(params) = 'object'
      and (params ? 'schema' or params ? 'schema_version' or params ? 'schemaVersion')
    )
  );

-- Exactly one domain_report action per finite domain run.
create unique index actions_one_domain_report_per_run_uidx
  on public.actions (orchestrator_run_id)
  where tool = 'domain_report';

-- A report may exist only on a domain-role run and must carry the
-- schema-marked DomainReport.v1 payload.
create or replace function public.actions_validate_domain_report()
returns trigger
language plpgsql
as $$
declare
  v_session uuid;
begin
  if new.orchestrator_run_id is null then
    raise exception 'domain_report requires an orchestrator run'
      using errcode = 'check_violation';
  end if;
  select r.agent_session_id into v_session
  from public.orchestrator_runs r
  where r.id = new.orchestrator_run_id;
  if v_session is null then
    raise exception 'domain_report is only valid on a domain-role run'
      using errcode = 'check_violation';
  end if;
  if coalesce(new.params ->> 'schemaVersion',
              new.params #>> '{report,schemaVersion}') is distinct from 'DomainReport.v1'
  then
    raise exception 'domain_report params must be a schema-marked DomainReport.v1 payload'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger actions_validate_domain_report
  before insert on public.actions
  for each row
  when (new.tool = 'domain_report')
  execute function public.actions_validate_domain_report();

-- Report immutability: params/inputs are already frozen by
-- actions_guard_immutable; for the terminal report the output links/arrays
-- and run link are frozen too (the fingerprint lives inside the immutable
-- params). Mirrored legacy arrays therefore cannot drift after insert.
create or replace function public.actions_guard_domain_report()
returns trigger
language plpgsql
as $$
begin
  if new.output_asset_ids is distinct from old.output_asset_ids
     or new.job_ids is distinct from old.job_ids
     -- Repointing the run link is forbidden; the FK's SET NULL during a
     -- project/run cascade delete is deletion semantics, not a rewrite.
     or (new.orchestrator_run_id is not null
         and new.orchestrator_run_id is distinct from old.orchestrator_run_id)
  then
    raise exception 'domain_report output links are immutable once inserted'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger actions_guard_domain_report
  before update on public.actions
  for each row
  when (old.tool = 'domain_report')
  execute function public.actions_guard_domain_report();

-- ===========================================================================
-- F. action_assets — the general per-action input/output attribution
--    relation (project, action, asset, direction, role, ordinal). Used by
--    ALL tools, not only domain agents; `assets.created_by_action_id` and
--    typed asset_edges keep immutable creation/dependency provenance.
-- ===========================================================================
create table public.action_assets (
  id         uuid                          not null primary key default gen_random_uuid(),
  project_id uuid                          not null references public.projects (id) on delete cascade,
  action_id  uuid                          not null,
  asset_id   uuid                          not null,
  direction  public.action_asset_direction not null,
  role       text,
  ordinal    integer                       not null,
  created_at timestamptz                   not null default now(),
  constraint action_assets_ordinal_nonneg check (ordinal >= 0),
  constraint action_assets_order_uidx unique (action_id, direction, ordinal),
  constraint action_assets_action_project_fk
    foreign key (action_id, project_id)
    references public.actions (id, project_id) on delete cascade,
  constraint action_assets_asset_project_fk
    foreign key (asset_id, project_id)
    references public.assets (id, project_id) on delete cascade
);

create index action_assets_asset_idx on public.action_assets (asset_id);
create index action_assets_project_idx on public.action_assets (project_id);

-- Attribution rows are append-only audit records.
create or replace function public.action_assets_guard_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'action_assets rows are append-only'
    using errcode = 'check_violation';
end;
$$;

create trigger action_assets_guard_immutable
  before update on public.action_assets
  for each row execute function public.action_assets_guard_immutable();

revoke update, delete on table public.action_assets from public, anon, authenticated;

-- ===========================================================================
-- G. jobs — canonical action attribution + durable claim fencing.
--    PR 5 preallocates the canonical action and supplies the active
--    generation before the generated-assets service creates a provider job.
-- ===========================================================================
alter table public.jobs
  add column action_id uuid,
  add column session_claim_generation bigint,
  add constraint jobs_action_project_fk
    foreign key (action_id, project_id)
    references public.actions (id, project_id)
    on delete set null (action_id),
  add constraint jobs_session_claim_generation_nonneg check (
    session_claim_generation is null or session_claim_generation >= 0
  );

create index jobs_action_id_idx on public.jobs (action_id)
  where action_id is not null;

comment on column public.jobs.action_id is
  'Canonical creating action (preallocated by PR 5) so retries cannot launch duplicate provider work.';
comment on column public.jobs.session_claim_generation is
  'agent_sessions.claim_generation copied at launch; async callbacks compare-and-set against the durable session claim so a reclaimed worker cannot commit late.';

-- ===========================================================================
-- H. assets — same-project creator-action link (composite FK replaces the
--    single-column one; guarded NOT VALID -> validate like actions above).
-- ===========================================================================
alter table public.assets
  drop constraint assets_created_by_action_id_fkey;
alter table public.assets
  add constraint assets_created_by_action_project_fk
    foreign key (created_by_action_id, project_id)
    references public.actions (id, project_id)
    on delete set null (created_by_action_id)
    not valid;
do $$
begin
  alter table public.assets validate constraint assets_created_by_action_project_fk;
exception when others then
  raise warning 'assets_created_by_action_project_fk left NOT VALID: % — clean cross-project asset/action links, then VALIDATE CONSTRAINT', sqlerrm;
end;
$$;

-- ===========================================================================
-- I. orchestrator_dispatches — workspace identity is DERIVED from the run's
--    project at the table boundary (the wake RPC already refuses mismatches;
--    this closes direct-insert/update drift too).
-- ===========================================================================
create or replace function public.orchestrator_dispatches_enforce_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  select p.workspace_id into v_workspace_id
  from public.orchestrator_runs r
  join public.projects p on p.id = r.project_id
  where r.id = new.orchestrator_run_id;

  if v_workspace_id is null then
    raise exception 'orchestrator run % has no project workspace', new.orchestrator_run_id
      using errcode = '23503';
  end if;

  if new.workspace_id is null then
    new.workspace_id := v_workspace_id;
  elsif new.workspace_id is distinct from v_workspace_id then
    raise exception 'dispatch workspace does not match run project workspace for run %',
      new.orchestrator_run_id using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger orchestrator_dispatches_enforce_workspace
  before insert or update of workspace_id, orchestrator_run_id
  on public.orchestrator_dispatches
  for each row execute function public.orchestrator_dispatches_enforce_workspace();

-- ===========================================================================
-- J. RLS — extend through the EXISTING project/workspace ownership helpers.
--    Sessions, raw runs, task specs, report actions, jobs, actor/request
--    metadata, and gate material are owner/service-only. Public projects lose
--    raw control-row access and keep a sanitized progress projection.
-- ===========================================================================
alter table public.agent_sessions enable row level security;
alter table public.action_assets  enable row level security;

-- Owners may observe; only the service role writes (session allocation,
-- claims, and attribution are server-owned transitions).
create policy agent_sessions_owner_read on public.agent_sessions
  for select using (public.owns_project(project_id));
create policy action_assets_owner_read on public.action_assets
  for select using (public.owns_project(project_id));

-- Raw runs, gates, and actions are control records, not public project
-- content: task specs, reports, creator questions, approval material, and
-- actor/request metadata must not be publicly readable.
drop policy if exists orchestrator_runs_public_read on public.orchestrator_runs;
drop policy if exists orchestrator_run_gates_public_read on public.orchestrator_run_gates;
drop policy if exists actions_public_read on public.actions;

-- Sanitized public progress projection: the only run fields the public
-- project experience may read (no input summary, budget, error, task,
-- origin, or actor/request metadata).
create or replace function public.public_orchestrator_run_progress(p_project_id uuid)
returns table (
  id uuid,
  project_id uuid,
  status public.orchestrator_run_status,
  agent_role public.agent_role,
  created_at timestamptz,
  updated_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.project_id, r.status, r.agent_role,
         r.created_at, r.updated_at, r.started_at, r.completed_at
  from public.orchestrator_runs r
  where r.project_id = p_project_id
    and public.project_is_public(p_project_id);
$$;

revoke all on function public.public_orchestrator_run_progress(uuid) from public;
grant execute on function public.public_orchestrator_run_progress(uuid)
  to anon, authenticated, service_role;
