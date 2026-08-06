-- Least-privilege direct-Postgres access for atomic full-video script review.

revoke all on table public.script_drafts from popcorn_api;

grant select (id, project_id, status)
  on table public.script_drafts to popcorn_api;
grant update (status, updated_at)
  on table public.script_drafts to popcorn_api;
grant select (current_script_draft_id)
  on table public.projects to popcorn_api;
grant update (current_script_draft_id)
  on table public.projects to popcorn_api;
grant select (stage, decided_by_action_id)
  on table public.orchestrator_run_gates to popcorn_api;
grant update (decided_by_action_id)
  on table public.orchestrator_run_gates to popcorn_api;

drop policy if exists script_drafts_popcorn_api_review_select on public.script_drafts;
create policy script_drafts_popcorn_api_review_select
  on public.script_drafts for select to popcorn_api
  using (true);

drop policy if exists script_drafts_popcorn_api_review_update on public.script_drafts;
create policy script_drafts_popcorn_api_review_update
  on public.script_drafts for update to popcorn_api
  using (true)
  with check (status in ('draft', 'approved'));

drop policy if exists projects_popcorn_api_script_review_update on public.projects;
create policy projects_popcorn_api_script_review_update
  on public.projects for update to popcorn_api
  using (true)
  with check (true);

drop policy if exists orchestrator_runs_popcorn_api_script_review_select
  on public.orchestrator_runs;
create policy orchestrator_runs_popcorn_api_script_review_select
  on public.orchestrator_runs for select to popcorn_api
  using (agent_role is null or agent_role = 'creative_director');

drop policy if exists orchestrator_runs_popcorn_api_script_review_update
  on public.orchestrator_runs;
create policy orchestrator_runs_popcorn_api_script_review_update
  on public.orchestrator_runs for update to popcorn_api
  using (agent_role is null or agent_role = 'creative_director')
  with check (agent_role is null or agent_role = 'creative_director');

drop policy if exists orchestrator_run_gates_popcorn_api_script_review_select
  on public.orchestrator_run_gates;
create policy orchestrator_run_gates_popcorn_api_script_review_select
  on public.orchestrator_run_gates for select to popcorn_api
  using (stage = 'after:draft_script');

drop policy if exists orchestrator_run_gates_popcorn_api_script_review_update
  on public.orchestrator_run_gates;
create policy orchestrator_run_gates_popcorn_api_script_review_update
  on public.orchestrator_run_gates for update to popcorn_api
  using (stage = 'after:draft_script')
  with check (stage = 'after:draft_script');

drop policy if exists actions_popcorn_api_script_feedback_insert on public.actions;
create policy actions_popcorn_api_script_feedback_insert
  on public.actions for insert to popcorn_api
  with check (tool = 'board_feedback');
