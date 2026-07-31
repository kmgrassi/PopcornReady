import { createHash } from "node:crypto";
import { ApiError } from "@/core/errors";
import type { BoundRequiredOutput } from "@popcorn/shared/rerun-proposal";
import { rerunOutputAssetKinds } from "@/lib/orchestrator/rerun-output-asset-kind";
import {
  assertLiveLease,
  lifecycleTransaction,
  lockExecution,
  lockWork,
  requireRow,
} from "./rerun-lifecycle-common";
import type { ExecutionLease } from "./rerun-execution-transactions";

type CallbackFence = {
  executorId: string;
  tokenHash: string;
  generation: number;
  requiredOutputs: unknown[];
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

type DurableCallbackResult = {
  executorId: string;
  status: "completed" | "failed" | "canceled" | "pending";
  jobIds: string[];
  result: {
    outputs?: unknown[];
    childRunId?: string;
    reportActionId?: string;
    reconciliationActionId?: string;
    primitiveActionIds?: string[];
    budgetReservationKeys?: string[];
    providerResult?: unknown;
  } | null;
};

function callbackResult(row: Record<string, unknown>): DurableCallbackResult {
  const status = String(row.status) as DurableCallbackResult["status"];
  const result = status === "completed"
    ? {
      childRunId: row.child_run_id,
      reportActionId: row.report_action_id,
      reconciliationActionId: row.reconciliation_action_id,
      primitiveActionIds: row.primitive_action_ids,
      budgetReservationKeys: row.budget_reservation_keys,
      outputs: row.binding_results,
      providerResult: row.callback_result,
    }
    : null;
  return {
    executorId: String(row.executor_id),
    status,
    jobIds: (row.job_ids ?? []) as string[],
    result: result as DurableCallbackResult["result"],
  };
}

export async function reserveWorkTransaction(input: {
  projectId: string;
  lease: ExecutionLease;
  workItemId: string;
  requestFingerprint: string;
  dispatchActionId: string;
  dispatchParams: Record<string, unknown>;
  callbackFences: CallbackFence[];
}) {
  return lifecycleTransaction("rerunLifecycle.reserveWork", async (client) => {
    const execution = await lockExecution(
      client, input.projectId, input.lease.reservationId
    );
    assertLiveLease(execution, input.lease.leaseToken, input.lease.leaseGeneration);
    const existing = await lockWork(client, execution.id, input.workItemId);
    if (existing) {
      if (
        existing.request_fingerprint !== input.requestFingerprint ||
        existing.dispatch_action_id !== input.dispatchActionId
      ) {
        throw new ApiError("idempotency_conflict", "Work-item replay input changed.");
      }
      const callbacks = await client.query(
        `select id, execution_reservation_id, work_reservation_id, project_id,
                executor_id, binding_subset, callback_token_hash,
                callback_generation, job_ids, status, callback_result,
                child_run_id, report_action_id, reconciliation_action_id,
                primitive_action_ids, budget_reservation_keys,
                binding_results, expires_at
           from public.rerun_execution_callbacks
          where work_reservation_id=$1 and status <> 'canceled'
          order by executor_id`,
        [existing.id]
      );
      return {
        work_reservation_id: existing.id as string,
        work_status: existing.status as
          | "reserved"
          | "running"
          | "completed"
          | "failed"
          | "canceled",
        child_run_id: existing.child_run_id as string | null,
        report_action_id: existing.report_action_id as string | null,
        reconciliation_action_id: existing.reconciliation_action_id as string | null,
        binding_results: existing.binding_results as unknown[] | null,
        primitive_action_ids: existing.primitive_action_ids as string[],
        budget_reservation_keys: existing.budget_reservation_keys as string[],
        callback_results: callbacks.rows.map(callbackResult),
        replayed: true,
      };
    }
    await client.query(
      `insert into public.actions (
         id,schema_version,project_id,orchestrator_run_id,tool,status,params,
         input_asset_ids,rationale,proposal,job_ids,output_asset_ids
       ) values ($1,'action.v1',$2,$3,'rerun_work_item_dispatch','running',
         $4::jsonb,'{}','Bound selective-regeneration work-item dispatch.',
         null,'{}','{}')`,
      [
        input.dispatchActionId, input.projectId, execution.root_run_id,
        JSON.stringify({ schema_version: "action_params.v1", ...input.dispatchParams }),
      ]
    );
    const workId = requireRow((await client.query<{ id: string }>(
      `insert into public.rerun_execution_work_items (
         execution_reservation_id,project_id,work_item_id,request_fingerprint,
         dispatch_action_id,lease_generation,status
       ) values ($1,$2,$3,$4,$5,$6,'running') returning id`,
      [
        execution.id, input.projectId, input.workItemId,
        input.requestFingerprint, input.dispatchActionId,
        input.lease.leaseGeneration,
      ]
    )).rows, "Could not reserve rerun work.").id;
    for (const callback of [...input.callbackFences].sort((a, b) =>
      a.executorId.localeCompare(b.executorId))) {
      await client.query(
        `insert into public.rerun_execution_callbacks (
           execution_reservation_id,work_reservation_id,project_id,executor_id,
           binding_subset,callback_token_hash,callback_generation
         ) values ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
        [
          execution.id, workId, input.projectId, callback.executorId,
          JSON.stringify(callback.requiredOutputs), callback.tokenHash,
          callback.generation,
        ]
      );
    }
    return {
      work_reservation_id: workId,
      work_status: "running" as const,
      child_run_id: null,
      report_action_id: null,
      reconciliation_action_id: null,
      binding_results: null,
      primitive_action_ids: [],
      budget_reservation_keys: [],
      callback_results: [],
      replayed: false,
    };
  });
}

export async function parkWorkTransaction(input: {
  projectId: string;
  lease: ExecutionLease;
  workItemId: string;
  acceptedCallbacks?: Array<{
    executorId: string; tokenHash: string; generation: number; jobIds: string[];
  }>;
  completedCallbacks?: Array<{
    executorId: string; tokenHash: string; generation: number;
    result: Record<string, unknown>;
  }>;
  blockedPrecondition?: Record<string, unknown>;
  primitiveActionIds: string[];
  budgetReservationKeys: string[];
  bindingResults: unknown[];
}): Promise<void> {
  return lifecycleTransaction("rerunLifecycle.parkWork", async (client) => {
    const execution = await lockExecution(
      client, input.projectId, input.lease.reservationId
    );
    assertLiveLease(execution, input.lease.leaseToken, input.lease.leaseGeneration);
    const work = await lockWork(client, execution.id, input.workItemId);
    if (!work) throw new ApiError("not_found", "Rerun work item not found.");
    const accepted = input.acceptedCallbacks ?? [];
    const completed = input.completedCallbacks ?? [];
    if (input.blockedPrecondition && (accepted.length || completed.length)) {
      throw new ApiError("validation_failed", "Blocked work cannot accept callbacks.");
    }
    let mutatedCallback = false;
    for (const callback of [...accepted, ...completed].sort((a, b) =>
      a.executorId.localeCompare(b.executorId))) {
      const locked = requireRow((await client.query<Record<string, unknown>>(
        `select id, execution_reservation_id, work_reservation_id, project_id,
                executor_id, binding_subset, callback_token_hash,
                callback_generation, job_ids, status, callback_result,
                child_run_id, report_action_id, reconciliation_action_id,
                primitive_action_ids, budget_reservation_keys,
                binding_results, expires_at
           from public.rerun_execution_callbacks
          where work_reservation_id=$1 and executor_id=$2 for update`,
        [work.id, callback.executorId]
      )).rows, "Rerun callback not found.");
      if (
        locked.callback_token_hash !== callback.tokenHash ||
        locked.callback_generation !== callback.generation
      ) {
        throw new ApiError("idempotency_in_progress", "Stale callback fence.");
      }
      if ("jobIds" in callback) {
        if (locked.status !== "pending") {
          throw new ApiError(
            "idempotency_conflict",
            "Accepted callback replay is already terminal."
          );
        }
        const storedJobIds = (locked.job_ids ?? []) as string[];
        if (storedJobIds.length > 0) {
          if (!sameJson(storedJobIds, callback.jobIds)) {
            throw new ApiError(
              "idempotency_conflict",
              "Accepted callback replay changed provider jobs."
            );
          }
          continue;
        }
        await client.query(
          `update public.rerun_execution_callbacks set job_ids=$2
            where id=$1 and status='pending'`,
          [locked.id, callback.jobIds]
        );
        mutatedCallback = true;
      } else {
        const result = callback.result;
        if (locked.status === "completed") {
          if (
            !sameJson(locked.callback_result, result.providerResult ?? null) ||
            locked.child_run_id !== (result.childRunId ?? null) ||
            locked.report_action_id !== (result.reportActionId ?? null) ||
            locked.reconciliation_action_id !==
              (result.reconciliationActionId ?? null) ||
            !sameJson(
              locked.primitive_action_ids,
              result.primitiveActionIds ?? []
            ) ||
            !sameJson(
              locked.budget_reservation_keys,
              result.budgetReservationKeys ?? []
            ) ||
            !sameJson(locked.binding_results, result.outputs ?? [])
          ) {
            throw new ApiError(
              "idempotency_conflict",
              "Completed callback replay changed its durable result."
            );
          }
          continue;
        }
        if (locked.status !== "pending") {
          throw new ApiError(
            "idempotency_conflict",
            "Completed callback replay conflicts with terminal state."
          );
        }
        await client.query(
          `update public.rerun_execution_callbacks set status='completed',
             callback_result=$2::jsonb, child_run_id=$3, report_action_id=$4,
             reconciliation_action_id=$5, primitive_action_ids=$6,
             budget_reservation_keys=$7, binding_results=$8::jsonb,
             completed_at=now()
           where id=$1 and status='pending'`,
          [
            locked.id,
            JSON.stringify(result.providerResult ?? null),
            result.childRunId ?? null,
            result.reportActionId ?? null,
            result.reconciliationActionId ?? null,
            result.primitiveActionIds ?? [],
            result.budgetReservationKeys ?? [],
            JSON.stringify(result.outputs ?? []),
          ]
        );
        mutatedCallback = true;
      }
    }
    if (
      !mutatedCallback &&
      !input.blockedPrecondition &&
      (
        !sameJson(work.primitive_action_ids, input.primitiveActionIds) ||
        !sameJson(work.budget_reservation_keys, input.budgetReservationKeys) ||
        !sameJson(work.binding_results, input.bindingResults)
      )
    ) {
      throw new ApiError(
        "idempotency_conflict",
        "Work park replay changed its durable aggregate."
      );
    }
    await client.query(
      `update public.rerun_execution_work_items
          set status=$2, blocked_precondition=$3::jsonb,
              accepted_callbacks=$4::jsonb, primitive_action_ids=$5,
              budget_reservation_keys=$6, binding_results=$7::jsonb
        where id=$1`,
      [
        work.id,
        input.blockedPrecondition ? "blocked" : "running",
        JSON.stringify(input.blockedPrecondition ?? null),
        JSON.stringify(accepted),
        input.primitiveActionIds,
        input.budgetReservationKeys,
        JSON.stringify(input.bindingResults),
      ]
    );
  });
}

export async function completeWorkTransaction(input: {
  projectId: string;
  lease: ExecutionLease;
  workItemId: string;
  childRunId?: string;
  reportActionId?: string;
  reconciliationActionId?: string;
  bindingResults: unknown[];
  primitiveActionIds: string[];
  budgetReservationKeys: string[];
}): Promise<void> {
  return lifecycleTransaction("rerunLifecycle.completeWork", async (client) => {
    const execution = await lockExecution(
      client, input.projectId, input.lease.reservationId
    );
    assertLiveLease(execution, input.lease.leaseToken, input.lease.leaseGeneration);
    const work = await lockWork(client, execution.id, input.workItemId);
    if (!work) throw new ApiError("not_found", "Rerun work item not found.");
    if (work.status === "completed") {
      if (
        work.child_run_id !== (input.childRunId ?? null) ||
        work.report_action_id !== (input.reportActionId ?? null) ||
        work.reconciliation_action_id !==
          (input.reconciliationActionId ?? null) ||
        !sameJson(work.binding_results, input.bindingResults) ||
        !sameJson(work.primitive_action_ids, input.primitiveActionIds) ||
        !sameJson(work.budget_reservation_keys, input.budgetReservationKeys)
      ) {
        throw new ApiError("idempotency_conflict", "Work completion replay changed.");
      }
      return;
    }
    if (!["reserved", "running"].includes(String(work.status))) {
      throw new ApiError("validation_failed", "Rerun work item is terminal.");
    }
    const set = (values: unknown) =>
      [...new Set(Array.isArray(values) ? values.map(String) : [])].sort();
    if (
      !sameJson(set(work.primitive_action_ids), set(input.primitiveActionIds)) ||
      !sameJson(
        set(work.budget_reservation_keys),
        set(input.budgetReservationKeys)
      )
    ) {
      throw new ApiError(
        "validation_failed",
        "Declared work causation differs from durable reservation."
      );
    }
    const proposal = requireRow((await client.query<{
      proposal: { selectedWork?: Array<{
        workItemId: string;
        requiredOutputs: Array<Record<string, unknown>>;
      }> };
    }>("select proposal from public.actions where id=$1", [
      execution.proposal_action_id,
    ])).rows, "Rerun proposal not found.");
    const expected = proposal.proposal.selectedWork?.find(
      (candidate) => candidate.workItemId === input.workItemId
    )?.requiredOutputs;
    if (!expected || expected.length !== input.bindingResults.length) {
      throw new ApiError("validation_failed", "Bound output count mismatch.");
    }
    const bindings = input.bindingResults as Array<Record<string, unknown>>;
    for (const binding of bindings) {
      const matches = expected.filter((candidate) =>
        candidate.bindingId === binding.bindingId &&
        candidate.workItemId === binding.workItemId &&
        sameJson(candidate.target, binding.target) &&
        candidate.kind === binding.kind &&
        candidate.role === binding.role &&
        candidate.ordinal === binding.ordinal
      );
      if (
        matches.length !== 1 ||
        bindings.filter((candidate) =>
          candidate.bindingId === binding.bindingId).length !== 1
      ) {
        throw new ApiError(
          "validation_failed",
          "Report claimed a binding outside its task."
        );
      }
      const asset = await client.query<{ kind: string; role: string }>(
        `select kind::text as kind,role from public.assets
          where id=$1 and project_id=$2`,
        [binding.assetId, input.projectId]
      );
      const expectedKinds = rerunOutputAssetKinds(
        binding as unknown as BoundRequiredOutput
      );
      if (
        !asset.rows[0] ||
        !expectedKinds.includes(asset.rows[0].kind) ||
        asset.rows[0].role !== binding.intrinsicRole
      ) {
        throw new ApiError(
          "validation_failed",
          "Bound output asset does not match its required output."
        );
      }
    }
    const outputIds = (input.bindingResults as Array<{ assetId?: string }>)
      .flatMap((result) => result.assetId ? [result.assetId] : []);
    const callbacks = await client.query<{
      status: string;
      binding_subset: unknown[];
      binding_results: unknown[];
      child_run_id: string | null;
      report_action_id: string | null;
      reconciliation_action_id: string | null;
      primitive_action_ids: string[];
      budget_reservation_keys: string[];
    }>(
      `select status,binding_subset,binding_results,child_run_id,
              report_action_id,reconciliation_action_id,primitive_action_ids,
              budget_reservation_keys
         from public.rerun_execution_callbacks
        where work_reservation_id=$1 order by executor_id for update`,
      [work.id]
    );
    if (callbacks.rows.some((callback) => callback.status !== "completed")) {
      throw new ApiError("validation_failed", "Executor steps are incomplete.");
    }
    if (callbacks.rows.length > 0) {
      if (input.childRunId || input.reportActionId) {
        throw new ApiError(
          "validation_failed",
          "Step-backed work cannot claim one aggregate child."
        );
      }
      const callbackReconciliations = [...new Set(callbacks.rows.flatMap(
        (callback) => callback.reconciliation_action_id
          ? [callback.reconciliation_action_id] : []
      ))];
      if (
        callbackReconciliations.length > 1 ||
        (callbackReconciliations[0] ?? null) !==
          (input.reconciliationActionId ?? null)
      ) {
        throw new ApiError(
          "validation_failed",
          "Executor reconciliation causation differs."
        );
      }
      const aggregate = callbacks.rows.flatMap(
        (callback) => callback.binding_results ?? []
      ).sort((left, right) => {
        const a = left as Record<string, unknown>;
        const b = right as Record<string, unknown>;
        return Number(a.ordinal) - Number(b.ordinal) ||
          String(a.bindingId).localeCompare(String(b.bindingId));
      });
      if (!sameJson(aggregate, bindings)) {
        throw new ApiError(
          "validation_failed",
          "Aggregate bindings differ from durable executor steps."
        );
      }
      for (const callback of callbacks.rows) {
        if (
          callback.binding_subset.length !== callback.binding_results.length ||
          callback.binding_results.some((result) =>
            !(callback.binding_subset as Array<Record<string, unknown>>).some(
              (expectedBinding) => {
                const actual = result as Record<string, unknown>;
                return expectedBinding.bindingId === actual.bindingId &&
                  expectedBinding.workItemId === actual.workItemId &&
                  sameJson(expectedBinding.target, actual.target) &&
                  expectedBinding.kind === actual.kind &&
                  expectedBinding.role === actual.role &&
                  expectedBinding.ordinal === actual.ordinal;
              }
            ))
        ) {
          throw new ApiError(
            "validation_failed",
            "Executor step binding subset mismatch."
          );
        }
        if (Boolean(callback.child_run_id) !== Boolean(callback.report_action_id)) {
          throw new ApiError(
            "validation_failed",
            "Executor child and report must be paired."
          );
        }
        if (callback.child_run_id && callback.report_action_id) {
          const report = await client.query(
            `select 1
               from public.orchestrator_runs child
               join public.actions report on report.id=$1
              where child.id=$2 and child.project_id=$3
                and child.parent_run_id=$4 and child.root_action_id=$5
                and child.task_params#>>'{approvalContext,proposalActionId}'=$6
                and child.task_params#>>'{approvalContext,executionReservationId}'=$7
                and child.status='succeeded'
                and report.project_id=$3
                and report.orchestrator_run_id=child.id
                and report.tool='domain_report' and report.status='applied'
                and report.params#>'{outcome,outputs}'=$8::jsonb`,
            [
              callback.report_action_id, callback.child_run_id,
              input.projectId, execution.root_run_id,
              work.dispatch_action_id, execution.proposal_action_id,
              execution.id, JSON.stringify(callback.binding_results),
            ]
          );
          if (!report.rowCount) {
            throw new ApiError(
              "validation_failed",
              "Executor step child report causation mismatch."
            );
          }
        }
      }
    }
    if (Boolean(input.childRunId) !== Boolean(input.reportActionId)) {
      throw new ApiError(
        "validation_failed",
        "Child run and report action must be provided together."
      );
    }
    if (input.childRunId && input.reportActionId) {
      const report = await client.query(
        `select 1
           from public.orchestrator_runs child
           join public.actions report on report.id=$1
          where child.id=$2 and child.project_id=$3
            and child.parent_run_id=$4 and child.root_action_id=$5
            and child.task_params#>>'{approvalContext,proposalActionId}'=$6
            and child.task_params#>>'{approvalContext,executionReservationId}'=$7
            and child.status='succeeded'
            and report.project_id=$3
            and report.orchestrator_run_id=child.id
            and report.tool='domain_report' and report.status='applied'
            and report.params#>'{outcome,outputs}'=$8::jsonb`,
        [
          input.reportActionId, input.childRunId, input.projectId,
          execution.root_run_id, work.dispatch_action_id,
          execution.proposal_action_id, execution.id,
          JSON.stringify(input.bindingResults),
        ]
      );
      if (!report.rowCount) {
        throw new ApiError(
          "validation_failed",
          "Domain report causation or fenced finalization mismatch."
        );
      }
    }
    if (input.reconciliationActionId) {
      const reconciliation = await client.query(
        `select 1 from public.actions where id=$1 and project_id=$2
          and orchestrator_run_id=$3 and status='applied'
          and params->>'proposalActionId'=$4
          and params->>'executionReservationId'=$5
          and params->>'workItemId'=$6`,
        [
          input.reconciliationActionId, input.projectId,
          execution.root_run_id, execution.proposal_action_id,
          execution.id, input.workItemId,
        ]
      );
      if (!reconciliation.rowCount) {
        throw new ApiError(
          "validation_failed",
          "Work reconciliation is outside proposal causation."
        );
      }
    }
    for (const binding of bindings) {
      let caused = false;
      if (callbacks.rows.length > 0) {
        for (const callback of callbacks.rows) {
          if (!(callback.binding_results as Array<Record<string, unknown>>)
            .some((candidate) => candidate.assetId === binding.assetId)) {
            continue;
          }
          const evidence = await client.query(
            `select 1
               from public.action_assets aa
               join public.actions primitive on primitive.id=aa.action_id
               join public.orchestrator_budget_reservations budget
                 on budget.action_id=primitive.id
              where aa.project_id=$1 and aa.asset_id=$2::uuid
                and aa.direction='output' and aa.action_id=any($3::uuid[])
                and primitive.orchestrator_run_id=coalesce($4::uuid,$5::uuid)
                and primitive.tool<>'domain_report'
                and (
                  primitive.status='applied'
                  or (
                    primitive.id=$8::uuid
                    and primitive.status='running'
                  )
                )
                and budget.parent_reservation_id=$6::uuid
                and budget.reservation_key=any($7::text[])
                and budget.orchestrator_run_id=coalesce($4::uuid,$5::uuid)
                and budget.status='settled' limit 1`,
            [
              input.projectId, binding.assetId,
              callback.primitive_action_ids, callback.child_run_id,
              execution.root_run_id, execution.budget_reservation_id,
              callback.budget_reservation_keys,
              work.dispatch_action_id,
            ]
          );
          caused ||= Boolean(evidence.rowCount);
        }
      } else {
        const evidence = await client.query(
          `select 1
             from public.action_assets aa
             join public.actions primitive on primitive.id=aa.action_id
             join public.orchestrator_budget_reservations budget
               on budget.action_id=primitive.id
            where aa.project_id=$1 and aa.asset_id=$2::uuid
              and aa.direction='output' and aa.action_id=any($3::uuid[])
              and primitive.orchestrator_run_id=coalesce($4::uuid,$5::uuid)
              and primitive.tool<>'domain_report'
              and (
                primitive.status='applied'
                or (
                  primitive.id=$8::uuid
                  and primitive.status='running'
                )
              )
              and budget.parent_reservation_id=$6::uuid
              and budget.reservation_key=any($7::text[])
              and budget.status='settled' limit 1`,
          [
            input.projectId, binding.assetId, input.primitiveActionIds,
            input.childRunId ?? null, execution.root_run_id,
            execution.budget_reservation_id, input.budgetReservationKeys,
            work.dispatch_action_id,
          ]
        );
        caused = Boolean(evidence.rowCount);
      }
      if (!caused) {
        throw new ApiError(
          "validation_failed",
          "Bound output lacks primitive action and budget causation."
        );
      }
    }
    const unsettled = await client.query(
      `select 1 from public.orchestrator_budget_reservations
        where parent_reservation_id=$1 and reservation_key=any($2)
          and status='reserved' limit 1`,
      [execution.budget_reservation_id, input.budgetReservationKeys]
    );
    if (unsettled.rowCount) {
      throw new ApiError("validation_failed", "Work budget is not settled.");
    }
    await client.query(
      `update public.rerun_execution_work_items
          set status='completed',child_run_id=$2,report_action_id=$3,
              reconciliation_action_id=$4,binding_results=$5::jsonb,
              output_asset_ids=$6,primitive_action_ids=$7,
              budget_reservation_keys=$8
        where id=$1`,
      [
        work.id, input.childRunId ?? null, input.reportActionId ?? null,
        input.reconciliationActionId ?? null, JSON.stringify(input.bindingResults),
        outputIds, input.primitiveActionIds, input.budgetReservationKeys,
      ]
    );
    await client.query(
      "update public.actions set status='applied',output_asset_ids=$2 where id=$1",
      [work.dispatch_action_id, outputIds]
    );
    for (const [ordinal, binding] of (input.bindingResults as Array<{
      assetId?: string; role?: string; ordinal?: number;
    }>).entries()) {
      if (!binding.assetId) continue;
      await client.query(
        `insert into public.action_assets(
           project_id,action_id,asset_id,direction,role,ordinal
         ) values ($1,$2,$3,'output',$4,$5)`,
        [
          input.projectId, work.dispatch_action_id, binding.assetId,
          binding.role ?? "rerun_output", binding.ordinal ?? ordinal,
        ]
      );
    }
  });
}

export async function failWorkTransaction(input: {
  projectId: string;
  lease: ExecutionLease;
  workItemId: string;
  error: Record<string, unknown>;
}): Promise<void> {
  return lifecycleTransaction("rerunLifecycle.failWork", async (client) => {
    const execution = await lockExecution(
      client, input.projectId, input.lease.reservationId
    );
    assertLiveLease(execution, input.lease.leaseToken, input.lease.leaseGeneration);
    const work = await lockWork(client, execution.id, input.workItemId);
    if (!work) throw new ApiError("not_found", "Rerun work item not found.");
    if (work.status === "completed") {
      throw new ApiError("validation_failed", "Completed rerun work cannot fail.");
    }
    const error = { schema_version: "rerun_work_error.v1", ...input.error };
    if (work.status === "failed") {
      if (!sameJson(work.error, error)) {
        throw new ApiError(
          "idempotency_conflict",
          "Work failure replay changed its durable error."
        );
      }
      return;
    }
    if (work.status === "canceled") {
      throw new ApiError(
        "idempotency_conflict",
        "Canceled rerun work cannot be failed."
      );
    }
    await client.query(
      "update public.rerun_execution_work_items set status='failed',error=$2::jsonb where id=$1",
      [work.id, JSON.stringify(error)]
    );
    await client.query(
      `update public.actions set status='failed',error=$2::jsonb
        where id=$1 and status='running'`,
      [work.dispatch_action_id, JSON.stringify({ schema_version: "action_error.v1", ...input.error })]
    );
    await client.query(
      `update public.rerun_execution_callbacks set status='canceled'
        where work_reservation_id=$1 and status='pending'`,
      [work.id]
    );
    await client.query(
      `update public.orchestrator_budget_reservations
          set status='released',released_at=now(),updated_at=now()
        where parent_reservation_id=$1
          and reservation_key=any($2) and status='reserved'`,
      [execution.budget_reservation_id, work.budget_reservation_keys ?? []]
    );
  });
}

export async function recordCallbackTransaction(input: {
  projectId: string;
  reservationId: string;
  workItemId: string;
  executorId: string;
  callbackToken: string;
  callbackGeneration: number;
  outcome: "completed" | "failed";
  result: Record<string, unknown>;
}): Promise<boolean> {
  return lifecycleTransaction("rerunLifecycle.recordCallback", async (client) => {
    // Universal order: execution -> work -> callback.
    const execution = await lockExecution(client, input.projectId, input.reservationId);
    const work = await lockWork(client, execution.id, input.workItemId);
    if (!work) throw new ApiError("not_found", "Rerun callback not found.");
    const callback = requireRow((await client.query<Record<string, unknown>>(
      `select id, execution_reservation_id, work_reservation_id, project_id,
              executor_id, binding_subset, callback_token_hash,
              callback_generation, job_ids, status, callback_result,
              child_run_id, report_action_id, reconciliation_action_id,
              primitive_action_ids, budget_reservation_keys,
              binding_results, expires_at,
              expires_at > now() as callback_live
         from public.rerun_execution_callbacks
        where work_reservation_id=$1 and executor_id=$2 for update`,
      [work.id, input.executorId]
    )).rows, "Rerun callback not found.");
    const tokenHash = createHash("sha256").update(input.callbackToken).digest("hex");
    if (
      callback.callback_generation !== input.callbackGeneration ||
      callback.callback_token_hash !== tokenHash
    ) {
      throw new ApiError("idempotency_in_progress", "Stale callback fence.");
    }
    if (callback.status === "completed" || callback.status === "failed") {
      if (
        callback.status !== input.outcome ||
        !sameJson(callback.callback_result, input.result.providerResult ?? null) ||
        callback.child_run_id !== (input.result.childRunId ?? null) ||
        callback.report_action_id !== (input.result.reportActionId ?? null) ||
        callback.reconciliation_action_id !==
          (input.result.reconciliationActionId ?? null) ||
        !sameJson(
          callback.primitive_action_ids,
          input.result.primitiveActionIds ?? []
        ) ||
        !sameJson(
          callback.budget_reservation_keys,
          input.result.budgetReservationKeys ?? []
        ) ||
        !sameJson(callback.binding_results, input.result.outputs ?? [])
      ) {
        throw new ApiError("idempotency_conflict", "Callback replay outcome changed.");
      }
      return true;
    }
    if (
      callback.status !== "pending" ||
      !["running", "waiting"].includes(execution.status) ||
      work.status !== "running" ||
      callback.callback_live !== true
    ) {
      throw new ApiError("idempotency_in_progress", "Stale callback fence.");
    }
    await client.query(
      `update public.rerun_execution_callbacks set status=$2,
         callback_result=$3::jsonb,child_run_id=$4,report_action_id=$5,
         reconciliation_action_id=$6,primitive_action_ids=$7,
         budget_reservation_keys=$8,binding_results=$9::jsonb,
         completed_at=now() where id=$1`,
      [
        callback.id, input.outcome,
        JSON.stringify(input.result.providerResult ?? null),
        input.result.childRunId ?? null, input.result.reportActionId ?? null,
        input.result.reconciliationActionId ?? null,
        input.result.primitiveActionIds ?? [],
        input.result.budgetReservationKeys ?? [],
        JSON.stringify(input.result.outputs ?? []),
      ]
    );
    return false;
  });
}

export async function reserveChildBudgetTransaction(input: {
  projectId: string;
  executionReservationId: string;
  workItemId: string;
  actionId: string;
  childRunId?: string;
  jobId?: string;
  reservationKey: string;
  estimatedUsd: number;
}): Promise<{ reservationId: string; replayed: boolean }> {
  return lifecycleTransaction("rerunLifecycle.reserveChildBudget", async (client) => {
    if (input.estimatedUsd < 0) {
      throw new ApiError("validation_failed", "Invalid child budget estimate.");
    }
    const execution = await lockExecution(
      client, input.projectId, input.executionReservationId
    );
    if (!["running", "waiting"].includes(execution.status)) {
      throw new ApiError("not_found", "Active rerun execution not found.");
    }
    const work = await lockWork(client, execution.id, input.workItemId);
    if (!work || !["reserved", "running"].includes(String(work.status))) {
      throw new ApiError("not_found", "Active rerun work item not found.");
    }
    if (input.actionId === work.dispatch_action_id) {
      if (input.childRunId) {
        throw new ApiError(
          "validation_failed",
          "Dispatch budget cannot claim a child run."
        );
      }
    } else {
      if (!input.childRunId) {
        throw new ApiError(
          "validation_failed",
          "Child budget action requires a causally bound child run."
        );
      }
      const causation = await client.query(
        `select 1
           from public.orchestrator_runs child
           join public.actions primitive on primitive.id=$1
          where child.id=$2 and child.project_id=$3
            and child.parent_run_id=$4
            and child.root_action_id=$5
            and child.task_params#>>'{approvalContext,proposalActionId}'=$6
            and child.task_params#>>'{approvalContext,executionReservationId}'=$7
            and primitive.project_id=$3
            and primitive.orchestrator_run_id=child.id
            and primitive.status in ('running','applied')`,
        [
          input.actionId, input.childRunId, input.projectId,
          execution.root_run_id, work.dispatch_action_id,
          execution.proposal_action_id, execution.id,
        ]
      );
      if (!causation.rowCount) {
        throw new ApiError(
          "validation_failed",
          "Child budget action is outside proposal causation."
        );
      }
    }
    const existing = (await client.query<{
      id: string; parent_reservation_id: string; action_id: string;
      orchestrator_run_id: string; job_id: string | null; estimated_usd: number;
    }>(
      `select id, project_id, orchestrator_run_id, root_run_id, action_id,
              job_id, reservation_key, reservation_scope, estimated_usd,
              actual_usd, status, proposal_action_id, parent_reservation_id
         from public.orchestrator_budget_reservations
        where project_id=$1 and reservation_key=$2 for update`,
      [input.projectId, input.reservationKey]
    )).rows[0];
    if (existing) {
      if (
        existing.parent_reservation_id !== execution.budget_reservation_id ||
        existing.action_id !== input.actionId ||
        existing.orchestrator_run_id !== (input.childRunId ?? execution.root_run_id) ||
        existing.job_id !== (input.jobId ?? null) ||
        existing.estimated_usd !== input.estimatedUsd
      ) {
        throw new ApiError("idempotency_conflict", "Child budget replay input changed.");
      }
      return { reservationId: existing.id, replayed: true };
    }
    const row = requireRow((await client.query<{ id: string }>(
      `insert into public.orchestrator_budget_reservations (
         project_id,orchestrator_run_id,root_run_id,action_id,job_id,
         reservation_key,reservation_scope,estimated_usd,parent_reservation_id
       ) values ($1,$2,$3,$4,$5,$6,'operation',$7,$8) returning id`,
      [
        input.projectId, input.childRunId ?? execution.root_run_id,
        execution.root_run_id, input.actionId, input.jobId ?? null,
        input.reservationKey, input.estimatedUsd, execution.budget_reservation_id,
      ]
    )).rows, "Could not reserve child budget.");
    await client.query(
      `update public.rerun_execution_work_items
          set budget_reservation_keys=array_append(budget_reservation_keys,$2)
        where id=$1 and not ($2=any(budget_reservation_keys))`,
      [work.id, input.reservationKey]
    );
    return { reservationId: row.id, replayed: false };
  });
}
