import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createSupabaseGraphSnapshotReader,
  loadProjectGraphSnapshot,
} from "../graph-snapshot";

const workspaceId = "workspace_reader";
const projectId = "project_reader";
const blueprintId = "blueprint_reader";
const actionId = "action_reader";
const runId = "run_reader";

interface QueryCall {
  table: string;
  select?: string;
  filters: Array<{ method: string; column: string; value: unknown }>;
}

class RecordingQuery implements PromiseLike<{ data: unknown; error: null }> {
  readonly call: QueryCall;

  constructor(
    table: string,
    private readonly resolveData: (call: QueryCall) => unknown
  ) {
    this.call = { table, filters: [] };
  }

  select(columns: string): this {
    this.call.select = columns;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.call.filters.push({ method: "eq", column, value });
    return this;
  }

  neq(column: string, value: unknown): this {
    this.call.filters.push({ method: "neq", column, value });
    return this;
  }

  in(column: string, value: unknown): this {
    this.call.filters.push({ method: "in", column, value });
    return this;
  }

  maybeSingle(): this {
    return this;
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({
      data: this.resolveData(this.call),
      error: null,
    }).then(onfulfilled, onrejected);
  }
}

function fixtureData(call: QueryCall): unknown {
  if (call.table === "projects" && call.select === "id, workspace_id") {
    return { id: projectId, workspace_id: workspaceId };
  }
  if (call.table === "projects" && call.select === "current_story_blueprint_id") {
    return { current_story_blueprint_id: blueprintId };
  }
  if (
    call.table === "story_blueprints" &&
    call.select === "id, project_id, asset_id, brief_asset_id, status"
  ) {
    return {
      id: blueprintId,
      project_id: projectId,
      asset_id: "blueprint_asset",
      brief_asset_id: "brief_asset",
      status: "approved",
    };
  }
  if (
    call.table === "story_blueprints" &&
    call.select === "id, project_id, status, provenance"
  ) {
    return [{
      id: blueprintId,
      project_id: projectId,
      status: "approved",
      provenance: { planAssetId: "plan_asset" },
    }];
  }
  if (
    call.table === "story_blueprint_scenes" &&
    call.select ===
      "id, project_id, story_blueprint_id, position, title, summary, target_duration_sec, scene_asset_id, status"
  ) {
    return [{
      id: "scene_reader",
      project_id: projectId,
      story_blueprint_id: blueprintId,
      position: 2,
      title: "Current scene",
      summary: "Mapped from the unified story spine.",
      target_duration_sec: 7,
      scene_asset_id: null,
      status: "ready",
    }];
  }
  if (
    call.table === "story_beats" &&
    call.select ===
      "id, project_id, scene_id, beat_index, intent, visual_description, dialogue_summary, narration, duration_sec, status, beat_asset_id"
  ) {
    return [{
      id: "beat_reader",
      project_id: projectId,
      scene_id: "scene_reader",
      beat_index: 3,
      intent: "Prove the current beat relation.",
      visual_description: "A current-schema beat.",
      dialogue_summary: null,
      narration: null,
      duration_sec: 4,
      status: "ready",
      beat_asset_id: null,
    }];
  }
  if (
    call.table === "story_panels" &&
    call.select ===
      "id, project_id, beat_id, panel_index, image_asset_id, prompt_asset_id, status, is_selected, approved_at"
  ) {
    return [{
      id: "panel_reader",
      project_id: projectId,
      beat_id: "beat_reader",
      panel_index: 1,
      image_asset_id: null,
      prompt_asset_id: null,
      status: "ready",
      is_selected: true,
      approved_at: null,
    }];
  }
  if (call.table === "assets") {
    return [{
      id: "asset_reader",
      project_id: projectId,
      workspace_id: workspaceId,
      ref: "kf_reader",
      lineage_id: "lineage_reader",
      version: 1,
      kind: "keyframe",
      media: "image",
      status: "ready",
      role: "primary",
      description: "Reader fixture",
      duration_sec: null,
      content_hash: "hash_reader",
      inputs_fingerprint: "fingerprint_reader",
      created_by_action_id: actionId,
      inputs: [],
      created_at: "2026-07-30T00:00:00.000Z",
    }];
  }
  if (call.table === "current_selections") return [];
  if (call.table === "actions") {
    return [{ id: actionId, project_id: projectId, orchestrator_run_id: runId }];
  }
  if (call.table === "orchestrator_runs") {
    return [{
      id: runId,
      project_id: projectId,
      status: "waiting",
      agent_role: "root",
      agent_session_id: null,
      session_sequence: null,
      task_kind: null,
      origin_kind: "creator_direct",
      wait_reason: "approval",
      created_at: "2026-07-30T00:00:00.000Z",
      completed_at: null,
    }];
  }
  if (call.table === "agent_sessions") return [];
  if (call.table === "orchestrator_run_gates") {
    return [{
      id: "gate_reader",
      orchestrator_run_id: runId,
      stage: "storyboard",
      status: "pending",
    }];
  }
  throw new Error(`Missing recording fixture for ${call.table} select ${call.select}`);
}

test("production graph reader queries and maps the unified story spine", async () => {
  const calls: QueryCall[] = [];
  const db = {
    from(table: string) {
      const query = new RecordingQuery(table, fixtureData);
      calls.push(query.call);
      return query;
    },
  } as unknown as SupabaseClient;

  const snapshot = await loadProjectGraphSnapshot(
    { workspaceId, projectId },
    createSupabaseGraphSnapshotReader(() => db)
  );

  assert.deepEqual(
    calls
      .filter((call) => call.table.startsWith("story"))
      .map((call) => call.table)
      .sort(),
    [
      "story_beats",
      "story_blueprint_scenes",
      "story_blueprints",
      "story_blueprints",
      "story_panels",
    ]
  );
  const storySelects = new Map(
    calls
      .filter((call) =>
        new Set([
          "story_blueprints",
          "story_blueprint_scenes",
          "story_beats",
          "story_panels",
        ]).has(call.table)
      )
      .map((call) => [`${call.table}:${call.select}`, true])
  );
  for (const [table, selectedColumns] of [
    ["story_blueprints", "id, project_id, status, provenance"],
    [
      "story_blueprint_scenes",
      "id, project_id, story_blueprint_id, position, title, summary, target_duration_sec, scene_asset_id, status",
    ],
    [
      "story_beats",
      "id, project_id, scene_id, beat_index, intent, visual_description, dialogue_summary, narration, duration_sec, status, beat_asset_id",
    ],
    [
      "story_panels",
      "id, project_id, beat_id, panel_index, image_asset_id, prompt_asset_id, status, is_selected, approved_at",
    ],
  ]) {
    assert.equal(
      storySelects.get(`${table}:${selectedColumns}`),
      true,
      `${table} must select only current-schema columns`
    );
  }
  assert.ok(
    calls.every(
      (call) =>
        call.table === "orchestrator_run_gates" ||
        call.filters.some(
          (filter) =>
            filter.column === "project_id" ||
            (call.table === "projects" &&
              filter.column === "id" &&
              filter.value === projectId)
        )
    ),
    "every project-owned production read keeps an explicit project predicate"
  );
  assert.deepEqual(snapshot.storyboards, [{
    id: blueprintId,
    projectId,
    status: "approved",
    planAssetId: "plan_asset",
  }]);
  assert.deepEqual(snapshot.scenes[0], {
    id: "scene_reader",
    projectId,
    storyboardId: blueprintId,
    sceneIndex: 2,
    title: "Current scene",
    summary: "Mapped from the unified story spine.",
    durationSec: 7,
    sceneAssetId: null,
    status: "ready",
  });
  assert.deepEqual(snapshot.beats[0], {
    id: "beat_reader",
    projectId,
    sceneId: "scene_reader",
    beatIndex: 3,
    intent: "Prove the current beat relation.",
    visualDescription: "A current-schema beat.",
    durationSec: 4,
    status: "ready",
    beatAssetId: null,
  });
  assert.deepEqual(snapshot.panels[0], {
    id: "panel_reader",
    projectId,
    beatId: "beat_reader",
    panelIndex: 1,
    imageAssetId: null,
    promptAssetId: null,
    status: "ready",
    isSelected: true,
  });
  assert.equal(snapshot.actionLinks[0]?.id, actionId);
  assert.equal(snapshot.runGates[0]?.id, "gate_reader");

  for (const retired of [
    "storyboards",
    "storyboard_scenes",
    "storyboard_beats",
    "storyboard_panels",
  ]) {
    assert.ok(
      !calls.some((call) => call.table === retired),
      `production reader must not query retired ${retired}`
    );
  }
});
