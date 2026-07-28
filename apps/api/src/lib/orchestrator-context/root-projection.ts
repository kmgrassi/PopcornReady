// Specialist-agent orchestration PR 7 — root graph projection.
//
// This is a pure projection over a freshly authorized ProjectGraphSnapshot.
// It is intentionally not a prompt string: trusted control fields and mutable
// creator/project content stay structurally separate until a later agent
// definition chooses how to render them.

import type { AgentDomain } from "@popcorn/shared/domain-agent-contract";

import type {
  GraphSnapshotReader,
  ProjectGraphSnapshot,
  SnapshotAsset,
  SnapshotRun,
  SnapshotSelection,
} from "./graph-snapshot";
import { loadProjectGraphSnapshot } from "./graph-snapshot";

export interface RootProjectionAsset {
  id: string;
  lineageId: string;
  version: number;
  kind: string;
  media: string;
  role?: string;
  description?: string;
  durationSec?: number;
  status: string;
  activeSelection: boolean;
  source: "root_production" | "creator_pool" | "unknown";
}

export interface GraphStaleCandidate {
  assetId: string;
  staleInputAssetIds: string[];
  reason: "input_hash_changed" | "active_selection_moved";
}

export interface RootDomainStatus {
  domain: AgentDomain;
  sessionId: string;
  activeRunId: string | null;
  nextSequence: number;
  claimGeneration: number;
  summaryThroughSequence: number;
  summaryVersion: number;
  runs: Array<{
    id: string;
    status: string;
    origin: "creative_director" | "creator_direct" | "root";
    taskKind: string | null;
    sessionSequence: number | null;
    waitReason: string | null;
  }>;
}

export interface RootGraphProjection {
  /** Server-derived identity/freshness; this partition is trusted control data. */
  trusted: {
    projectId: string;
    workspaceId: string;
    loadedAt: string;
  };
  /** Project content is data, never a replacement for trusted instructions. */
  project: {
    assets: RootProjectionAsset[];
    selections: SnapshotSelection[];
    story: {
      blueprint: ProjectGraphSnapshot["storyBlueprint"];
      storyboards: ProjectGraphSnapshot["storyboards"];
      scenes: ProjectGraphSnapshot["scenes"];
      beats: ProjectGraphSnapshot["beats"];
      panels: ProjectGraphSnapshot["panels"];
    };
    domainStatus: RootDomainStatus[];
    approvals: Array<{
      gateId: string;
      runId: string;
      stage: string;
      status: string;
    }>;
    staleCandidates: GraphStaleCandidate[];
    pins: {
      assets: Array<{ assetId: string; contentHash: string }>;
      selections: Array<{
        slotOwnerLineageId: string | null;
        slotRole: string;
        activeAssetId: string;
        seq: number;
      }>;
    };
  };
}

function originForRun(run: SnapshotRun | undefined): RootProjectionAsset["source"] {
  if (run?.originKind === "creative_director") return "root_production";
  if (run?.originKind === "creator_direct") return "creator_pool";
  return "unknown";
}

function domainRunOrigin(
  run: SnapshotRun
): RootDomainStatus["runs"][number]["origin"] {
  if (run.originKind === "creative_director" || run.originKind === "creator_direct") {
    return run.originKind;
  }
  return "root";
}

function activeAssetIds(selections: readonly SnapshotSelection[]): Set<string> {
  return new Set(selections.map((selection) => selection.activeAssetId));
}

function projectAsset(
  asset: SnapshotAsset,
  selected: Set<string>,
  runByActionId: ReadonlyMap<string, SnapshotRun>
): RootProjectionAsset {
  const source = originForRun(
    asset.createdByActionId
      ? runByActionId.get(asset.createdByActionId)
      : undefined
  );
  // A direct asset becomes production truth only through an explicit selection.
  return {
    id: asset.id,
    lineageId: asset.lineageId,
    version: asset.version,
    kind: asset.kind,
    media: asset.media,
    ...(asset.role ? { role: asset.role } : {}),
    ...(asset.description ? { description: asset.description } : {}),
    ...(asset.durationSec !== undefined ? { durationSec: asset.durationSec } : {}),
    status: asset.status,
    activeSelection: selected.has(asset.id),
    source: source === "creator_pool" && selected.has(asset.id) ? "root_production" : source,
  };
}

/**
 * This is an intentionally conservative stale signal. It exposes graph facts
 * to the root; it never schedules a rerun. PR 15 owns the semantic decision.
 */
export function deriveGraphStaleCandidates(
  assets: readonly SnapshotAsset[],
  selections: readonly SnapshotSelection[]
): GraphStaleCandidate[] {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const selectedByLineage = new Map<string, string>();
  for (const selection of selections) {
    const asset = assetById.get(selection.activeAssetId);
    if (asset) selectedByLineage.set(asset.lineageId, asset.id);
  }
  const candidates: GraphStaleCandidate[] = [];
  for (const asset of assets) {
    const hashChanged: string[] = [];
    const selectionMoved: string[] = [];
    for (const input of asset.inputs) {
      const current = assetById.get(input.assetId);
      if (!current) continue;
      if (input.contentHash && current.contentHash && input.contentHash !== current.contentHash) {
        hashChanged.push(input.assetId);
      }
      const selectedId = selectedByLineage.get(current.lineageId);
      if (selectedId && selectedId !== current.id) selectionMoved.push(input.assetId);
    }
    if (hashChanged.length) {
      candidates.push({ assetId: asset.id, staleInputAssetIds: hashChanged, reason: "input_hash_changed" });
    } else if (selectionMoved.length) {
      candidates.push({ assetId: asset.id, staleInputAssetIds: selectionMoved, reason: "active_selection_moved" });
    }
  }
  return candidates;
}

export function buildRootGraphProjection(snapshot: ProjectGraphSnapshot): RootGraphProjection {
  const selected = activeAssetIds(snapshot.selections);
  const actionToRunId = new Map(
    snapshot.actionLinks.map((link) => [link.id, link.orchestratorRunId])
  );
  const runById = new Map(snapshot.runs.map((run) => [run.id, run]));
  const runByActionId = new Map<string, SnapshotRun>();
  for (const [actionId, runId] of actionToRunId) {
    if (runId) {
      const run = runById.get(runId);
      if (run) runByActionId.set(actionId, run);
    }
  }

  const domainStatus: RootDomainStatus[] = snapshot.agentSessions.map((session) => ({
    domain: session.domain,
    sessionId: session.id,
    activeRunId: session.activeRunId,
    nextSequence: session.nextSequence,
    claimGeneration: session.claimGeneration,
    summaryThroughSequence: session.summaryThroughSequence,
    summaryVersion: session.summaryVersion,
    runs: snapshot.runs
      .filter((run) => run.agentSessionId === session.id)
      .sort((a, b) => (a.sessionSequence ?? 0) - (b.sessionSequence ?? 0))
      .map((run) => ({
        id: run.id,
        status: run.status,
        origin: domainRunOrigin(run),
        taskKind: run.taskKind,
        sessionSequence: run.sessionSequence,
        waitReason: run.waitReason,
      })),
  }));

  return {
    trusted: {
      projectId: snapshot.projectId,
      workspaceId: snapshot.workspaceId,
      loadedAt: snapshot.loadedAt,
    },
    project: {
      assets: snapshot.assets.map((asset) => projectAsset(asset, selected, runByActionId)),
      selections: snapshot.selections.map((selection) => ({ ...selection })),
      story: {
        blueprint: snapshot.storyBlueprint ? { ...snapshot.storyBlueprint } : null,
        storyboards: snapshot.storyboards.map((row) => ({ ...row })),
        scenes: snapshot.scenes.map((row) => ({ ...row })),
        beats: snapshot.beats.map((row) => ({ ...row })),
        panels: snapshot.panels.map((row) => ({ ...row })),
      },
      domainStatus,
      approvals: snapshot.runGates.map((gate) => ({
        gateId: gate.id,
        runId: gate.orchestratorRunId,
        stage: gate.stage,
        status: gate.status,
      })),
      staleCandidates: deriveGraphStaleCandidates(snapshot.assets, snapshot.selections),
      pins: {
        assets: snapshot.assets.flatMap((asset) =>
          asset.contentHash ? [{ assetId: asset.id, contentHash: asset.contentHash }] : []
        ),
        selections: snapshot.selections.map((selection) => ({
          slotOwnerLineageId: selection.slotOwnerLineageId,
          slotRole: selection.slotRole,
          activeAssetId: selection.activeAssetId,
          seq: selection.seq,
        })),
      },
    },
  };
}

/** Load and project in one call so every root turn starts from live graph state. */
export async function loadRootGraphProjection(
  input: { workspaceId: string; projectId: string },
  reader?: GraphSnapshotReader
): Promise<RootGraphProjection> {
  const snapshot = reader
    ? await loadProjectGraphSnapshot(input, reader)
    : await loadProjectGraphSnapshot(input);
  return buildRootGraphProjection(snapshot);
}
