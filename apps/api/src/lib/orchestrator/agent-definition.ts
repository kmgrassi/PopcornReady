// Role-configured entry definitions for the one durable orchestrator loop.
//
// This module deliberately does not start work, enqueue a run, or persist a
// report. It selects the model-visible surface and fresh context for an already
// claimed run. PR 6 remains the sole domain-report finalization boundary.

import type { AgentDomain, AgentRole, DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";
import type { DomainReportV1 } from "@popcorn/shared/domain-agent-contract";
import { createHash } from "node:crypto";
import type { OrchestratorRun } from "@/lib/api/v1/orchestrator-store";
import { getDomainRun } from "@/lib/api/v1/domain-session-store";
import { createDefaultToolRegistry, type DefaultToolRegistryDeps } from "@/lib/orchestrator-tools/default-registry";
import { createAudioToolRegistry } from "@/lib/orchestrator-tools/audio-registry";
import { createVisualsToolRegistry } from "@/lib/orchestrator-tools/visuals-registry";
import { isDispatchToolName } from "@/lib/orchestrator-tools/capability-catalog";
import { toOrchestratorRegistry } from "@/lib/orchestrator-tools/to-orchestrator-registry";
import { loadDomainTurnProjection } from "@/lib/orchestrator-context/domain-projection";
import type { ToolRegistry } from "./registry";
import { ORCHESTRATOR_SYSTEM_PROMPT } from "./model";
import { VISUALS_SYSTEM_PROMPT } from "./visuals-profile";
import type { RunActionSummary } from "@/lib/api/v1/orchestrator-store";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";
import { AUDIO_AGENT_SYSTEM_PROMPT } from "./audio-agent";

export interface AgentDefinition {
  role: AgentRole;
  registry: ToolRegistry;
  systemPrompt: string;
  /** Kept separate from inputSummary so trusted and creator partitions survive intact. */
  loadTurnContext: () => Promise<unknown | undefined>;
  task?: DomainTaskV1;
}

export interface ResolveAgentDefinitionInput {
  run: OrchestratorRun;
  workspaceId: string;
  /** Test seams may supply the exact root registry without changing its behavior. */
  rootRegistry?: ToolRegistry;
  registryDeps?: DefaultToolRegistryDeps;
  /** Domain execution is fail-closed and role-aware. */
  enabledDomainRoles?: readonly AgentDomain[];
}

export function assertDomainRegistry(role: "visuals" | "audio", registry: ToolRegistry): ToolRegistry {
  for (const tool of registry.values()) {
    if (isDispatchToolName(tool.name) || tool.ownerRole !== role) {
      throw new Error(`${role} agent definition contains forbidden tool ${tool.name}.`);
    }
  }
  return registry;
}

function rootDefinition(input: ResolveAgentDefinitionInput): AgentDefinition {
  return {
    role: "creative_director",
    // Preserve the active root path byte-for-byte in behavior. PR 14 owns the
    // separate root delegation registry and must opt into it explicitly.
    registry: input.rootRegistry ?? toOrchestratorRegistry(createDefaultToolRegistry(input.registryDeps)),
    systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
    loadTurnContext: async () => undefined,
  };
}

/**
 * Resolve a definition from durable run data, never caller-provided role/task
 * hints. Domain work is deliberately unavailable when the explicit runtime
 * role allowlist is absent or does not include the durable run role.
 */
export async function resolveAgentDefinition(
  input: ResolveAgentDefinitionInput
): Promise<AgentDefinition> {
  const role = input.run.agentRole ?? "creative_director";
  if (role === "creative_director") return rootDefinition(input);
  if (!input.enabledDomainRoles?.includes(role)) {
    throw new Error("Domain agent runtime is disabled until its rollout safety gate is enabled.");
  }

  const domainRun = await getDomainRun(input.run.projectId, input.run.id);
  if (
    !domainRun ||
    domainRun.agentRole !== role ||
    !domainRun.agentSessionId ||
    !domainRun.taskParams ||
    domainRun.taskParams.domain !== role
  ) {
    throw new Error(`Run ${input.run.id} is not a valid ${role} domain assignment.`);
  }

  const task = domainRun.taskParams;
  const registry =
    role === "visuals"
      ? assertDomainRegistry(
          role,
          toOrchestratorRegistry(createVisualsToolRegistry(input.registryDeps, task))
        )
      : assertDomainRegistry(
          role,
          toOrchestratorRegistry(
            createAudioToolRegistry(input.registryDeps, { task })
          )
        );
  return {
    role,
    registry,
    systemPrompt: role === "visuals" ? VISUALS_SYSTEM_PROMPT : AUDIO_AGENT_SYSTEM_PROMPT,
    task,
    loadTurnContext: () =>
      loadDomainTurnProjection({
        workspaceId: input.workspaceId,
        projectId: input.run.projectId,
        task,
      }),
  };
}

export const AGENT_DEFINITION_PROMPTS = {
  creative_director: ORCHESTRATOR_SYSTEM_PROMPT,
  visuals: VISUALS_SYSTEM_PROMPT,
  audio: AUDIO_AGENT_SYSTEM_PROMPT,
} as const;

type CompletionObject = Record<string, unknown>;

function completionObject(value: unknown): CompletionObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Domain completion must be a JSON object.");
  }
  return value as CompletionObject;
}

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`Domain completion ${field} must be a non-empty string of at most ${max} characters.`);
  }
  return value.trim();
}

function actionOutputIds(actions: readonly RunActionSummary[]): string[] {
  return [...new Set(actions.flatMap((action) => action.status === "applied" ? action.outputAssetIds : []))];
}

interface OutputAssetRow {
  id: string;
  project_id: string;
  kind: string;
  role: string | null;
}

async function loadOutputAssetRows(
  projectId: string,
  candidateIds: readonly string[]
): Promise<OutputAssetRow[]> {
  return await runQuery(
    "agentDefinition.validatedOutputs",
    getServiceSupabase()
      .from("assets")
      .select("id, project_id, kind, role")
      .eq("project_id", projectId)
      .in("id", candidateIds)
  ) as OutputAssetRow[];
}

async function validatedOutputs(input: {
  projectId: string;
  task: DomainTaskV1;
  actions: readonly RunActionSummary[];
  requestedOutputIds?: readonly string[];
  loadOutputRows?: (
    projectId: string,
    candidateIds: readonly string[]
  ) => Promise<OutputAssetRow[]>;
}): Promise<Array<{ assetId: string; intrinsicRole: string; kind: string }>> {
  const actionIds = actionOutputIds(input.actions);
  const requestedIds = input.requestedOutputIds
    ? [...new Set(input.requestedOutputIds)]
    : undefined;
  const candidateIds = [...new Set([...(requestedIds ?? []), ...actionIds])];
  if (candidateIds.length === 0) {
    throw new Error("Domain done completion requires a primary output.");
  }
  const rows = await (input.loadOutputRows ?? loadOutputAssetRows)(
    input.projectId,
    candidateIds
  );
  if (
    rows.length !== candidateIds.length ||
    rows.some((row) => row.project_id !== input.projectId)
  ) {
    throw new Error("Domain completion referenced an output outside its project.");
  }
  const allowed = new Set<string>(input.task.allowedOutputKinds);
  const ids = requestedIds ?? actionIds.filter((id) => {
    const row = rows.find((candidate) => candidate.id === id);
    return Boolean(row && allowed.has(row.kind));
  });
  const created = new Set(actionIds);
  const fitTargetIds = new Set(
    input.task.domain === "audio" && input.task.taskKind === "audio_fit"
      ? [
          ...input.task.targets.flatMap((target) =>
            target.kind === "asset" ? [target.assetId] : []
          ),
          ...input.task.preserve.assetIds,
          ...input.task.preserve.selections.map((selection) => selection.activeAssetId),
          ...input.task.preserve.pins.flatMap((pin) =>
            pin.kind === "asset" ? [pin.id] : []
          ),
        ]
      : []
  );
  const outputs = ids.map((id) => {
    const row = rows.find((candidate) => candidate.id === id);
    if (!row || !allowed.has(row.kind)) {
      throw new Error(`Domain completion output ${id} is not an allowed task output.`);
    }
    if (!created.has(id) && !fitTargetIds.has(id)) {
      throw new Error(
        `Domain completion output ${id} was neither created by this run nor authorized as its fit target.`
      );
    }
    const required = input.task.requiredOutputs.find((candidate) => candidate.kind === row.kind);
    return { assetId: id, intrinsicRole: row.role ?? required?.role ?? row.kind, kind: row.kind };
  });
  for (const required of input.task.requiredOutputs) {
    if (outputs.filter((output) => output.kind === required.kind).length < required.minimumCount) {
      throw new Error(`Domain completion is missing required ${required.kind} outputs.`);
    }
  }
  return outputs;
}

function parseEvidence(input: {
  value: unknown;
  task: DomainTaskV1;
  outputIds: ReadonlySet<string>;
}) {
  if (!Array.isArray(input.value) || input.value.length !== input.task.acceptanceCriteria.length) {
    throw new Error("Domain done completion must include one acceptance evidence item per criterion.");
  }
  const seen = new Set<string>();
  return input.value.map((raw) => {
    const item = completionObject(raw);
    const criterion = boundedString(item.criterion, "acceptanceEvidence.criterion", 500);
    if (!input.task.acceptanceCriteria.includes(criterion) || seen.has(criterion)) {
      throw new Error("Domain completion evidence must use each trusted acceptance criterion exactly once.");
    }
    seen.add(criterion);
    if (typeof item.satisfied !== "boolean") throw new Error("Domain completion evidence satisfied must be boolean.");
    const assetIds = Array.isArray(item.assetIds)
      ? item.assetIds.map((id) => boundedString(id, "acceptanceEvidence.assetIds", 128))
      : [];
    if (assetIds.some((id) => !input.outputIds.has(id))) {
      throw new Error("Domain completion evidence may reference only this run's validated outputs.");
    }
    return {
      criterion,
      satisfied: item.satisfied,
      evidence: boundedString(item.evidence, "acceptanceEvidence.evidence", 1_000),
      ...(assetIds.length ? { assetIds } : {}),
    };
  });
}

function questionFingerprint(runId: string, question: string, options: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify({ runId, question, options }))
    .digest("hex");
}

function failedAudioFitRequiresQuestion(
  task: DomainTaskV1,
  actions: readonly RunActionSummary[]
): boolean {
  if (task.domain !== "audio" || task.taskKind !== "audio_fit") return false;
  return actions.some((action) => {
    if (action.tool !== "fit_audio_to_picture" || action.status !== "applied") {
      return false;
    }
    const result = action.params.result;
    return (
      typeof result === "object" &&
      result !== null &&
      (result as { verdict?: unknown }).verdict === "fail"
    );
  });
}

function audioFitQuestion(input: {
  runId: string;
  task: DomainTaskV1;
}): DomainReportV1 {
  const question =
    "The current picture is too short for the exact spoken words. Should the picture timing or the spoken meaning change?";
  const options = [
    {
      id: "revise_picture",
      label: "Revise picture timing",
      tradeoff: "Preserves the approved words but requires a visual/timing change.",
    },
    {
      id: "revise_words",
      label: "Revise spoken meaning",
      tradeoff: "Fits the current picture but requires creative-director approval for new words.",
    },
  ];
  return {
    schemaVersion: "DomainReport.v1",
    outcome: {
      outcome: "question",
      question,
      targets: input.task.targets.slice(0, 32),
      options,
      fingerprint: questionFingerprint(input.runId, question, options),
    },
  };
}

/** Strictly convert the domain model's terminal JSON into the immutable report. */
export async function buildDomainReportFromCompletion(
  input: {
    runId: string;
    projectId: string;
    task: DomainTaskV1;
    summary: string;
    actions: readonly RunActionSummary[];
    loadOutputRows?: (
      projectId: string,
      candidateIds: readonly string[]
    ) => Promise<OutputAssetRow[]>;
  },
  deps: {
    validatedOutputs?: typeof validatedOutputs;
  } = {}
): Promise<DomainReportV1> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.summary);
  } catch {
    throw new Error("Domain completion must be valid JSON.");
  }
  const completion = completionObject(parsed);
  const outcome = completion.outcome;
  if (outcome === "done") {
    if (failedAudioFitRequiresQuestion(input.task, input.actions)) {
      return audioFitQuestion(input);
    }
    const outputAssetIds =
      completion.outputAssetIds === undefined
        ? undefined
        : Array.isArray(completion.outputAssetIds)
          ? completion.outputAssetIds.map((id) =>
              boundedString(id, "outputAssetIds", 128)
            )
          : (() => {
              throw new Error("Domain completion outputAssetIds must be an array.");
            })();
    const outputs = await (deps.validatedOutputs ?? validatedOutputs)({
      ...input,
      requestedOutputIds: outputAssetIds,
    });
    return {
      schemaVersion: "DomainReport.v1",
      outcome: {
        outcome: "done",
        outputs: outputs.map(({ assetId, intrinsicRole }) => ({ assetId, intrinsicRole })),
        changedSelections: [],
        acceptanceEvidence: parseEvidence({
          value: completion.acceptanceEvidence,
          task: input.task,
          outputIds: new Set(outputs.map((output) => output.assetId)),
        }),
        sessionSummary: boundedString(completion.sessionSummary, "sessionSummary", 2_000),
      },
    };
  }
  if (outcome !== "question") throw new Error("Domain completion outcome must be done or question.");
  const optionsRaw = completion.options;
  if (!Array.isArray(optionsRaw) || optionsRaw.length < 2 || optionsRaw.length > 6) {
    throw new Error("Domain question must contain between two and six options.");
  }
  const ids = new Set<string>();
  const options = optionsRaw.map((raw) => {
    const option = completionObject(raw);
    const id = boundedString(option.id, "question.options.id", 80);
    if (!/^[A-Za-z0-9_-]+$/.test(id) || ids.has(id)) throw new Error("Domain question option ids must be unique stable tokens.");
    ids.add(id);
    return {
      id,
      label: boundedString(option.label, "question.options.label", 240),
      tradeoff: boundedString(option.tradeoff, "question.options.tradeoff", 600),
    };
  });
  const question = boundedString(completion.question, "question", 1_000);
  return {
    schemaVersion: "DomainReport.v1",
    outcome: {
      outcome: "question",
      question,
      targets: input.task.targets.slice(0, 32),
      options,
      fingerprint: questionFingerprint(input.runId, question, options),
    },
  };
}
