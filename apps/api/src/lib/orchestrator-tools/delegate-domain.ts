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
  AudioOutputKind,
  DomainTaskV1,
  OrchestratorRunId,
  VisualsOutputKind,
} from "@popcorn/shared/domain-agent-contract";
import type {
  RerunProposalV2,
  RerunWorkItem,
} from "@popcorn/shared/rerun-proposal";
import {
  dispatchDomainRunBatch,
  dispatchDomainRun,
  isDomainRunLimitError,
} from "@/lib/orchestrator/domain-run-service";
import { toolDefinitionMetadata } from "./capability-catalog";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";

const DELEGATION_DEFAULT_BUDGET_USD = 5;
const VISUAL_OUTPUT_KINDS = [
  "image", "poster", "anchor", "storyboard", "keyframe", "clip", "composite", "render",
] as const;
type VisualOutputKind = (typeof VISUAL_OUTPUT_KINDS)[number];

export interface DelegateDomainInput {
  objective: string;
  instruction?: string;
  /** Stable asset ids that must not change. */
  preserveAssetIds?: string[];
  constraints?: string;
  budgetUsd?: number;
  /** Required terminal outputs for a Visuals assignment; trusted by schema validation. */
  requiredOutputKinds?: VisualOutputKind[];
}

export interface DelegateDomainsInput {
  visuals: DelegateDomainInput;
  audio: DelegateDomainInput;
}

function parseDelegateDomainsInput(input: unknown): DelegateDomainsInput {
  if (typeof input !== "object" || input === null) {
    throw new ToolInputError("Parallel delegation input must be an object.");
  }
  const record = input as Record<string, unknown>;
  return {
    visuals: parseDelegateInput(record.visuals, "visuals"),
    audio: parseDelegateInput(record.audio, "audio"),
  };
}

function parseDelegateInput(input: unknown, domain: AgentDomain): DelegateDomainInput {
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
  const requiredOutputKinds = record.requiredOutputKinds;
  if (
    requiredOutputKinds !== undefined &&
    (!Array.isArray(requiredOutputKinds) ||
      requiredOutputKinds.length === 0 ||
      requiredOutputKinds.some(
        (kind) => typeof kind !== "string" || !VISUAL_OUTPUT_KINDS.includes(kind as VisualOutputKind)
      ) ||
      new Set(requiredOutputKinds).size !== requiredOutputKinds.length)
  ) {
    throw new ToolInputError("requiredOutputKinds must contain unique supported Visuals output kinds.");
  }
  if (domain === "audio" && requiredOutputKinds !== undefined) {
    throw new ToolInputError("Audio delegation does not accept requiredOutputKinds.");
  }
  if (domain === "visuals" && requiredOutputKinds === undefined) {
    throw new ToolInputError("Visuals delegation requires at least one requiredOutputKinds value.");
  }
  return {
    objective: record.objective.trim(),
    instruction:
      typeof record.instruction === "string" ? record.instruction : undefined,
    preserveAssetIds: (preserve as string[] | undefined) ?? [],
    constraints:
      typeof record.constraints === "string" ? record.constraints : undefined,
    budgetUsd: budget as number | undefined,
    ...(requiredOutputKinds ? { requiredOutputKinds: requiredOutputKinds as VisualOutputKind[] } : {}),
  };
}

const delegateInputProperties = {
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
} as const;

function delegateInputSchema(domain: AgentDomain) {
  return {
  type: "object",
  additionalProperties: false,
  properties: {
    ...delegateInputProperties,
    ...(domain === "visuals" ? { requiredOutputKinds: {
      type: "array",
      items: { enum: VISUAL_OUTPUT_KINDS },
      minItems: 1,
      uniqueItems: true,
      description: "For Visuals, the terminal output kinds required from this bounded assignment.",
    } } : {}),
  },
  required: domain === "visuals" ? ["objective", "requiredOutputKinds"] : ["objective"],
  } as const;
}

export function buildDelegatedTask(input: {
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
    const requiredOutputKinds = input.parsed.requiredOutputKinds;
    if (!requiredOutputKinds) throw new ToolInputError("Visuals delegation requires requiredOutputKinds.");
    return {
      ...base,
      domain: "visuals",
      taskKind: "visuals_production",
      requiredOutputs: requiredOutputKinds.map((kind) => ({
        kind,
        role: kind === "anchor" ? "visual_anchor" : kind,
        minimumCount: 1,
      })),
      allowedOutputKinds: [...VISUAL_OUTPUT_KINDS],
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

/**
 * Proposal execution never reparses model delegation prose. The coordinator
 * supplies the exact approved work item and its immutable scope.
 */
export function buildProposalDelegatedTask(input: {
  projectId: string;
  rootRunId: string;
  delegationActionId: string;
  creatorMessageId: string;
  proposalActionId: string;
  approvalActionId: string;
  executionReservationId: string;
  approvalFingerprint: string;
  proposal: Extract<RerunProposalV2, { outcome: "revision" }>;
  workItem: Extract<RerunWorkItem, { owner: "visuals" | "audio" }>;
}): DomainTaskV1 {
  if (
    input.proposal.projectId !== input.projectId ||
    (input.proposal.rootRunId !== null &&
      input.proposal.rootRunId !== input.rootRunId) ||
    input.workItem.targets.some((target) => target.projectId !== input.projectId) ||
    input.workItem.requiredOutputs.some((output) =>
      output.workItemId !== input.workItem.workItemId ||
      output.target.projectId !== input.projectId)
  ) {
    throw new ToolInputError("Proposal delegation membership is invalid.");
  }
  const budgetUsd = input.proposal.estimate.maxCostUsd;
  const common = {
    schemaVersion: "DomainTask.v1" as const,
    objective: input.proposal.userFacingSummary,
    instruction: input.proposal.userIntent,
    targets: input.workItem.targets,
    creativeConstraints: {},
    preserve: {
      assetIds: input.proposal.preservedAssetIds,
      selections: input.proposal.pins.selections.flatMap((pin) =>
        pin.expectedActiveAssetId
          ? [{
            slotRole: pin.slotRole,
            slotKey: `${pin.slotOwnerLineageId ?? "project"}:${pin.slotRole}`,
            activeAssetId: pin.expectedActiveAssetId,
            sequence: pin.expectedSeq,
          }]
          : []),
      fingerprints: input.proposal.pins.assets.map((pin) => ({
        assetId: pin.assetId,
        value: pin.inputsFingerprint ?? pin.contentHash ?? "unhashed",
      })),
      pins: [
        ...input.proposal.pins.assets.map((pin) => ({
          kind: "asset" as const,
          id: pin.assetId,
          fingerprint: pin.inputsFingerprint ?? pin.contentHash ?? undefined,
        })),
        ...input.proposal.pins.selections.map((pin) => ({
          kind: "selection" as const,
          id: `${pin.slotOwnerLineageId ?? "project"}:${pin.slotRole}:${pin.expectedSeq}`,
          fingerprint: pin.expectedActiveAssetId ?? undefined,
        })),
      ],
    },
    candidateAffectedAssetIds: input.proposal.candidateAffectedAssetIds,
    budgetUsd,
    approvalContext: {
      proposalActionId: input.proposalActionId as ActionId,
      approvalActionId: input.approvalActionId as ActionId,
      executionReservationId: input.executionReservationId,
      approvedBudgetUsd: budgetUsd,
      approvalFingerprint: input.approvalFingerprint,
    },
    acceptanceCriteria: input.proposal.checklist
      .filter((item) => item.decision === "change")
      .map((item) => item.reason),
    origin: {
      kind: "creative_director" as const,
      rootRunId: input.rootRunId as OrchestratorRunId,
      rootActionId: input.delegationActionId as ActionId,
      creatorMessageId: input.creatorMessageId,
    },
    responseRecipient: { kind: "creative_director" as const },
  };
  if (input.workItem.owner === "visuals") {
    const requiredOutputs = input.workItem.requiredOutputs.map((output) => {
      if (!VISUAL_OUTPUT_KINDS.includes(output.kind as VisualOutputKind)) {
        throw new ToolInputError(`Unsupported bound Visuals output ${output.kind}.`);
      }
      return {
        ...output,
        kind: output.kind as VisualsOutputKind,
        minimumCount: 1,
      };
    });
    return {
      ...common,
      domain: "visuals",
      taskKind: "visuals_revision",
      requiredOutputs,
      allowedOutputKinds: [...new Set(requiredOutputs.map((output) => output.kind))],
    };
  }
  const requiredOutputs = input.workItem.requiredOutputs.map((output) => {
    if (output.kind !== "audio_track" && output.kind !== "audio_fit") {
      throw new ToolInputError(`Unsupported bound Audio output ${output.kind}.`);
    }
    return {
      ...output,
      kind: output.kind as AudioOutputKind,
      minimumCount: 1,
    };
  });
  return {
    ...common,
    domain: "audio",
    taskKind: requiredOutputs.every((output) => output.kind === "audio_fit")
      ? "audio_fit"
      : "audio_revision",
    requiredOutputs,
    allowedOutputKinds: [...new Set(requiredOutputs.map((output) => output.kind))],
  };
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
    inputSchema: delegateInputSchema(input.domain) as unknown as Record<string, unknown>,
    outputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        childRunId: { type: "string" },
        sessionId: { type: "string" },
      },
    },
    parseInput: (raw) => parseDelegateInput(raw, input.domain),
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
      "Provide the objective, requiredOutputKinds, target beats/assets by stable id, constraints, and what to preserve. The specialist reports done, blocked, or a question. " +
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

/**
 * Root-only atomic fan-out. One reserved root action causally owns both
 * children, so their reports can deterministically fan back into one join.
 */
export function createDelegateDomainsTool(): ToolDefinition<DelegateDomainsInput> {
  return {
    ...toolDefinitionMetadata("delegate_domains"),
    description:
      "Atomically assign independent Visuals and Audio work. Use only when neither assignment depends on the other's output. The creative director resumes after both persisted reports arrive.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["visuals", "audio"],
      properties: {
        visuals: delegateInputSchema("visuals"),
        audio: delegateInputSchema("audio"),
      },
    },
    outputSchema: { type: "object", additionalProperties: true },
    parseInput: parseDelegateDomainsInput,
    async execute(parsed, context): Promise<ToolCallResult> {
      const projectId = context.projectId;
      const rootRunId = context.orchestratorRunId;
      const rootActionId = context.actionId;
      if (!projectId || !rootRunId || !rootActionId) {
        return delegationFailure(new ApiError("validation_failed", "Parallel delegation requires a reserved root action."));
      }
      try {
        const assignments = ([
          ["visuals", parsed.visuals],
          ["audio", parsed.audio],
        ] as const).map(([domain, assignment]) => {
          const budgetUsd = assignment.budgetUsd ?? DELEGATION_DEFAULT_BUDGET_USD;
          return {
            domain,
            inputSummary: assignment.objective,
            budgetUsd,
            task: buildDelegatedTask({
              domain,
              projectId,
              rootRunId,
              rootActionId,
              creatorMessageId: context.messageId ?? rootActionId,
              parsed: assignment,
              budgetUsd,
            }),
          };
        });
        const dispatches = await dispatchDomainRunBatch({
          projectId,
          parentRunId: rootRunId,
          rootActionId,
          assignments,
        });
        const childRuns = dispatches.map((dispatch) => ({ childRunId: dispatch.runId, sessionId: dispatch.sessionId }));
        return {
          status: "delegated",
          childRunId: childRuns[0]!.childRunId,
          sessionId: childRuns[0]!.sessionId,
          childRuns,
          resumesWhen: "domain_report",
        };
      } catch (err) {
        return delegationFailure(err);
      }
    },
  };
}
