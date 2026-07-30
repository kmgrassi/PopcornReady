#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl =
  "postgresql://postgres:postgres@127.0.0.1:55522/postgres";
const apiPort = 4319;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const ids = {
  workspace: "00000000-0000-0000-0000-000000007000",
  project: "00000000-0000-0000-0000-000000007001",
  legacySucceeded: "00000000-0000-0000-0000-000000007101",
  legacyFailed: "00000000-0000-0000-0000-000000007102",
  validSucceeded: "00000000-0000-0000-0000-000000007103",
  validFailed: "00000000-0000-0000-0000-000000007104",
  legacyChild: "00000000-0000-0000-0000-000000007105",
  session: "00000000-0000-0000-0000-000000007110",
  legacyGate: "00000000-0000-0000-0000-000000007201",
  validGate: "00000000-0000-0000-0000-000000007203",
  legacyFailureAction: "00000000-0000-0000-0000-000000007302",
  validFailureAction: "00000000-0000-0000-0000-000000007304",
  proposalAction: "00000000-0000-0000-0000-000000007310",
  approvalAction: "00000000-0000-0000-0000-000000007311",
  dispatchAction: "00000000-0000-0000-0000-000000007312",
  dispatch: "00000000-0000-0000-0000-000000007401",
  budget: "00000000-0000-0000-0000-000000007500",
  execution: "00000000-0000-0000-0000-000000007600",
  work: "00000000-0000-0000-0000-000000007700",
  callback: "00000000-0000-0000-0000-000000007800",
  job: "00000000-0000-0000-0000-000000007900",
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.input ? ["pipe", "pipe", "pipe"] : "pipe",
    input: options.input,
    env: { ...process.env, ...options.env },
    timeout: options.timeout ?? 180_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(" ")} failed with ${result.status}`,
        result.stdout,
        result.stderr,
      ].filter(Boolean).join("\n")
    );
  }
  return result.stdout;
}

function sql(source) {
  return run(
    "psql",
    [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-q"],
    { input: source }
  );
}

function sqlScalar(source) {
  return run(
    "psql",
    [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-qAt"],
    { input: source }
  ).trim();
}

function flatten(value, prefix = "", out = new Map()) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  out.set(prefix, String(value ?? ""));
  return out;
}

function findValue(flat, exactPaths, fallbackPattern) {
  for (const path of exactPaths) {
    const value = flat.get(path);
    if (value) return value;
  }
  for (const [path, value] of flat.entries()) {
    if (fallbackPattern.test(path) && value) return value;
  }
  return "";
}

function localEnvironment() {
  const status = JSON.parse(run("supabase", ["status", "-o", "json"], {
    timeout: 30_000,
  }));
  const flat = flatten(status);
  const supabaseUrl = findValue(
    flat,
    ["api.url", "API_URL"],
    /(^|\.)api(_|\.)?url$/i
  );
  const anonKey = findValue(
    flat,
    ["auth.anon_key", "auth.anonKey", "ANON_KEY"],
    /(^|\.)(anon|anon_key|anonKey)$/i
  );
  const serviceRoleKey = findValue(
    flat,
    ["auth.service_role_key", "auth.serviceRoleKey", "SERVICE_ROLE_KEY"],
    /(^|\.)(service_role|service_role_key|serviceRoleKey)$/i
  );
  assert.ok(supabaseUrl && anonKey && serviceRoleKey);
  return {
    ...process.env,
    AUTH_MODE: "local",
    DB_BACKEND: "supabase",
    STORAGE_BACKEND: "local",
    NODE_ENV: "development",
    ORCHESTRATOR_RECOVERY_ENABLED: "false",
    PORT: String(apiPort),
    SUPABASE_URL: supabaseUrl,
    SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    DATABASE_URL: databaseUrl,
  };
}

const seedSql = `
insert into public.workspaces (id, name)
values ('${ids.workspace}', 'dev_workspace');
insert into public.projects (id, workspace_id, name, visibility)
values ('${ids.project}', '${ids.workspace}', 'PR7B upgrade smoke', 'private');

insert into public.orchestrator_runs (
  id, project_id, status, input_summary, agent_role, root_execution_profile,
  started_at, completed_at
) values
  ('${ids.legacySucceeded}', '${ids.project}', 'succeeded',
   'Legacy storyboard root', 'creative_director', 'flat', now(), now()),
  ('${ids.validSucceeded}', '${ids.project}', 'succeeded',
   'Valid storyboard root', 'creative_director', 'creative_director', now(), now()),
  ('${ids.validFailed}', '${ids.project}', 'failed',
   'Valid credit retry root', 'creative_director', 'creative_director', now(), now());

alter table public.orchestrator_runs
  disable trigger orchestrator_runs_fill_root_profile;
insert into public.orchestrator_runs (
  id, project_id, status, input_summary, agent_role, root_execution_profile,
  started_at, completed_at, error
) values (
  '${ids.legacyFailed}', '${ids.project}', 'failed',
  'Legacy credit retry root', 'creative_director', null, now(), now(),
  '{"schema_version":"orchestrator_run_error.v1","kind":"insufficient_credits","message":"fixture"}'
);
alter table public.orchestrator_runs
  enable trigger orchestrator_runs_fill_root_profile;

insert into public.orchestrator_run_gates (
  id, orchestrator_run_id, stage, status
) values
  ('${ids.legacyGate}', '${ids.legacySucceeded}',
   'after:generate_storyboard', 'reached'),
  ('${ids.validGate}', '${ids.validSucceeded}',
   'after:generate_storyboard', 'reached');

insert into public.actions (
  id, project_id, orchestrator_run_id, tool, status, params, error
) values
  ('${ids.legacyFailureAction}', '${ids.project}', '${ids.legacyFailed}',
   'generate_clip', 'failed', '{}',
   '{"schema_version":"action_error.v1","kind":"insufficient_credits","message":"fixture"}'),
  ('${ids.validFailureAction}', '${ids.project}', '${ids.validFailed}',
   'generate_clip', 'failed', '{}',
   '{"schema_version":"action_error.v1","kind":"insufficient_credits","message":"fixture"}'),
  ('${ids.proposalAction}', '${ids.project}', '${ids.legacySucceeded}',
   'rerun_proposal', 'running', '{}', null),
  ('${ids.approvalAction}', '${ids.project}', '${ids.legacySucceeded}',
   'rerun_proposal_approval', 'applied',
   '{"schemaVersion":"RerunProposalApproval.v1"}', null),
  ('${ids.dispatchAction}', '${ids.project}', '${ids.legacySucceeded}',
   'rerun_work_item_dispatch', 'running', '{}', null);

insert into public.agent_sessions (
  id, project_id, domain, active_run_id
) values ('${ids.session}', '${ids.project}', 'visuals', null);
insert into public.orchestrator_runs (
  id, project_id, status, input_summary, agent_role, agent_session_id,
  session_sequence, task_kind, task_params, origin_kind, parent_run_id,
  root_action_id, started_at
) values (
  '${ids.legacyChild}', '${ids.project}', 'running', 'Legacy active child',
  'visuals', '${ids.session}', 1, 'visuals_revision',
  '{"schemaVersion":"DomainTask.v1","domain":"visuals","taskKind":"visuals_revision"}',
  'creative_director', '${ids.legacySucceeded}', '${ids.dispatchAction}', now()
);
update public.agent_sessions
   set active_run_id = '${ids.legacyChild}'
 where id = '${ids.session}';

insert into public.orchestrator_dispatches (
  id, orchestrator_run_id, workspace_id, status
) values (
  '${ids.dispatch}', '${ids.legacySucceeded}', '${ids.workspace}', 'queued'
);

insert into public.orchestrator_budget_reservations (
  id, project_id, orchestrator_run_id, root_run_id, action_id,
  reservation_key, reservation_scope, estimated_usd, status,
  proposal_action_id
) values (
  '${ids.budget}', '${ids.project}', '${ids.legacySucceeded}',
  '${ids.legacySucceeded}', '${ids.proposalAction}', 'pr7b-fixture-budget',
  'proposal_ceiling', 0.5, 'reserved', '${ids.proposalAction}'
);
insert into public.rerun_execution_reservations (
  id, proposal_action_id, project_id, root_run_id, approval_action_id,
  budget_reservation_id, idempotency_key, request_fingerprint,
  approved_max_cost_usd, status
) values (
  '${ids.execution}', '${ids.proposalAction}', '${ids.project}',
  '${ids.legacySucceeded}', '${ids.approvalAction}', '${ids.budget}',
  'pr7b-fixture-execution', 'pr7b-fixture-fingerprint', 0.5, 'running'
);
insert into public.rerun_execution_work_items (
  id, execution_reservation_id, project_id, work_item_id,
  request_fingerprint, dispatch_action_id, status, lease_generation
) values (
  '${ids.work}', '${ids.execution}', '${ids.project}', 'legacy-work',
  'pr7b-fixture-work', '${ids.dispatchAction}', 'running', 1
);
insert into public.rerun_execution_callbacks (
  id, execution_reservation_id, work_reservation_id, project_id, executor_id,
  callback_token_hash, callback_generation, status
) values (
  '${ids.callback}', '${ids.execution}', '${ids.work}', '${ids.project}',
  'fake:pr7b', 'fixture-hash', 1, 'pending'
);
insert into public.jobs (
  id, workspace_id, project_id, type, status, action_id
) values (
  '${ids.job}', '${ids.workspace}', '${ids.project}', 'generation', 'running',
  '${ids.dispatchAction}'
);
`;

const postUpgradeAssertions = `
do $$
declare
  v_reopen_blocked boolean := false;
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orchestrator_runs'
       and column_name = 'root_execution_profile'
  ) then raise exception 'profile column remains'; end if;

  if exists (
    select 1 from public.orchestrator_runs
     where id in ('${ids.legacySucceeded}', '${ids.legacyFailed}')
       and status <> 'superseded'
  ) then raise exception 'legacy roots were not superseded'; end if;
  if exists (
    select 1 from public.orchestrator_run_gates
     where id = '${ids.legacyGate}' and status <> 'rejected'
  ) then raise exception 'legacy storyboard gate remains open'; end if;
  if exists (
    select 1 from public.orchestrator_dispatches
     where id = '${ids.dispatch}' and status <> 'completed'
  ) then raise exception 'legacy dispatch remains live'; end if;
  if exists (
    select 1 from public.orchestrator_runs
     where id = '${ids.legacyChild}' and status <> 'canceled'
  ) then raise exception 'legacy child remains active'; end if;
  if exists (
    select 1 from public.agent_sessions
     where id = '${ids.session}' and active_run_id is not null
  ) then raise exception 'legacy session claim remains active'; end if;
  if exists (
    select 1 from public.jobs
     where id = '${ids.job}' and status <> 'canceled'
  ) then raise exception 'legacy provider job remains active'; end if;
  if exists (
    select 1 from public.orchestrator_budget_reservations
     where id = '${ids.budget}' and status <> 'canceled'
  ) then raise exception 'legacy budget remains reserved'; end if;
  if exists (
    select 1 from public.rerun_execution_reservations
     where id = '${ids.execution}' and status <> 'canceled'
  ) then raise exception 'legacy execution remains active'; end if;
  if exists (
    select 1 from public.rerun_execution_work_items
     where id = '${ids.work}' and status <> 'canceled'
  ) then raise exception 'legacy work remains active'; end if;
  if exists (
    select 1 from public.rerun_execution_callbacks
     where id = '${ids.callback}' and status <> 'canceled'
  ) then raise exception 'legacy callback remains pending'; end if;

  if not exists (
    select 1 from public.orchestrator_runs
     where id = '${ids.validSucceeded}' and status = 'succeeded'
  ) or not exists (
    select 1 from public.orchestrator_run_gates
     where id = '${ids.validGate}' and status = 'reached'
  ) or not exists (
    select 1 from public.orchestrator_runs
     where id = '${ids.validFailed}' and status = 'failed'
  ) then raise exception 'valid hierarchy controls changed during migration'; end if;

  begin
    update public.orchestrator_runs
       set status = 'running', superseded_at = null, completed_at = null
     where id = '${ids.legacySucceeded}';
  exception when check_violation then
    v_reopen_blocked := true;
  end;
  if not v_reopen_blocked then
    raise exception 'direct superseded reopen unexpectedly succeeded';
  end if;

  if to_regprocedure(
    'public.create_orchestrator_run_with_anonymous_quota(uuid,text,double precision,timestamp with time zone,integer,text,text)'
  ) is null then raise exception 'seven-argument anonymous RPC missing'; end if;
  if position(
    'root_execution_profile' in pg_get_functiondef(
      'public.reserve_rerun_proposal_execution(uuid,uuid,uuid,text,text,double precision,text)'::regprocedure
    )
  ) > 0 then raise exception 'reserve RPC still references profile'; end if;
end;
$$;
`;

async function waitForApi(child) {
  const deadline = Date.now() + 30_000;
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`API exited before health check:\n${output}`);
    }
    try {
      const response = await fetch(`${apiOrigin}/api/v1/health`);
      if (response.status === 200) return;
    } catch {
      // Continue until the bounded deadline.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`API did not become healthy:\n${output}`);
}

async function post(path) {
  const response = await fetch(`${apiOrigin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { response, body };
}

async function exerciseRoutes(env) {
  const child = spawn("pnpm", ["--filter", "@popcorn/api", "start"], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForApi(child);

    const legacyApprove = await post(
      `/api/v1/projects/${ids.project}/generation-runs/${ids.legacySucceeded}/approve`
    );
    assert.equal(legacyApprove.response.status, 202);
    assert.equal(legacyApprove.body?.run?.status, "superseded");
    assert.equal(
      sqlScalar(`
        select status::text || '|' || attempts::text
          from public.orchestrator_dispatches
         where id = '${ids.dispatch}';
      `),
      "completed|0",
      "legacy approval must not re-enqueue or claim the retired dispatch"
    );

    const legacyRetry = await post(
      `/api/v1/projects/${ids.project}/generation-runs/${ids.legacyFailed}/retry-after-credit-update`
    );
    assert.equal(legacyRetry.response.status, 400);

    const validApprove = await post(
      `/api/v1/projects/${ids.project}/generation-runs/${ids.validSucceeded}/approve`
    );
    assert.equal(validApprove.response.status, 202);
    assert.equal(validApprove.body?.run?.status, "waiting");

    const validRetry = await post(
      `/api/v1/projects/${ids.project}/generation-runs/${ids.validFailed}/retry-after-credit-update`
    );
    assert.equal(validRetry.response.status, 202);
    assert.equal(validRetry.body?.run?.status, "running");

    for (const path of [
      `/api/v1/projects/${ids.project}/generation-runs/${ids.legacySucceeded}/reject`,
      `/api/v1/projects/${ids.project}/generation-runs/${ids.legacySucceeded}/restart-from`,
      `/api/v1/projects/${ids.project}/generation-runs/${ids.legacySucceeded}/board-revisions`,
      `/api/v1/projects/${ids.project}/asset-revisions`,
      `/api/v1/projects/${ids.project}/timelines/00000000-0000-0000-0000-000000007999/revisions`,
    ]) {
      const retired = await post(path);
      assert.equal(retired.response.status, 404, path);
    }
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolvePromise) => {
      if (child.exitCode !== null) resolvePromise();
      else child.once("exit", resolvePromise);
      setTimeout(resolvePromise, 5_000);
    });
  }
}

console.log("Resetting the local database to the PR7A migration boundary...");
run(
  "supabase",
  [
    "db", "reset", "--local", "--version", "20260730180000",
    "--no-seed", "--yes",
  ],
  { timeout: 300_000 }
);
sql(seedSql);

console.log("Applying PR7B over seeded legacy and hierarchy controls...");
run("supabase", ["migration", "up", "--local"], { timeout: 180_000 });
sql(postUpgradeAssertions);
const env = localEnvironment();
await exerciseRoutes(env);

console.log("Exercising the replacement RPCs and final-schema integration...");
run(
  "pnpm",
  [
    "--filter", "@popcorn/api", "exec", "tsx", "--test",
    "src/lib/supabase/__tests__/root-profile-retirement.integration.test.ts",
    "src/lib/supabase/__tests__/rerun-proposal-lifecycle.integration.test.ts",
  ],
  {
    env: { ...env, RUN_LOCAL_DB_INTEGRATION: "1" },
    timeout: 300_000,
  }
);

console.log("Replaying all migrations from a clean database...");
run("supabase", ["db", "reset", "--local", "--yes"], { timeout: 300_000 });
sql(`
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orchestrator_runs'
       and column_name = 'root_execution_profile'
  ) then raise exception 'clean reset retained profile column'; end if;
end;
$$;
`);

console.log("PR7B seeded upgrade and clean-reset smoke passed.");
