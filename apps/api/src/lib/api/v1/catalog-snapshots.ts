import { contentTypeForFilename } from "@/lib/storage/asset-write";
import { runQuery } from "@/lib/supabase/db-errors";
import { ApiError, notFound } from "./errors";
import {
  type CatalogDb,
  type SourceAssetRow,
  type StoryActRow,
  type StoryBlueprintRow,
  type StoryCharacterRow,
  type StorySceneRow,
} from "./catalog-types";
import {
  buildSearchText,
  recordValue,
  stringArrayValue,
  stringValue,
  unmarked,
} from "./catalog-utils";

export async function sourceAssetRow(
  db: CatalogDb,
  workspaceId: string,
  assetId: string
): Promise<SourceAssetRow> {
  const row = await runQuery(
    "catalog.sourceAssetRow",
    db
      .from("assets")
      .select("*")
      .eq("id", assetId)
      .eq("workspace_id", workspaceId)
      .maybeSingle()
  );
  if (!row) throw notFound(`Source asset not found: ${assetId}`);
  return row as SourceAssetRow;
}

export async function assetSnapshot(
  db: CatalogDb,
  workspaceId: string,
  sourceAssetId: string,
  kind: "character" | "image"
): Promise<{
  source: {
    workspaceId: string;
    projectId: string;
    assetId: string;
    storyBlueprintId: null;
  };
  body: Record<string, unknown>;
  searchText: string;
}> {
  const asset = await sourceAssetRow(db, workspaceId, sourceAssetId);
  if (asset.media !== "image") {
    throw new ApiError("asset_invalid", "Catalog character and image entries require an image asset.");
  }
  if (kind === "character" && asset.kind !== "anchor") {
    throw new ApiError("asset_invalid", "Character catalog entries require an anchor asset.");
  }
  const context = asset.context ?? {};
  const userContext = recordValue(context.userContext);
  const agentContext = recordValue(context.agentContext);
  const summary = stringValue(userContext.description) ??
    stringValue(agentContext.summary) ??
    stringValue(context.summary) ??
    asset.description ??
    undefined;
  const tags = stringArrayValue(userContext.tags);
  const searchText = buildSearchText([
    asset.filename ?? undefined,
    asset.role ?? undefined,
    summary,
    ...(tags ?? []),
    JSON.stringify(asset.semantic_analysis ?? {}),
  ]);
  return {
    source: {
      workspaceId: asset.workspace_id,
      projectId: asset.project_id,
      assetId: asset.id,
      storyBlueprintId: null,
    },
    body: {
      kind,
      source: "asset",
      asset: {
        id: asset.id,
        graphKind: asset.kind,
        filename: asset.filename,
        role: asset.role,
        summary,
        tags: tags ?? [],
        contentType: contentTypeForFilename(asset.filename ?? "anchor.png"),
      },
    },
    searchText,
  };
}

export async function storySnapshot(
  db: CatalogDb,
  workspaceId: string,
  sourceStoryBlueprintId: string
): Promise<{
  source: {
    workspaceId: string;
    projectId: string;
    assetId: null;
    storyBlueprintId: string;
  };
  body: Record<string, unknown>;
  searchText: string;
}> {
  const blueprint = await runQuery(
    "catalog.storySnapshot blueprint",
    db
      .from("story_blueprints")
      .select("*")
      .eq("id", sourceStoryBlueprintId)
      .eq("workspace_id", workspaceId)
      .maybeSingle()
  );
  if (!blueprint) throw notFound(`Source story blueprint not found: ${sourceStoryBlueprintId}`);
  const row = blueprint as StoryBlueprintRow;
  const [characters, acts, scenes] = await Promise.all([
    runQuery(
      "catalog.storySnapshot characters",
      db
        .from("story_blueprint_characters")
        .select("stable_id,position,name,role,description")
        .eq("story_blueprint_id", row.id)
        .order("position", { ascending: true })
    ),
    runQuery(
      "catalog.storySnapshot acts",
      db
        .from("story_blueprint_acts")
        .select("id,stable_id,position,title,purpose,summary,target_duration_sec")
        .eq("story_blueprint_id", row.id)
        .order("position", { ascending: true })
    ),
    runQuery(
      "catalog.storySnapshot scenes",
      db
        .from("story_blueprint_scenes")
        .select("stable_id,story_blueprint_act_id,position,title,summary,target_duration_sec")
        .eq("story_blueprint_id", row.id)
        .order("position", { ascending: true })
    ),
  ]);
  const snapshot = unmarked(row.snapshot);
  const logline =
    stringValue(snapshot.logline) ??
    stringValue(snapshot.summary) ??
    stringValue(snapshot.goal);
  const body = {
    kind: "story",
    source: "story_blueprint",
    story: {
      id: row.id,
      status: row.status,
      logline,
      snapshot,
      characters: (characters as StoryCharacterRow[]).map((character) => ({
        id: character.stable_id,
        name: character.name,
        role: character.role,
        description: character.description,
      })),
      acts: (acts as StoryActRow[]).map((act) => ({
        id: act.stable_id,
        title: act.title,
        purpose: act.purpose,
        summary: act.summary,
        targetDurationSec: act.target_duration_sec,
      })),
      scenes: (scenes as StorySceneRow[]).map((scene) => {
        const act = (acts as StoryActRow[]).find(
          (candidate) => candidate.id === scene.story_blueprint_act_id
        );
        return {
          id: scene.stable_id,
          title: scene.title,
          summary: scene.summary,
          ...(act ? { actId: act.stable_id } : {}),
          targetDurationSec: scene.target_duration_sec,
        };
      }),
    },
  };
  return {
    source: {
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      assetId: null,
      storyBlueprintId: row.id,
    },
    body,
    searchText: buildSearchText([
      logline,
      ...((characters as StoryCharacterRow[]).flatMap((c) => [
        c.name,
        c.role,
        c.description,
      ])),
      ...((acts as StoryActRow[]).flatMap((a) => [a.title, a.purpose, a.summary])),
      ...((scenes as StorySceneRow[]).flatMap((s) => [s.title, s.summary])),
    ]),
  };
}
