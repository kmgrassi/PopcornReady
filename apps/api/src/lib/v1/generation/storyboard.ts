// Default storyboard tile fan-out for the `storyboard` generation stage
// (Storyboard & Scenes scope, Part B).
//
// Iterates the plan's scenes → beats and generates exactly one cheap sketch
// `beat_storyboard` tile per beat, returning each tile's metadata + raw bytes.
// Decoupled from the run executor (injected via GenerationDeps.generateStoryboardTiles)
// so the executor can be exercised offline; the store layer (addStoryboardTiles)
// owns persistence — uploading bytes to the object store like every other
// generated asset.

import type { EditPlan, Scene } from "@popcorn/shared/types";
import { randomUUID } from "crypto";
import {
  generateStoryboardTile,
  type GeneratedStoryboardTile,
  type StoryboardTileProvider,
} from "@/lib/generative/storyboard-tile";

// The storyboard stage is a low-cost preview, so it uses the cheap default image
// provider unless the environment pins one (e.g. `mock` in tests/CI without
// provider keys).
function tileProvider(): StoryboardTileProvider | undefined {
  const pinned = process.env.STORYBOARD_TILE_PROVIDER;
  if (pinned === "mock" || pinned === "gemini" || pinned === "openai") {
    return pinned;
  }
  return undefined;
}

export async function generateStoryboardTilesForPlan(input: {
  workspaceId: string;
  projectId: string;
  plan: EditPlan;
}): Promise<GeneratedStoryboardTile[]> {
  const provider = tileProvider();

  const tiles: GeneratedStoryboardTile[] = [];
  for (const scene of input.plan.scenes) {
    for (const beat of scene.beats) {
      tiles.push(await generateOne({ projectId: input.projectId, scene, beat, provider }));
    }
  }
  return tiles;
}

async function generateOne(input: {
  projectId: string;
  scene: Scene;
  beat: Scene["beats"][number];
  provider?: StoryboardTileProvider;
}): Promise<GeneratedStoryboardTile> {
  return generateStoryboardTile({
    projectId: input.projectId,
    scene: input.scene,
    beat: input.beat,
    ...(input.scene.anchorAssetId ? { sceneAnchorAssetId: input.scene.anchorAssetId } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    newId: () => randomUUID(),
  });
}
