-- Project overview polls the latest storyboard review boundary while an agent
-- is planning. Support the gate-stage filter and newest-first lookup without
-- repeatedly scanning and sorting the full gate history.

create index orchestrator_run_gates_stage_created_run_idx
  on public.orchestrator_run_gates
  (stage, created_at desc, orchestrator_run_id);
