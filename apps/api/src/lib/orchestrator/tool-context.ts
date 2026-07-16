import { randomUUID } from "node:crypto";

import type { ToolExecutionContext } from "./types";

export interface ToolExecutionContextInput {
  workspaceId: string;
  projectId: string;
  orchestratorRunId: string;
  /** A preallocated durable action id when the engine owns this invocation. */
  toolCallId?: string;
  actorId?: string;
  agentId?: string;
  messageId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export function createToolExecutionContext(
  input: ToolExecutionContextInput
): ToolExecutionContext {
  return {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    orchestratorRunId: input.orchestratorRunId,
    toolCallId: input.toolCallId ?? randomUUID(),
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.messageId ? { messageId: input.messageId } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}
