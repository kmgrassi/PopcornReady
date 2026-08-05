import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { ApiError } from "@/core/errors";
import { withTransaction } from "./transactions";

export interface DecideScriptReviewInput {
  workspaceId: string;
  projectId: string;
  runId: string;
  gateId: string;
  scriptDraftId: string;
  decision: "approved" | "rejected";
  note?: string;
  feedbackActionId?: string;
}

interface ReviewRow extends QueryResultRow {
  gate_status: string;
  stage: string;
  script_draft_id: string | null;
}

interface ScriptRow extends QueryResultRow {
  id: string;
  status: string;
}

export type ScriptReviewTransactionRunner = <T>(
  operation: string,
  callback: (client: PoolClient) => Promise<T>,
) => Promise<T>;

export async function decideScriptReviewTransaction(
  input: DecideScriptReviewInput,
  transaction: ScriptReviewTransactionRunner = withTransaction,
): Promise<{ feedbackActionId?: string }> {
  return transaction("script-review.decide", async (client) => {
    const locked = await client.query<ReviewRow>(
      `select g.status as gate_status, g.stage,
              p.current_script_draft_id as script_draft_id
         from public.orchestrator_run_gates g
         join public.orchestrator_runs r on r.id = g.orchestrator_run_id
         join public.projects p on p.id = r.project_id
        where g.id = $1 and r.id = $2 and r.project_id = $3
          and p.workspace_id = $4
        for update of g, r, p`,
      [input.gateId, input.runId, input.projectId, input.workspaceId],
    );
    const row = locked.rows[0];
    if (!row) throw new ApiError("not_found", "Script review was not found.");
    if (row.stage !== "after:draft_script" || row.gate_status !== "reached") {
      throw new ApiError("stale_proposal", "This script review was already decided.");
    }
    if (!row.script_draft_id || row.script_draft_id !== input.scriptDraftId) {
      throw new ApiError("stale_proposal", "The active script changed before this decision.");
    }
    const script = await client.query<ScriptRow>(
      `select id, status from public.script_drafts
        where id = $1 and project_id = $2
        for update`,
      [input.scriptDraftId, input.projectId],
    );
    if (script.rowCount !== 1 || script.rows[0]?.status !== "draft") {
      throw new ApiError("stale_proposal", "The active script changed before this decision.");
    }

    let feedbackActionId: string | undefined;
    if (input.decision === "approved") {
      const approved = await client.query(
        `update public.script_drafts
            set status = 'approved', updated_at = now()
          where id = $1 and project_id = $2 and status = 'draft'
          returning id`,
        [input.scriptDraftId, input.projectId],
      );
      if (approved.rowCount !== 1) {
        throw new ApiError("stale_proposal", "The active script changed before approval.");
      }
    } else {
      const note = input.note?.trim();
      if (!note) throw new ApiError("validation_failed", "Describe the script changes first.");
      feedbackActionId = input.feedbackActionId ?? randomUUID();
      await client.query(
        `insert into public.actions(
           id,schema_version,project_id,orchestrator_run_id,tool,status,params,
           input_asset_ids,rationale,job_ids,output_asset_ids
         ) values ($1,'action.v1',$2,$3,'board_feedback','applied',$4::jsonb,
           '{}','Creator requested changes to the active script review.','{}','{}')`,
        [
          feedbackActionId,
          input.projectId,
          input.runId,
          JSON.stringify({ scope: "script", message: note, scriptDraftId: input.scriptDraftId }),
        ],
      );
    }

    await client.query(
      `update public.orchestrator_run_gates
          set status = $2, decided_at = now(), decided_by_action_id = $3, updated_at = now()
        where id = $1`,
      [input.gateId, input.decision, feedbackActionId ?? null],
    );
    await client.query(
      `update public.orchestrator_runs
          set status = 'waiting', started_at = coalesce(started_at, now()),
              completed_at = null, error = null, updated_at = now()
        where id = $1`,
      [input.runId],
    );
    return feedbackActionId ? { feedbackActionId } : {};
  });
}
