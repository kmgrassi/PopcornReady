// Transition as a first-class asset.
//
// A transition joins two consecutive beats' clips. It is its own asset
// (`kind='transition'`, `media='data'`): the typed `content` below is the spec,
// its boundary identity is the selection slot `transition:${fromBeatId}` (the
// outgoing beat owns its trailing transition), and it links to the from/to clip
// assets via `asset_edges` (role `from` / `to`). An empty slot renders as a hard
// cut, so most boundaries need no asset at all — see
// docs/scopes/transitions-as-assets.md.
//
// This resurrects the shape of the retired `EditGraph.TransitionDecision`
// (deleted with the legacy edit-graph in PR #605) as a graph-native asset.

export const TRANSITION_SCHEMA_VERSION = "transition.v1" as const;

/** How the transition is realized at render time. */
export type TransitionMethod =
  // A render-time effect over the two existing clips (crossfade/dissolve/cut…).
  // No new media; the renderer overlaps/fades clip[i] and clip[i+1].
  | "effect"
  // A generated bridge video inserted between the clips. The transition asset
  // gains a child `kind='clip'` asset conditioned on the endpoint frames.
  | "generated_clip";

/** The visual/edit grammar of the cut. */
export type TransitionType =
  | "hard_cut"
  | "jump_cut"
  | "match_cut"
  | "smash_cut"
  | "crossfade"
  | "dissolve"
  | "wipe"
  | "fade_to_black"
  | "scene_change"
  | "hidden_cut";

/** Why the agent chose this transition — surfaced to the user, editable. */
export type TransitionReason =
  | "sentence_boundary"
  | "beat_change"
  | "scene_change"
  | "visual_match"
  | "music_downbeat"
  | "motion_continuity"
  | "emotional_shift"
  | "remove_dead_air"
  | "hide_jump_cut";

/** A ranked alternative the agent considered (the slot holds the chosen one). */
export interface TransitionAlternative {
  type: TransitionType;
  method: TransitionMethod;
  durationMs: number;
  score: number;
}

/**
 * The typed `content` payload of a `kind='transition'` asset.
 *
 * The store wraps this under the {@link TRANSITION_SCHEMA_VERSION} marker
 * (`schema_version`) on write and strips it on read — the convention shared by
 * every data-asset payload (e.g. `VideoBrief`) — so the marker is not a field
 * here.
 */
export interface TransitionContent {
  method: TransitionMethod;
  type: TransitionType;
  /** Effect duration (or generated-bridge length) in milliseconds. */
  durationMs: number;
  /** Type-specific knobs (fade color, easing, wipe direction, provider params…). */
  params: Record<string, unknown>;
  reason: TransitionReason;
  /** Agent confidence in the choice, 0–1. */
  confidence: number;
  alternatives?: TransitionAlternative[];
}

/** Slot-role family for a boundary's active transition (from-beat owns it). */
export function transitionSlotRole(fromBeatId: string): string {
  return `transition:${fromBeatId}`;
}

/** Parse a transition slot role back to its owning (from) beat id, or null. */
export function fromBeatIdOfTransitionSlot(slotRole: string): string | null {
  const prefix = "transition:";
  return slotRole.startsWith(prefix) ? slotRole.slice(prefix.length) : null;
}

/** A boundary between two consecutive beats. The from-beat owns its transition. */
export interface BeatBoundary {
  fromBeatId: string;
  toBeatId: string;
}

/**
 * Derive boundaries from beat order — every consecutive pair. Boundaries come
 * from the spine, not from which transitions happen to exist, so an empty
 * boundary (no transition asset = hard cut) stays addressable.
 */
export function beatBoundaries(orderedBeatIds: string[]): BeatBoundary[] {
  const boundaries: BeatBoundary[] = [];
  for (let i = 0; i < orderedBeatIds.length - 1; i += 1) {
    boundaries.push({ fromBeatId: orderedBeatIds[i], toBeatId: orderedBeatIds[i + 1] });
  }
  return boundaries;
}
