import type { DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";
import { getLlmClient } from "@/lib/llm";
import { createAudioToolRegistry } from "@/lib/orchestrator-tools/audio-registry";
import { composeToolDescription } from "@/lib/orchestrator-tools/to-orchestrator-registry";
import { AUDIO_AGENT_SYSTEM_PROMPT } from "../audio-agent";

export type AudioProfileExpectation =
  | { type: "tool_call"; toolName: "generate_audio" | "fit_audio_to_picture" }
  | { type: "terminal"; outcome: "question" };

export interface AudioProfileScenario {
  id: string;
  description: string;
  task: DomainTaskV1;
  context: Record<string, unknown>;
  priorResults: unknown[];
  expect: AudioProfileExpectation;
}

export type AudioProfileDecision =
  | { type: "tool_call"; toolName: string }
  | { type: "terminal"; outcome: string };

export type AudioProfileDecisionModel = (input: {
  scenario: AudioProfileScenario;
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
}) => Promise<AudioProfileDecision>;

function audioTask(input: {
  taskKind:
    | "audio_production"
    | "audio_revision"
    | "audio_fit"
    | "soundtrack_create"
    | "audio_create";
  objective: string;
  instruction: string;
  targets: DomainTaskV1["targets"];
  allowedOutputKinds?: DomainTaskV1["allowedOutputKinds"];
  preserveAssetIds?: string[];
}): DomainTaskV1 {
  const route =
    input.taskKind === "soundtrack_create" || input.taskKind === "audio_create"
      ? {
          origin: {
            kind: "creator_direct" as const,
            actorId: "actor-1",
            creatorMessageId: "creator-message",
            entrypoint: "asset_studio" as const,
            requestDigest: "request-digest",
            idempotencyKey: `audio-eval-${input.taskKind}`,
            approvalGateId: "approval-gate",
          },
          responseRecipient: { kind: "creator_conversation" as const },
          approvalContext: {
            proposalActionId: "proposal-action" as never,
            approvedBudgetUsd: 1,
            approvalFingerprint: "approval-fingerprint",
          },
        }
      : {
          origin: {
            kind: "creative_director" as const,
            rootRunId: "root-run" as never,
            rootActionId: "root-action" as never,
            creatorMessageId: "creator-message",
          },
          responseRecipient: { kind: "creative_director" as const },
        };
  return {
    schemaVersion: "DomainTask.v1",
    domain: "audio",
    taskKind: input.taskKind,
    objective: input.objective,
    instruction: input.instruction,
    targets: input.targets,
    requiredOutputs: [
      { kind: "audio_track", role: "primary", minimumCount: 1 },
    ],
    allowedOutputKinds: input.allowedOutputKinds ?? ["audio_track"],
    creativeConstraints: {},
    preserve: {
      assetIds: input.preserveAssetIds ?? [],
      selections: [],
      fingerprints: [],
      pins: (input.preserveAssetIds ?? []).map((id) => ({ kind: "asset", id })),
    },
    candidateAffectedAssetIds: input.preserveAssetIds ?? [],
    budgetUsd: 1,
    acceptanceCriteria: [input.objective],
    ...route,
  } as unknown as DomainTaskV1;
}

export const AUDIO_PROFILE_SCENARIOS: readonly AudioProfileScenario[] = [
  {
    id: "audio_voiceover_exact_script",
    description: "Production voiceover uses the exact current script.",
    task: audioTask({
      taskKind: "audio_production",
      objective: "Create the approved narration for beat_1.",
      instruction: "Speak the current script exactly; do not paraphrase.",
      targets: [{ kind: "beat", projectId: "project-1", beatId: "beat_1" }],
    }),
    context: {
      assets: [
        {
          id: "script_1",
          kind: "script_draft",
          content: { narration: "Every morning begins with one small ritual." },
        },
      ],
    },
    priorResults: [],
    expect: { type: "tool_call", toolName: "generate_audio" },
  },
  {
    id: "audio_production_music_bed",
    description: "Production music remains an Audio-local generation choice.",
    task: audioTask({
      taskKind: "audio_production",
      objective: "Create a restrained instrumental bed for the approved cut.",
      instruction: "Keep space for narration.",
      targets: [{ kind: "project", projectId: "project-1" }],
    }),
    context: { assets: [{ id: "plan_1", kind: "shot_plan" }] },
    priorResults: [],
    expect: { type: "tool_call", toolName: "generate_audio" },
  },
  {
    id: "audio_standalone_soundtrack",
    description: "A standalone soundtrack creates one pooled audio asset.",
    task: audioTask({
      taskKind: "soundtrack_create",
      objective: "Create a 15-second warm analog instrumental underscore.",
      instruction: "Return one standalone pooled track; do not select it into a cut.",
      targets: [{ kind: "project", projectId: "project-1" }],
    }),
    context: { assets: [] },
    priorResults: [],
    expect: { type: "tool_call", toolName: "generate_audio" },
  },
  {
    id: "audio_standalone_sound_effect",
    description: "A standalone sound-effect request uses the canonical audio generator.",
    task: audioTask({
      taskKind: "audio_create",
      objective: "Create one close, dry ceramic cup-set-down sound.",
      instruction: "Return one standalone pooled sound-effect asset.",
      targets: [{ kind: "project", projectId: "project-1" }],
    }),
    context: { assets: [] },
    priorResults: [],
    expect: { type: "tool_call", toolName: "generate_audio" },
  },
  {
    id: "audio_refit_to_current_picture",
    description: "An exact audio/picture refit uses the fit primitive.",
    task: audioTask({
      taskKind: "audio_fit",
      objective: "Fit audio_1 to the current picture clip_1.",
      instruction: "Preserve every spoken word.",
      targets: [
        { kind: "asset", projectId: "project-1", assetId: "audio_1" },
        { kind: "asset", projectId: "project-1", assetId: "clip_1" },
      ],
      preserveAssetIds: ["audio_1", "clip_1"],
    }),
    context: {
      assets: [
        { id: "audio_1", kind: "audio_track", durationSec: 8 },
        { id: "clip_1", kind: "clip", durationSec: 10 },
      ],
    },
    priorResults: [],
    expect: { type: "tool_call", toolName: "fit_audio_to_picture" },
  },
  {
    id: "audio_warmer_delivery",
    description: "Warmer delivery with unchanged words is an Audio-local revision.",
    task: audioTask({
      taskKind: "audio_revision",
      objective: "Make audio_1 warmer while preserving its exact words.",
      instruction: "Change delivery only; preserve wording and meaning.",
      targets: [{ kind: "asset", projectId: "project-1", assetId: "audio_1" }],
      preserveAssetIds: ["audio_1"],
    }),
    context: {
      assets: [{ id: "audio_1", kind: "audio_track", prompt: "The approved words." }],
    },
    priorResults: [],
    expect: { type: "tool_call", toolName: "generate_audio" },
  },
  {
    id: "audio_change_dialogue_meaning",
    description: "A requested meaning change must be returned as a creative question.",
    task: audioTask({
      taskKind: "audio_revision",
      objective: "Revise audio_1.",
      instruction: "Change the character's promise into a refusal.",
      targets: [{ kind: "asset", projectId: "project-1", assetId: "audio_1" }],
      preserveAssetIds: ["audio_1"],
    }),
    context: {
      assets: [{ id: "audio_1", kind: "audio_track", prompt: "I promise I will be there." }],
    },
    priorResults: [],
    expect: { type: "terminal", outcome: "question" },
  },
  {
    id: "audio_picture_too_short_for_exact_words",
    description: "An impossible exact-word fit asks whether picture or meaning may change.",
    task: audioTask({
      taskKind: "audio_fit",
      objective: "Fit audio_1 to clip_1 without changing any words.",
      instruction: "The words and meaning are immutable.",
      targets: [
        { kind: "asset", projectId: "project-1", assetId: "audio_1" },
        { kind: "asset", projectId: "project-1", assetId: "clip_1" },
      ],
      preserveAssetIds: ["audio_1", "clip_1"],
    }),
    context: {
      assets: [
        { id: "audio_1", kind: "audio_track", durationSec: 12 },
        { id: "clip_1", kind: "clip", durationSec: 2 },
      ],
    },
    priorResults: [],
    expect: { type: "terminal", outcome: "question" },
  },
];

export async function runAudioProfileScenario(
  scenario: AudioProfileScenario,
  model: AudioProfileDecisionModel
): Promise<{ decision: AudioProfileDecision; passed: boolean }> {
  const registry = createAudioToolRegistry({}, { task: scenario.task });
  const tools = registry.list().map((tool) => ({
    name: tool.name,
    description: composeToolDescription(tool.description, tool.usage),
    inputSchema: tool.inputSchema,
  }));
  const decision = await model({ scenario, tools });
  const passed =
    scenario.expect.type === "tool_call"
      ? decision.type === "tool_call" &&
        decision.toolName === scenario.expect.toolName
      : decision.type === "terminal" &&
        decision.outcome === scenario.expect.outcome;
  return { decision, passed };
}

export function createRealAudioProfileDecisionModel(): AudioProfileDecisionModel {
  return async ({ scenario, tools }) => {
    const decision = await getLlmClient().chooseTool({
      system: AUDIO_AGENT_SYSTEM_PROMPT,
      userPayload: {
        task: scenario.task,
        context: scenario.context,
        priorResults: scenario.priorResults,
        instruction:
          "Choose one allowed tool if bounded work remains. Otherwise return the terminal JSON required by the system prompt.",
      },
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      })),
      maxTokens: 4_000,
      effort: "medium",
    });
    if (decision.type === "tool_call") {
      return { type: "tool_call", toolName: decision.toolName };
    }
    try {
      const parsed = JSON.parse(decision.text) as { outcome?: unknown };
      return {
        type: "terminal",
        outcome: typeof parsed.outcome === "string" ? parsed.outcome : "invalid",
      };
    } catch {
      return { type: "terminal", outcome: "invalid" };
    }
  };
}
