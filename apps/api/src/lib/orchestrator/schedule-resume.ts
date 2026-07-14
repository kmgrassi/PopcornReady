import { enqueueOrchestratorDispatch } from "@/lib/api/v1/orchestrator-store";

/**
 * Wake the durable dispatcher after an async tool reaches a terminal state.
 * Workers must not directly enter the engine: the dispatcher lease is the
 * single owner of an orchestrator turn.
 */
export async function scheduleOrchestratorResume(input: {
  runId: string;
  workspaceId: string;
  enqueue?: (runId: string, workspaceId: string) => Promise<unknown>;
}): Promise<void> {
  await (input.enqueue ?? enqueueOrchestratorDispatch)(input.runId, input.workspaceId);
}
