import { TOOL_NAMES, type ToolName } from "../types";
import type { DecisionScenario, PriorResult } from "./types";

// The model always sees the full tool vocabulary; the scenario's state (priorResults)
// is what should steer the choice.
const ALL_TOOLS: ToolName[] = [...TOOL_NAMES];
const GOAL = "Make a 15-second 9:16 video about a skateboarding puppy.";

function applied(tool: ToolName, assetId?: string): PriorResult {
  return { tool, status: "applied", outputAssetIds: [assetId ?? `${tool}_asset`] };
}

function failed(tool: ToolName, error: NonNullable<PriorResult["error"]>): PriorResult {
  return { tool, status: "failed", outputAssetIds: [], error };
}

// Cumulative upstream state, reused to build each step's "everything before me is done."
const brief = applied("create_or_load_brief", "brief_asset");
const blueprint = applied("develop_story_blueprint");
const script = applied("draft_script");
const plan = applied("plan_shots", "plan_asset");
const anchorPlan = applied("plan_visual_anchors");
const anchor = applied("generate_anchor", "anchor_asset");
const poster = applied("generate_poster", "poster_asset");
const storyboard = applied("generate_storyboard");
const keyframe = applied("generate_keyframe", "keyframe_asset");
const clip = applied("generate_clip", "clip_asset");
const audio = applied("generate_audio", "audio_asset");
const timeline = applied("assemble_timeline", "timeline_asset");
const critique = applied("critique_timeline");
const exported = applied("export_video", "export_asset");

// The high-level nine steps, as forward routing decisions: given everything up to
// step N is done, the orchestrator should move to step N+1. Acceptable sets widen
// at the per-beat loop stages (keyframe/clip), where ID-level state alone cannot
// tell the model whether more beats remain — those are inherently generous; the
// boundary transitions (fresh→brief, plan→visual prep, critique→export, →done) are
// the high-signal, tight cases.
export const FORWARD_CHAIN: DecisionScenario[] = [
  {
    id: "step1_fresh_start",
    description: "Nothing generated yet → create the brief first.",
    inputSummary: GOAL,
    priorResults: [],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["create_or_load_brief"] },
  },
  {
    id: "step2_after_brief",
    description: "Brief exists → generate early poster art or move into story/plan development.",
    inputSummary: GOAL,
    priorResults: [brief],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["generate_poster", "develop_story_blueprint", "draft_script", "plan_shots"] },
  },
  {
    id: "step3_after_plan",
    description: "Plan exists → prepare the visual references.",
    inputSummary: GOAL,
    priorResults: [brief, poster, blueprint, script, plan],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["plan_visual_anchors", "generate_anchor", "generate_storyboard"] },
  },
  {
    id: "step4_after_anchors",
    description: "Anchors exist → storyboard / keyframes next.",
    inputSummary: GOAL,
    priorResults: [brief, poster, blueprint, script, plan, anchorPlan, anchor],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["generate_storyboard", "generate_keyframe", "generate_anchor"] },
  },
  {
    id: "step5_after_keyframes",
    description: "Keyframes exist → generate the clips.",
    inputSummary: GOAL,
    priorResults: [brief, poster, blueprint, script, plan, anchorPlan, anchor, storyboard, keyframe],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["generate_keyframe", "generate_clip"] },
  },
  {
    id: "step6_after_clips",
    description: "Clips exist, no audio yet → audio or assemble (or more clips).",
    inputSummary: GOAL,
    priorResults: [brief, poster, blueprint, script, plan, anchorPlan, anchor, storyboard, keyframe, clip],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["generate_clip", "generate_audio", "assemble_timeline"] },
  },
  {
    id: "step7_after_audio",
    description: "Clips + audio exist → assemble the timeline.",
    inputSummary: GOAL,
    priorResults: [brief, poster, blueprint, script, plan, anchorPlan, anchor, storyboard, keyframe, clip, audio],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["assemble_timeline", "generate_clip"] },
  },
  {
    id: "step8_after_assemble",
    description: "Timeline assembled → critique or export.",
    inputSummary: GOAL,
    priorResults: [brief, poster, blueprint, script, plan, anchorPlan, anchor, storyboard, keyframe, clip, audio, timeline],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["critique_timeline", "export_video"] },
  },
  {
    id: "step9_after_critique",
    description: "Cut critiqued → export the final video.",
    inputSummary: GOAL,
    priorResults: [brief, poster, blueprint, script, plan, anchorPlan, anchor, storyboard, keyframe, clip, audio, timeline, critique],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["export_video"] },
  },
  {
    id: "step10_after_export",
    description: "Video exported → the run is complete (no tool).",
    inputSummary: GOAL,
    priorResults: [brief, poster, blueprint, script, plan, anchorPlan, anchor, storyboard, keyframe, clip, audio, timeline, critique, exported],
    availableTools: ALL_TOOLS,
    expect: { type: "done" },
  },
];

// Self-heal routing: a failed tool surfaces a precondition + suggested next tool.
// The orchestrator must satisfy the precondition, NOT blindly retry the failed tool.
export const RECOVERY: DecisionScenario[] = [
  {
    id: "recover_missing_brief",
    description: "plan_shots failed needing a brief → create the brief, don't retry plan_shots.",
    inputSummary: GOAL,
    priorResults: [
      failed("plan_shots", {
        kind: "precondition_unmet",
        message: "plan_shots needs a project brief before it can plan shots.",
        recoverable: true,
        unmetRequirements: [
          {
            requirement: "brief",
            because: "The plan is derived from the project's brief.",
            satisfyWith: { tool: "create_or_load_brief", inputHint: {} },
          },
        ],
        suggestedNextTools: [{ tool: "create_or_load_brief", inputHint: {} }],
      }),
    ],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["create_or_load_brief"] },
  },
  {
    id: "recover_missing_keyframe",
    description: "generate_clip failed needing a keyframe → generate the keyframe first.",
    inputSummary: GOAL,
    priorResults: [
      brief,
      blueprint,
      script,
      plan,
      anchor,
      failed("generate_clip", {
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
      }),
    ],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["generate_keyframe"] },
  },
];

// Approval gating is opt-in, not automatic. The forward chain already covers the
// negative cases (step5/step9: nothing in the input asks to pause, so the model
// must proceed to clips/export — never self-gate). This pins the positive case:
// when the input explicitly asks for human approval, request_approval is correct.
export const APPROVAL: DecisionScenario[] = [
  {
    id: "approval_when_explicitly_requested",
    description:
      "Input explicitly asks to pause for approval before export → request_approval, not export_video.",
    inputSummary: `${GOAL} Pause and request my approval before exporting the final video.`,
    priorResults: [brief, blueprint, script, plan, anchorPlan, anchor, storyboard, keyframe, clip, audio, timeline, critique],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["request_approval"] },
  },
];

export const ALL_SCENARIOS: DecisionScenario[] = [...FORWARD_CHAIN, ...RECOVERY, ...APPROVAL];
