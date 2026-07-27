// Mount point: aggregates every per-tool battery into one lookup. Add a new
// tool's spec import here. A startup check asserts every vocabulary tool has
// a battery so a newly-declared tool can't silently lack test coverage.

import {
  DOMAIN_TOOL_NAMES,
  PRODUCTION_TOOL_NAMES,
  type ToolName,
} from "@/lib/orchestrator";
import type { ToolBattery } from "./types";

import { assembleTimelineBattery } from "./specs/assemble-timeline";
import { createOrLoadBriefBattery } from "./specs/create-or-load-brief";
import { critiqueTimelineBattery } from "./specs/critique-timeline";
import { developStoryBlueprintBattery } from "./specs/develop-story-blueprint";
import { draftScriptBattery } from "./specs/draft-script";
import { editVideoAssetBattery } from "./specs/edit-video-asset";
import { exportVideoBattery } from "./specs/export-video";
import { fitAudioToPictureBattery } from "./specs/fit-audio-to-picture";
import { generateAnchorBattery } from "./specs/generate-anchor";
import { generateAudioBattery } from "./specs/generate-audio";
import { generateClipBattery } from "./specs/generate-clip";
import { generateKeyframeBattery } from "./specs/generate-keyframe";
import { generateStoryboardBattery } from "./specs/generate-storyboard";
import { generateImageAssetBattery } from "./specs/generate-image-asset";
import { generateVideoAssetBattery } from "./specs/generate-video-asset";
import { planShotsBattery } from "./specs/plan-shots";
import { planVisualAnchorsBattery } from "./specs/plan-visual-anchors";
import { publishToCatalogBattery } from "./specs/publish-to-catalog";
import { regenerateImageAssetBattery } from "./specs/regenerate-image-asset";
import { requestApprovalBattery } from "./specs/request-approval";

const ALL_BATTERIES: ToolBattery[] = [
  createOrLoadBriefBattery,
  developStoryBlueprintBattery,
  draftScriptBattery,
  planShotsBattery,
  planVisualAnchorsBattery,
  generateAnchorBattery,
  generateStoryboardBattery,
  generateKeyframeBattery,
  generateClipBattery,
  regenerateImageAssetBattery,
  editVideoAssetBattery,
  generateImageAssetBattery,
  generateVideoAssetBattery,
  generateAudioBattery,
  fitAudioToPictureBattery,
  assembleTimelineBattery,
  critiqueTimelineBattery,
  requestApprovalBattery,
  exportVideoBattery,
  publishToCatalogBattery,
];

export const batteries: Map<ToolName, ToolBattery> = new Map(
  ALL_BATTERIES.map((battery) => [battery.tool, battery])
);

// Fail loud if a production-vocabulary tool has no battery (or a battery
// names an unknown tool) — keeps the harness honest as the vocabulary grows.
// Root-only dispatch tools (delegate_*) are transport adapters exercised by
// the engine/service test suites, never by the model-in-the-loop media
// harness, so they deliberately have no battery.
const batteryToolNames = [...PRODUCTION_TOOL_NAMES, ...DOMAIN_TOOL_NAMES];
const missing = batteryToolNames.filter((name) => !batteries.has(name));
if (missing.length > 0) {
  throw new Error(`Tool-test batteries missing for: ${missing.join(", ")}`);
}
if (batteries.size !== batteryToolNames.length) {
  throw new Error(
    `Tool-test batteries define ${batteries.size} tools but the battery vocabulary has ${batteryToolNames.length}.`
  );
}

export function listBatteries(): ToolBattery[] {
  return [...batteries.values()];
}

export function getBattery(tool: ToolName): ToolBattery | undefined {
  return batteries.get(tool);
}
