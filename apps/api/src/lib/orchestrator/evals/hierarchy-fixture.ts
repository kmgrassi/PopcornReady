// Fixture-only simulation of the PROPOSED creative-director/domain decision
// surface (docs/scopes/specialist-agent-orchestration-prs.md, Decision Gate 0).
//
// The Gate-0 comparison never runs both architectures against live billable
// providers: the hierarchy side is a pure decision surface built from the
// dormant role registries (root/visuals/audio-registry.ts) plus fixture
// `delegate_visuals` / `delegate_audio` tool DEFINITIONS. Nothing here can
// execute a tool — the surface carries names/descriptions/schemas only, and
// the model (real or scripted) just picks one.

import { createAudioToolRegistry } from "@/lib/orchestrator-tools/audio-registry";
import { createRootToolRegistry } from "@/lib/orchestrator-tools/root-registry";
import { createVisualsToolRegistry } from "@/lib/orchestrator-tools/visuals-registry";
import { composeToolDescription } from "@/lib/orchestrator-tools/to-orchestrator-registry";
import { buildRoutingContext, ORCHESTRATOR_SYSTEM_PROMPT } from "../model";
import { getLlmClient } from "@/lib/llm";
import {
  classifyDecision,
  lastFailedTool,
  type Gate0Family,
  type ScoredScenario,
} from "./gate0-report";

// Fixture prior results/tools are strings, not ToolName: the proposed surface
// includes dispatch tools that do not exist in the production vocabulary.
export interface FixturePriorResult {
  tool: string;
  status: "applied" | "failed" | "running";
  outputAssetIds: string[];
  error?: {
    kind: string;
    message: string;
    recoverable: boolean;
    unmetRequirements?: Array<{
      requirement: string;
      because: string;
      satisfyWith: { tool: string; inputHint: Record<string, unknown> };
    }>;
    suggestedNextTools?: Array<{ tool: string; inputHint: Record<string, unknown> }>;
  };
}

/** Model-facing decision surface entry: schema + prose only, no execute. */
export interface FixtureToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type FixtureSurfaceName = "root" | "visuals" | "audio";

export interface HierarchyScenario {
  id: string;
  family: Gate0Family;
  /** Which simulated agent is deciding. */
  surface: FixtureSurfaceName;
  description: string;
  inputSummary: string;
  priorResults: FixturePriorResult[];
  expect: { type: "tool_call"; oneOf: string[] } | { type: "done" };
}

export type FixtureDecision = { type: "tool_call"; toolName: string } | { type: "done" };

export type FixtureDecisionModel = (input: {
  scenarioId: string;
  inputSummary: string;
  priorResults: FixturePriorResult[];
  tools: FixtureToolDefinition[];
}) => Promise<FixtureDecision>;

export const DELEGATE_VISUALS_FIXTURE: FixtureToolDefinition = {
  name: "delegate_visuals",
  description:
    "Assign a bounded visual-production task to the Visuals specialist (anchors, storyboard tiles, keyframes, clips, image/video revisions). " +
    "Provide the objective, target beats/assets by stable id, constraints, and what to preserve. The specialist reports done, blocked, or a question. " +
    "Use this instead of generating visual media yourself; you retain story, coherence, timeline, approval, and export decisions.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      objective: { type: "string", description: "What visual outcome the assignment must produce." },
      targets: {
        type: "array",
        items: { type: "string" },
        description: "Stable graph ids (beats, panels, assets) the work is scoped to.",
      },
      preserveAssetIds: {
        type: "array",
        items: { type: "string" },
        description: "Assets that must not change.",
      },
      constraints: { type: "string", description: "Creative constraints (tone, look, continuity)." },
    },
    required: ["objective"],
  },
};

export const DELEGATE_AUDIO_FIXTURE: FixtureToolDefinition = {
  name: "delegate_audio",
  description:
    "Assign a bounded audio-production task to the Audio specialist (voice, dialogue, music, sound, fitting audio to picture). " +
    "Provide the objective, target beats/assets by stable id, constraints, and what to preserve. The specialist reports done, blocked, or a question. " +
    "Use this instead of generating audio yourself; you retain story, coherence, timeline, approval, and export decisions.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      objective: { type: "string", description: "What audio outcome the assignment must produce." },
      targets: {
        type: "array",
        items: { type: "string" },
        description: "Stable graph ids (beats, timeline items, assets) the work is scoped to.",
      },
      preserveAssetIds: {
        type: "array",
        items: { type: "string" },
        description: "Assets that must not change.",
      },
      constraints: { type: "string", description: "Creative constraints (mood, pacing, mix)." },
    },
    required: ["objective"],
  },
};

function toFixtureDefinitions(
  registry: ReturnType<typeof createRootToolRegistry>
): FixtureToolDefinition[] {
  return registry.list().map((definition) => ({
    name: definition.name,
    description: composeToolDescription(definition.description, definition.usage),
    inputSchema: definition.inputSchema,
  }));
}

export interface FixtureSurfaces {
  /** Creative director: root-owned coherence tools + fixture dispatch tools. */
  root: FixtureToolDefinition[];
  /** Visuals specialist: visuals-owned tools only (in-domain self-healing). */
  visuals: FixtureToolDefinition[];
  /** Audio specialist: audio-owned tools only. */
  audio: FixtureToolDefinition[];
}

/**
 * Build the three simulated decision surfaces from the SAME definitions the
 * dormant role registries own, so descriptions match what a real cutover would
 * expose. Definitions only — execution is never bridged.
 */
export function buildFixtureSurfaces(): FixtureSurfaces {
  return {
    root: [
      ...toFixtureDefinitions(createRootToolRegistry()),
      DELEGATE_VISUALS_FIXTURE,
      DELEGATE_AUDIO_FIXTURE,
    ],
    visuals: toFixtureDefinitions(createVisualsToolRegistry()),
    audio: toFixtureDefinitions(createAudioToolRegistry()),
  };
}

// The production RoutingContext shape with the tool fields widened to plain
// strings so fixture dispatch tools (delegate_visuals/delegate_audio) can
// appear in it. Serialized into the model payload exactly like production's.
export interface FixtureRoutingContext {
  completedTools: string[];
  latestFailure?: {
    tool: string;
    kind?: string;
    message?: string;
    unmetRequirements: string[];
    requiredRecoveryTools: string[];
  };
  nextToolHint?: {
    tool: string;
    reason: string;
  };
  assetRoleGuide: Record<string, string>;
}

/**
 * Fixture-aware routing context: production `buildRoutingContext` semantics,
 * extended — locally to the eval fixture path, never for real runs — so
 * dispatch fixture tools are preserved instead of dropped by the production
 * ToolName filter. Real-tool signals (including the keyframe/storyboard
 * next-tool hints) come straight from the production builder; only results
 * whose tool name falls outside the production vocabulary (the delegate
 * fixtures) get the same treatment production would give them: applied ones
 * join completedTools, and a trailing failure surfaces latestFailure plus the
 * suggested-recovery nextToolHint. Both compared surfaces therefore receive
 * equivalent failure/recovery signals.
 */
export function buildFixtureRoutingContext(
  priorResults: FixturePriorResult[]
): FixtureRoutingContext {
  const base = buildRoutingContext(priorResults);
  // Recompute completions fixture-tolerantly: applied dispatch results count.
  const completedTools = [
    ...new Set(
      priorResults.filter((result) => result.status === "applied").map((result) => result.tool)
    ),
  ];

  const context: FixtureRoutingContext = { ...base, completedTools };
  const latest = priorResults.at(-1);
  if (latest?.status === "failed" && !base.latestFailure) {
    // The production builder dropped this failure because its tool name is a
    // fixture dispatch. Mirror its projection: unmet requirement names, the
    // deduped recovery tools, and the generic suggested-recovery hint.
    const recoveryTools = [
      ...new Set([
        ...(latest.error?.suggestedNextTools ?? []).map((call) => call.tool),
        ...(latest.error?.unmetRequirements ?? []).map((miss) => miss.satisfyWith.tool),
      ]),
    ];
    context.latestFailure = {
      tool: latest.tool,
      ...(latest.error?.kind ? { kind: latest.error.kind } : {}),
      ...(latest.error?.message ? { message: latest.error.message } : {}),
      unmetRequirements: (latest.error?.unmetRequirements ?? []).map((miss) => miss.requirement),
      requiredRecoveryTools: recoveryTools,
    };
    const [recoveryTool] = recoveryTools;
    if (recoveryTool) {
      context.nextToolHint = {
        tool: recoveryTool,
        reason: "The latest failed action explicitly suggested this recovery tool.",
      };
    }
  }
  return context;
}

/**
 * Opt-in REAL-model adapter for the fixture surface. Every call is a billable
 * LLM request — only the env-gated report script should construct this; tests
 * always inject a scripted model instead. Uses the exact production system
 * prompt and routing-context projection so only the tool surface differs
 * between the flat baseline and the hierarchy simulation.
 */
export function createRealFixtureDecisionModel(): FixtureDecisionModel {
  return async ({ scenarioId, inputSummary, priorResults, tools }) => {
    const client = getLlmClient();
    const decision = await client.chooseTool({
      system: ORCHESTRATOR_SYSTEM_PROMPT,
      userPayload: {
        projectId: scenarioId,
        inputSummary,
        priorResults,
        routingContext: buildFixtureRoutingContext(priorResults),
        instruction:
          "Choose exactly one next tool if work remains. If all work is complete, answer with a concise text summary and no tool call. " +
          "If the latest action failed, resolve its error (follow suggestedNextTools / unmetRequirements) rather than calling the failed tool again unchanged.",
      },
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      })),
      maxTokens: 4000,
      effort: "medium",
    });
    if (decision.type === "tool_call") {
      return { type: "tool_call", toolName: decision.toolName };
    }
    return { type: "done" };
  };
}

export interface HierarchyEvalOptions {
  /** REQUIRED-by-tests injection point; use createRealFixtureDecisionModel() for opt-in real runs. */
  model: FixtureDecisionModel;
  /** Sample each scenario N times. Default 1. */
  samples?: number;
  /** Override the surfaces (tests may shrink them); defaults to buildFixtureSurfaces(). */
  surfaces?: FixtureSurfaces;
}

export async function runHierarchyScenario(
  scenario: HierarchyScenario,
  opts: HierarchyEvalOptions
): Promise<ScoredScenario> {
  const surfaces = opts.surfaces ?? buildFixtureSurfaces();
  const tools = surfaces[scenario.surface];
  const samples = Math.max(1, opts.samples ?? 1);
  const failedTool = lastFailedTool(scenario.priorResults);

  const scored: ScoredScenario = {
    scenarioId: scenario.id,
    family: scenario.family,
    classifications: [],
    sampledDecisions: [],
  };
  for (let i = 0; i < samples; i += 1) {
    const decision = await opts.model({
      scenarioId: scenario.id,
      inputSummary: scenario.inputSummary,
      priorResults: scenario.priorResults,
      tools,
    });
    const sample =
      decision.type === "done"
        ? ({ decision: "done" } as const)
        : ({ decision: "tool_call", toolName: decision.toolName } as const);
    scored.sampledDecisions.push(sample);
    scored.classifications.push(
      classifyDecision({ expect: scenario.expect, sample, lastFailedTool: failedTool })
    );
  }
  return scored;
}

export async function runHierarchyScenarios(
  scenarios: HierarchyScenario[],
  opts: HierarchyEvalOptions
): Promise<ScoredScenario[]> {
  const surfaces = opts.surfaces ?? buildFixtureSurfaces();
  const results: ScoredScenario[] = [];
  for (const scenario of scenarios) {
    results.push(await runHierarchyScenario(scenario, { ...opts, surfaces }));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Comparison scenarios: the same project states the flat families measure,
// projected onto the proposed root/domain surfaces. Root media gaps become
// dispatch decisions; in-domain gaps stay inside the specialist surface.
// ---------------------------------------------------------------------------

const GOAL = "Make a 15-second 9:16 video about a skateboarding puppy.";

function done(tool: string, assetId?: string): FixturePriorResult {
  return { tool, status: "applied", outputAssetIds: [assetId ?? `${tool}_asset`] };
}

const ROOT_PLANNING: FixturePriorResult[] = [
  done("create_or_load_brief", "brief_asset"),
  done("develop_story_blueprint"),
  done("draft_script"),
  done("plan_shots", "plan_asset"),
  done("plan_visual_anchors"),
];

const VISUALS_DELEGATED = done("delegate_visuals", "visuals_report_beats_1_3");
const AUDIO_DELEGATED = done("delegate_audio", "audio_report_narration");

export const HIERARCHY_ROOT_SCENARIOS: HierarchyScenario[] = [
  {
    id: "hier_root_plan_ready_dispatch_visuals",
    family: "tool_overload",
    surface: "root",
    description:
      "Shot plan and anchor plan exist, no visual media yet → the root dispatches Visuals instead of picking a leaf media tool.",
    inputSummary: GOAL,
    priorResults: ROOT_PLANNING,
    expect: { type: "tool_call", oneOf: ["delegate_visuals"] },
  },
  {
    id: "hier_root_clips_need_audio_dispatch",
    family: "cross_modality",
    surface: "root",
    description:
      "Visuals reported done; narration is still missing → root dispatches Audio.",
    inputSummary: `${GOAL} The script includes a narrator voiceover for every beat.`,
    priorResults: [...ROOT_PLANNING, VISUALS_DELEGATED],
    expect: { type: "tool_call", oneOf: ["delegate_audio"] },
  },
  {
    id: "hier_root_media_ready_assemble",
    family: "tool_overload",
    surface: "root",
    description:
      "Both domains reported done, no timeline → root keeps assembly for itself.",
    inputSummary: GOAL,
    priorResults: [...ROOT_PLANNING, VISUALS_DELEGATED, AUDIO_DELEGATED],
    expect: { type: "tool_call", oneOf: ["assemble_timeline"] },
  },
  {
    id: "hier_root_visuals_blocked_on_audio",
    family: "recovery",
    surface: "root",
    description:
      "Visuals returned blocked on a missing audio dependency → root dispatches Audio, not Visuals again.",
    inputSummary: GOAL,
    priorResults: [
      ...ROOT_PLANNING,
      {
        tool: "delegate_visuals",
        status: "failed",
        outputAssetIds: [],
        error: {
          kind: "precondition_unmet",
          message:
            "Visuals is blocked: fitting the montage needs the narration track that does not exist yet.",
          recoverable: true,
          unmetRequirements: [
            {
              requirement: "narration_track",
              because: "The montage timing is driven by the narration.",
              satisfyWith: { tool: "delegate_audio", inputHint: {} },
            },
          ],
          suggestedNextTools: [{ tool: "delegate_audio", inputHint: {} }],
        },
      },
    ],
    expect: { type: "tool_call", oneOf: ["delegate_audio"] },
  },
  {
    id: "hier_root_selective_regen_delegates",
    family: "selective_regeneration",
    surface: "root",
    description:
      "\"Redo beats 3–5 warmer\" after a finished pass → a scoped Visuals dispatch, never re-planning the story.",
    inputSummary:
      `${GOAL} Request Changes: redo beats 3, 4, and 5 with a warmer golden-hour look; keep all other beats exactly as they are.`,
    priorResults: [
      ...ROOT_PLANNING,
      VISUALS_DELEGATED,
      AUDIO_DELEGATED,
      done("assemble_timeline", "timeline_asset"),
      done("critique_timeline"),
    ],
    expect: { type: "tool_call", oneOf: ["delegate_visuals"] },
  },
  {
    id: "hier_root_long_context_export",
    family: "long_context",
    surface: "root",
    description:
      "Long dispatch history ending with critique → export; the root surface stays decisive as history grows.",
    inputSummary: `${GOAL} The video has eight beats.`,
    priorResults: [
      ...ROOT_PLANNING,
      done("delegate_visuals", "visuals_report_beats_1_4"),
      done("delegate_visuals", "visuals_report_beats_5_8"),
      AUDIO_DELEGATED,
      done("delegate_audio", "audio_report_music_bed"),
      done("assemble_timeline", "timeline_asset"),
      done("critique_timeline"),
    ],
    expect: { type: "tool_call", oneOf: ["export_video"] },
  },
  {
    id: "hier_root_done_after_export",
    family: "premature_done",
    surface: "root",
    description: "Export finished → done; another dispatch is an unnecessary turn.",
    inputSummary: GOAL,
    priorResults: [
      ...ROOT_PLANNING,
      VISUALS_DELEGATED,
      AUDIO_DELEGATED,
      done("assemble_timeline", "timeline_asset"),
      done("critique_timeline"),
      done("export_video", "export_asset"),
    ],
    expect: { type: "done" },
  },
];

export const HIERARCHY_DOMAIN_SCENARIOS: HierarchyScenario[] = [
  {
    id: "hier_visuals_self_heal_keyframe",
    family: "recovery",
    surface: "visuals",
    description:
      "Inside the Visuals assignment, generate_clip failed on a missing keyframe → self-heal in-domain with generate_keyframe.",
    inputSummary:
      "Visuals assignment: produce beat clips 1–3 for the skateboarding-puppy project; keyframes may need to be created first.",
    priorResults: [
      done("generate_storyboard", "storyboard_asset"),
      {
        tool: "generate_clip",
        status: "failed",
        outputAssetIds: [],
        error: {
          kind: "precondition_unmet",
          message: "generate_clip needs a first-frame keyframe for the beat.",
          recoverable: true,
          unmetRequirements: [
            {
              requirement: "beat_keyframe",
              because: "The clip is seeded from the beat's first-frame keyframe.",
              satisfyWith: { tool: "generate_keyframe", inputHint: {} },
            },
          ],
          suggestedNextTools: [{ tool: "generate_keyframe", inputHint: {} }],
        },
      },
    ],
    expect: { type: "tool_call", oneOf: ["generate_keyframe"] },
  },
  {
    id: "hier_audio_fit_after_generate",
    family: "cross_modality",
    surface: "audio",
    description:
      "Inside the Audio assignment, the narration exists and the task asks for beat alignment → fit_audio_to_picture.",
    inputSummary:
      "Audio assignment: the narration track audio_asset is generated; fit it to each beat window before reporting done.",
    priorResults: [done("generate_audio", "audio_asset")],
    expect: { type: "tool_call", oneOf: ["fit_audio_to_picture"] },
  },
];

export const HIERARCHY_SCENARIOS: HierarchyScenario[] = [
  ...HIERARCHY_ROOT_SCENARIOS,
  ...HIERARCHY_DOMAIN_SCENARIOS,
];
