import { createHash } from "crypto";

export type StoryboardSearchChunkKind = "storyboard_scene" | "storyboard_beat";

export interface StoryboardSearchChunk {
  chunkKey: string;
  chunkKind: StoryboardSearchChunkKind;
  sourceHash: string;
  sourceText: string;
}

export interface StoryboardSceneChunkInput {
  id: string;
  sceneIndex: number;
  title?: string | null;
  summary?: string | null;
  setting?: string | null;
  mood?: string | null;
  durationSec?: number | null;
}

export interface StoryboardBeatChunkInput {
  id: string;
  beatIndex: number;
  sceneTitle?: string | null;
  sceneSummary?: string | null;
  intent?: string | null;
  visualDescription?: string | null;
  dialogueSummary?: string | null;
  narration?: string | null;
  durationSec?: number | null;
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : null;
}

function addLine(lines: string[], label: string, value: string | number | null | undefined) {
  if (typeof value === "number") {
    lines.push(`${label}: ${value}`);
    return;
  }
  const normalized = normalizeText(value);
  if (normalized) lines.push(`${label}: ${normalized}`);
}

function hashSource(sourceText: string): string {
  return createHash("sha256").update(sourceText).digest("hex");
}

export function buildStoryboardSceneSearchChunk(
  scene: StoryboardSceneChunkInput
): StoryboardSearchChunk | null {
  const lines: string[] = [`Scene ${scene.sceneIndex + 1}`];
  addLine(lines, "Title", scene.title);
  addLine(lines, "Summary", scene.summary);
  addLine(lines, "Setting", scene.setting);
  addLine(lines, "Mood", scene.mood);
  addLine(lines, "Duration seconds", scene.durationSec);

  if (lines.length === 1) return null;

  const sourceText = lines.join("\n");
  return {
    chunkKey: `storyboard.scene.${scene.id}`,
    chunkKind: "storyboard_scene",
    sourceHash: hashSource(sourceText),
    sourceText,
  };
}

export function buildStoryboardBeatSearchChunk(
  beat: StoryboardBeatChunkInput
): StoryboardSearchChunk | null {
  const lines: string[] = [`Beat ${beat.beatIndex + 1}`];
  addLine(lines, "Scene title", beat.sceneTitle);
  addLine(lines, "Scene summary", beat.sceneSummary);
  addLine(lines, "Intent", beat.intent);
  addLine(lines, "Visual description", beat.visualDescription);
  addLine(lines, "Dialogue summary", beat.dialogueSummary);
  addLine(lines, "Narration", beat.narration);
  addLine(lines, "Duration seconds", beat.durationSec);

  if (lines.length === 1) return null;

  const sourceText = lines.join("\n");
  return {
    chunkKey: `storyboard.beat.${beat.id}`,
    chunkKind: "storyboard_beat",
    sourceHash: hashSource(sourceText),
    sourceText,
  };
}
