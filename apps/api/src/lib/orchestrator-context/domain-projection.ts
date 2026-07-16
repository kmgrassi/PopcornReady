// Specialist-agent orchestration PR 7 — role-filtered finite-turn context.

import type { DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";

import { buildRootGraphProjection, type RootProjectionAsset } from "./root-projection";
import {
  loadProjectGraphSnapshot,
  type GraphSnapshotReader,
  type ProjectGraphSnapshot,
  type SnapshotAsset,
} from "./graph-snapshot";
import {
  assertPreservePinsCurrent,
  buildDomainTargetScope,
  isAssetInTargetScope,
  type DomainTargetScope,
} from "./target-scope";

export interface DomainTurnProjection {
  /** Server-controlled fields. Do not merge this object into creator content. */
  trusted: {
    projectId: string;
    workspaceId: string;
    loadedAt: string;
    domain: DomainTaskV1["domain"];
    taskKind: DomainTaskV1["taskKind"];
    origin: DomainTaskV1["origin"];
    targets: DomainTaskV1["targets"];
    allowedOutputKinds: DomainTaskV1["allowedOutputKinds"];
    requiredOutputs: DomainTaskV1["requiredOutputs"];
    budgetUsd: number;
    acceptanceCriteria: DomainTaskV1["acceptanceCriteria"];
    scope: DomainTargetScope;
  };
  /** Creator intent and graph descriptions are data, not executable instructions. */
  creatorContent: {
    objective: string;
    instruction: string;
    creativeConstraints: DomainTaskV1["creativeConstraints"];
  };
  graph: {
    assets: RootProjectionAsset[];
    selections: ReturnType<typeof buildRootGraphProjection>["project"]["selections"];
    story: ReturnType<typeof buildRootGraphProjection>["project"]["story"];
    staleCandidates: ReturnType<typeof buildRootGraphProjection>["project"]["staleCandidates"];
    domainStatus: ReturnType<typeof buildRootGraphProjection>["project"]["domainStatus"];
  };
}

function roleCanInspectAsset(task: DomainTaskV1, asset: SnapshotAsset): boolean {
  if (task.domain === "audio") {
    return (
      asset.media === "audio" ||
      asset.kind === "audio_track" ||
      asset.media === "image" ||
      asset.media === "video" ||
      task.targets.some((target) => target.kind === "asset" && target.assetId === asset.id)
    );
  }
  return asset.media === "image" || asset.media === "video" || ["image", "anchor", "keyframe", "clip", "composite", "render"].includes(asset.kind);
}

/**
 * Build context at the exact boundary before a finite domain turn. The caller
 * loads the snapshot first, so context never trusts an old session copy.
 */
export function buildDomainTurnProjection(input: {
  snapshot: ProjectGraphSnapshot;
  task: DomainTaskV1;
}): DomainTurnProjection {
  const { snapshot, task } = input;
  const scope = buildDomainTargetScope({
    snapshot,
    targets: task.targets,
    candidateAffectedAssetIds: task.candidateAffectedAssetIds,
  });
  assertPreservePinsCurrent(scope, snapshot, task.preserve);
  const root = buildRootGraphProjection(snapshot);

  const assets = root.project.assets.filter((asset) => {
    const snapshotAsset = snapshot.assets.find((candidate) => candidate.id === asset.id);
    return Boolean(
      snapshotAsset && isAssetInTargetScope(scope, asset.id) && roleCanInspectAsset(task, snapshotAsset)
    );
  });

  return {
    trusted: {
      projectId: snapshot.projectId,
      workspaceId: snapshot.workspaceId,
      loadedAt: snapshot.loadedAt,
      domain: task.domain,
      taskKind: task.taskKind,
      origin: task.origin,
      targets: task.targets,
      allowedOutputKinds: task.allowedOutputKinds,
      requiredOutputs: task.requiredOutputs,
      budgetUsd: task.budgetUsd,
      acceptanceCriteria: task.acceptanceCriteria,
      scope,
    },
    creatorContent: {
      objective: task.objective,
      instruction: task.instruction,
      creativeConstraints: task.creativeConstraints,
    },
    graph: {
      assets,
      selections: root.project.selections.filter((selection) =>
        isAssetInTargetScope(scope, selection.activeAssetId)
      ),
      story: root.project.story,
      staleCandidates: root.project.staleCandidates.filter((candidate) =>
        isAssetInTargetScope(scope, candidate.assetId)
      ),
      domainStatus: root.project.domainStatus.filter((status) => status.domain === task.domain),
    },
  };
}

/**
 * The production entry point for a finite domain turn. It deliberately loads
 * the authorized graph immediately before projection rather than accepting a
 * session-held creative snapshot.
 */
export async function loadDomainTurnProjection(input: {
  workspaceId: string;
  projectId: string;
  task: DomainTaskV1;
  reader?: GraphSnapshotReader;
}): Promise<DomainTurnProjection> {
  const snapshot = input.reader
    ? await loadProjectGraphSnapshot(input, input.reader)
    : await loadProjectGraphSnapshot(input);
  return buildDomainTurnProjection({ snapshot, task: input.task });
}
