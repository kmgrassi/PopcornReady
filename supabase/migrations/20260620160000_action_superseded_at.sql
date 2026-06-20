-- Restart-from-stage support: when a run is re-entered at an earlier stage, the
-- actions for that stage and everything downstream are flagged superseded so the
-- orchestrator's action log (priorResults) no longer shows that work as done and
-- the agent re-runs from the chosen stage. Provenance is preserved (append-only;
-- the produced assets/selections are untouched — the asset "pool" keeps them).
alter table public.actions
  add column if not exists superseded_at timestamptz;

comment on column public.actions.superseded_at is
  'When set, this action is excluded from the orchestrator action log because the run was restarted from an earlier stage. Provenance/assets are preserved.';

-- The action log is read per run on every orchestrator turn; index the common
-- "live (non-superseded) actions for a run" lookup.
create index if not exists actions_run_live_idx
  on public.actions (orchestrator_run_id)
  where superseded_at is null;
