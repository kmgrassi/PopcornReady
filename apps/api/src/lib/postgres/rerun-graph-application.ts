import type { PoolClient } from "pg";
import type {
  PlannedSelectionMove,
  PlannedStoryPointerMove,
  RerunProposalV2,
} from "@popcorn/shared/rerun-proposal";
import { ApiError } from "@/core/errors";

export interface DurableRerunBinding {
  bindingId: string;
  workItemId: string;
  role: string;
  intrinsicRole: string;
  assetId: string;
}

export interface ResolvedSelectionMove extends PlannedSelectionMove {
  activeAssetId: string;
}

export interface ResolvedStoryPointerMove extends PlannedStoryPointerMove {
  snapshotAssetId: string;
}

export interface ResolvedRerunGraphMoves {
  selections: ResolvedSelectionMove[];
  storyPointers: ResolvedStoryPointerMove[];
}

function selectionKey(move: PlannedSelectionMove): string {
  return `${move.slotOwnerLineageId ?? "project"}:${move.slotRole}`;
}

function storyKey(move: PlannedStoryPointerMove): string {
  return `${move.rowKind}:${move.rowId}`;
}

export function resolveRerunGraphMoves(
  proposal: RerunProposalV2,
  bindings: readonly DurableRerunBinding[]
): ResolvedRerunGraphMoves {
  if (proposal.outcome !== "revision") {
    throw new ApiError(
      "validation_failed",
      "Only revision proposals can apply graph moves."
    );
  }
  const expected = new Map(
    proposal.selectedWork.flatMap((work) =>
      work.requiredOutputs.map((output) => [output.bindingId, output] as const)
    )
  );
  if (expected.size !== proposal.selectedWork.reduce(
    (count, work) => count + work.requiredOutputs.length,
    0
  )) {
    throw new ApiError(
      "validation_failed",
      "Proposal contains duplicate output binding identities."
    );
  }
  const byBinding = new Map<string, DurableRerunBinding>();
  for (const binding of bindings) {
    const expectedBinding = expected.get(binding.bindingId);
    if (
      !expectedBinding ||
      expectedBinding.workItemId !== binding.workItemId ||
      expectedBinding.role !== binding.role ||
      byBinding.has(binding.bindingId)
    ) {
      throw new ApiError(
        "validation_failed",
        `Durable result ${binding.bindingId} is outside the approved bindings.`
      );
    }
    byBinding.set(binding.bindingId, binding);
  }
  if (byBinding.size !== expected.size) {
    throw new ApiError(
      "validation_failed",
      "Durable results do not cover every approved output binding."
    );
  }

  const selectionKeys = proposal.plannedSelectionMoves.map(selectionKey);
  const storyKeys = proposal.plannedStoryPointerMoves.map(storyKey);
  if (
    new Set(selectionKeys).size !== selectionKeys.length ||
    new Set(storyKeys).size !== storyKeys.length
  ) {
    throw new ApiError(
      "validation_failed",
      "Proposal contains duplicate graph pointer moves."
    );
  }
  const destination = (bindingId: string): DurableRerunBinding => {
    const binding = byBinding.get(bindingId);
    if (!binding) {
      throw new ApiError(
        "validation_failed",
        `Graph move references missing output binding ${bindingId}.`
      );
    }
    return binding;
  };
  return {
    selections: proposal.plannedSelectionMoves.map((move) => ({
      ...move,
      activeAssetId: destination(move.bindingId).assetId,
    })).sort((left, right) => selectionKey(left).localeCompare(selectionKey(right))),
    storyPointers: proposal.plannedStoryPointerMoves.map((move) => ({
      ...move,
      snapshotAssetId: destination(move.bindingId).assetId,
    })).sort((left, right) => storyKey(left).localeCompare(storyKey(right))),
  };
}

function stale(message: string): never {
  throw new ApiError("stale_proposal", message);
}

export async function applyResolvedRerunGraphMoves(
  client: PoolClient,
  input: {
    projectId: string;
    executionActionId: string;
    moves: ResolvedRerunGraphMoves;
  }
): Promise<void> {
  const assetIds = [...new Set([
    ...input.moves.selections.map((move) => move.activeAssetId),
    ...input.moves.storyPointers.map((move) => move.snapshotAssetId),
  ])].sort();
  if (assetIds.length > 0) {
    const assets = await client.query<{ id: string }>(
      `select id from public.assets
        where project_id=$1 and id=any($2::uuid[])
        order by id for share`,
      [input.projectId, assetIds]
    );
    if (assets.rowCount !== assetIds.length) {
      throw new ApiError(
        "validation_failed",
        "A graph move destination is outside the execution project."
      );
    }
  }

  if (input.moves.selections.length > 0) {
    // Selection heads are append-only. This matches proposal admission and
    // prevents an insert between the final head read and the appended CAS row.
    await client.query("lock table public.selections in share row exclusive mode");
  }
  for (const move of input.moves.selections) {
    const current = (await client.query<{
      active_asset_id: string;
      seq: number;
    }>(
      `select active_asset_id,seq from public.selections
        where project_id=$1
          and slot_owner_lineage_id is not distinct from $2
          and slot_role=$3
        order by seq desc limit 1`,
      [input.projectId, move.slotOwnerLineageId, move.slotRole]
    )).rows[0];
    if (
      (current?.active_asset_id ?? null) !== move.expectedActiveAssetId ||
      (current?.seq ?? 0) !== move.expectedSeq
    ) {
      stale(`Selection ${selectionKey(move)} changed before atomic application.`);
    }
    if (move.activeAssetId === move.expectedActiveAssetId) {
      throw new ApiError(
        "validation_failed",
        `Selection ${selectionKey(move)} did not produce a new asset.`
      );
    }
    await client.query(
      `insert into public.selections(
         project_id,slot_owner_lineage_id,slot_role,seq,
         active_asset_id,set_by_action_id
       ) values ($1,$2,$3,$4,$5,$6)`,
      [
        input.projectId,
        move.slotOwnerLineageId,
        move.slotRole,
        move.expectedSeq + 1,
        move.activeAssetId,
        input.executionActionId,
      ]
    );
  }

  for (const move of input.moves.storyPointers) {
    let current: string | null | undefined;
    if (move.rowKind === "story_blueprint") {
      current = (await client.query<{ snapshot_asset_id: string | null }>(
        `select asset_id as snapshot_asset_id
           from public.story_blueprints
          where project_id=$1 and id=$2 for update`,
        [input.projectId, move.rowId]
      )).rows[0]?.snapshot_asset_id;
    } else if (move.rowKind === "storyboard") {
      current = (await client.query<{ snapshot_asset_id: string | null }>(
        `select nullif(provenance->>'planAssetId','')::uuid as snapshot_asset_id
           from public.story_blueprints
          where project_id=$1 and id=$2 for update`,
        [input.projectId, move.rowId]
      )).rows[0]?.snapshot_asset_id;
    } else if (move.rowKind === "story_scene") {
      current = (await client.query<{ snapshot_asset_id: string | null }>(
        `select scene_asset_id as snapshot_asset_id
           from public.story_blueprint_scenes
          where project_id=$1 and id=$2 for update`,
        [input.projectId, move.rowId]
      )).rows[0]?.snapshot_asset_id;
    } else {
      current = (await client.query<{ snapshot_asset_id: string | null }>(
        `select beat_asset_id as snapshot_asset_id
           from public.story_beats
          where project_id=$1 and id=$2 for update`,
        [input.projectId, move.rowId]
      )).rows[0]?.snapshot_asset_id;
    }
    if (current === undefined) {
      stale(`Story pointer ${storyKey(move)} no longer exists.`);
    }
    if (current !== move.expectedSnapshotAssetId) {
      stale(`Story pointer ${storyKey(move)} changed before atomic application.`);
    }
    if (move.snapshotAssetId === move.expectedSnapshotAssetId) {
      throw new ApiError(
        "validation_failed",
        `Story pointer ${storyKey(move)} did not produce a new snapshot.`
      );
    }
    if (move.rowKind === "story_blueprint") {
      await client.query(
        `update public.story_blueprints set asset_id=$3
          where project_id=$1 and id=$2`,
        [input.projectId, move.rowId, move.snapshotAssetId]
      );
    } else if (move.rowKind === "storyboard") {
      await client.query(
        `update public.story_blueprints
            set provenance=jsonb_set(
              provenance,'{planAssetId}',to_jsonb($3::text),true
            )
          where project_id=$1 and id=$2`,
        [input.projectId, move.rowId, move.snapshotAssetId]
      );
    } else if (move.rowKind === "story_scene") {
      await client.query(
        `update public.story_blueprint_scenes set scene_asset_id=$3
          where project_id=$1 and id=$2`,
        [input.projectId, move.rowId, move.snapshotAssetId]
      );
    } else {
      await client.query(
        `update public.story_beats set beat_asset_id=$3
          where project_id=$1 and id=$2`,
        [input.projectId, move.rowId, move.snapshotAssetId]
      );
    }
  }
}
