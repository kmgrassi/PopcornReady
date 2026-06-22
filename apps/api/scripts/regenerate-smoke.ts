#!/usr/bin/env tsx
/**
 * regenerate-smoke — manually exercise image regeneration against a real DB.
 *
 * Regeneration mints a NEW IMMUTABLE asset version (same lineage, version+1) and
 * repoints the surfaces (storyboard panels + selection slots) that pointed at the
 * old asset — the old in-place UPDATE violated `assets_guard_immutable`. This
 * harness drives the REAL `regenerateImageAsset` executor end-to-end with the
 * image provider and storage writer STUBBED, so the only live work is the DB
 * insert + repoint via the `regenerate_asset_version` RPC. Point it at the
 * local Supabase stack to see the fix work without burning provider credits.
 *
 * Env (the store reads these): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DB_BACKEND=supabase.
 * The easiest way to supply the local values is the repo helper:
 *
 *   node scripts/with-local-supabase-env.mjs \
 *     pnpm --filter @popcorn/api exec tsx scripts/regenerate-smoke.ts <command>
 *
 * Commands:
 *   seed [--project <id>]   Create an image asset + storyboard panel + selection
 *                           slot that all point at it. Prints the asset id.
 *   inspect <assetId>       Show the lineage's versions and who points where.
 *   run <assetId> [--prompt <text>]
 *                           Regenerate (stubbed bytes) and print before/after.
 *   demo [--project <id>]   seed -> inspect -> run -> inspect, end to end.
 */
import { randomUUID } from "node:crypto";
import type { GeneratedAssetResult } from "@popcorn/shared/generative/types";
import { getServiceSupabaseForStore } from "@/lib/api/v1/store";
import { regenerateImageAsset } from "@/lib/api/v1/regenerate-asset";

type Json = Record<string, unknown>;

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): { positionals: string[]; opts: Record<string, string> } {
  const positionals: string[] = [];
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      opts[arg.slice(2)] = argv[i + 1] ?? "";
      i += 1;
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, opts };
}

const db = getServiceSupabaseForStore();

async function pickProject(projectId?: string): Promise<{ id: string; workspace_id: string }> {
  const query = db.from("projects").select("id, workspace_id");
  const { data, error } = projectId
    ? await query.eq("id", projectId).maybeSingle()
    : await query.limit(1).maybeSingle();
  if (error) fail(`project lookup failed: ${error.message}`);
  if (!data) fail(projectId ? `no project ${projectId}` : "no projects exist; create one first");
  return data as { id: string; workspace_id: string };
}

// Seed an image asset wired into a storyboard panel AND a selection slot, so a
// regenerate has both repoint surfaces to exercise.
async function seed(projectId?: string): Promise<{ assetId: string; workspaceId: string }> {
  const project = await pickProject(projectId);
  const insert = async <T>(table: string, row: Json): Promise<T> => {
    const { data, error } = await db.from(table).insert(row).select("*").single();
    if (error) fail(`insert ${table} failed: ${error.message}`);
    return data as T;
  };

  const asset = await insert<{ id: string }>("assets", {
    workspace_id: project.workspace_id,
    project_id: project.id,
    kind: "keyframe",
    media: "image",
    status: "ready",
    role: "beat_keyframe",
    filename: "seed-old.png",
    params: { schema_version: "asset_params.v1", provenance: { prompt: "a calico cat on a sofa" } },
    content_hash: `seed_old_${randomUUID().slice(0, 8)}`,
    storage_key: `projects/${project.id}/seed-old.png`,
    storage_bucket: "assets",
  });

  const sb = await insert<{ id: string }>("storyboards", { project_id: project.id });
  const scene = await insert<{ id: string }>("storyboard_scenes", {
    project_id: project.id,
    storyboard_id: sb.id,
    scene_index: 0,
  });
  const beat = await insert<{ id: string }>("storyboard_beats", {
    project_id: project.id,
    scene_id: scene.id,
    beat_index: 0,
  });
  await insert("storyboard_panels", {
    project_id: project.id,
    beat_id: beat.id,
    image_asset_id: asset.id,
  });
  await insert("selections", {
    project_id: project.id,
    slot_owner_lineage_id: null,
    slot_role: `beat_keyframe:${beat.id}`,
    active_asset_id: asset.id,
  });

  console.log(`seeded image asset ${asset.id} (project ${project.id})`);
  return { assetId: asset.id, workspaceId: project.workspace_id };
}

async function inspect(assetId: string): Promise<void> {
  const { data: anchor, error } = await db
    .from("assets")
    .select("lineage_id, project_id")
    .eq("id", assetId)
    .maybeSingle();
  if (error) fail(error.message);
  if (!anchor) fail(`asset ${assetId} not found`);
  const { lineage_id, project_id } = anchor as { lineage_id: string; project_id: string };

  const { data: versions } = await db
    .from("assets")
    .select("id, version, status, storage_key, content_hash")
    .eq("lineage_id", lineage_id)
    .order("version", { ascending: true });
  console.log(`\nlineage ${lineage_id} — ${(versions ?? []).length} version(s):`);
  for (const v of (versions ?? []) as Json[]) {
    console.log(`  v${v.version}\t${v.id}\t${v.status}\t${v.storage_key}\t${v.content_hash}`);
  }

  const { data: panels } = await db
    .from("storyboard_panels")
    .select("id, image_asset_id")
    .eq("project_id", project_id);
  const ids = new Set(((versions ?? []) as Json[]).map((v) => v.id));
  const linkedPanels = ((panels ?? []) as Json[]).filter((p) => ids.has(p.image_asset_id));
  console.log(`panels in this lineage: ${linkedPanels.map((p) => `${p.id}->v?(${String(p.image_asset_id).slice(0, 8)})`).join(", ") || "none"}`);

  const { data: sels } = await db
    .from("current_selections")
    .select("slot_role, active_asset_id")
    .eq("project_id", project_id);
  const linkedSels = ((sels ?? []) as Json[]).filter((s) => ids.has(s.active_asset_id));
  console.log(`selection heads in this lineage: ${linkedSels.map((s) => `${s.slot_role}->${String(s.active_asset_id).slice(0, 8)}`).join(", ") || "none"}`);
}

// Stubbed image generation + storage so only the DB insert+repoint is real.
async function run(assetId: string, workspaceId: string, prompt?: string): Promise<void> {
  const before = await db.from("assets").select("id").eq("id", assetId).maybeSingle();
  if (!before.data) fail(`asset ${assetId} not found`);

  const media = await regenerateImageAsset({
    workspaceId,
    assetId,
    prompt,
    deps: {
      generateImage: async (input): Promise<GeneratedAssetResult> => ({
        kind: "image",
        bytes: Buffer.from(`stub-bytes-${randomUUID()}`),
        extension: "png",
        mimeType: "image/png",
        provider: input.provider as GeneratedAssetResult["provider"],
        prompt: input.prompt,
      }),
      writeObject: async ({ projectId, filename }) => ({
        storageKey: `projects/${projectId}/${filename}`,
        storageBucket: "assets",
        contentType: "image/png",
      }),
    },
  });
  console.log(`regenerated -> url=${media.url ?? "(none)"} expiresAt=${media.expiresAt}`);
}

async function main(): Promise<void> {
  const [, , ...argv] = process.argv;
  const { positionals, opts } = parseArgs(argv);
  const [command] = positionals;

  switch (command) {
    case "seed": {
      await seed(opts.project);
      return;
    }
    case "inspect": {
      await inspect(positionals[1] ?? fail("usage: inspect <assetId>"));
      return;
    }
    case "run": {
      const assetId = positionals[1] ?? fail("usage: run <assetId>");
      const { data } = await db
        .from("assets")
        .select("workspace_id")
        .eq("id", assetId)
        .maybeSingle();
      if (!data) fail(`asset ${assetId} not found`);
      await run(assetId, (data as { workspace_id: string }).workspace_id, opts.prompt);
      return;
    }
    case "demo": {
      const { assetId, workspaceId } = await seed(opts.project);
      await inspect(assetId);
      console.log("\n--- regenerating ---");
      await run(assetId, workspaceId, opts.prompt);
      await inspect(assetId);
      return;
    }
    default:
      fail("usage: regenerate-smoke seed|inspect|run|demo (see file header)");
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
