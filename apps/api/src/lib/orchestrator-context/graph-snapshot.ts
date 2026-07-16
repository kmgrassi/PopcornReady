// Specialist-agent orchestration PR 7 — fresh authorized graph snapshot.
//
// One read-only load of the CURRENT graph/relational state for one authorized
// project. Projections (root-projection.ts, domain-projection.ts) are pure
// functions over this snapshot, so every finite agent turn rebuilds context
// from live graph state instead of trusting a stale copy in session memory
// ("the asset graph is the real communication channel",
// docs/scopes/specialist-agent-orchestration-prs.md).
//
// Authorization is enforced HERE, before any content row is read: the project
// must exist inside the caller-supplied workspace. Every fetched row is also
// re-checked against the authorized project id (defense in depth against a
// misbehaving reader), so a foreign row can never enter agent context.
//
// This module owns its own read queries on purpose: PRs 5-6 own the
// store/lifecycle write paths (orchestrator-store.ts, engine recordInvocation),
// and PR 7 must not edit them (scope merge-conflict plan).

import type { AgentDomain, AgentRole } from "@popcorn/shared/domain-agent-contract";

import { getServiceSupabase } from "../supabase/clients";
import { runQuery } from "../supabase/db-errors";
import { ApiError } from "../api/v1/errors";

export type SnapshotOriginKind = "creative_director" | "creator_direct";

export interface SnapshotAssetInput {
  assetId: string;
  relation: string;
  role?: string;
  position?: number;
  contentHash?: string;
}

export interface SnapshotAsset {
  id: string;
  projectId: string;
  workspaceId: string;
  ref?: string;
  lineageId: string;
  version: number;
  kind: string;
  media: string;
  status: string;
  role?: string;
  name?: string;
  description?: string;
  durationSec?: number;
  contentHash?: string;
  inputsFingerprint?: string;
  createdByActionId?: string;
  inputs: SnapshotAssetInput[];
  createdAt: string;
}

export interface SnapshotSelection {
  projectId: string;
  slotOwnerLineageId: string | null;
  slotRole: string;
  seq: number;
  activeAssetId: string;
  setByActionId?: string;
}

export interface SnapshotStoryBlueprint {
  id: string;
  projectId: string;
  assetId: string | null;
  briefAssetId: string | null;
  status: string;
}

export interface SnapshotStoryboard {
  id: string;
  projectId: string;
  status: string;
  planAssetId: string | null;
}

export interface SnapshotStoryboardScene {
  id: string;
  projectId: string;
  storyboardId: string;
  sceneIndex: number;
  title?: string;
  summary?: string;
  durationSec?: number;
  sceneAssetId: string | null;
  status: string;
}

export interface SnapshotStoryboardBeat {
  id: string;
  projectId: string;
  sceneId: string;
  beatIndex: number;
  intent: string;
  visualDescription?: string;
  dialogueSummary?: string;
  narration?: string;
  durationSec?: number;
  status: string;
  beatAssetId: string | null;
}

export interface SnapshotStoryboardPanel {
  id: string;
  projectId: string;
  beatId: string;
  panelIndex: number;
  imageAssetId: string | null;
  promptAssetId: string | null;
  status: string;
  isSelected: boolean;
  approvedAt?: string;
}

/** Minimal action join used only to attribute assets to their creating run. */
export interface SnapshotActionLink {
  id: string;
  projectId: string;
  orchestratorRunId: string | null;
}

export interface SnapshotRun {
  id: string;
  projectId: string;
  status: string;
  agentRole: AgentRole;
  agentSessionId: string | null;
  sessionSequence: number | null;
  taskKind: string | null;
  originKind: SnapshotOriginKind | null;
  waitReason: string | null;
  createdAt: string;
  completedAt?: string;
}

export interface SnapshotAgentSession {
  id: string;
  projectId: string;
  domain: AgentDomain;
  activeRunId: string | null;
  nextSequence: number;
  claimGeneration: number;
  summaryThroughSequence: number;
  summaryVersion: number;
}

export interface SnapshotRunGate {
  id: string;
  orchestratorRunId: string;
  stage: string;
  status: string;
}

export interface ProjectGraphSnapshot {
  projectId: string;
  workspaceId: string;
  /** Freshness marker: when this snapshot was read from the live graph. */
  loadedAt: string;
  assets: SnapshotAsset[];
  selections: SnapshotSelection[];
  storyBlueprint: SnapshotStoryBlueprint | null;
  storyboards: SnapshotStoryboard[];
  scenes: SnapshotStoryboardScene[];
  beats: SnapshotStoryboardBeat[];
  panels: SnapshotStoryboardPanel[];
  actionLinks: SnapshotActionLink[];
  runs: SnapshotRun[];
  agentSessions: SnapshotAgentSession[];
  runGates: SnapshotRunGate[];
  /** Foreign rows a reader returned and the loader refused (defense in depth). */
  droppedForeignRowCount: number;
}

/**
 * Read-side dependency seam. The production reader talks to Supabase; tests
 * inject deterministic fixtures. Every method returns raw rows for ONE project;
 * the loader still re-verifies tenancy on each row.
 */
export interface GraphSnapshotReader {
  /**
   * Returns the project identity iff `projectId` exists inside `workspaceId`
   * and is not deleted. MUST be the first read; a null return aborts the load
   * before any content is fetched.
   */
  getAuthorizedProject(
    workspaceId: string,
    projectId: string
  ): Promise<{ id: string; workspaceId: string } | null>;
  listAssets(projectId: string): Promise<SnapshotAsset[]>;
  listCurrentSelections(projectId: string): Promise<SnapshotSelection[]>;
  getActiveStoryBlueprint(projectId: string): Promise<SnapshotStoryBlueprint | null>;
  listStoryboards(projectId: string): Promise<SnapshotStoryboard[]>;
  listScenes(projectId: string): Promise<SnapshotStoryboardScene[]>;
  listBeats(projectId: string): Promise<SnapshotStoryboardBeat[]>;
  listPanels(projectId: string): Promise<SnapshotStoryboardPanel[]>;
  listActionLinks(projectId: string, actionIds: string[]): Promise<SnapshotActionLink[]>;
  listRuns(projectId: string): Promise<SnapshotRun[]>;
  listAgentSessions(projectId: string): Promise<SnapshotAgentSession[]>;
  listRunGates(projectId: string, runIds: string[]): Promise<SnapshotRunGate[]>;
}

function keepProjectRows<Row extends { projectId: string }>(
  rows: Row[],
  projectId: string,
  dropped: { count: number }
): Row[] {
  const kept: Row[] = [];
  for (const row of rows) {
    if (row.projectId === projectId) kept.push(row);
    else dropped.count += 1;
  }
  return kept;
}

/**
 * Load one fresh, authorized snapshot of the project graph. Throws before any
 * content read when the caller's workspace does not own the project.
 */
export async function loadProjectGraphSnapshot(
  input: { workspaceId: string; projectId: string },
  reader: GraphSnapshotReader = createSupabaseGraphSnapshotReader()
): Promise<ProjectGraphSnapshot> {
  const project = await reader.getAuthorizedProject(input.workspaceId, input.projectId);
  if (!project || project.id !== input.projectId || project.workspaceId !== input.workspaceId) {
    throw new ApiError(
      "forbidden",
      "Project is not accessible from this workspace.",
      { projectId: input.projectId }
    );
  }

  const [
    assetsRaw,
    selectionsRaw,
    storyBlueprintRaw,
    storyboardsRaw,
    scenesRaw,
    beatsRaw,
    panelsRaw,
    runsRaw,
    agentSessionsRaw,
  ] = await Promise.all([
    reader.listAssets(input.projectId),
    reader.listCurrentSelections(input.projectId),
    reader.getActiveStoryBlueprint(input.projectId),
    reader.listStoryboards(input.projectId),
    reader.listScenes(input.projectId),
    reader.listBeats(input.projectId),
    reader.listPanels(input.projectId),
    reader.listRuns(input.projectId),
    reader.listAgentSessions(input.projectId),
  ]);

  const dropped = { count: 0 };
  const assets = keepProjectRows(assetsRaw, input.projectId, dropped).filter((asset) => {
    if (asset.workspaceId === input.workspaceId) return true;
    dropped.count += 1;
    return false;
  });
  const selections = keepProjectRows(selectionsRaw, input.projectId, dropped);
  const storyboards = keepProjectRows(storyboardsRaw, input.projectId, dropped);
  const scenes = keepProjectRows(scenesRaw, input.projectId, dropped);
  const beats = keepProjectRows(beatsRaw, input.projectId, dropped);
  const panels = keepProjectRows(panelsRaw, input.projectId, dropped);
  const runs = keepProjectRows(runsRaw, input.projectId, dropped);
  const agentSessions = keepProjectRows(agentSessionsRaw, input.projectId, dropped);
  const storyBlueprint =
    storyBlueprintRaw && storyBlueprintRaw.projectId === input.projectId
      ? storyBlueprintRaw
      : (storyBlueprintRaw ? (dropped.count += 1, null) : null);

  const creatingActionIds = [
    ...new Set(
      assets.flatMap((asset) => (asset.createdByActionId ? [asset.createdByActionId] : []))
    ),
  ];
  const openRunIds = runs
    .filter((run) => run.status === "queued" || run.status === "running" || run.status === "waiting")
    .map((run) => run.id);

  const [actionLinksRaw, runGatesRaw] = await Promise.all([
    creatingActionIds.length > 0
      ? reader.listActionLinks(input.projectId, creatingActionIds)
      : Promise.resolve([]),
    openRunIds.length > 0
      ? reader.listRunGates(input.projectId, openRunIds)
      : Promise.resolve([]),
  ]);
  const actionLinks = keepProjectRows(actionLinksRaw, input.projectId, dropped);
  const runIdsInProject = new Set(runs.map((run) => run.id));
  const runGates = runGatesRaw.filter((gate) => {
    if (runIdsInProject.has(gate.orchestratorRunId)) return true;
    dropped.count += 1;
    return false;
  });

  return {
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    loadedAt: new Date().toISOString(),
    assets,
    selections,
    storyBlueprint,
    storyboards,
    scenes,
    beats,
    panels,
    actionLinks,
    runs,
    agentSessions,
    runGates,
    droppedForeignRowCount: dropped.count,
  };
}

// ---------------------------------------------------------------------------
// Production Supabase reader. Read-only, service-role client with explicit
// project scoping on every query (tenancy is this module's responsibility on
// the service client; see lib/supabase/clients.ts).
// ---------------------------------------------------------------------------

interface AssetRowShape {
  id: string;
  project_id: string;
  workspace_id: string;
  ref: string | null;
  lineage_id: string;
  version: number;
  kind: string;
  media: string;
  status: string;
  role: string | null;
  name?: string | null;
  description: string | null;
  duration_sec: number | null;
  content_hash: string | null;
  inputs_fingerprint: string | null;
  created_by_action_id: string | null;
  inputs: unknown;
  created_at: string;
}

function snapshotInputs(raw: unknown): SnapshotAssetInput[] {
  if (!Array.isArray(raw)) return [];
  const inputs: SnapshotAssetInput[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.assetId !== "string" || !record.assetId) continue;
    inputs.push({
      assetId: record.assetId,
      relation: typeof record.relation === "string" ? record.relation : "input",
      ...(typeof record.role === "string" ? { role: record.role } : {}),
      ...(typeof record.position === "number" ? { position: record.position } : {}),
      ...(typeof record.contentHash === "string" ? { contentHash: record.contentHash } : {}),
    });
  }
  return inputs;
}

export function createSupabaseGraphSnapshotReader(): GraphSnapshotReader {
  const db = () => getServiceSupabase();
  return {
    async getAuthorizedProject(workspaceId, projectId) {
      const data = await runQuery(
        "orchestratorContext.getAuthorizedProject",
        db()
          .from("projects")
          .select("id, workspace_id")
          .eq("id", projectId)
          .eq("workspace_id", workspaceId)
          .neq("status", "deleted")
          .maybeSingle()
      );
      const row = data as { id: string; workspace_id: string } | null;
      return row ? { id: row.id, workspaceId: row.workspace_id } : null;
    },

    async listAssets(projectId) {
      const data = await runQuery(
        "orchestratorContext.listAssets",
        db()
          .from("assets")
          .select(
            "id, project_id, workspace_id, ref, lineage_id, version, kind, media, status, role, description, duration_sec, content_hash, inputs_fingerprint, created_by_action_id, inputs, created_at"
          )
          .eq("project_id", projectId)
          .in("status", ["ready", "pending"])
      );
      return ((data as AssetRowShape[]) ?? []).map((row) => ({
        id: row.id,
        projectId: row.project_id,
        workspaceId: row.workspace_id,
        ...(row.ref ? { ref: row.ref } : {}),
        lineageId: row.lineage_id,
        version: row.version,
        kind: row.kind,
        media: row.media,
        status: row.status,
        ...(row.role ? { role: row.role } : {}),
        ...(row.description ? { description: row.description } : {}),
        ...(row.duration_sec != null ? { durationSec: row.duration_sec } : {}),
        ...(row.content_hash ? { contentHash: row.content_hash } : {}),
        ...(row.inputs_fingerprint ? { inputsFingerprint: row.inputs_fingerprint } : {}),
        ...(row.created_by_action_id
          ? { createdByActionId: row.created_by_action_id }
          : {}),
        inputs: snapshotInputs(row.inputs),
        createdAt: row.created_at,
      }));
    },

    async listCurrentSelections(projectId) {
      const data = await runQuery(
        "orchestratorContext.listCurrentSelections",
        db()
          .from("current_selections")
          .select("project_id, slot_owner_lineage_id, slot_role, seq, active_asset_id, set_by_action_id")
          .eq("project_id", projectId)
      );
      return (
        (data as Array<{
          project_id: string;
          slot_owner_lineage_id: string | null;
          slot_role: string;
          seq: number;
          active_asset_id: string;
          set_by_action_id: string | null;
        }>) ?? []
      ).map((row) => ({
        projectId: row.project_id,
        slotOwnerLineageId: row.slot_owner_lineage_id,
        slotRole: row.slot_role,
        seq: row.seq,
        activeAssetId: row.active_asset_id,
        ...(row.set_by_action_id ? { setByActionId: row.set_by_action_id } : {}),
      }));
    },

    async getActiveStoryBlueprint(projectId) {
      const project = (await runQuery(
        "orchestratorContext.getActiveStoryBlueprint project",
        db()
          .from("projects")
          .select("current_story_blueprint_id")
          .eq("id", projectId)
          .maybeSingle()
      )) as { current_story_blueprint_id: string | null } | null;
      const currentId = project?.current_story_blueprint_id;
      if (!currentId) return null;
      const data = await runQuery(
        "orchestratorContext.getActiveStoryBlueprint",
        db()
          .from("story_blueprints")
          .select("id, project_id, asset_id, brief_asset_id, status")
          .eq("project_id", projectId)
          .eq("id", currentId)
          .maybeSingle()
      );
      const row = data as {
        id: string;
        project_id: string;
        asset_id: string | null;
        brief_asset_id: string | null;
        status: string;
      } | null;
      return row
        ? {
            id: row.id,
            projectId: row.project_id,
            assetId: row.asset_id,
            briefAssetId: row.brief_asset_id,
            status: row.status,
          }
        : null;
    },

    async listStoryboards(projectId) {
      const data = await runQuery(
        "orchestratorContext.listStoryboards",
        db()
          .from("storyboards")
          .select("id, project_id, status, plan_asset_id")
          .eq("project_id", projectId)
      );
      return (
        (data as Array<{
          id: string;
          project_id: string;
          status: string;
          plan_asset_id: string | null;
        }>) ?? []
      ).map((row) => ({
        id: row.id,
        projectId: row.project_id,
        status: row.status,
        planAssetId: row.plan_asset_id,
      }));
    },

    async listScenes(projectId) {
      const data = await runQuery(
        "orchestratorContext.listScenes",
        db()
          .from("storyboard_scenes")
          .select(
            "id, project_id, storyboard_id, scene_index, title, summary, duration_sec, scene_asset_id, status"
          )
          .eq("project_id", projectId)
      );
      return (
        (data as Array<{
          id: string;
          project_id: string;
          storyboard_id: string;
          scene_index: number;
          title: string | null;
          summary: string | null;
          duration_sec: number | null;
          scene_asset_id: string | null;
          status: string;
        }>) ?? []
      ).map((row) => ({
        id: row.id,
        projectId: row.project_id,
        storyboardId: row.storyboard_id,
        sceneIndex: row.scene_index,
        ...(row.title ? { title: row.title } : {}),
        ...(row.summary ? { summary: row.summary } : {}),
        ...(row.duration_sec != null ? { durationSec: row.duration_sec } : {}),
        sceneAssetId: row.scene_asset_id,
        status: row.status,
      }));
    },

    async listBeats(projectId) {
      const data = await runQuery(
        "orchestratorContext.listBeats",
        db()
          .from("storyboard_beats")
          .select(
            "id, project_id, scene_id, beat_index, intent, visual_description, dialogue_summary, narration, duration_sec, status, beat_asset_id"
          )
          .eq("project_id", projectId)
      );
      return (
        (data as Array<{
          id: string;
          project_id: string;
          scene_id: string;
          beat_index: number;
          intent: string;
          visual_description: string | null;
          dialogue_summary: string | null;
          narration: string | null;
          duration_sec: number | null;
          status: string;
          beat_asset_id: string | null;
        }>) ?? []
      ).map((row) => ({
        id: row.id,
        projectId: row.project_id,
        sceneId: row.scene_id,
        beatIndex: row.beat_index,
        intent: row.intent,
        ...(row.visual_description ? { visualDescription: row.visual_description } : {}),
        ...(row.dialogue_summary ? { dialogueSummary: row.dialogue_summary } : {}),
        ...(row.narration ? { narration: row.narration } : {}),
        ...(row.duration_sec != null ? { durationSec: row.duration_sec } : {}),
        status: row.status,
        beatAssetId: row.beat_asset_id,
      }));
    },

    async listPanels(projectId) {
      const data = await runQuery(
        "orchestratorContext.listPanels",
        db()
          .from("storyboard_panels")
          .select(
            "id, project_id, beat_id, panel_index, image_asset_id, prompt_asset_id, status, is_selected, approved_at"
          )
          .eq("project_id", projectId)
      );
      return (
        (data as Array<{
          id: string;
          project_id: string;
          beat_id: string;
          panel_index: number;
          image_asset_id: string | null;
          prompt_asset_id: string | null;
          status: string;
          is_selected: boolean;
          approved_at: string | null;
        }>) ?? []
      ).map((row) => ({
        id: row.id,
        projectId: row.project_id,
        beatId: row.beat_id,
        panelIndex: row.panel_index,
        imageAssetId: row.image_asset_id,
        promptAssetId: row.prompt_asset_id,
        status: row.status,
        isSelected: row.is_selected,
        ...(row.approved_at ? { approvedAt: row.approved_at } : {}),
      }));
    },

    async listActionLinks(projectId, actionIds) {
      if (actionIds.length === 0) return [];
      const data = await runQuery(
        "orchestratorContext.listActionLinks",
        db()
          .from("actions")
          .select("id, project_id, orchestrator_run_id")
          .eq("project_id", projectId)
          .in("id", actionIds)
      );
      return (
        (data as Array<{
          id: string;
          project_id: string;
          orchestrator_run_id: string | null;
        }>) ?? []
      ).map((row) => ({
        id: row.id,
        projectId: row.project_id,
        orchestratorRunId: row.orchestrator_run_id,
      }));
    },

    async listRuns(projectId) {
      const data = await runQuery(
        "orchestratorContext.listRuns",
        db()
          .from("orchestrator_runs")
          .select(
            "id, project_id, status, agent_role, agent_session_id, session_sequence, task_kind, origin_kind, wait_reason, created_at, completed_at"
          )
          .eq("project_id", projectId)
      );
      return (
        (data as Array<{
          id: string;
          project_id: string;
          status: string;
          agent_role: AgentRole;
          agent_session_id: string | null;
          session_sequence: number | null;
          task_kind: string | null;
          origin_kind: SnapshotOriginKind | null;
          wait_reason: string | null;
          created_at: string;
          completed_at: string | null;
        }>) ?? []
      ).map((row) => ({
        id: row.id,
        projectId: row.project_id,
        status: row.status,
        agentRole: row.agent_role,
        agentSessionId: row.agent_session_id,
        sessionSequence: row.session_sequence,
        taskKind: row.task_kind,
        originKind: row.origin_kind,
        waitReason: row.wait_reason,
        createdAt: row.created_at,
        ...(row.completed_at ? { completedAt: row.completed_at } : {}),
      }));
    },

    async listAgentSessions(projectId) {
      const data = await runQuery(
        "orchestratorContext.listAgentSessions",
        db()
          .from("agent_sessions")
          .select(
            "id, project_id, domain, active_run_id, next_sequence, claim_generation, summary_through_sequence, summary_version"
          )
          .eq("project_id", projectId)
      );
      return (
        (data as Array<{
          id: string;
          project_id: string;
          domain: AgentDomain;
          active_run_id: string | null;
          next_sequence: number;
          claim_generation: number;
          summary_through_sequence: number;
          summary_version: number;
        }>) ?? []
      ).map((row) => ({
        id: row.id,
        projectId: row.project_id,
        domain: row.domain,
        activeRunId: row.active_run_id,
        nextSequence: row.next_sequence,
        claimGeneration: row.claim_generation,
        summaryThroughSequence: row.summary_through_sequence,
        summaryVersion: row.summary_version,
      }));
    },

    async listRunGates(projectId, runIds) {
      if (runIds.length === 0) return [];
      const data = await runQuery(
        "orchestratorContext.listRunGates",
        db()
          .from("orchestrator_run_gates")
          .select("id, orchestrator_run_id, stage, status")
          .in("orchestrator_run_id", runIds)
      );
      return (
        (data as Array<{
          id: string;
          orchestrator_run_id: string;
          stage: string;
          status: string;
        }>) ?? []
      ).map((row) => ({
        id: row.id,
        orchestratorRunId: row.orchestrator_run_id,
        stage: row.stage,
        status: row.status,
      }));
    },
  };
}
