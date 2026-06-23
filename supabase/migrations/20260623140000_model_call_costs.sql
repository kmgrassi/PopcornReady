-- Decouple cost from the agent decision log.
--
-- `actions` is the core provenance/decision model the whole app reasons over
-- (what the agent did, on what, producing what). Cost was a first-pass bolt-on
-- (estimated_cost_usd / actual_cost_usd) that muddied it. This moves cost into a
-- dedicated, optional sidecar — `model_call_costs` — that the core never depends
-- on, but that's available for cost/usage analytics and budget gating.
--
-- One row per model/API call. `action_id` is SET for tool calls (link to their
-- provenance + output asset), NULL for the reasoning "glue" the agent does
-- between tools (which has no action today — that capture is a follow-up). Cost
-- is `quantity * rate`; storing the raw quantity (+ token splits) means cost can
-- be recomputed when rates improve. Distinct from credit_transactions.cost_usd,
-- which is what we *charge the user* — this is what the call *cost us*.

create table public.model_call_costs (
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

create index model_call_costs_run_idx on public.model_call_costs (run_id);
create index model_call_costs_action_idx on public.model_call_costs (action_id);
create index model_call_costs_project_idx on public.model_call_costs (project_id, created_at desc);

-- Internal cost data: written and read by the server (service_role). No client
-- access — RLS on with no policies locks out anon/authenticated entirely.
alter table public.model_call_costs enable row level security;
revoke all on public.model_call_costs from anon, authenticated;

-- Retire the cost columns on actions — cost now lives only in the sidecar.
alter table public.actions drop column if exists estimated_cost_usd;
alter table public.actions drop column if exists actual_cost_usd;
