import path from "node:path";
import { assetStorageKey, contentTypeForFilename } from "@/lib/storage/asset-write";
import {
  readStorageConfig,
  visibilityForBucket,
  type AssetVisibility,
} from "@/lib/storage/config";
import { createObjectStore, type ObjectStore } from "@/lib/storage/object-store";
import { runQuery } from "@/lib/supabase/db-errors";
import { canonicalContentHash, inputsFingerprint } from "./asset-graph";
import { ApiError } from "./errors";
import {
  defaultVisibilityForWorkspace,
  type StoryBlueprint,
} from "./store";
import { markedJson } from "./store-internal";
import {
  type CatalogDb,
  type CatalogEntryRow,
  type TargetProjectRow,
} from "./catalog-types";
import {
  arrayValue,
  buildCatalogAssetSource,
  recordValue,
  stringValue,
} from "./catalog-utils";
import { sourceAssetRow } from "./catalog-snapshots";

export async function cloneAssetEntry(
  db: CatalogDb,
  entry: CatalogEntryRow,
  project: TargetProjectRow,
  deps?: { store?: ObjectStore }
): Promise<{ asset: Record<string, unknown> }> {
  if (!entry.preview_storage_key || !entry.preview_storage_bucket) {
    throw new ApiError("asset_invalid", "Catalog entry has no preview object to copy.");
  }
  const config = readStorageConfig();
  const store = deps?.store ?? createObjectStore(config);
  const filename = path.basename(
    stringValue(recordValue(entry.snapshot.asset).filename) ?? `${entry.kind}-anchor.png`
  );
  const assetVisibility = await defaultVisibilityForWorkspace(db, project.workspace_id);
  const destinationVisibility =
    assetVisibility === "private" || project.visibility === "private" ? "private" : "public";
  const now = new Date().toISOString();
  const inserted = await runQuery(
    "catalog.cloneAssetEntry",
    db
      .from("assets")
      .insert({
        schema_version: "asset.v2",
        workspace_id: project.workspace_id,
        project_id: project.id,
        kind: "anchor",
        media: "image",
        status: "pending",
        role: entry.kind === "character" ? "character_anchor" : "scene_anchor",
        filename,
        source: buildCatalogAssetSource({
          catalogEntryId: entry.id,
          sourceAssetId: entry.source_asset_id,
        }),
        description: entry.summary,
        context: {
          userContext: {
            title: entry.title,
            description: entry.summary ?? undefined,
            tags: entry.tags,
            intendedUse:
              entry.kind === "character"
                ? ["character_reference"]
                : ["style_reference"],
          },
        },
        inputs: [],
        inputs_fingerprint: inputsFingerprint([], null),
        visibility: assetVisibility,
        created_at: now,
        updated_at: now,
      })
      .select("*")
      .single()
  );
  const insertedAsset = inserted as Record<string, unknown>;
  const assetId = String(insertedAsset.id);
  let updated: unknown;
  try {
    const copied = await store.copyObject({
      sourceKey: entry.preview_storage_key,
      sourceVisibility: visibilityForBucket(config, entry.preview_storage_bucket),
      destinationKey: assetStorageKey({
        workspaceId: project.workspace_id,
        projectId: project.id,
        assetId,
        filename,
      }),
      destinationVisibility,
      contentType: entry.preview_content_type ?? contentTypeForFilename(filename),
    });
    updated = await runQuery(
      "catalog.cloneAssetEntry storage",
      db
        .from("assets")
        .update({
          status: "ready",
          storage_key: copied.key,
          storage_bucket: copied.bucket,
        })
        .eq("id", assetId)
        .select("*")
        .single()
    );
  } catch (error) {
    try {
      await runQuery(
        "catalog.cloneAssetEntry failed",
        db.from("assets").update({ status: "failed" }).eq("id", assetId)
      );
    } catch {
      // Preserve the clone failure; marking failed is best effort.
    }
    throw error;
  }
  return { asset: updated as Record<string, unknown> };
}

export async function cloneStoryEntry(
  db: CatalogDb,
  entry: CatalogEntryRow,
  project: TargetProjectRow
): Promise<{ storyBlueprint: Record<string, unknown> }> {
  const blueprint = storyBlueprintFromCatalogEntry(entry);
  const action = await runQuery(
    "catalog.cloneStoryEntry action",
    db
      .from("actions")
      .insert({
        schema_version: "action.v1",
        project_id: project.id,
        tool: "use_catalog_entry",
        status: "running",
        params: markedJson("action_params.v1", {
          catalogEntryId: entry.id,
          sourceStoryBlueprintId: entry.source_story_blueprint_id,
        }),
        input_asset_ids: [],
        output_asset_ids: [],
        rationale: "Clone a published story anchor into this project.",
      })
      .select("*")
      .single()
  );
  const actionId = (action as { id: string }).id;
  const content = { schema_version: "story_blueprint", ...blueprint };
  const now = new Date().toISOString();
  const storyAsset = await runQuery(
    "catalog.cloneStoryEntry asset",
    db
      .from("assets")
      .insert({
        schema_version: "asset.v2",
        workspace_id: project.workspace_id,
        project_id: project.id,
        kind: "story_blueprint",
        media: "data",
        status: "ready",
        role: "current_story_blueprint",
        content,
        content_hash: canonicalContentHash(content),
        inputs: [],
        inputs_fingerprint: inputsFingerprint([], null),
        source: buildCatalogAssetSource({
          catalogEntryId: entry.id,
          sourceStoryBlueprintId: entry.source_story_blueprint_id,
        }),
        visibility: await defaultVisibilityForWorkspace(db, project.workspace_id),
        created_by_action_id: actionId,
        created_at: now,
        updated_at: now,
      })
      .select("*")
      .single()
  );
  const storyAssetId = (storyAsset as { id: string }).id;
  const cloned = await runQuery(
    "catalog.cloneStoryEntry blueprint",
    db
      .from("story_blueprints")
      .insert({
        schema_version: "storyBlueprint.v1",
        workspace_id: project.workspace_id,
        project_id: project.id,
        brief_asset_id: null,
        asset_id: storyAssetId,
        status: "draft",
        snapshot: { schema_version: "story_blueprint", ...blueprint },
        provenance: markedJson("story_blueprint_provenance.v1", {
          via: "catalog",
          catalogEntryId: entry.id,
          sourceStoryBlueprintId: entry.source_story_blueprint_id,
          outputAssetId: storyAssetId,
        }),
        created_by: markedJson("story_blueprint_creator.v1", {
          actionId,
          tool: "use_catalog_entry",
        }),
      })
      .select("*")
      .single()
  );
  const clonedBlueprintId = (cloned as { id: string }).id;
  await cloneStoryChildrenFromSnapshot(
    db,
    blueprint,
    clonedBlueprintId,
    project.workspace_id,
    project.id
  );
  await runQuery(
    "catalog.cloneStoryEntry selection",
    db.from("selections").insert({
      project_id: project.id,
      slot_owner_lineage_id: null,
      slot_role: "story_blueprint",
      active_asset_id: storyAssetId,
      set_by_action_id: actionId,
    })
  );
  await runQuery(
    "catalog.cloneStoryEntry projectPointer",
    db.from("projects").update({ current_story_blueprint_id: clonedBlueprintId }).eq("id", project.id)
  );
  await runQuery(
    "catalog.cloneStoryEntry actionOutputs",
    db
      .from("actions")
      .update({ status: "applied", output_asset_ids: [storyAssetId] })
      .eq("id", actionId)
  );
  return { storyBlueprint: cloned as Record<string, unknown> };
}

export async function materializePreview(input: {
  db: CatalogDb;
  entryId: string;
  workspaceId: string;
  sourceAssetId: string;
  store?: ObjectStore;
}): Promise<{ storageKey: string; storageBucket: string; contentType: string }> {
  const asset = await sourceAssetRow(input.db, input.workspaceId, input.sourceAssetId);
  if (!asset.storage_key || !asset.storage_bucket) {
    throw new ApiError(
      "asset_invalid",
      "Publishing to the catalog requires a managed-storage source asset."
    );
  }
  const config = readStorageConfig();
  const store = input.store ?? createObjectStore(config);
  const filename = path.basename(asset.filename ?? `${asset.id}.png`);
  const contentType = contentTypeForFilename(filename);
  const sourceVisibility = visibilityForBucket(config, asset.storage_bucket);
  const copied = await store.copyObject({
    sourceKey: asset.storage_key,
    sourceVisibility,
    destinationKey: `catalog/${input.entryId}/${filename}`,
    destinationVisibility: "public",
    contentType,
  });
  return {
    storageKey: copied.key,
    storageBucket: copied.bucket,
    contentType,
  };
}

function storyBlueprintFromCatalogEntry(entry: CatalogEntryRow): StoryBlueprint {
  const story = recordValue(entry.snapshot.story);
  const snapshot = recordValue(story.snapshot);
  return {
    schemaVersion: "storyBlueprint.v1",
    premise: stringValue(snapshot.premise) ?? stringValue(story.logline) ?? "",
    logline: stringValue(snapshot.logline) ?? stringValue(story.logline) ?? "",
    tone: stringValue(snapshot.tone) ?? "",
    ...(stringValue(snapshot.audience)
      ? { audience: stringValue(snapshot.audience) }
      : {}),
    targetLengthSec:
      typeof snapshot.targetLengthSec === "number" ? snapshot.targetLengthSec : 0,
    aspectRatio:
      snapshot.aspectRatio === "16:9" ||
      snapshot.aspectRatio === "9:16" ||
      snapshot.aspectRatio === "1:1"
        ? snapshot.aspectRatio
        : "16:9",
    characters: arrayValue(story.characters).map((character, index) => {
      const row = recordValue(character);
      return {
        id: stringValue(row.id) ?? `character_${index + 1}`,
        name: stringValue(row.name) ?? `Character ${index + 1}`,
        role: stringValue(row.role) ?? "character",
        description: stringValue(row.description) ?? "",
      };
    }),
    acts: arrayValue(story.acts).map((act, index) => {
      const row = recordValue(act);
      return {
        id: stringValue(row.id) ?? `act_${index + 1}`,
        title: stringValue(row.title) ?? `Act ${index + 1}`,
        purpose: stringValue(row.purpose) ?? "",
        summary: stringValue(row.summary) ?? "",
        targetDurationSec:
          typeof row.targetDurationSec === "number" ? row.targetDurationSec : 0,
      };
    }),
    scenes: arrayValue(story.scenes).map((scene, index) => {
      const row = recordValue(scene);
      return {
        id: stringValue(row.id) ?? `scene_${index + 1}`,
        title: stringValue(row.title) ?? `Scene ${index + 1}`,
        summary: stringValue(row.summary) ?? "",
        actId: stringValue(row.actId) ?? "act_1",
        targetDurationSec:
          typeof row.targetDurationSec === "number" ? row.targetDurationSec : 0,
      };
    }),
    ending: stringValue(snapshot.ending) ?? "",
  };
}

async function cloneStoryChildrenFromSnapshot(
  db: CatalogDb,
  blueprint: StoryBlueprint,
  targetBlueprintId: string,
  targetWorkspaceId: string,
  targetProjectId: string
): Promise<void> {
  if (blueprint.characters.length > 0) {
    await runQuery(
      "catalog.cloneStoryChildren characters write",
      db.from("story_blueprint_characters").insert(
        blueprint.characters.map((character, index) => ({
          story_blueprint_id: targetBlueprintId,
          workspace_id: targetWorkspaceId,
          project_id: targetProjectId,
          stable_id: character.id,
          position: index,
          name: character.name,
          role: character.role,
          description: character.description,
        }))
      )
    );
  }

  const actIdByStableId = new Map<string, string>();
  if (blueprint.acts.length > 0) {
    const insertedActs = (await runQuery(
      "catalog.cloneStoryChildren acts write",
      db
        .from("story_blueprint_acts")
        .insert(
          blueprint.acts.map((act, index) => ({
            story_blueprint_id: targetBlueprintId,
            workspace_id: targetWorkspaceId,
            project_id: targetProjectId,
            stable_id: act.id,
            position: index,
            title: act.title,
            purpose: act.purpose,
            summary: act.summary,
            target_duration_sec: act.targetDurationSec,
          }))
        )
        .select("id, stable_id")
    )) as Array<{ id: string; stable_id: string }>;
    for (const act of insertedActs) {
      actIdByStableId.set(act.stable_id, act.id);
    }
  }

  if (blueprint.scenes.length > 0) {
    await runQuery(
      "catalog.cloneStoryChildren scenes write",
      db.from("story_blueprint_scenes").insert(
        blueprint.scenes.map((scene, index) => {
          const mappedActId = actIdByStableId.get(scene.actId);
          if (!mappedActId) {
            throw new Error(`Could not map scene ${scene.id} to a cloned act.`);
          }
          return {
            story_blueprint_id: targetBlueprintId,
            story_blueprint_act_id: mappedActId,
            workspace_id: targetWorkspaceId,
            project_id: targetProjectId,
            stable_id: scene.id,
            position: index,
            title: scene.title,
            summary: scene.summary,
            target_duration_sec: scene.targetDurationSec,
          };
        })
      )
    );
  }
}
