import type { AuthContext } from "@/lib/api/v1/auth";
import type { DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";
import type { ProjectGraphSnapshot } from "@/lib/orchestrator-context/graph-snapshot";
import type { DomainTargetScope } from "@/lib/orchestrator-context/target-scope";
import type {
  ToolCapabilityId,
  ToolCostClass,
  ToolGateMetadata,
  ToolName,
} from "./capability-catalog";

export type { ToolName } from "./capability-catalog";

export type ToolInvocationStatus =
  | "requested"
  | "running"
  | "waiting_for_job"
  | "waiting_for_approval"
  | "succeeded"
  | "failed"
  | "cancelled";

export type ToolErrorKind =
  | "precondition_unmet"
  | "invalid_input"
  | "provider_quota"
  | "provider_failed"
  | "budget_exceeded"
  | "approval_rejected"
  | "policy_violation"
  | "timeout"
  | "storage_error";

export interface SuggestedToolCall {
  tool: ToolName;
  inputHint: Record<string, unknown>;
}

export interface PreconditionMiss {
  requirement: string;
  because: string;
  satisfyWith: SuggestedToolCall;
}

export interface ToolError {
  kind: ToolErrorKind;
  message: string;
  recoverable: boolean;
  retryAfterSec?: number;
  unmetRequirements?: PreconditionMiss[];
  suggestedNextTools?: SuggestedToolCall[];
  details?: Record<string, unknown>;
}

export type ToolCallResult<TOutput = unknown> =
  | {
      status: "succeeded";
      resourceIds: string[];
      artifactIds?: string[];
      costUsd?: number;
      output?: TOutput;
    }
  | {
      status: "accepted";
      jobId: string;
      resumesWhen: "job_terminal";
      estimatedCostUsd?: number;
    }
  | {
      status: "waiting_for_approval";
      gateId: string;
      resumesWhen: "approval_terminal";
      previewArtifactIds: string[];
    }
  | {
      /**
       * A root-only delegate_* tool durably enqueued a finite domain run in a
       * persistent session. The calling run parks in the domain wait (distinct
       * from media-job and approval waits) until the child's terminal
       * domain_report finalization wakes its dispatch.
       */
      status: "delegated";
      childRunId: string;
      sessionId: string;
      resumesWhen: "domain_report";
    }
  | {
      status: "failed";
      error: ToolError;
    };

export type JsonSchema = Record<string, unknown>;

export interface ToolExecutionContext {
  auth: AuthContext;
  projectId?: string;
  generationRunId?: string;
  toolCallId?: string;
  /** Canonical action reserved by the durable engine, if this is an engine call. */
  actionId?: string;
  agentId?: string;
  messageId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
  /** The orchestrator run driving this call — async tools' workers use it to
   * resume the run when their job completes. */
  orchestratorRunId?: string;
  sessionClaimGeneration?: number;
  domainTask?: DomainTaskV1;
  domainScope?: DomainTargetScope;
  domainSnapshot?: ProjectGraphSnapshot;
}

export interface ToolCostEstimate {
  estimatedCostUsd?: number;
  unit?: string;
  notes?: string;
}

/**
 * Optional, model-facing usage guidance for a tool. These short declarative
 * strings are composed onto the tool's `description` (see composeToolDescription)
 * so the orchestrator model can pick the right tool proactively — knowing what a
 * tool needs, what it produces, and when to reach for it — instead of probing the
 * pipeline by trial and error and only learning from failures.
 */
export interface ToolUsage {
  /** What must already exist or be true before this tool can succeed. */
  preconditions?: string[];
  /** What the tool persists or produces on success. */
  produces?: string[];
  /** 1–2 "use this when…" situations that disambiguate it from sibling tools. */
  useWhen?: string[];
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: ToolName;
  capability: ToolCapabilityId;
  ownerRole: import("@popcorn/shared/domain-agent-contract").AgentRole;
  label: string;
  displayOrder: number;
  costClass: ToolCostClass;
  gate: ToolGateMetadata;
  description: string;
  /** Optional structured usage guidance, composed onto `description` for the model. */
  usage?: ToolUsage;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  execution: "sync" | "async" | "approval";
  parseInput(input: unknown): TInput;
  estimateCost?(
    input: TInput,
    context: ToolExecutionContext
  ): ToolCostEstimate | Promise<ToolCostEstimate>;
  execute(
    input: TInput,
    context: ToolExecutionContext
  ): ToolCallResult<TOutput> | Promise<ToolCallResult<TOutput>>;
}

export class ToolInputError extends Error {
  readonly toolError: ToolError;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ToolInputError";
    this.toolError = {
      kind: "invalid_input",
      message,
      recoverable: true,
      details,
    };
  }
}
