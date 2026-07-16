// Specialist-agent orchestration PR 7 — stable target scope and graph closure.
//
// These guards are deliberately independent from the PR 5/6 store lifecycle.
// The lifecycle service calls them in its transaction immediately before an
// asset, edge, or selection write.  They fail closed: a domain run can only
// inspect or mutate IDs the server derived from its typed DomainTask.v1.

import type {
  DomainOutputKind,
  DomainPreserveSet,
  DomainTarget,
} from "@popcorn/shared/domain-agent-contract";

import type {
  ProjectGraphSnapshot,
  SnapshotAsset,
  SnapshotSelection,
} from "./graph-snapshot";

const MAX_TARGETS = 32;
const MAX_REFERENCED_IDS = 128;
const TARGET_ID_MAX_LENGTH = 128;

type TargetKind = DomainTarget["kind"];

export interface ScopedSelectionAppend {
  slotOwnerLineageId: string | null;
  slotRole: string;
  activeAssetId: string;
  expectedSeq?: number;
}

export interface ScopedAssetMint {
  outputKind: DomainOutputKind;
  inputAssetIds: readonly string[];
  target?: DomainTarget;
}

export interface ScopedAssetEdge {
  fromAssetId: string;
  toAssetId: string;
  /** Only the freshly minted output of this same guarded write may be new. */
  fromIsNewOutput?: boolean;
}

export interface DomainTargetScope {
  readonly projectId: string;
  readonly targets: readonly DomainTarget[];
  /** A project target permits broad reads, never an implicit selection write. */
  readonly hasProjectTarget: boolean;
  /** Existing asset IDs in the authorized graph closure. */
  readonly authorizedAssetIds: ReadonlySet<string>;
  readonly authorizedLineageIds: ReadonlySet<string>;
  readonly authorizedTargetKeys: ReadonlySet<string>;
  readonly currentSelections: readonly SnapshotSelection[];
}

function targetKey(target: DomainTarget): string {
  switch (target.kind) {
    case "project":
      return `project:${target.projectId}`;
    case "storyboard":
      return `storyboard:${target.storyboardId}`;
    case "scene":
      return `scene:${target.sceneId}`;
    case "beat":
      return `beat:${target.beatId}`;
    case "panel":
      return `panel:${target.panelId}`;
    case "asset":
      return `asset:${target.assetId}`;
    case "lineage":
      return `lineage:${target.lineageId}`;
    case "timeline_item":
      return `timeline_item:${target.timelineItemId}`;
    case "export":
      return `export:${target.exportId}`;
  }
}

function targetId(target: DomainTarget): string {
  switch (target.kind) {
    case "project":
      return target.projectId;
    case "storyboard":
      return target.storyboardId;
    case "scene":
      return target.sceneId;
    case "beat":
      return target.beatId;
    case "panel":
      return target.panelId;
    case "asset":
      return target.assetId;
    case "lineage":
      return target.lineageId;
    case "timeline_item":
      return target.timelineItemId;
    case "export":
      return target.exportId;
  }
}

function validId(value: string): boolean {
  return value.length > 0 && value.length <= TARGET_ID_MAX_LENGTH && !/[\r\n]/.test(value);
}

function canonicalTarget(target: DomainTarget, projectId: string): DomainTarget {
  if (target.projectId !== projectId || !validId(targetId(target))) {
    throw new Error("Domain target is outside the authorized project.");
  }
  return target;
}

function addAsset(assetIds: Set<string>, asset: SnapshotAsset | undefined): void {
  if (asset) assetIds.add(asset.id);
}

function assetIdsForTarget(
  snapshot: ProjectGraphSnapshot,
  target: DomainTarget,
  assetById: ReadonlyMap<string, SnapshotAsset>
): string[] {
  switch (target.kind) {
    case "project":
      return snapshot.assets.map((asset) => asset.id);
    case "asset":
      if (!assetById.has(target.assetId)) throw new Error("Domain target asset is not in the project.");
      return [target.assetId];
    case "lineage": {
      const assets = snapshot.assets
        .filter((asset) => asset.lineageId === target.lineageId)
        .map((asset) => asset.id);
      if (!assets.length) throw new Error("Domain target lineage is not in the project.");
      return assets;
    }
    case "storyboard": {
      const storyboard = snapshot.storyboards.find((row) => row.id === target.storyboardId);
      if (!storyboard) throw new Error("Domain target storyboard is not in the project.");
      const ids = [storyboard.planAssetId];
      for (const scene of snapshot.scenes.filter((row) => row.storyboardId === storyboard.id)) {
        ids.push(scene.sceneAssetId);
        for (const beat of snapshot.beats.filter((row) => row.sceneId === scene.id)) {
          ids.push(beat.beatAssetId);
          for (const panel of snapshot.panels.filter((row) => row.beatId === beat.id)) {
            ids.push(panel.imageAssetId, panel.promptAssetId);
          }
        }
      }
      return ids.filter((id): id is string => Boolean(id));
    }
    case "scene": {
      const scene = snapshot.scenes.find((row) => row.id === target.sceneId);
      if (!scene) throw new Error("Domain target scene is not in the project.");
      const ids = [scene.sceneAssetId];
      for (const beat of snapshot.beats.filter((row) => row.sceneId === scene.id)) {
        ids.push(beat.beatAssetId);
        for (const panel of snapshot.panels.filter((row) => row.beatId === beat.id)) {
          ids.push(panel.imageAssetId, panel.promptAssetId);
        }
      }
      return ids.filter((id): id is string => Boolean(id));
    }
    case "beat": {
      const beat = snapshot.beats.find((row) => row.id === target.beatId);
      if (!beat) throw new Error("Domain target beat is not in the project.");
      const ids = [beat.beatAssetId];
      for (const panel of snapshot.panels.filter((row) => row.beatId === beat.id)) {
        ids.push(panel.imageAssetId, panel.promptAssetId);
      }
      return ids.filter((id): id is string => Boolean(id));
    }
    case "panel": {
      const panel = snapshot.panels.find((row) => row.id === target.panelId);
      if (!panel) throw new Error("Domain target panel is not in the project.");
      return [panel.imageAssetId, panel.promptAssetId].filter((id): id is string => Boolean(id));
    }
    // Timeline and export rows are not modeled by this PR's snapshot. They are
    // still stable, project-scoped targets but do not authorize arbitrary assets.
    case "timeline_item":
    case "export":
      return [];
  }
}

/**
 * Build the graph closure available to one task.  The closure includes every
 * explicitly targeted asset, all immutable lineage versions, and transitive
 * input provenance.  It never reaches into another project, and it never
 * treats a free-form model string as authority.
 */
export function buildDomainTargetScope(input: {
  snapshot: ProjectGraphSnapshot;
  targets: readonly DomainTarget[];
  candidateAffectedAssetIds?: readonly string[];
}): DomainTargetScope {
  const { snapshot } = input;
  if (!snapshot.projectId || !snapshot.workspaceId) {
    throw new Error("A target scope requires an authorized project snapshot.");
  }
  if (!input.targets.length || input.targets.length > MAX_TARGETS) {
    throw new Error("A domain task must contain between one and thirty-two stable targets.");
  }

  const targets: DomainTarget[] = [];
  const targetKeys = new Set<string>();
  for (const raw of input.targets) {
    const target = canonicalTarget(raw, snapshot.projectId);
    const key = targetKey(target);
    if (!targetKeys.has(key)) {
      targetKeys.add(key);
      targets.push(target);
    }
  }

  const assetById = new Map(snapshot.assets.map((asset) => [asset.id, asset]));
  const authorizedAssetIds = new Set<string>();
  for (const target of targets) {
    for (const assetId of assetIdsForTarget(snapshot, target, assetById)) {
      addAsset(authorizedAssetIds, assetById.get(assetId));
    }
  }

  for (const assetId of input.candidateAffectedAssetIds ?? []) {
    if (!assetById.has(assetId)) {
      throw new Error("Candidate affected asset is not in the project.");
    }
    authorizedAssetIds.add(assetId);
  }

  // Versions of an authorized lineage are safe immutable alternatives, and all
  // provenance inputs are necessary to understand or validate the target.
  let changed = true;
  while (changed) {
    changed = false;
    for (const asset of snapshot.assets) {
      if (authorizedAssetIds.has(asset.id)) {
        for (const inputAsset of asset.inputs) {
          if (assetById.has(inputAsset.assetId) && !authorizedAssetIds.has(inputAsset.assetId)) {
            authorizedAssetIds.add(inputAsset.assetId);
            changed = true;
          }
        }
      }
      if ([...authorizedAssetIds].some((id) => assetById.get(id)?.lineageId === asset.lineageId)) {
        if (!authorizedAssetIds.has(asset.id)) {
          authorizedAssetIds.add(asset.id);
          changed = true;
        }
      }
    }
  }

  // A project target is broad read authority for this project, not a blank
  // check for arbitrary IDs. Teach the scope every concrete relational target
  // currently in this authorized snapshot.
  if (targets.some((target) => target.kind === "project")) {
    for (const asset of snapshot.assets) {
      targetKeys.add(targetKey({ kind: "asset", projectId: snapshot.projectId, assetId: asset.id }));
      targetKeys.add(targetKey({ kind: "lineage", projectId: snapshot.projectId, lineageId: asset.lineageId }));
    }
    for (const storyboard of snapshot.storyboards) {
      targetKeys.add(targetKey({ kind: "storyboard", projectId: snapshot.projectId, storyboardId: storyboard.id }));
    }
    for (const scene of snapshot.scenes) {
      targetKeys.add(targetKey({ kind: "scene", projectId: snapshot.projectId, sceneId: scene.id }));
    }
    for (const beat of snapshot.beats) {
      targetKeys.add(targetKey({ kind: "beat", projectId: snapshot.projectId, beatId: beat.id }));
    }
    for (const panel of snapshot.panels) {
      targetKeys.add(targetKey({ kind: "panel", projectId: snapshot.projectId, panelId: panel.id }));
    }
  }

  return {
    projectId: snapshot.projectId,
    targets,
    hasProjectTarget: targets.some((target) => target.kind === "project"),
    authorizedAssetIds,
    authorizedLineageIds: new Set(
      [...authorizedAssetIds].flatMap((id) => {
        const lineageId = assetById.get(id)?.lineageId;
        return lineageId ? [lineageId] : [];
      })
    ),
    authorizedTargetKeys: targetKeys,
    currentSelections: snapshot.selections,
  };
}

export function isAssetInTargetScope(scope: DomainTargetScope, assetId: string): boolean {
  return scope.authorizedAssetIds.has(assetId);
}

function assertProject(scope: DomainTargetScope, projectId: unknown): void {
  if (projectId !== undefined && projectId !== scope.projectId) {
    throw new Error("Primitive input project does not match the run target scope.");
  }
}

function targetFromPrimitiveField(
  field: string,
  value: string,
  projectId: string
): DomainTarget | undefined {
  switch (field) {
    case "storyboardId": return { kind: "storyboard", projectId, storyboardId: value };
    case "sceneId": return { kind: "scene", projectId, sceneId: value };
    case "beatId": return { kind: "beat", projectId, beatId: value };
    case "panelId": return { kind: "panel", projectId, panelId: value };
    case "assetId":
    case "sourceAssetId":
    case "audioAssetId": return { kind: "asset", projectId, assetId: value };
    case "lineageId": return { kind: "lineage", projectId, lineageId: value };
    case "timelineItemId": return { kind: "timeline_item", projectId, timelineItemId: value };
    case "exportId": return { kind: "export", projectId, exportId: value };
    default: return undefined;
  }
}

function assertTarget(scope: DomainTargetScope, target: DomainTarget): void {
  if (target.projectId !== scope.projectId || !validId(targetId(target))) {
    throw new Error("Primitive input contains an invalid or foreign stable target.");
  }
  if (target.kind === "asset" && isAssetInTargetScope(scope, target.assetId)) return;
  if (target.kind === "lineage" && scope.authorizedLineageIds.has(target.lineageId)) return;
  if (!scope.authorizedTargetKeys.has(targetKey(target))) {
    throw new Error("Primitive input target is outside the run task's stable targets.");
  }
}

/**
 * Validate only canonical ID-bearing primitive fields. Prompt text and provider
 * payloads are intentionally never parsed as authority.  Call this after the
 * tool parser and before any persistence or provider request.
 */
export function assertScopedPrimitiveInput(
  scope: DomainTargetScope,
  input: Record<string, unknown>
): void {
  assertProject(scope, input.projectId);
  const singular = [
    "storyboardId", "sceneId", "beatId", "panelId", "assetId", "sourceAssetId", "audioAssetId",
    "lineageId", "timelineItemId", "exportId",
  ];
  for (const field of singular) {
    const value = input[field];
    if (value === undefined) continue;
    if (typeof value !== "string") throw new Error(`Primitive ${field} must be a stable ID.`);
    const target = targetFromPrimitiveField(field, value, scope.projectId);
    if (target) assertTarget(scope, target);
  }
  for (const [field, kind] of [["assetIds", "asset"], ["sourceAssetIds", "asset"], ["beatIds", "beat"], ["panelIds", "panel"], ["timelineItemIds", "timeline_item"]] as const) {
    const values = input[field];
    if (values === undefined) continue;
    if (!Array.isArray(values) || values.length > MAX_REFERENCED_IDS) {
      throw new Error(`Primitive ${field} must be a bounded stable-ID list.`);
    }
    for (const value of values) {
      if (typeof value !== "string") throw new Error(`Primitive ${field} must contain stable IDs.`);
      const target = kind === "asset"
        ? { kind, projectId: scope.projectId, assetId: value } as DomainTarget
        : kind === "beat"
          ? { kind, projectId: scope.projectId, beatId: value } as DomainTarget
          : kind === "panel"
            ? { kind, projectId: scope.projectId, panelId: value } as DomainTarget
            : { kind, projectId: scope.projectId, timelineItemId: value } as DomainTarget;
      assertTarget(scope, target);
    }
  }
}

export function assertScopedAssetMint(
  scope: DomainTargetScope,
  input: ScopedAssetMint,
  allowedOutputKinds: readonly DomainOutputKind[]
): void {
  if (!input.outputKind) throw new Error("A minted asset requires an allowed output kind.");
  if (!allowedOutputKinds.includes(input.outputKind)) {
    throw new Error("Minted asset kind is not allowed by the run task.");
  }
  if (input.inputAssetIds.length > MAX_REFERENCED_IDS) {
    throw new Error("A minted asset cannot exceed the graph-closure input limit.");
  }
  for (const assetId of input.inputAssetIds) {
    if (!isAssetInTargetScope(scope, assetId)) {
      throw new Error("Minted asset input is outside the authorized graph closure.");
    }
  }
  if (input.target) assertTarget(scope, input.target);
}

export function assertScopedAssetEdge(scope: DomainTargetScope, edge: ScopedAssetEdge): void {
  if (!isAssetInTargetScope(scope, edge.toAssetId)) {
    throw new Error("Asset edge input is outside the authorized graph closure.");
  }
  // `fromAssetId` may be a just-minted output not present in the read snapshot.
  if (scope.authorizedAssetIds.has(edge.fromAssetId)) return;
  if (edge.fromIsNewOutput && validId(edge.fromAssetId)) return;
  throw new Error("Asset edge output is outside the authorized graph closure.");
}

function hasExplicitSelectionTarget(scope: DomainTargetScope, append: ScopedSelectionAppend): boolean {
  if (scope.targets.every((target) => target.kind === "project")) return false;
  if (append.slotOwnerLineageId && scope.authorizedLineageIds.has(append.slotOwnerLineageId)) {
    return true;
  }
  return scope.targets.some((target) => target.kind === "asset" || target.kind === "lineage" || target.kind === "panel" || target.kind === "beat");
}

export function assertScopedSelectionAppend(
  scope: DomainTargetScope,
  append: ScopedSelectionAppend
): void {
  if (!append.slotRole || !validId(append.activeAssetId)) {
    throw new Error("Selection append requires a stable asset and slot role.");
  }
  if (!isAssetInTargetScope(scope, append.activeAssetId)) {
    throw new Error("Selection asset is outside the authorized graph closure.");
  }
  if (!hasExplicitSelectionTarget(scope, append)) {
    throw new Error("Project-wide work cannot append a selection without a stable target.");
  }
  const current = scope.currentSelections.find(
    (selection) => selection.slotRole === append.slotRole && selection.slotOwnerLineageId === append.slotOwnerLineageId
  );
  if (append.expectedSeq !== undefined && current?.seq !== append.expectedSeq) {
    throw new Error("Selection pin is stale; reload the current graph before appending.");
  }
}

/** Verify the task's preserve pins against the fresh graph before a write. */
export function assertPreservePinsCurrent(
  scope: DomainTargetScope,
  snapshot: ProjectGraphSnapshot,
  preserve: DomainPreserveSet
): void {
  const assetById = new Map(snapshot.assets.map((asset) => [asset.id, asset]));
  for (const pin of preserve.fingerprints) {
    const asset = assetById.get(pin.assetId);
    if (!asset || asset.contentHash !== pin.value || !isAssetInTargetScope(scope, pin.assetId)) {
      throw new Error("Asset fingerprint pin is stale or outside the authorized graph closure.");
    }
  }
  for (const pin of preserve.selections) {
    const selection = snapshot.selections.find(
      (candidate) =>
        candidate.slotRole === pin.slotRole &&
        (candidate.slotOwnerLineageId ?? candidate.slotRole) === pin.slotKey &&
        candidate.activeAssetId === pin.activeAssetId
    );
    if (!selection || (pin.sequence !== undefined && selection.seq !== pin.sequence)) {
      throw new Error("Selection pin is stale; reload the current graph before writing.");
    }
  }
}
