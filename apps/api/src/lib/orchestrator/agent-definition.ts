// Role-configured entry definitions for the one durable orchestrator loop.
//
// This module deliberately does not start work, enqueue a run, or persist a
// report. It selects the model-visible surface and fresh context for an already
// claimed run. PR 6 remains the sole domain-report finalization boundary.

import {
  domainOutputAssetKind,
  type AgentDomain,
  type AgentRole,
  type DomainOutputKind,
  type DomainTaskV1,
} from "@popcorn/shared/domain-agent-contract";
import type { DomainReportV1 } from "@popcorn/shared/domain-agent-contract";
import { createHash } from "node:crypto";
import {
  assertCreativeDirectorHierarchyRoot,
  type OrchestratorRun,
} from "@/lib/api/v1/orchestrator-store";
import { getDomainRun, getRootRunFamily, type RootRunFamily } from "@/lib/api/v1/domain-session-store";
import type { ToolRegistryDeps } from "@/lib/orchestrator-tools/registry-deps";
import { createRootToolRegistry } from "@/lib/orchestrator-tools/root-registry";
import { createAudioToolRegistry } from "@/lib/orchestrator-tools/audio-registry";
import { createVisualsToolRegistry } from "@/lib/orchestrator-tools/visuals-registry";
import { isDispatchToolName } from "@/lib/orchestrator-tools/capability-catalog";
import { toOrchestratorRegistry } from "@/lib/orchestrator-tools/to-orchestrator-registry";
import { loadDomainTurnProjection } from "@/lib/orchestrator-context/domain-projection";
import type { ToolRegistry } from "./registry";
import { VISUALS_SYSTEM_PROMPT } from "./visuals-profile";
import type { RunActionSummary } from "@/lib/api/v1/orchestrator-store";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";
import { AUDIO_AGENT_SYSTEM_PROMPT } from "./audio-agent";
import {
  CREATIVE_DIRECTOR_SYSTEM_PROMPT,
  SCRIPT_CREATION_SYSTEM_PROMPT,
} from "./creative-director-agent";
import { loadRootGraphProjection } from "@/lib/orchestrator-context/root-projection";

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
  registryDeps?: ToolRegistryDeps;
  /** Domain execution is fail-closed and role-aware. */
  enabledDomainRoles?: readonly AgentDomain[];
  /** Root-only test seam; production reads the durable root/child linkage. */
  loadRootRunFamily?: (rootRunId: string) => Promise<RootRunFamily>;
}

export function compactRootDomainReports(input: {
  rootRunId: string;
  family: RootRunFamily;
}) {
  return input.family.children.flatMap((child) => {
    if (
      child.originKind !== "creative_director" ||
      child.parentRunId !== input.rootRunId ||
      !child.report ||
      !child.reportActionId
    ) {
      return [];
    }
    return [{
      runId: child.id,
      sessionId: child.agentSessionId,
      domain: child.agentRole,
      taskKind: child.taskKind,
      reportActionId: child.reportActionId,
      outcome: child.report.outcome,
    }];
  });
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
  assertCreativeDirectorHierarchyRoot(input.run, "resolve a production agent");
  const scriptOnly = input.run.creationScope === "script";
  const rootRegistry =
    input.rootRegistry ??
    toOrchestratorRegistry(createRootToolRegistry(input.registryDeps));
  const registry = scriptOnly
    ? new Map(
        [...rootRegistry].filter(([name]) =>
          ["create_or_load_brief", "develop_story_blueprint", "draft_script"].includes(name),
        ),
      )
    : rootRegistry;
  return {
    role: "creative_director",
    registry,
    systemPrompt: scriptOnly
      ? SCRIPT_CREATION_SYSTEM_PROMPT
      : CREATIVE_DIRECTOR_SYSTEM_PROMPT,
    loadTurnContext: async () => {
      const [graph, family] = await Promise.all([
        loadRootGraphProjection({
          workspaceId: input.workspaceId,
          projectId: input.run.projectId,
        }),
        (input.loadRootRunFamily ?? getRootRunFamily)(input.run.id),
      ]);
      return {
        ...graph,
        runtime: {
          rootRunId: input.run.id,
          status: input.run.status,
          spentUsd: input.run.spentUsd,
          budgetUsd: input.run.budgetUsd ?? null,
          domainReports: compactRootDomainReports({ rootRunId: input.run.id, family }),
        },
      };
    },
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
          toOrchestratorRegistry(createAudioToolRegistry(input.registryDeps, { task }))
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
  creative_director: CREATIVE_DIRECTOR_SYSTEM_PROMPT,
  visuals: VISUALS_SYSTEM_PROMPT,
  audio: AUDIO_AGENT_SYSTEM_PROMPT,
} as const;

type CompletionObject = Record<string, unknown>;

export type DomainCompletionValidationCode =
  | "invalid_json"
  | "invalid_shape"
  | "invalid_output_claims"
  | "invalid_evidence"
  | "invalid_question"
  | "missing_run_outputs"
  | "invalid_output_state";

export class DomainCompletionValidationError extends Error {
  constructor(
    readonly code: DomainCompletionValidationCode,
    message: string,
    readonly repairable: boolean
  ) {
    super(message);
    this.name = "DomainCompletionValidationError";
  }
}

function completionValidationError(
  code: DomainCompletionValidationCode,
  message: string,
  repairable = true
): DomainCompletionValidationError {
  return new DomainCompletionValidationError(code, message, repairable);
}

function completionObject(value: unknown): CompletionObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw completionValidationError("invalid_shape", "Domain completion must be a JSON object.");
  }
  return value as CompletionObject;
}

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw completionValidationError(
      "invalid_shape",
      `Domain completion ${field} must be a non-empty string of at most ${max} characters.`
    );
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
  status: string;
}

export interface DomainCompletionOutputInventoryItem {
  assetId: string;
  kind: string;
  intrinsicRole: string;
}

function semanticOutputKind(
  output: DomainCompletionOutputInventoryItem
): DomainOutputKind | undefined {
  if (output.kind === "composite" || output.kind === "render") return output.kind;
  if (output.kind === "critique") {
    return output.intrinsicRole === "audio_fit" ? "audio_fit" : undefined;
  }
  if (output.kind === "video") {
    return ["beat_clip", "standalone_video", "upload", "primary_footage"].includes(
      output.intrinsicRole
    )
      ? "clip"
      : undefined;
  }
  if (output.kind === "audio") {
    return ["audio_track", "soundtrack", "voiceover", "dialogue", "sound_effect"].includes(
      output.intrinsicRole
    )
      ? "audio_track"
      : undefined;
  }
  if (output.kind !== "image") return undefined;
  if (["standalone_image", "image", "upload"].includes(output.intrinsicRole)) return "image";
  if (output.intrinsicRole === "poster") return "poster";
  if (["visual_anchor", "character_anchor", "scene_anchor"].includes(output.intrinsicRole)) {
    return "anchor";
  }
  if (["storyboard", "beat_storyboard", "scene_storyboard"].includes(output.intrinsicRole)) {
    return "storyboard";
  }
  if (["keyframe", "beat_keyframe"].includes(output.intrinsicRole)) return "keyframe";
  return undefined;
}

function outputMatchesRequirement(
  output: DomainCompletionOutputInventoryItem,
  required: DomainTaskV1["requiredOutputs"][number]
): boolean {
  return semanticOutputKind(output) === required.kind;
}

export function assertDomainCompletionOutputInventoryAllowed(input: {
  task: DomainTaskV1;
  inventory: readonly DomainCompletionOutputInventoryItem[];
}): void {
  const allowedSemanticKinds = new Set<DomainOutputKind>(input.task.allowedOutputKinds);
  if (input.inventory.some((output) => {
    const semanticKind = semanticOutputKind(output);
    return semanticKind === undefined || !allowedSemanticKinds.has(semanticKind);
  })) {
    throw completionValidationError(
      "invalid_output_state",
      "Domain completion output assets do not match the task's allowed semantic output kinds.",
      false
    );
  }
}

export function assertDomainCompletionOutputCoverage(input: {
  task: DomainTaskV1;
  inventory: readonly DomainCompletionOutputInventoryItem[];
}): void {
  const slots = input.task.requiredOutputs.flatMap((required) =>
    Array.from({ length: required.minimumCount }, () => required)
  );
  const candidatesBySlot = slots.map((required) =>
    input.inventory.flatMap((output, index) =>
      outputMatchesRequirement(output, required) ? [index] : []
    )
  );
  const slotOrder = slots
    .map((_, index) => index)
    .sort((left, right) => candidatesBySlot[left].length - candidatesBySlot[right].length);
  const assetAssignments = new Map<number, number>();

  const assign = (slotIndex: number, visitedAssets: Set<number>): boolean => {
    for (const assetIndex of candidatesBySlot[slotIndex]) {
      if (visitedAssets.has(assetIndex)) continue;
      visitedAssets.add(assetIndex);
      const priorSlot = assetAssignments.get(assetIndex);
      if (priorSlot === undefined || assign(priorSlot, visitedAssets)) {
        assetAssignments.set(assetIndex, slotIndex);
        return true;
      }
    }
    return false;
  };

  if (slotOrder.some((slotIndex) => !assign(slotIndex, new Set()))) {
    throw completionValidationError(
      "invalid_output_state",
      "Domain completion requires distinct role-compatible assets for every required output.",
      false
    );
  }
}

export function validateDomainCompletionOutputInventory(input: {
  projectId: string;
  task: DomainTaskV1;
  ids: readonly string[];
  rows: readonly OutputAssetRow[];
  requireComplete: boolean;
}): DomainCompletionOutputInventoryItem[] {
  if (
    input.rows.length !== input.ids.length ||
    input.rows.some((row) => row.project_id !== input.projectId)
  ) {
    throw completionValidationError(
      "invalid_output_state",
      "Domain completion referenced an output outside its project.",
      false
    );
  }
  if (input.rows.some((row) => row.status !== "ready")) {
    throw completionValidationError(
      "invalid_output_state",
      "Domain completion referenced an output that is not ready.",
      false
    );
  }
  const allowedGraphKinds = new Set<string>(
    input.task.allowedOutputKinds.map(domainOutputAssetKind)
  );
  if (input.rows.some((row) => !allowedGraphKinds.has(row.kind))) {
    throw completionValidationError(
      "invalid_output_state",
      "Domain completion output assets do not match the task's allowed output kinds.",
      false
    );
  }
  const inventory = input.ids.map((id) => {
    const row = input.rows.find((candidate) => candidate.id === id)!;
    return {
      assetId: row.id,
      kind: row.kind,
      intrinsicRole: row.role ?? row.kind,
    };
  });
  assertDomainCompletionOutputInventoryAllowed({ task: input.task, inventory });
  if (input.requireComplete) {
    assertDomainCompletionOutputCoverage({ task: input.task, inventory });
  }
  return inventory;
}

export async function loadDomainCompletionOutputInventory(input: {
  projectId: string;
  task: DomainTaskV1;
  actions: readonly RunActionSummary[];
  requireComplete?: boolean;
}): Promise<DomainCompletionOutputInventoryItem[]> {
  const ids = actionOutputIds(input.actions);
  if (ids.length === 0) {
    if (input.requireComplete === false) return [];
    throw completionValidationError(
      "missing_run_outputs",
      "Domain done completion requires outputs created by this run.",
      false
    );
  }
  const rows = await runQuery(
    "agentDefinition.validatedOutputs",
    getServiceSupabase()
      .from("assets")
      .select("id, project_id, kind, role, status")
      .eq("project_id", input.projectId)
      .in("id", ids)
  ) as OutputAssetRow[];
  return validateDomainCompletionOutputInventory({
    projectId: input.projectId,
    task: input.task,
    ids,
    rows,
    requireComplete: input.requireComplete !== false,
  });
}

type ValidatedDomainCompletionOutput = {
  assetId: string;
  intrinsicRole: string;
  kind: string;
  bindingId?: string;
  workItemId?: string;
  target?: import("@popcorn/shared/domain-agent-contract").DomainTaskTarget;
  role?: string;
  ordinal?: number;
};

export function validateDomainCompletionBoundOutputClaims(input: {
  task: DomainTaskV1;
  inventory: readonly DomainCompletionOutputInventoryItem[];
  claimedOutputs?: unknown;
}): ValidatedDomainCompletionOutput[] | undefined {
  const bound = input.task.requiredOutputs.filter(
    (required): required is Extract<typeof required, { bindingId: string }> =>
      "bindingId" in required
  );
  if (bound.length === 0) return undefined;
  if (
    bound.length !== input.task.requiredOutputs.length ||
    !Array.isArray(input.claimedOutputs) ||
    input.claimedOutputs.length !== bound.length
  ) {
    throw completionValidationError(
      bound.length !== input.task.requiredOutputs.length
        ? "invalid_output_state"
        : "invalid_output_claims",
      "Bound domain completion must claim every required binding exactly once.",
      bound.length === input.task.requiredOutputs.length
    );
  }
  const seen = new Set<string>();
  const outputs = input.claimedOutputs.map((raw) => {
    const claim = completionObject(raw);
    const bindingId = boundedString(claim.bindingId, "outputs.bindingId", 128);
    const assetId = boundedString(claim.assetId, "outputs.assetId", 128);
    if (seen.has(bindingId)) {
      throw completionValidationError(
        "invalid_output_claims",
        "Domain completion repeated an output binding."
      );
    }
    seen.add(bindingId);
    const required = bound.find((candidate) => candidate.bindingId === bindingId);
    if (!required) {
      throw completionValidationError(
        "invalid_output_claims",
        "Domain completion claimed a binding outside its task."
      );
    }
    const row = input.inventory.find((candidate) => candidate.assetId === assetId);
    const expectedAssetKind = domainOutputAssetKind(required.kind);
    if (!row || row.kind !== expectedAssetKind || !outputMatchesRequirement(row, required)) {
      throw completionValidationError(
        "invalid_output_claims",
        `Domain completion output ${assetId} does not satisfy binding ${bindingId}.`
      );
    }
    return {
      assetId,
      intrinsicRole: row.intrinsicRole,
      bindingId: required.bindingId,
      workItemId: required.workItemId,
      target: required.target,
      kind: required.kind,
      role: required.role,
      ordinal: required.ordinal,
    };
  });
  const inventoryIds = input.inventory.map((output) => output.assetId);
  if (
    new Set(outputs.map((output) => output.assetId)).size !== outputs.length ||
    outputs.length !== inventoryIds.length ||
    outputs.some((output) => !inventoryIds.includes(output.assetId))
  ) {
    throw completionValidationError(
      "invalid_output_claims",
      "Bound completion must claim exactly this run's output assets."
    );
  }
  return outputs;
}

async function validatedOutputs(input: {
  projectId: string;
  task: DomainTaskV1;
  actions: readonly RunActionSummary[];
  claimedOutputs?: unknown;
}): Promise<ValidatedDomainCompletionOutput[]> {
  const inventory = await loadDomainCompletionOutputInventory(input);
  return validateDomainCompletionBoundOutputClaims({
    task: input.task,
    inventory,
    claimedOutputs: input.claimedOutputs,
  }) ?? inventory;
}

function parseEvidence(input: {
  value: unknown;
  task: DomainTaskV1;
  outputIds: ReadonlySet<string>;
}) {
  if (!Array.isArray(input.value) || input.value.length !== input.task.acceptanceCriteria.length) {
    throw completionValidationError(
      "invalid_evidence",
      "Domain done completion must include one acceptance evidence item per criterion."
    );
  }
  const seen = new Set<string>();
  return input.value.map((raw) => {
    const item = completionObject(raw);
    const criterion = boundedString(item.criterion, "acceptanceEvidence.criterion", 500);
    if (!input.task.acceptanceCriteria.includes(criterion) || seen.has(criterion)) {
      throw completionValidationError(
        "invalid_evidence",
        "Domain completion evidence must use each trusted acceptance criterion exactly once."
      );
    }
    seen.add(criterion);
    if (typeof item.satisfied !== "boolean") {
      throw completionValidationError(
        "invalid_evidence",
        "Domain completion evidence satisfied must be boolean."
      );
    }
    if (!item.satisfied) {
      throw completionValidationError(
        "invalid_evidence",
        "Domain done completion requires every acceptance criterion to be satisfied."
      );
    }
    const assetIds = Array.isArray(item.assetIds)
      ? item.assetIds.map((id) => boundedString(id, "acceptanceEvidence.assetIds", 128))
      : [];
    if (assetIds.some((id) => !input.outputIds.has(id))) {
      throw completionValidationError(
        "invalid_evidence",
        "Domain completion evidence may reference only this run's validated outputs."
      );
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

/** Strictly convert the domain model's terminal JSON into the immutable report. */
function parseDomainCompletion(summary: string): unknown {
  const trimmed = summary.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  const payload = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(payload);
  } catch {
    throw completionValidationError("invalid_json", "Domain completion must be valid JSON.");
  }
}

export async function buildDomainReportFromCompletion(
  input: {
    runId: string;
    projectId: string;
    task: DomainTaskV1;
    summary: string;
    actions: readonly RunActionSummary[];
  },
  deps: {
    validatedOutputs?: typeof validatedOutputs;
  } = {}
): Promise<DomainReportV1> {
  const parsed = parseDomainCompletion(input.summary);
  const completion = completionObject(parsed);
  const outcome = completion.outcome;
  if (outcome === "done") {
    const outputs = await (deps.validatedOutputs ?? validatedOutputs)({
      ...input,
      claimedOutputs: completion.outputs,
    });
    return {
      schemaVersion: "DomainReport.v1",
      outcome: {
        outcome: "done",
        outputs: outputs.map((output) =>
          output.bindingId
            ? {
              bindingId: output.bindingId,
              workItemId: output.workItemId!,
              target: output.target!,
              kind: output.kind as import("@popcorn/shared/domain-agent-contract").DomainOutputKind,
              role: output.role!,
              ordinal: output.ordinal!,
              assetId: output.assetId,
              intrinsicRole: output.intrinsicRole,
            }
            : {
              assetId: output.assetId,
              intrinsicRole: output.intrinsicRole,
            }),
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
  if (outcome !== "question") {
    throw completionValidationError(
      "invalid_shape",
      "Domain completion outcome must be done or question."
    );
  }
  const optionsRaw = completion.options;
  if (!Array.isArray(optionsRaw) || optionsRaw.length < 2 || optionsRaw.length > 6) {
    throw completionValidationError(
      "invalid_question",
      "Domain question must contain between two and six options."
    );
  }
  const ids = new Set<string>();
  const options = optionsRaw.map((raw) => {
    const option = completionObject(raw);
    const id = boundedString(option.id, "question.options.id", 80);
    if (!/^[A-Za-z0-9_-]+$/.test(id) || ids.has(id)) {
      throw completionValidationError(
        "invalid_question",
        "Domain question option ids must be unique stable tokens."
      );
    }
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
