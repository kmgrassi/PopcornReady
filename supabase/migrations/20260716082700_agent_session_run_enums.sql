-- Specialist-agent orchestration PR 4 — enum groundwork.
-- (docs/scopes/specialist-agent-orchestration-prs.md, "PR 4 — Persistent
-- session and finite-run extension schema".)
--
-- `ALTER TYPE ... ADD VALUE` may not be consumed in the same transaction that
-- adds it, and `supabase db push` runs each migration file in one transaction.
-- All enum work therefore lands here; every table/constraint/trigger that uses
-- these values lands in the companion 20260716082800 migration.

set check_function_bodies = off;

-- Who a run executes as. Existing root runs are the creative director; the
-- shared contract (packages/shared/src/domain-agent-contract.ts AgentRole)
-- is the source of truth for these labels.
create type public.agent_role as enum ('creative_director', 'visuals', 'audio');

-- Persistent per-project session domains (AgentRole minus the root).
create type public.agent_domain as enum ('visuals', 'audio');

-- DomainTask.v1 task kinds (creator-direct + production; shared contract
-- CreatorDirectTaskKind / VisualsProductionTaskKind / AudioProductionTaskKind).
create type public.domain_task_kind as enum (
  'image_create',
  'video_create',
  'video_edit',
  'soundtrack_create',
  'audio_create',
  'visuals_production',
  'visuals_revision',
  'audio_production',
  'audio_fit',
  'audio_revision'
);

-- Exactly one trusted origin per finite domain run (shared contract
-- CreativeDirectorTaskRoute / CreatorDirectTaskRoute origin kinds).
create type public.trusted_origin_kind as enum ('creative_director', 'creator_direct');

-- Queryable wait reason distinguishing media-job, domain, and approval waits
-- (shared contract DomainRunWaitReason).
create type public.orchestrator_run_wait_reason as enum ('media_job', 'domain', 'approval');

-- General action/asset attribution direction (action_assets relation).
create type public.action_asset_direction as enum ('input', 'output');

-- Transport states the shared DomainRunState contract adds on top of the
-- existing lifecycle. Status stays transport-oriented: `succeeded` means a
-- terminal report was persisted; done|blocked|question stays report outcome.
alter type public.orchestrator_run_status add value if not exists 'timed_out';
alter type public.orchestrator_run_status add value if not exists 'superseded';
