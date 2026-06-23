-- Decouple cost from the agent decision log.
--
-- This migration was originally authored as 20260623140000_model_call_costs.sql,
-- which collided with 20260623140000_video_provider_api_keys.sql. Production
-- recorded the video-provider migration for that timestamp, so the cost sidecar
-- never applied there. Reissue it under a unique timestamp and keep the DDL
-- idempotent so drifted/staging databases can converge safely.

create table if not exists public.model_call_costs (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  run_id        uuid references public.orchestrator_runs (id) on delete set null,
  -- The provenance action this cost belongs to (null = agent reasoning glue).
  action_id     uuid references public.actions (id) on delete set null,
  provider      text not null,
  model         text,
  -- What `quantity` is denominated in for this provider call.
  unit          text not null check (unit in ('tokens', 'characters', 'seconds', 'images')),
  quantity      double precision not null,
  -- Token splits for token-priced calls (LLM, gpt-image); null otherwise.
  input_tokens  integer,
  output_tokens integer,
  cost_usd      double precision not null,
  -- true while cost is derived from the modeled rate table; false once it's a
  -- measured/reconciled figure.
  is_estimate   boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists model_call_costs_run_idx
  on public.model_call_costs (run_id);
create index if not exists model_call_costs_action_idx
  on public.model_call_costs (action_id);
create index if not exists model_call_costs_project_idx
  on public.model_call_costs (project_id, created_at desc);

-- Internal cost data: written and read by the server (service_role). No client
-- access - RLS on with no policies locks out anon/authenticated entirely.
alter table public.model_call_costs enable row level security;
revoke all on public.model_call_costs from anon, authenticated;

-- Backfill historical cost from actions into the sidecar BEFORE dropping the
-- columns, so pre-migration provider cost isn't lost and in-flight run totals
-- (sumRunCostUsd) stay accurate after deploy. Guard the backfill because some
-- environments may already have applied the first, colliding version and
-- dropped these columns.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'actions'
      and column_name = 'estimated_cost_usd'
  ) then
    execute $backfill$
      insert into public.model_call_costs (
        project_id, run_id, action_id, provider, model, unit, quantity,
        cost_usd, is_estimate, created_at
      )
      select
        a.project_id,
        a.orchestrator_run_id,
        a.id,
        coalesce(nullif(a.params->>'provider', ''), 'unknown'),
        a.params->>'model',
        case when a.params->>'kind' = 'image' then 'images' else 'seconds' end,
        case when a.params->>'kind' = 'image' then 1
             else coalesce(nullif(a.params->>'durationSec', '')::double precision, 0) end,
        coalesce(a.actual_cost_usd, a.estimated_cost_usd),
        a.actual_cost_usd is null,
        a.created_at
      from public.actions a
      where coalesce(a.actual_cost_usd, a.estimated_cost_usd) > 0
        and not exists (
          select 1
          from public.model_call_costs m
          where m.action_id = a.id
        )
    $backfill$;
  end if;
end;
$$;

-- Retire the cost columns on actions - cost now lives only in the sidecar.
alter table public.actions drop column if exists estimated_cost_usd;
alter table public.actions drop column if exists actual_cost_usd;
