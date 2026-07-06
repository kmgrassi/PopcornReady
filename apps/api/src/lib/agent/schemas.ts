// Hand-written JSON Schemas for structured tool-call inputs. Kept here so every agent
// shares the exact patch shape the timeline engine knows how to apply.

const num = { type: "number" } as const;
const str = { type: "string" } as const;

const sourceWindowSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    assetId: str,
    startSec: num,
    endSec: num,
    label: str,
  },
  required: ["startSec", "endSec"],
};

const beatSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: str,
    durationSec: num,
    intent: str,
    sourceWindow: sourceWindowSchema,
  },
  required: ["name", "durationSec", "intent"],
};

// A storyboard scene: the continuity unit (shared setting/cast/look) grouping
// ordered beats. The planner may emit a single scene for short clips.
const sceneSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: str,
    setting: str,
    mood: str,
    characterIds: { type: "array", items: str },
    beats: { type: "array", items: beatSchema },
  },
  required: ["name", "beats"],
};

export const planSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    targetLengthSec: num,
    style: str,
    aspectRatio: { type: "string", enum: ["9:16", "16:9", "1:1"] },
    scenes: {
      type: "array",
      items: sceneSchema,
    },
  },
  required: ["targetLengthSec", "style", "aspectRatio", "scenes"],
};

const planCritiqueIssueSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    severity: { type: "string", enum: ["low", "medium", "high"] },
    area: {
      type: "string",
      enum: [
        "story_arc",
        "beat_order",
        "character_continuity",
        "prompt_specificity",
        "visual_feasibility",
        "timing",
      ],
    },
    issue: str,
    recommendation: str,
  },
  required: ["severity", "area", "issue", "recommendation"],
};

export const planCritiqueSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    storyArc: { type: "string", enum: ["pass", "needs_review", "fail"] },
    characterContinuity: {
      type: "string",
      enum: ["pass", "needs_review", "fail"],
    },
    promptReadiness: { type: "string", enum: ["pass", "needs_review", "fail"] },
    visualFeasibility: {
      type: "string",
      enum: ["pass", "needs_review", "fail"],
    },
    summary: str,
    issues: { type: "array", items: planCritiqueIssueSchema },
    revisedPlan: planSchema,
  },
  required: [
    "storyArc",
    "characterContinuity",
    "promptReadiness",
    "visualFeasibility",
    "summary",
    "issues",
    "revisedPlan",
  ],
};

export const uploadedFootagePlanReviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    storyArc: { type: "string", enum: ["pass", "needs_review", "fail"] },
    sourceCoverage: { type: "string", enum: ["pass", "needs_review", "fail"] },
    timing: { type: "string", enum: ["pass", "needs_review", "fail"] },
    missingBeats: { type: "array", items: str },
    recommendedMode: {
      type: "string",
      enum: ["uploaded_only", "hybrid_generate_gaps", "needs_more_source"],
    },
    summary: str,
    revisedPlan: planSchema,
  },
  required: [
    "storyArc",
    "sourceCoverage",
    "timing",
    "missingBeats",
    "recommendedMode",
    "summary",
    "revisedPlan",
  ],
};

export const compositionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    beats: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: str,
          intent: str,
          durationSec: num,
          assetStrategy: {
            type: "string",
            enum: ["use_existing", "generate_image", "generate_video"],
          },
          requiredAssetIds: { type: "array", items: str },
          generationKind: { type: "string", enum: ["image", "video"] },
          generationPrompt: str,
        },
        required: ["name", "intent", "durationSec", "assetStrategy"],
      },
    },
    narration: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: { type: "string", enum: ["none", "provided", "generate"] },
        script: str,
      },
      required: ["mode"],
    },
  },
  required: ["beats", "narration"],
};

export const timelineSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    showCaptions: { type: "boolean" },
    segments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          clipId: str,
          sourceInSec: num,
          sourceOutSec: num,
          role: str,
          reason: str,
          caption: str,
        },
        required: ["clipId", "sourceInSec", "sourceOutSec", "role", "reason"],
      },
    },
  },
  required: ["segments"],
};

export const editDecisionTimelineSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    showCaptions: { type: "boolean" },
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          beatId: str,
          clipId: str,
          sourceInSec: num,
          sourceOutSec: num,
          rationale: str,
          caption: str,
        },
        required: ["beatId", "clipId", "sourceInSec", "sourceOutSec", "rationale"],
      },
    },
  },
  required: ["decisions"],
};

export const criticSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    scores: {
      type: "object",
      additionalProperties: false,
      properties: {
        hook_score: num,
        clarity_score: num,
        pacing_score: num,
        visual_variety: num,
        script_coverage: num,
        emotional_arc: num,
        repetition_penalty: num,
      },
      required: [
        "hook_score",
        "clarity_score",
        "pacing_score",
        "visual_variety",
        "script_coverage",
        "emotional_arc",
        "repetition_penalty",
      ],
    },
    summary: str,
  },
  required: ["scores", "summary"],
};

export const narrationRewriteSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    script: str,
    estimatedDurationSec: num,
    summary: str,
  },
  required: ["script", "estimatedDurationSec", "summary"],
};
