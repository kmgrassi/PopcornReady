import { randomUUID } from "node:crypto";

import type { ToolExecutionContext } from "./types";
import type { DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";
import type { ProjectGraphSnapshot } from "@/lib/orchestrator-context/graph-snapshot";
import type { DomainTargetScope } from "@/lib/orchestrator-context/target-scope";

export interface ToolExecutionContextInput {
  workspaceId: string;
  projectId: string;
  orchestratorRunId: string;
  /** Per-call correlation id. It is not necessarily backed by an action row. */
  toolCallId?: string;
  /** A durable action id, set only after the engine reserves the action row. */
  actionId?: string;
  actorId?: string;
  agentId?: string;
  messageId?: string;
  requestId?: string;
  sessionClaimGeneration?: number;
  domainTask?: DomainTaskV1;
  domainScope?: DomainTargetScope;
  domainSnapshot?: ProjectGraphSnapshot;
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
    ...(input.actionId ? { actionId: input.actionId } : {}),
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.messageId ? { messageId: input.messageId } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.sessionClaimGeneration !== undefined
      ? { sessionClaimGeneration: input.sessionClaimGeneration }
      : {}),
    ...(input.domainTask ? { domainTask: input.domainTask } : {}),
    ...(input.domainScope ? { domainScope: input.domainScope } : {}),
    ...(input.domainSnapshot ? { domainSnapshot: input.domainSnapshot } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}
