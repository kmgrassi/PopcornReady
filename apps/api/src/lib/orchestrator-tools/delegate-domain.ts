// Specialist-agent orchestration PR 6 — root-only delegate_visuals /
// delegate_audio adapters over the ONE internal domain-run service.
//
// These definitions are registered ONLY by createRootToolRegistry (the dormant
// creative-director registry). They never join the flat production default
// registry, the driver stubs, or any domain registry — nothing user-visible
// changes in production. The adapter derives every trusted field server-side
// (origin, task kind, recipients, allowed output kinds); the model supplies
// only bounded creative intent.

import { ApiError } from "@/core/errors";
import type {
  ActionId,
  AgentDomain,
  DomainTaskV1,
  OrchestratorRunId,
} from "@popcorn/shared/domain-agent-contract";
import {
  dispatchDomainRun,
  isDomainRunLimitError,
} from "@/lib/orchestrator/domain-run-service";
import { toolDefinitionMetadata } from "./capability-catalog";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";

const DELEGATION_DEFAULT_BUDGET_USD = 5;

export interface DelegateDomainInput {
  objective: string;
  instruction?: string;
  /** Stable asset ids that must not change. */
  preserveAssetIds?: string[];
  constraints?: string;
  budgetUsd?: number;
}

function parseDelegateInput(input: unknown): DelegateDomainInput {
  if (typeof input !== "object" || input === null) {
    throw new ToolInputError("Delegation input must be an object.");
  }
  const record = input as Record<string, unknown>;
  if (typeof record.objective !== "string" || record.objective.trim().length === 0) {
    throw new ToolInputError("Delegation requires a non-empty objective.");
  }
  const preserve = record.preserveAssetIds;
  if (
    preserve !== undefined &&
    (!Array.isArray(preserve) || preserve.some((id) => typeof id !== "string"))
  ) {
    throw new ToolInputError("preserveAssetIds must be an array of asset ids.");
  }
  const budget = record.budgetUsd;
  if (budget !== undefined && (typeof budget !== "number" || !(budget > 0))) {
    throw new ToolInputError("budgetUsd must be a positive number.");
  }
  return {
    objective: record.objective.trim(),
    instruction:
      typeof record.instruction === "string" ? record.instruction : undefined,
    preserveAssetIds: (preserve as string[] | undefined) ?? [],
    constraints:
      typeof record.constraints === "string" ? record.constraints : undefined,
    budgetUsd: budget as number | undefined,
  };
}

const delegateInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    objective: {
      type: "string",
      description: "What outcome the specialist assignment must produce.",
    },
    instruction: {
      type: "string",
      description: "Creator intent rewritten for the bounded assignment.",
    },
    preserveAssetIds: {
      type: "array",
      items: { type: "string" },
      description: "Assets that must not change.",
    },
    constraints: {
      type: "string",
      description: "Creative constraints (tone, look, continuity, mood, pacing).",
    },
    budgetUsd: {
      type: "number",
      description: "Maximum allocation for this assignment.",
    },
  },
  required: ["objective"],
} as const;

function buildDelegatedTask(input: {
  domain: AgentDomain;
  projectId: string;
  rootRunId: string;
  rootActionId: string;
  creatorMessageId: string;
  parsed: DelegateDomainInput;
  budgetUsd: number;
}): DomainTaskV1 {
  const base = {
    schemaVersion: "DomainTask.v1" as const,
    objective: input.parsed.objective,
    instruction: input.parsed.instruction ?? input.parsed.objective,
    targets: [{ kind: "project" as const, projectId: input.projectId }],
    creativeConstraints: input.parsed.constraints
      ? { notes: [input.parsed.constraints] }
      : {},
    preserve: {
      assetIds: input.parsed.preserveAssetIds ?? [],
      selections: [],
      fingerprints: [],
      pins: [],
    },
    candidateAffectedAssetIds: [],
    budgetUsd: input.budgetUsd,
    acceptanceCriteria: [input.parsed.objective],
    origin: {
      kind: "creative_director" as const,
      rootRunId: input.rootRunId as OrchestratorRunId,
      rootActionId: input.rootActionId as ActionId,
      creatorMessageId: input.creatorMessageId,
    },
    responseRecipient: { kind: "creative_director" as const },
  };
  if (input.domain === "visuals") {
    return {
      ...base,
      domain: "visuals",
      taskKind: "visuals_production",
      requiredOutputs: [{ kind: "clip", role: "primary", minimumCount: 1 }],
      allowedOutputKinds: ["image", "anchor", "keyframe", "clip", "composite", "render"],
    } as DomainTaskV1;
  }
  return {
    ...base,
    domain: "audio",
    taskKind: "audio_production",
    requiredOutputs: [{ kind: "audio_track", role: "primary", minimumCount: 1 }],
    allowedOutputKinds: ["audio_track"],
  } as DomainTaskV1;
}

function delegationFailure(err: unknown): ToolCallResult {
  if (err instanceof ApiError) {
    if (isDomainRunLimitError(err) || err.code === "validation_failed") {
      return {
        status: "failed",
        error: {
          kind: "policy_violation",
          message: err.message,
          recoverable: false,
          details: { code: err.code },
        },
      };
    }
    if (err.code === "idempotency_conflict") {
      return {
        status: "failed",
        error: {
          kind: "invalid_input",
          message: err.message,
          recoverable: false,
          details: { code: err.code },
        },
      };
    }
  }
  return {
    status: "failed",
    error: {
      kind: "provider_failed",
      message: err instanceof Error ? err.message : String(err),
      recoverable: false,
    },
  };
}

function createDelegateTool(input: {
  name: "delegate_visuals" | "delegate_audio";
  domain: AgentDomain;
  description: string;
}): ToolDefinition<DelegateDomainInput> {
  return {
    ...toolDefinitionMetadata(input.name),
    description: input.description,
    inputSchema: delegateInputSchema as unknown as Record<string, unknown>,
    outputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        childRunId: { type: "string" },
        sessionId: { type: "string" },
      },
    },
    parseInput: parseDelegateInput,
    async execute(parsed, context): Promise<ToolCallResult> {
      const projectId = context.projectId;
      const rootRunId = context.orchestratorRunId;
      const rootActionId = context.actionId;
      if (!projectId || !rootRunId || !rootActionId) {
        return {
          status: "failed",
          error: {
            kind: "policy_violation",
            message:
              "Delegation requires a root orchestrator run with a durably reserved delegation action.",
            recoverable: false,
          },
        };
      }
      const budgetUsd = parsed.budgetUsd ?? DELEGATION_DEFAULT_BUDGET_USD;
      const task = buildDelegatedTask({
        domain: input.domain,
        projectId,
        rootRunId,
        rootActionId,
        creatorMessageId: context.messageId ?? rootActionId,
        parsed,
        budgetUsd,
      });
      try {
        const dispatch = await dispatchDomainRun({
          projectId,
          domain: input.domain,
          task,
          inputSummary: parsed.objective,
          budgetUsd,
          origin: {
            kind: "creative_director",
            parentRunId: rootRunId,
            rootActionId,
          },
          // The engine reserves exactly one action per invocation, so the
          // delegation action id is the natural idempotency key: a crash
          // retry of this invocation replays the same finite child run.
          idempotencyKey: `root-action:${rootActionId}`,
        });
        return {
          status: "delegated",
          childRunId: dispatch.runId,
          sessionId: dispatch.sessionId,
          resumesWhen: "domain_report",
        };
      } catch (err) {
        return delegationFailure(err);
      }
    },
  };
}

export function createDelegateVisualsTool(): ToolDefinition<DelegateDomainInput> {
  return createDelegateTool({
    name: "delegate_visuals",
    domain: "visuals",
    description:
      "Assign a bounded visual-production task to the Visuals specialist (anchors, storyboard tiles, keyframes, clips, image/video revisions). " +
      "Provide the objective, target beats/assets by stable id, constraints, and what to preserve. The specialist reports done, blocked, or a question. " +
      "Use this instead of generating visual media yourself; you retain story, coherence, timeline, approval, and export decisions.",
  });
}

export function createDelegateAudioTool(): ToolDefinition<DelegateDomainInput> {
  return createDelegateTool({
    name: "delegate_audio",
    domain: "audio",
    description:
      "Assign a bounded audio-production task to the Audio specialist (voice, dialogue, music, sound, fitting audio to picture). " +
      "Provide the objective, target beats/assets by stable id, constraints, and what to preserve. The specialist reports done, blocked, or a question. " +
      "Use this instead of generating audio yourself; you retain story, coherence, timeline, approval, and export decisions.",
  });
}
