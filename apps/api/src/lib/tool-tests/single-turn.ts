import { randomUUID } from "node:crypto";

import { orchestratorModel, type OrchestratorModel } from "@/lib/orchestrator/model";
import {
  createToolRegistry,
  executeRegisteredTool,
  type ToolRegistry,
} from "@/lib/orchestrator/registry";
import { createToolExecutionContext } from "@/lib/orchestrator/tool-context";
import {
  type OrchestratorRun,
  type OrchestratorTurn,
  type ToolCallResult,
  type ToolInvocation,
  type ToolInvocationStatus,
} from "@/lib/orchestrator/types";

export type ToolLoopTurnResult =
  | {
      status: "disabled";
      run: OrchestratorRun;
    }
  | {
      status: "completed_turn";
      run: OrchestratorRun;
      turn: OrchestratorTurn;
      result?: ToolCallResult;
    };

export interface RunToolTestTurnInput {
  run: OrchestratorRun;
  workspaceId: string;
  actorId?: string;
  agentId?: string;
  messageId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
  inputSummary: string;
  priorResults?: unknown[];
  registry?: ToolRegistry;
  model?: OrchestratorModel;
  systemPrompt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function invocationStatus(result: ToolCallResult): ToolInvocationStatus {
  switch (result.status) {
    case "succeeded":
      return "succeeded";
    case "accepted":
      return "waiting_for_job";
    case "waiting_for_approval":
      return "waiting_for_approval";
    // The legacy driver never hosts dispatch tools; treat a (never-produced)
    // delegated result as an in-flight invocation for type completeness.
    case "delegated":
      return "running";
    case "failed":
      return "failed";
  }
}

function nextRunState(run: OrchestratorRun, result: ToolCallResult): OrchestratorRun {
  const updatedAt = nowIso();
  if (result.status === "accepted") {
    return {
      ...run,
      status: "waiting",
      waitingOn: { kind: "tool_job", id: result.jobId },
      updatedAt,
    };
  }
  if (result.status === "waiting_for_approval") {
    return {
      ...run,
      status: "waiting",
      waitingOn: { kind: "approval_gate", id: result.gateId },
      updatedAt,
    };
  }
  if (result.status === "failed") {
    if (result.error.recoverable) {
      return {
        ...run,
        status: "running",
        waitingOn: undefined,
        updatedAt,
      };
    }
    return {
      ...run,
      status: "failed",
      waitingOn: undefined,
      updatedAt,
    };
  }
  return {
    ...run,
    status: "running",
    waitingOn: undefined,
    updatedAt,
  };
}

export async function runToolTestTurn({
  run,
  workspaceId,
  actorId,
  agentId,
  messageId,
  requestId,
  metadata,
  inputSummary,
  priorResults = [],
  registry = createToolRegistry(),
  model = orchestratorModel,
  systemPrompt,
}: RunToolTestTurnInput): Promise<ToolLoopTurnResult> {
  if (run.status !== "running") {
    throw new Error(`Cannot start a model tool turn while run is ${run.status}.`);
  }

  const decision = await model({
    workspaceId,
    projectId: run.projectId,
    inputSummary,
    priorResults,
    registry,
    systemPrompt,
  });
  const turnId = randomUUID();
  const createdAt = nowIso();

  if (decision.type === "done") {
    const nextRun: OrchestratorRun = {
      ...run,
      status: "succeeded",
      currentTurnId: turnId,
      waitingOn: undefined,
      updatedAt: createdAt,
    };
    return {
      status: "completed_turn",
      run: nextRun,
      turn: {
        id: turnId,
        orchestratorRunId: run.id,
        inputSummary,
        model: decision.model,
        toolCalls: [],
        terminalReason: "done",
        createdAt,
      },
    };
  }

  const context = createToolExecutionContext({
    workspaceId,
    projectId: run.projectId,
    orchestratorRunId: run.id,
    actorId,
    agentId,
    messageId,
    requestId,
    metadata,
  });
  const result = await executeRegisteredTool({
    registry,
    toolName: decision.toolName,
    input: decision.input,
    context,
  });
  const invocationUpdatedAt = nowIso();
  const invocation: ToolInvocation = {
    id: randomUUID(),
    orchestratorRunId: run.id,
    turnId,
    toolName: decision.toolName,
    input: decision.input,
    status: invocationStatus(result),
    jobId: result.status === "accepted" ? result.jobId : undefined,
    gateId: result.status === "waiting_for_approval" ? result.gateId : undefined,
    result,
    error: result.status === "failed" ? result.error : undefined,
    createdAt,
    updatedAt: invocationUpdatedAt,
  };
  const nextRun = {
    ...nextRunState(run, result),
    currentTurnId: turnId,
  };
  return {
    status: "completed_turn",
    run: nextRun,
    result,
    turn: {
      id: turnId,
      orchestratorRunId: run.id,
      inputSummary,
      model: decision.model,
      toolCalls: [invocation],
      terminalReason:
        result.status === "accepted" || result.status === "waiting_for_approval"
          ? "waiting"
          : result.status === "failed"
            ? "error"
            : "tool_requested",
      createdAt,
    },
  };
}
