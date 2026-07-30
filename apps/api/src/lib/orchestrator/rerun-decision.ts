import type { RerunTarget } from "@popcorn/shared/rerun-proposal";
import { ApiError } from "@/core/errors";

export type ProposedWorkItem = {
  owner: "creative_director" | "visuals" | "audio";
  kind:
    | "revise_story"
    | "reassemble_cut"
    | "critique_cut"
    | "revise_visuals"
    | "revise_audio";
  targets: RerunTarget[];
  requiredOutputs: Array<{
    target: RerunTarget;
    kind: string;
    role: string;
    ordinal: number;
  }>;
};

interface DecisionBase {
  preservedAssetIds: string[];
  rationale: string;
  userFacingSummary: string;
  checklist: Array<{
    target: RerunTarget;
    decision: "change" | "preserve" | "clarify";
    reason: string;
  }>;
}

export type RerunModelDecision =
  | (DecisionBase & { outcome: "no_op"; selectedWork: [] })
  | (DecisionBase & {
      outcome: "ask_clarification";
      selectedWork: [];
      clarification: {
        question: string;
        targets: RerunTarget[];
        options: Array<{ id: string; label: string; tradeoff: string }>;
      };
    })
  | (DecisionBase & {
      outcome: "revision";
      selectedWork: [ProposedWorkItem, ...ProposedWorkItem[]];
    });

const TARGET_KINDS = new Set([
  "project",
  "storyboard",
  "scene",
  "beat",
  "panel",
  "asset",
  "lineage",
  "timeline_item",
  "export",
  "selection",
  "transcript_segment",
]);
const TOP_LEVEL_KEYS = new Set([
  "outcome",
  "selectedWork",
  "preservedAssetIds",
  "rationale",
  "userFacingSummary",
  "checklist",
  "clarification",
]);
const FORBIDDEN_POLICY_KEYS = new Set([
  "requiresApproval",
  "estimate",
  "estimatedCostUsd",
  "costUsd",
  "maxCostUsd",
  "risk",
  "pins",
  "plannedSelectionMoves",
  "plannedStoryPointerMoves",
  "bindingId",
  "workItemId",
  "answerFingerprint",
]);

function fail(message: string): never {
  throw new ApiError("validation_failed", `Invalid rerun decision: ${message}`);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, name: string) {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_POLICY_KEYS.has(key)) fail(`${name} cannot author server policy field ${key}.`);
    if (!allowed.has(key)) fail(`${name} contains unsupported field ${key}.`);
  }
}

function text(value: unknown, name: string, max = 2_000): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    fail(`${name} must be a non-empty string of at most ${max} characters.`);
  }
  return value.trim();
}

function integer(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 100) {
    fail(`${name} must be an integer between 0 and 100.`);
  }
  return value as number;
}

function stringArray(value: unknown, name: string, max = 100): string[] {
  if (!Array.isArray(value) || value.length > max) fail(`${name} must be a bounded array.`);
  return value.map((entry, index) => text(entry, `${name}[${index}]`, 200));
}

export function parseRerunTarget(value: unknown, name = "target"): RerunTarget {
  const input = record(value, name);
  const kind = text(input.kind, `${name}.kind`, 40);
  if (!TARGET_KINDS.has(kind)) fail(`${name}.kind is unsupported.`);
  const projectId = text(input.projectId, `${name}.projectId`, 200);
  const allowed = new Set(["kind", "projectId"]);
  const requiredKey: Record<string, string | undefined> = {
    storyboard: "storyboardId",
    scene: "sceneId",
    beat: "beatId",
    panel: "panelId",
    asset: "assetId",
    lineage: "lineageId",
    timeline_item: "timelineItemId",
    export: "exportId",
    transcript_segment: "transcriptSegmentId",
  };
  const key = requiredKey[kind];
  if (key) {
    allowed.add(key);
    text(input[key], `${name}.${key}`, 200);
  }
  if (kind === "selection") {
    allowed.add("slotOwnerLineageId");
    allowed.add("slotRole");
    if (input.slotOwnerLineageId !== null) {
      text(input.slotOwnerLineageId, `${name}.slotOwnerLineageId`, 200);
    }
    text(input.slotRole, `${name}.slotRole`, 200);
  }
  exactKeys(input, allowed, name);
  return { ...input, kind, projectId } as RerunTarget;
}

function parseWorkItem(value: unknown, index: number): ProposedWorkItem {
  const name = `selectedWork[${index}]`;
  const input = record(value, name);
  exactKeys(input, new Set(["owner", "kind", "targets", "requiredOutputs"]), name);
  const owner = text(input.owner, `${name}.owner`, 40);
  const kind = text(input.kind, `${name}.kind`, 40);
  const valid =
    (owner === "creative_director" &&
      ["revise_story", "reassemble_cut", "critique_cut"].includes(kind)) ||
    (owner === "visuals" && kind === "revise_visuals") ||
    (owner === "audio" && kind === "revise_audio");
  if (!valid) fail(`${name} owner/kind combination is not allowed.`);
  if (!Array.isArray(input.targets) || input.targets.length === 0 || input.targets.length > 50) {
    fail(`${name}.targets must contain between 1 and 50 targets.`);
  }
  if (!Array.isArray(input.requiredOutputs) ||
      input.requiredOutputs.length === 0 ||
      input.requiredOutputs.length > 50) {
    fail(`${name}.requiredOutputs must contain between 1 and 50 outputs.`);
  }
  const requiredOutputs = input.requiredOutputs.map((raw, outputIndex) => {
    const outputName = `${name}.requiredOutputs[${outputIndex}]`;
    const output = record(raw, outputName);
    exactKeys(output, new Set(["target", "kind", "role", "ordinal"]), outputName);
    return {
      target: parseRerunTarget(output.target, `${outputName}.target`),
      kind: text(output.kind, `${outputName}.kind`, 80),
      role: text(output.role, `${outputName}.role`, 120),
      ordinal: integer(output.ordinal, `${outputName}.ordinal`),
    };
  });
  return {
    owner: owner as ProposedWorkItem["owner"],
    kind: kind as ProposedWorkItem["kind"],
    targets: input.targets.map((target, targetIndex) =>
      parseRerunTarget(target, `${name}.targets[${targetIndex}]`)
    ),
    requiredOutputs,
  };
}

export function parseRerunModelDecision(value: unknown): RerunModelDecision {
  const input = record(value, "decision");
  exactKeys(input, TOP_LEVEL_KEYS, "decision");
  const outcome = text(input.outcome, "decision.outcome", 40);
  if (!["no_op", "ask_clarification", "revision"].includes(outcome)) {
    fail("outcome must be no_op, ask_clarification, or revision.");
  }
  if (!Array.isArray(input.selectedWork) || input.selectedWork.length > 20) {
    fail("selectedWork must be a bounded array.");
  }
  const selectedWork = input.selectedWork.map(parseWorkItem);
  const checklistRaw = input.checklist;
  if (!Array.isArray(checklistRaw) || checklistRaw.length > 100) {
    fail("checklist must be a bounded array.");
  }
  const base: DecisionBase = {
    preservedAssetIds: stringArray(input.preservedAssetIds, "decision.preservedAssetIds"),
    rationale: text(input.rationale, "decision.rationale"),
    userFacingSummary: text(input.userFacingSummary, "decision.userFacingSummary"),
    checklist: checklistRaw.map((raw, index) => {
      const name = `decision.checklist[${index}]`;
      const item = record(raw, name);
      exactKeys(item, new Set(["target", "decision", "reason"]), name);
      const decision = text(item.decision, `${name}.decision`, 20);
      if (!["change", "preserve", "clarify"].includes(decision)) {
        fail(`${name}.decision is invalid.`);
      }
      return {
        target: parseRerunTarget(item.target, `${name}.target`),
        decision: decision as "change" | "preserve" | "clarify",
        reason: text(item.reason, `${name}.reason`, 500),
      };
    }),
  };
  if (outcome === "no_op") {
    if (selectedWork.length > 0) fail("no_op cannot contain work.");
    if (input.clarification !== undefined) fail("no_op cannot contain clarification.");
    if (base.checklist.some((item) => item.decision !== "preserve")) {
      fail("no_op checklist entries must all preserve their targets.");
    }
    return { ...base, outcome, selectedWork: [] };
  }
  if (outcome === "ask_clarification") {
    if (selectedWork.length > 0) fail("ask_clarification cannot contain work.");
    const clarification = record(input.clarification, "decision.clarification");
    exactKeys(
      clarification,
      new Set(["question", "targets", "options"]),
      "decision.clarification"
    );
    if (!Array.isArray(clarification.targets) || clarification.targets.length === 0) {
      fail("clarification must name at least one target.");
    }
    if (!Array.isArray(clarification.options) || clarification.options.length < 2 ||
        clarification.options.length > 5) {
      fail("clarification must contain between 2 and 5 options.");
    }
    return {
      ...base,
      outcome,
      selectedWork: [],
      clarification: {
        question: text(clarification.question, "decision.clarification.question", 500),
        targets: clarification.targets.map((target, index) =>
          parseRerunTarget(target, `decision.clarification.targets[${index}]`)
        ),
        options: clarification.options.map((raw, index) => {
          const option = record(raw, `decision.clarification.options[${index}]`);
          exactKeys(option, new Set(["id", "label", "tradeoff"]), `clarification option ${index}`);
          return {
            id: text(option.id, `clarification option ${index}.id`, 100),
            label: text(option.label, `clarification option ${index}.label`, 200),
            tradeoff: text(option.tradeoff, `clarification option ${index}.tradeoff`, 500),
          };
        }),
      },
    };
  }
  if (selectedWork.length === 0) fail("revision must contain at least one work item.");
  if (input.clarification !== undefined) fail("revision cannot contain clarification.");
  return {
    ...base,
    outcome: "revision",
    selectedWork: selectedWork as [ProposedWorkItem, ...ProposedWorkItem[]],
  };
}

const TARGET_JSON_SCHEMA = {
  type: "object",
  additionalProperties: true,
  required: ["kind", "projectId"],
  properties: {
    kind: { enum: [...TARGET_KINDS] },
    projectId: { type: "string" },
    storyboardId: { type: "string" },
    sceneId: { type: "string" },
    beatId: { type: "string" },
    panelId: { type: "string" },
    assetId: { type: "string" },
    lineageId: { type: "string" },
    timelineItemId: { type: "string" },
    exportId: { type: "string" },
    slotOwnerLineageId: { type: ["string", "null"] },
    slotRole: { type: "string" },
    transcriptSegmentId: { type: "string" },
  },
} as const;

const CHECKLIST_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["target", "decision", "reason"],
  properties: {
    target: TARGET_JSON_SCHEMA,
    decision: { enum: ["change", "preserve", "clarify"] },
    reason: { type: "string" },
  },
} as const;

const REQUIRED_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["target", "kind", "role", "ordinal"],
  properties: {
    target: TARGET_JSON_SCHEMA,
    kind: { type: "string" },
    role: { type: "string" },
    ordinal: { type: "integer", minimum: 0, maximum: 100 },
  },
} as const;

const WORK_ITEM_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["owner", "kind", "targets", "requiredOutputs"],
  properties: {
    owner: { enum: ["creative_director", "visuals", "audio"] },
    kind: {
      enum: [
        "revise_story",
        "reassemble_cut",
        "critique_cut",
        "revise_visuals",
        "revise_audio",
      ],
    },
    targets: {
      type: "array",
      minItems: 1,
      maxItems: 50,
      items: TARGET_JSON_SCHEMA,
    },
    requiredOutputs: {
      type: "array",
      minItems: 1,
      maxItems: 50,
      items: REQUIRED_OUTPUT_JSON_SCHEMA,
    },
  },
} as const;

export const RERUN_DECISION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "outcome",
    "selectedWork",
    "preservedAssetIds",
    "rationale",
    "userFacingSummary",
    "checklist",
  ],
  properties: {
    outcome: { enum: ["no_op", "ask_clarification", "revision"] },
    selectedWork: { type: "array", maxItems: 20, items: WORK_ITEM_JSON_SCHEMA },
    preservedAssetIds: { type: "array", maxItems: 100, items: { type: "string" } },
    rationale: { type: "string" },
    userFacingSummary: { type: "string" },
    checklist: { type: "array", maxItems: 100, items: CHECKLIST_JSON_SCHEMA },
    clarification: {
      type: "object",
      additionalProperties: false,
      required: ["question", "targets", "options"],
      properties: {
        question: { type: "string" },
        targets: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: TARGET_JSON_SCHEMA,
        },
        options: {
          type: "array",
          minItems: 2,
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "label", "tradeoff"],
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              tradeoff: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;
