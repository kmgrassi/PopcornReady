import type { RerunTarget } from "@popcorn/shared/rerun-proposal";
import {
  getActiveProjectTimelineAsset,
  getProjectStoryboard,
} from "@/lib/api/v1/store";
import {
  getOrchestratorRun,
  listRunActions,
} from "@/lib/api/v1/orchestrator-store";
import {
  buildRerunDecisionPacket,
  RERUN_CONTEXT_LIMITS,
  type RerunDecisionPacket,
  type RerunTimelineItem,
  type RerunTranscriptSegment,
} from "./rerun-decision-context";
import {
  loadProjectGraphSnapshot,
  type ProjectGraphSnapshot,
} from "@/lib/orchestrator-context/graph-snapshot";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";

function compactText(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  return value.trim().slice(0, RERUN_CONTEXT_LIMITS.summaryText);
}

export function canonicalTimelineItemIds(value: unknown): Set<string> {
  return new Set(canonicalTimelineItems(value).map((row) => row.id));
}

export function canonicalTimelineItems(value: unknown): RerunTimelineItem[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const segments = (value as { segments?: unknown }).segments;
  if (!Array.isArray(segments)) return [];
  return segments.flatMap((segment) => {
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) return [];
    const row = segment as Record<string, unknown>;
    const id = row.id;
    const clipAssetId = row.clipId;
    if (typeof id !== "string" || id.length === 0 || id.length > 128 ||
        typeof clipAssetId !== "string" || clipAssetId.length === 0 ||
        clipAssetId.length > 200) {
      return [];
    }
    const numberOrNull = (candidate: unknown) =>
      typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
    const textOrNull = (candidate: unknown) =>
      typeof candidate === "string" ? compactText(candidate) : null;
    return [{
      id,
      clipAssetId,
      beatId: typeof row.beatId === "string" ? row.beatId : null,
      sourceInSec: numberOrNull(row.sourceInSec),
      sourceOutSec: numberOrNull(row.sourceOutSec),
      role: textOrNull(row.role),
      reason: textOrNull(row.reason),
      caption: textOrNull(row.caption),
    }];
  });
}

export async function loadRerunDecisionPacket(input: {
  workspaceId: string;
  projectId: string;
  rootRunId?: string;
  targets: RerunTarget[];
  userIntent: string;
}): Promise<RerunDecisionPacket> {
  const snapshot = await loadProjectGraphSnapshot({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
  });
  const recentRunIds = [...new Set([
    ...(input.rootRunId ? [input.rootRunId] : []),
    ...snapshot.runs
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10)
      .map((run) => run.id),
  ])];
  const [rootRun, actions, timeline, transcriptSegments, canonicalStory] = await Promise.all([
    input.rootRunId ? getOrchestratorRun(input.rootRunId) : Promise.resolve(null),
    Promise.all(recentRunIds.map((runId) => listRunActions(runId))).then((actionLists) => {
      const byId = new Map(actionLists.flat().map((action) => [action.id, action]));
      return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }),
    getActiveProjectTimelineAsset({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    }),
    listTranscriptSegments(
      input.projectId,
      input.targets.flatMap((target) =>
        target.kind === "transcript_segment" ? [target.transcriptSegmentId] : [])
    ),
    getProjectStoryboard(input.workspaceId, input.projectId),
  ]);
  // Replace compatibility storyboard rows with the live relational story spine
  // before target authorization or pinning.
  const canonicalSnapshot: ProjectGraphSnapshot = canonicalStory
    ? {
        ...snapshot,
        storyboards: [{
          id: canonicalStory.id,
          projectId: canonicalStory.projectId,
          status: canonicalStory.status,
          planAssetId: canonicalStory.planAssetId,
        }],
        scenes: canonicalStory.scenes.map((scene) => ({
          id: scene.id,
          projectId: scene.projectId,
          storyboardId: scene.storyboardId,
          sceneIndex: scene.sceneIndex,
          ...(scene.title ? { title: scene.title } : {}),
          ...(scene.summary ? { summary: scene.summary } : {}),
          ...(scene.durationSec != null ? { durationSec: scene.durationSec } : {}),
          sceneAssetId: scene.sceneAssetId,
          storySnapshotAssetId: canonicalStory.planAssetId,
          status: scene.status,
        })),
        beats: canonicalStory.scenes.flatMap((scene) => scene.beats.map((beat) => ({
          id: beat.id,
          projectId: beat.projectId,
          sceneId: beat.sceneId,
          beatIndex: beat.beatIndex,
          intent: beat.intent,
          ...(beat.visualDescription ? { visualDescription: beat.visualDescription } : {}),
          ...(beat.dialogueSummary ? { dialogueSummary: beat.dialogueSummary } : {}),
          ...(beat.narration ? { narration: beat.narration } : {}),
          ...(beat.durationSec != null ? { durationSec: beat.durationSec } : {}),
          status: beat.status,
          beatAssetId: beat.beatAssetId,
        }))),
        panels: canonicalStory.scenes.flatMap((scene) => scene.beats.flatMap((beat) =>
          beat.panels.map((panel) => ({
            id: panel.id,
            projectId: panel.projectId,
            beatId: panel.beatId,
            panelIndex: panel.panelIndex,
            imageAssetId: panel.imageAssetId,
            promptAssetId: panel.promptAssetId,
            status: panel.status,
            isSelected: panel.isSelected,
            ...(panel.approvedAt ? { approvedAt: panel.approvedAt } : {}),
          }))
        )),
      }
    : { ...snapshot, storyboards: [], scenes: [], beats: [], panels: [] };
  return buildRerunDecisionPacket({
    snapshot: canonicalSnapshot,
    rootRun,
    targets: input.targets,
    userIntent: input.userIntent,
    ...(timeline ? {
      timelineAssetId: timeline.assetId,
      timelineItems: canonicalTimelineItems(timeline.timeline),
    } : {}),
    transcriptSegments,
    recentActions: actions,
  });
}

async function listTranscriptSegments(
  projectId: string,
  explicitSegmentIds: string[]
): Promise<RerunTranscriptSegment[]> {
  const db = getServiceSupabase();
  const columns = "id, transcript_asset_id, position, start_sec, end_sec, text, speaker";
  const [explicitRows, remainderRows] = await Promise.all([
    explicitSegmentIds.length > 0
      ? runQuery(
        "rerunDecisionContext.listTranscriptSegments explicit",
        db
          .from("transcript_segments")
          .select(columns)
          .eq("project_id", projectId)
          .in("id", explicitSegmentIds)
      )
      : Promise.resolve([]),
    runQuery(
      "rerunDecisionContext.listTranscriptSegments remainder",
      db
        .from("transcript_segments")
        .select(columns)
        .eq("project_id", projectId)
        .order("position", { ascending: true })
        .limit(500)
    ),
  ]);
  type TranscriptSegmentRow = {
    id: string;
    transcript_asset_id: string;
    position: number;
    start_sec: number;
    end_sec: number;
    text: string;
    speaker: string | null;
  };
  const rows: TranscriptSegmentRow[] = [];
  const seen = new Set<string>();
  for (const row of [...(explicitRows ?? []), ...(remainderRows ?? [])] as TranscriptSegmentRow[]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  return rows.map((row) => ({
    id: row.id,
    transcriptAssetId: row.transcript_asset_id,
    position: row.position,
    startSec: row.start_sec,
    endSec: row.end_sec,
    text: row.text.slice(0, RERUN_CONTEXT_LIMITS.summaryText),
    speaker: compactText(row.speaker ?? undefined),
  }));
}
