import type { DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";
import type { RunActionSummary } from "@/lib/api/v1/orchestrator-store";
import { withLlmCostRecording } from "@/lib/api/v1/llm-costs";
import {
  DomainCompletionValidationError,
  loadDomainCompletionOutputInventory,
} from "./agent-definition";
import {
  buildDomainCompletionContract,
  DOMAIN_COMPLETION_JSON_SCHEMA,
  DOMAIN_COMPLETION_REPAIR_SYSTEM_PROMPT,
} from "./domain-completion-contract";
import { llmClientForWorkspace } from "./model";

export interface RepairDomainCompletionInput {
  workspaceId: string;
  projectId: string;
  runId: string;
  task: DomainTaskV1;
  actions: readonly RunActionSummary[];
  previousCompletion: string;
  validationError: DomainCompletionValidationError;
}

export type DomainCompletionRepairer = (
  input: RepairDomainCompletionInput
) => Promise<string>;

interface RepairDeps {
  loadOutputInventory?: typeof loadDomainCompletionOutputInventory;
  structuredCall?: (input: {
    workspaceId: string;
    projectId: string;
    runId: string;
    user: string;
  }) => Promise<Record<string, unknown>>;
}

async function defaultStructuredCall(input: {
  workspaceId: string;
  projectId: string;
  runId: string;
  user: string;
}): Promise<Record<string, unknown>> {
  const client = await llmClientForWorkspace(input.workspaceId);
  return withLlmCostRecording(
    { projectId: input.projectId, runId: input.runId },
    () => client.structured<Record<string, unknown>>({
      cachedSystem: DOMAIN_COMPLETION_REPAIR_SYSTEM_PROMPT,
      user: input.user,
      schema: DOMAIN_COMPLETION_JSON_SCHEMA,
      maxTokens: 2_000,
      effort: "low",
    })
  );
}

export function createDomainCompletionRepairer(
  deps: RepairDeps = {}
): DomainCompletionRepairer {
  return async (input) => {
    const eligibleOutputs = await (
      deps.loadOutputInventory ?? loadDomainCompletionOutputInventory
    )({
      projectId: input.projectId,
      task: input.task,
      actions: input.actions,
      requireComplete: false,
    });
    const contract = buildDomainCompletionContract({
      task: input.task,
      eligibleOutputs,
      validationError: {
        code: input.validationError.code,
        message: input.validationError.message,
      },
      previousCompletion: input.previousCompletion,
    });
    const repaired = await (deps.structuredCall ?? defaultStructuredCall)({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      runId: input.runId,
      user: JSON.stringify({ terminalCompletionContract: contract }),
    });
    return JSON.stringify(repaired);
  };
}

export const repairDomainCompletion = createDomainCompletionRepairer();
