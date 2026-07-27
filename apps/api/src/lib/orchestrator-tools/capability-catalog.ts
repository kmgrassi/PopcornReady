import type { AgentRole } from "@popcorn/shared/domain-agent-contract";

export type ToolExecutionMode = "sync" | "async" | "approval";
export type ToolCostClass = "local" | "model" | "media" | "render";
export type ToolGateMetadata =
  | { kind: "none" }
  | { kind: "approval"; rootOnly: true };

interface ToolCatalogEntry {
  capability: string;
  ownerRole: AgentRole;
  label: string;
  driverDescription: string;
  execution: ToolExecutionMode;
  costClass: ToolCostClass;
  gate: ToolGateMetadata;
  /**
   * "dispatch" marks a root-only turn-boundary tool (delegate_*). Dispatch
   * tools are registered ONLY in the dormant creative-director registry —
   * never in the flat production default registry, driver stubs, flat eval
   * scenario surfaces, or the tool-test batteries (see PRODUCTION_TOOL_NAMES).
   */
  surface?: "dispatch";
  /** Exact compatibility behavior for the existing run projection. */
  runProjection: {
    label: string | null;
    order: number | null;
  };
}

function deepFreeze<T extends object>(value: T): Readonly<T> {
  for (const nested of Object.values(value)) {
    if (typeof nested === "object" && nested !== null && !Object.isFrozen(nested)) {
      deepFreeze(nested);
    }
  }
  return Object.freeze(value);
}

/**
 * Executable ownership and model-adjacent metadata for the current primitive
 * vocabulary. Object insertion order is the legacy driver-vocabulary order.
 * Future dispatch and standalone generation capabilities join in their owning
 * PRs; this catalog does not activate specialist routing.
 */
const toolCapabilityCatalog = {
  create_or_load_brief: {
    capability: "brief_intake",
    ownerRole: "creative_director",
    label: "Concept",
    driverDescription: "Create a new video brief from the prompt or load the active brief.",
    execution: "sync",
    costClass: "local",
    gate: { kind: "none" },
    runProjection: { label: "Concept", order: 0 },
  },
  develop_story_blueprint: {
    capability: "story_blueprint",
    ownerRole: "creative_director",
    label: "Story Structure",
    driverDescription: "Develop a structured story blueprint for the project.",
    execution: "sync",
    costClass: "model",
    gate: { kind: "none" },
    runProjection: { label: "Story Structure", order: 1 },
  },
  draft_script: {
    capability: "script_drafting",
    ownerRole: "creative_director",
    label: "Script",
    driverDescription: "Draft narration, dialogue, and scene copy from the story blueprint.",
    execution: "sync",
    costClass: "model",
    gate: { kind: "none" },
    runProjection: { label: "Script", order: 2 },
  },
  plan_shots: {
    capability: "shot_planning",
    ownerRole: "creative_director",
    label: "Shot Plan",
    driverDescription: "Plan scenes and beats with stable ids from the brief or script.",
    execution: "sync",
    costClass: "model",
    gate: { kind: "none" },
    runProjection: { label: "Shot Plan", order: 3 },
  },
  plan_visual_anchors: {
    capability: "visual_anchor_planning",
    ownerRole: "creative_director",
    label: "Continuity Plan",
    driverDescription:
      "Identify recurring characters, locations, props, and required visual anchors.",
    execution: "sync",
    costClass: "model",
    gate: { kind: "none" },
    runProjection: { label: "Continuity Plan", order: 4 },
  },
  generate_anchor: {
    capability: "visual_anchor_generation",
    ownerRole: "visuals",
    label: "Anchor Images",
    driverDescription:
      "Generate a reusable visual anchor asset for a character, location, or prop.",
    execution: "async",
    costClass: "media",
    gate: { kind: "none" },
    runProjection: { label: "Anchor Images", order: 5 },
  },
  generate_storyboard: {
    capability: "storyboard_generation",
    ownerRole: "visuals",
    label: "Storyboard",
    driverDescription: "Generate storyboard or previsualization assets for planned beats.",
    execution: "async",
    costClass: "media",
    gate: { kind: "none" },
    runProjection: { label: "Storyboard", order: 6 },
  },
  generate_keyframe: {
    capability: "keyframe_generation",
    ownerRole: "visuals",
    label: "Keyframes",
    driverDescription: "Generate a keyframe image for a beat.",
    execution: "async",
    costClass: "media",
    gate: { kind: "none" },
    runProjection: { label: "Keyframes", order: 7 },
  },
  generate_clip: {
    capability: "clip_generation",
    ownerRole: "visuals",
    label: "Clips",
    driverDescription: "Generate a motion clip for a beat.",
    execution: "async",
    costClass: "media",
    gate: { kind: "none" },
    runProjection: { label: "Clips", order: 8 },
  },
  regenerate_image_asset: {
    capability: "image_revision",
    ownerRole: "visuals",
    label: "Image Revisions",
    driverDescription:
      "Regenerate one existing image asset from a replacement prompt, minting a new immutable version and repointing its active selections.",
    execution: "sync",
    costClass: "media",
    gate: { kind: "none" },
    // This tool historically used the stage-label/order fallbacks. Preserve
    // that observable route behavior until a dedicated UI projection change.
    runProjection: { label: null, order: null },
  },
  edit_video_asset: {
    capability: "video_editing",
    ownerRole: "visuals",
    label: "Video Edits",
    driverDescription:
      "Edit existing uploaded footage or a generated clip in place conceptually, producing a new video asset linked to the source.",
    execution: "async",
    costClass: "media",
    gate: { kind: "none" },
    runProjection: { label: "Video Edits", order: 9 },
  },
  generate_audio: {
    capability: "audio_generation",
    ownerRole: "audio",
    label: "Audio",
    driverDescription: "Generate narration, dialogue, music, or sound assets.",
    execution: "async",
    costClass: "media",
    gate: { kind: "none" },
    runProjection: { label: "Audio", order: 10 },
  },
  fit_audio_to_picture: {
    capability: "audio_picture_fit",
    ownerRole: "audio",
    label: "Audio Sync",
    driverDescription: "Fit generated audio to a beat window and persist a sync critique.",
    execution: "sync",
    costClass: "local",
    gate: { kind: "none" },
    runProjection: { label: "Audio Sync", order: 11 },
  },
  assemble_timeline: {
    capability: "timeline_assembly",
    ownerRole: "creative_director",
    label: "Timeline",
    driverDescription: "Assemble available assets into a deterministic timeline.",
    execution: "sync",
    costClass: "model",
    gate: { kind: "none" },
    runProjection: { label: "Timeline", order: 12 },
  },
  critique_timeline: {
    capability: "timeline_critique",
    ownerRole: "creative_director",
    label: "Quality Review",
    driverDescription: "Review the assembled timeline and identify targeted fixes.",
    execution: "sync",
    costClass: "model",
    gate: { kind: "none" },
    runProjection: { label: "Quality Review", order: 13 },
  },
  request_approval: {
    capability: "approval_gate",
    ownerRole: "creative_director",
    label: "Approval",
    driverDescription: "Create a user approval gate before an expensive or user-visible stage.",
    execution: "approval",
    costClass: "local",
    gate: { kind: "approval", rootOnly: true },
    runProjection: { label: "Approval", order: 14 },
  },
  export_video: {
    capability: "video_export",
    ownerRole: "creative_director",
    label: "Final Render",
    driverDescription: "Export the current approved timeline to a video artifact.",
    execution: "async",
    costClass: "render",
    gate: { kind: "none" },
    runProjection: { label: "Final Render", order: 15 },
  },
  publish_to_catalog: {
    capability: "catalog_publication",
    ownerRole: "creative_director",
    label: "Publish",
    driverDescription:
      "Publish a generated image, character, or story to the shared public catalog under the system publisher.",
    execution: "sync",
    costClass: "local",
    gate: { kind: "none" },
    runProjection: { label: "Publish", order: 16 },
  },
  // Turn-boundary dispatch capabilities (specialist-agents PR 6). Appended
  // after the legacy vocabulary so existing displayOrder values are unchanged.
  // Root-only: registered exclusively by createRootToolRegistry (dormant).
  delegate_visuals: {
    capability: "visuals_dispatch",
    ownerRole: "creative_director",
    label: "Visuals Assignment",
    driverDescription:
      "Assign a bounded visual-production task to the persistent Visuals specialist session.",
    execution: "async",
    costClass: "local",
    gate: { kind: "none" },
    surface: "dispatch",
    runProjection: { label: null, order: null },
  },
  delegate_audio: {
    capability: "audio_dispatch",
    ownerRole: "creative_director",
    label: "Audio Assignment",
    driverDescription:
      "Assign a bounded audio-production task to the persistent Audio specialist session.",
    execution: "async",
    costClass: "local",
    gate: { kind: "none" },
    surface: "dispatch",
    runProjection: { label: null, order: null },
  },
} as const satisfies Record<string, ToolCatalogEntry>;

export const TOOL_CAPABILITY_CATALOG = deepFreeze(toolCapabilityCatalog);

export type ToolName = keyof typeof TOOL_CAPABILITY_CATALOG;
export type ToolCapabilityId =
  (typeof TOOL_CAPABILITY_CATALOG)[ToolName]["capability"];

export type ToolCapabilityMetadataFor<Name extends ToolName> = {
  name: Name;
  displayOrder: number;
} & (typeof TOOL_CAPABILITY_CATALOG)[Name];

export type ToolCapabilityMetadata = {
  [Name in ToolName]: ToolCapabilityMetadataFor<Name>;
}[ToolName];

export const TOOL_NAMES = Object.freeze(
  Object.keys(TOOL_CAPABILITY_CATALOG) as ToolName[]
);

const toolNameSet = new Set<string>(TOOL_NAMES);

export function isToolName(value: string): value is ToolName {
  return toolNameSet.has(value);
}

/**
 * Root-only turn-boundary dispatch tools (surface: "dispatch"). They exist in
 * the catalog for typing/metadata but must never appear on a flat production
 * surface: not in the default registry, driver stubs, flat eval scenarios, or
 * the tool-test batteries.
 */
export const DISPATCH_TOOL_NAMES = Object.freeze(
  TOOL_NAMES.filter(
    (name) => (TOOL_CAPABILITY_CATALOG[name] as ToolCatalogEntry).surface === "dispatch"
  )
);

const dispatchToolNameSet = new Set<string>(DISPATCH_TOOL_NAMES);

export function isDispatchToolName(value: string): value is ToolName {
  return dispatchToolNameSet.has(value);
}

/** The flat production vocabulary: every catalog tool except dispatch tools. */
export const PRODUCTION_TOOL_NAMES = Object.freeze(
  TOOL_NAMES.filter((name) => !dispatchToolNameSet.has(name))
);

export function getToolCapability<Name extends ToolName>(
  name: Name
): ToolCapabilityMetadataFor<Name> {
  return {
    name,
    displayOrder: TOOL_NAMES.indexOf(name),
    ...TOOL_CAPABILITY_CATALOG[name],
  } as ToolCapabilityMetadataFor<Name>;
}

export function toolDefinitionMetadata<Name extends ToolName>(
  name: Name
): Pick<
  ToolCapabilityMetadataFor<Name>,
  | "name"
  | "capability"
  | "ownerRole"
  | "label"
  | "displayOrder"
  | "execution"
  | "costClass"
  | "gate"
> {
  const metadata = getToolCapability(name);
  return {
    name: metadata.name,
    capability: metadata.capability,
    ownerRole: metadata.ownerRole,
    label: metadata.label,
    displayOrder: metadata.displayOrder,
    execution: metadata.execution,
    costClass: metadata.costClass,
    gate: metadata.gate,
  } as Pick<
    ToolCapabilityMetadataFor<Name>,
    | "name"
    | "capability"
    | "ownerRole"
    | "label"
    | "displayOrder"
    | "execution"
    | "costClass"
    | "gate"
  >;
}

export function driverToolDefinitionMetadata<Name extends ToolName>(
  name: Name
): Pick<
  ToolCapabilityMetadataFor<Name>,
  | "name"
  | "capability"
  | "ownerRole"
  | "label"
  | "displayOrder"
  | "costClass"
  | "gate"
> & { mode: ToolExecutionMode } {
  const metadata = getToolCapability(name);
  return {
    name: metadata.name,
    capability: metadata.capability,
    ownerRole: metadata.ownerRole,
    label: metadata.label,
    displayOrder: metadata.displayOrder,
    costClass: metadata.costClass,
    gate: metadata.gate,
    mode: metadata.execution,
  } as Pick<
    ToolCapabilityMetadataFor<Name>,
    | "name"
    | "capability"
    | "ownerRole"
    | "label"
    | "displayOrder"
    | "costClass"
    | "gate"
  > & { mode: ToolExecutionMode };
}

export interface ToolOwnershipClaim {
  name: string;
  ownerRole?: AgentRole;
}

const agentRoles = new Set<AgentRole>(["creative_director", "visuals", "audio"]);

export function assertExactlyOneToolOwner(claims: readonly ToolOwnershipClaim[]): void {
  const counts = new Map<ToolName, number>();
  for (const claim of claims) {
    if (!isToolName(claim.name)) {
      throw new Error(`Unknown tool ownership claim: ${claim.name}`);
    }
    if (!claim.ownerRole || !agentRoles.has(claim.ownerRole)) {
      throw new Error(`Tool has no valid owner: ${claim.name}`);
    }
    counts.set(claim.name, (counts.get(claim.name) ?? 0) + 1);
  }

  for (const name of TOOL_NAMES) {
    const count = counts.get(name) ?? 0;
    if (count !== 1) {
      throw new Error(`Tool must have exactly one owner: ${name} has ${count}`);
    }
  }
}

export function assertToolDefinitionMetadata(
  definition: {
    name: ToolName;
    capability: ToolCapabilityId;
    ownerRole: AgentRole;
    label: string;
    displayOrder: number;
    execution: ToolExecutionMode;
    costClass: ToolCostClass;
    gate: ToolGateMetadata;
  }
): void {
  const expected = getToolCapability(definition.name);
  const scalarKeys = [
    "capability",
    "ownerRole",
    "label",
    "displayOrder",
    "execution",
    "costClass",
  ] as const;
  for (const key of scalarKeys) {
    if (definition[key] !== expected[key]) {
      throw new Error(`Tool metadata mismatch for ${definition.name}: ${key}`);
    }
  }
  if (JSON.stringify(definition.gate) !== JSON.stringify(expected.gate)) {
    throw new Error(`Tool metadata mismatch for ${definition.name}: gate`);
  }

  const approvalInvariant =
    definition.execution === "approval" && definition.gate.kind === "approval";
  const noGateInvariant =
    definition.execution !== "approval" && definition.gate.kind === "none";
  if (!approvalInvariant && !noGateInvariant) {
    throw new Error(`Tool gate/execution invariant failed for ${definition.name}`);
  }
}

export function assertDriverToolDefinitionMetadata(definition: {
  name: ToolName;
  capability: ToolCapabilityId;
  ownerRole: AgentRole;
  label: string;
  displayOrder: number;
  mode: ToolExecutionMode;
  costClass: ToolCostClass;
  gate: ToolGateMetadata;
}): void {
  const expected = getToolCapability(definition.name);
  const scalarPairs = [
    ["capability", definition.capability, expected.capability],
    ["ownerRole", definition.ownerRole, expected.ownerRole],
    ["label", definition.label, expected.label],
    ["displayOrder", definition.displayOrder, expected.displayOrder],
    ["mode", definition.mode, expected.execution],
    ["costClass", definition.costClass, expected.costClass],
  ] as const;
  for (const [key, actual, catalogValue] of scalarPairs) {
    if (actual !== catalogValue) {
      throw new Error(`Driver tool metadata mismatch for ${definition.name}: ${key}`);
    }
  }
  if (JSON.stringify(definition.gate) !== JSON.stringify(expected.gate)) {
    throw new Error(`Driver tool metadata mismatch for ${definition.name}: gate`);
  }
}
