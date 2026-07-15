import { enqueueOrchestratorDispatch } from "@/lib/api/v1/orchestrator-store";
import { createLogger } from "@/lib/v1/logger";
import { redactError } from "@/lib/v1/redact";

const logger = createLogger();

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
  logger.info("orchestrator_resume.enqueue_started", {
    runId: input.runId,
    workspaceId: input.workspaceId,
  });
  try {
    await (input.enqueue ?? enqueueOrchestratorDispatch)(input.runId, input.workspaceId);
    logger.info("orchestrator_resume.enqueued", {
      runId: input.runId,
      workspaceId: input.workspaceId,
    });
  } catch (error) {
    const safeError = redactError(error, { defaultCode: "resume_enqueue_failed" });
    logger.error("orchestrator_resume.enqueue_failed", {
      runId: input.runId,
      workspaceId: input.workspaceId,
      error: safeError,
    });
    throw error;
  }
}
