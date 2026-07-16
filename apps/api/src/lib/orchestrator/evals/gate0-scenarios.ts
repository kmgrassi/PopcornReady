// Gate-0 scenario families for the flat production registry
// (docs/scopes/specialist-agent-orchestration-prs.md, Decision Gate 0).
//
// Same fixture pattern as scenarios.ts: fabricated priorResults in the exact
// shape the model sees (IDs + status + error guidance), full tool vocabulary,
// acceptable-set expectations. These extend — never replace — the original
// forward-chain/recovery/approval scenarios with the six Gate-0 dimensions:
// long-context, tool-overload, cross-modality, selective-regeneration,
// premature-done, and precondition-miss recovery.

import { TOOL_NAMES, type ToolName } from "../types";
import type { Gate0Scenario } from "./gate0-report";
import type { PriorResult } from "./types";

const ALL_TOOLS: ToolName[] = [...TOOL_NAMES];
const GOAL = "Make a 15-second 9:16 video about a skateboarding puppy.";

function applied(tool: ToolName, assetId?: string): PriorResult {
  return { tool, status: "applied", outputAssetIds: [assetId ?? `${tool}_asset`] };
}

function failed(tool: ToolName, error: NonNullable<PriorResult["error"]>): PriorResult {
  return { tool, status: "failed", outputAssetIds: [], error };
}

// Cumulative upstream state (mirrors scenarios.ts).
const brief = applied("create_or_load_brief", "brief_asset");
const blueprint = applied("develop_story_blueprint");
const script = applied("draft_script");
const plan = applied("plan_shots", "plan_asset");
const anchorPlan = applied("plan_visual_anchors");
const anchor = applied("generate_anchor", "anchor_asset");
const storyboard = applied("generate_storyboard", "storyboard_asset");
const audio = applied("generate_audio", "audio_asset");
const timeline = applied("assemble_timeline", "timeline_asset");
const critique = applied("critique_timeline");
const exported = applied("export_video", "export_asset");

const PLANNING = [brief, blueprint, script, plan, anchorPlan, anchor, storyboard];

// Stable per-beat asset IDs, the long-context / selective-regeneration
// substrate: the model must keep routing correctly as history grows and must
// target existing graph IDs instead of re-planning.
function beatMedia(beatCount: number): PriorResult[] {
  const results: PriorResult[] = [];
  for (let beat = 1; beat <= beatCount; beat += 1) {
    results.push(applied("generate_keyframe", `beat${beat}_keyframe`));
    results.push(applied("generate_clip", `beat${beat}_clip`));
  }
  return results;
}

const EIGHT_BEATS = beatMedia(8);

// ---------------------------------------------------------------------------
// long_context — the same boundary decisions, buried under a long history.
// ---------------------------------------------------------------------------
export const LONG_CONTEXT: Gate0Scenario[] = [
  {
    id: "long_context_export_after_many_beats",
    family: "long_context",
    description:
      "Eight beats of keyframes/clips plus audio, timeline, and critique → export, despite ~25 prior results.",
    inputSummary: `${GOAL} The video has eight beats.`,
    priorResults: [...PLANNING, ...EIGHT_BEATS, audio, timeline, critique],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["export_video"] },
  },
  {
    id: "long_context_audio_gap_after_many_beats",
    family: "long_context",
    description:
      "Eight beats of media exist but no audio → cross the modality boundary even with a long history.",
    inputSummary: `${GOAL} The video has eight beats and needs upbeat background music.`,
    priorResults: [...PLANNING, ...EIGHT_BEATS],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["generate_audio", "assemble_timeline", "generate_clip"] },
  },
  {
    id: "long_context_done_after_export",
    family: "long_context",
    description:
      "Long history that already ends in a successful export → done; any tool call is an unnecessary turn.",
    inputSummary: `${GOAL} The video has eight beats.`,
    priorResults: [...PLANNING, ...EIGHT_BEATS, audio, timeline, critique, exported],
    availableTools: ALL_TOOLS,
    expect: { type: "done" },
  },
];

// ---------------------------------------------------------------------------
// tool_overload — the full vocabulary is exposed and only a narrow,
// rarely-used tool is correct; distractor tools tempt a misroute.
// ---------------------------------------------------------------------------
export const TOOL_OVERLOAD: Gate0Scenario[] = [
  {
    id: "overload_image_tile_revision",
    family: "tool_overload",
    description:
      "A specific storyboard tile image should be revised in place → regenerate_image_asset, not a fresh storyboard/keyframe run.",
    inputSummary:
      `${GOAL} Request Changes: make the skate-park tile image storyboard_asset moodier at dusk; keep every other tile as is.`,
    priorResults: PLANNING,
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["regenerate_image_asset"] },
  },
  {
    id: "overload_edit_existing_footage",
    family: "tool_overload",
    description:
      "Content inside an existing clip must change → edit_video_asset with the source asset, not a new clip or export.",
    inputSummary:
      `${GOAL} Request Changes: remove the watermark visible in clip asset beat2_clip; the clip is otherwise approved.`,
    priorResults: [...PLANNING, ...beatMedia(3)],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["edit_video_asset"] },
  },
  {
    id: "overload_fit_audio_window",
    family: "tool_overload",
    description:
      "Narration exists but overruns its beat window → fit_audio_to_picture, not regenerating media.",
    inputSummary:
      `${GOAL} The narration track audio_asset overruns beat 2's window; align it to the picture before assembling.`,
    priorResults: [...PLANNING, ...beatMedia(3), audio],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["fit_audio_to_picture"] },
  },
  {
    id: "overload_no_unrequested_publish",
    family: "tool_overload",
    description:
      "Export finished and nothing asked for catalog publication → done; publish_to_catalog is a distractor.",
    inputSummary: GOAL,
    priorResults: [...PLANNING, ...beatMedia(3), audio, timeline, critique, exported],
    availableTools: ALL_TOOLS,
    expect: { type: "done" },
  },
];

// ---------------------------------------------------------------------------
// cross_modality — coherence decisions that cross the visuals/audio boundary.
// ---------------------------------------------------------------------------
export const CROSS_MODALITY: Gate0Scenario[] = [
  {
    id: "cross_modality_voiceover_after_clips",
    family: "cross_modality",
    description: "Script calls for a voiceover; clips exist but no audio → move to audio.",
    inputSummary: `${GOAL} The script includes a narrator voiceover for every beat.`,
    priorResults: [...PLANNING, ...beatMedia(3)],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["generate_audio"] },
  },
  {
    id: "cross_modality_sync_before_assemble",
    family: "cross_modality",
    description:
      "Both modalities exist and the input asks to verify narration timing before the cut → fit_audio_to_picture.",
    inputSummary:
      `${GOAL} Before assembling the cut, make sure the narration lines up with each beat's clip.`,
    priorResults: [...PLANNING, ...beatMedia(3), audio],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["fit_audio_to_picture"] },
  },
  {
    id: "cross_modality_visual_fix_not_audio",
    family: "cross_modality",
    description:
      "Critique found a visual glitch in one beat's clip; audio is fine → fix the clip, not the audio.",
    inputSummary:
      `${GOAL} The quality review flagged a rendering glitch in beat 2's clip (asset beat2_clip); the soundtrack was approved.`,
    priorResults: [...PLANNING, ...beatMedia(3), audio, timeline, critique],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["generate_clip", "edit_video_asset"] },
  },
];

// ---------------------------------------------------------------------------
// selective_regeneration — target existing stable graph IDs; re-planning the
// whole project (plan_shots/create_or_load_brief/...) is the misroute signal.
// ---------------------------------------------------------------------------
export const SELECTIVE_REGENERATION: Gate0Scenario[] = [
  {
    id: "selective_regen_beats_warmer",
    family: "selective_regeneration",
    description:
      "\"Redo beats 3–5 warmer\" with stable beat asset IDs → regenerate the affected media only, never re-plan.",
    inputSummary:
      `${GOAL} Request Changes: redo beats 3, 4, and 5 with a warmer golden-hour look; keep all other beats exactly as they are.`,
    priorResults: [...PLANNING, ...beatMedia(6), audio, timeline, critique],
    availableTools: ALL_TOOLS,
    expect: {
      type: "tool_call",
      oneOf: ["generate_keyframe", "generate_clip", "regenerate_image_asset"],
    },
  },
  {
    id: "selective_regen_single_keyframe",
    family: "selective_regeneration",
    description:
      "One named keyframe image should change → revise that image asset, not the storyboard or plan.",
    inputSummary:
      `${GOAL} Request Changes: replace the puppy's helmet with a red one in keyframe image asset beat4_keyframe only.`,
    priorResults: [...PLANNING, ...beatMedia(6)],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["regenerate_image_asset", "generate_keyframe"] },
  },
  {
    id: "selective_regen_edit_one_clip",
    family: "selective_regeneration",
    description:
      "Modify content inside one existing clip → edit_video_asset scoped to that source asset.",
    inputSummary:
      `${GOAL} Request Changes: in clip asset beat1_clip, remove the bystander in the background; everything else is approved.`,
    priorResults: [...PLANNING, ...beatMedia(6), audio, timeline, critique],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["edit_video_asset"] },
  },
];

// ---------------------------------------------------------------------------
// premature_done — work clearly remains; answering "done" is the failure this
// family measures (classified as premature_done in the Gate-0 report).
// ---------------------------------------------------------------------------
export const PREMATURE_DONE: Gate0Scenario[] = [
  {
    id: "premature_done_media_without_timeline",
    family: "premature_done",
    description: "All media exists but no timeline/export → the run must continue, not stop.",
    inputSummary: GOAL,
    priorResults: [...PLANNING, ...beatMedia(3), audio],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["assemble_timeline", "fit_audio_to_picture"] },
  },
  {
    id: "premature_done_timeline_not_exported",
    family: "premature_done",
    description: "Timeline assembled and critiqued but never exported → export, not done.",
    inputSummary: GOAL,
    priorResults: [...PLANNING, ...beatMedia(3), audio, timeline, critique],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["export_video"] },
  },
  {
    id: "premature_done_only_brief",
    family: "premature_done",
    description: "Only a brief exists on a full-video request → keep producing.",
    inputSummary: `${GOAL} Deliver the finished exported video.`,
    priorResults: [brief],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["develop_story_blueprint", "draft_script", "plan_shots"] },
  },
];

// ---------------------------------------------------------------------------
// recovery — precondition misses within and across modality boundaries. The
// latest prior result failed; re-choosing that same tool is scored as a
// repeated_failed_call, the Gate-0 recovery-baseline failure.
// ---------------------------------------------------------------------------
export const GATE0_RECOVERY: Gate0Scenario[] = [
  {
    id: "recover_keyframe_missing_storyboard",
    family: "recovery",
    description:
      "generate_keyframe failed needing storyboard tiles → create the storyboard, don't retry the keyframe.",
    inputSummary: GOAL,
    priorResults: [
      brief,
      blueprint,
      script,
      plan,
      anchorPlan,
      anchor,
      failed("generate_keyframe", {
        kind: "precondition_unmet",
        message: "generate_keyframe needs selected beat_storyboard sketch tiles for the beat.",
        recoverable: true,
        unmetRequirements: [
          {
            requirement: "beat_storyboard",
            because: "Photoreal keyframes are grounded in the selected storyboard tile.",
            satisfyWith: { tool: "generate_storyboard", inputHint: {} },
          },
        ],
        suggestedNextTools: [{ tool: "generate_storyboard", inputHint: {} }],
      }),
    ],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["generate_storyboard"] },
  },
  {
    id: "recover_cross_domain_missing_audio",
    family: "recovery",
    description:
      "assemble_timeline failed needing audio (a cross-modality precondition) → generate the audio first.",
    inputSummary: `${GOAL} Every beat needs narration under the picture.`,
    priorResults: [
      ...PLANNING,
      ...beatMedia(3),
      failed("assemble_timeline", {
        kind: "precondition_unmet",
        message: "assemble_timeline needs the required narration audio before building the cut.",
        recoverable: true,
        unmetRequirements: [
          {
            requirement: "beat_audio",
            because: "The requested cut places narration under every beat.",
            satisfyWith: { tool: "generate_audio", inputHint: {} },
          },
        ],
        suggestedNextTools: [{ tool: "generate_audio", inputHint: {} }],
      }),
    ],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["generate_audio"] },
  },
  {
    id: "recover_export_missing_timeline",
    family: "recovery",
    description: "export_video failed because no timeline exists → assemble it, don't retry export.",
    inputSummary: GOAL,
    priorResults: [
      ...PLANNING,
      ...beatMedia(3),
      audio,
      failed("export_video", {
        kind: "precondition_unmet",
        message: "export_video needs an assembled timeline to render.",
        recoverable: true,
        unmetRequirements: [
          {
            requirement: "timeline",
            because: "The export renders the assembled timeline deterministically.",
            satisfyWith: { tool: "assemble_timeline", inputHint: {} },
          },
        ],
        suggestedNextTools: [{ tool: "assemble_timeline", inputHint: {} }],
      }),
    ],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["assemble_timeline"] },
  },
  {
    id: "recover_fit_audio_missing_track",
    family: "recovery",
    description:
      "fit_audio_to_picture failed because no audio track exists → generate audio, don't retry the fit.",
    inputSummary: `${GOAL} Fit the narration to each beat.`,
    priorResults: [
      ...PLANNING,
      ...beatMedia(3),
      failed("fit_audio_to_picture", {
        kind: "precondition_unmet",
        message: "fit_audio_to_picture needs a generated audio track to fit.",
        recoverable: true,
        unmetRequirements: [
          {
            requirement: "audio_track",
            because: "Fitting aligns an existing track to the beat window.",
            satisfyWith: { tool: "generate_audio", inputHint: {} },
          },
        ],
        suggestedNextTools: [{ tool: "generate_audio", inputHint: {} }],
      }),
    ],
    availableTools: ALL_TOOLS,
    expect: { type: "tool_call", oneOf: ["generate_audio"] },
  },
];

export const GATE0_FLAT_SCENARIOS: Gate0Scenario[] = [
  ...LONG_CONTEXT,
  ...TOOL_OVERLOAD,
  ...CROSS_MODALITY,
  ...SELECTIVE_REGENERATION,
  ...PREMATURE_DONE,
  ...GATE0_RECOVERY,
];
