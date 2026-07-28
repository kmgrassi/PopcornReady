import type {
  FixturePriorResult,
  HierarchyScenario,
} from "./hierarchy-fixture";

function applied(tool: string, assetId: string): FixturePriorResult {
  return { tool, status: "applied", outputAssetIds: [assetId] };
}

/** Executable, provider-free decisions over the real eight-tool Visuals surface. */
export const VISUALS_DECISION_SCENARIOS: HierarchyScenario[] = [
  {
    id: "visuals_standalone_image",
    family: "tool_overload",
    surface: "visuals",
    description: "A standalone still has no production-plan prerequisite.",
    inputSummary:
      "Visuals image_create assignment: create one pooled 16:9 still of a neon diner at midnight.",
    priorResults: [],
    expect: { type: "tool_call", oneOf: ["generate_image_asset"] },
  },
  {
    id: "visuals_standalone_video",
    family: "tool_overload",
    surface: "visuals",
    description: "A standalone video segment must not fabricate a beat or storyboard.",
    inputSummary:
      "Visuals video_create assignment: create one pooled six-second dolly shot through a foggy arcade.",
    priorResults: [],
    expect: { type: "tool_call", oneOf: ["generate_video_asset"] },
  },
  {
    id: "visuals_pinned_video_edit",
    family: "selective_regeneration",
    surface: "visuals",
    description: "Editing visible content in a pinned source uses the edit primitive.",
    inputSummary:
      "Visuals video_edit assignment: edit pinned source asset clip_source to add fog; keep every other asset unchanged.",
    priorResults: [applied("generate_clip", "clip_source")],
    expect: { type: "tool_call", oneOf: ["edit_video_asset"] },
  },
  {
    id: "visuals_clip_missing_keyframe",
    family: "recovery",
    surface: "visuals",
    description: "A missing beat keyframe self-heals inside Visuals.",
    inputSummary:
      "Visuals production assignment: create the targeted beat clip and recover its missing prerequisite.",
    priorResults: [
      {
        tool: "generate_clip",
        status: "failed",
        outputAssetIds: [],
        error: {
          kind: "precondition_unmet",
          message: "The targeted beat has no selected beat_keyframe.",
          recoverable: true,
          unmetRequirements: [{
            requirement: "beat_keyframe",
            because: "The clip must be grounded in a first frame.",
            satisfyWith: { tool: "generate_keyframe", inputHint: {} },
          }],
          suggestedNextTools: [{ tool: "generate_keyframe", inputHint: {} }],
        },
      },
    ],
    expect: { type: "tool_call", oneOf: ["generate_keyframe"] },
  },
];
