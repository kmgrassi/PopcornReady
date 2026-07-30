import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseGraphSnapshotReader } from "../graph-snapshot";

interface QueryCall {
  table: string;
  selected?: string;
  filters: Array<{ column: string; value: unknown }>;
}

interface QueryResult {
  data: unknown;
  error: null;
}

class FakeQueryBuilder implements PromiseLike<QueryResult> {
  constructor(
    private readonly call: QueryCall,
    private readonly data: unknown
  ) {}

  select(columns: string): this {
    this.call.selected = columns;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.call.filters.push({ column, value });
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.data, error: null }).then(
      onfulfilled,
      onrejected
    );
  }
}

function fakeDatabase(
  rowsByTable: Record<string, unknown>
): { database: SupabaseClient; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const database = {
    from(table: string) {
      const call: QueryCall = { table, filters: [] };
      calls.push(call);
      return new FakeQueryBuilder(call, rowsByTable[table] ?? []);
    },
  } as unknown as SupabaseClient;
  return { database, calls };
}

test("production graph reader projects the unified story spine without retired table reads", async () => {
  const projectId = "project_1";
  const fixture = fakeDatabase({
    story_blueprints: [
      {
        id: "story_approved",
        project_id: projectId,
        status: "approved",
        provenance: { planAssetId: "plan_asset_1" },
      },
      {
        id: "story_draft",
        project_id: projectId,
        status: "draft",
        provenance: { planAssetId: 42 },
      },
      {
        id: "story_superseded",
        project_id: projectId,
        status: "superseded",
        provenance: null,
      },
    ],
    story_blueprint_scenes: [
      {
        id: "scene_1",
        project_id: projectId,
        story_blueprint_id: "story_approved",
        position: 0,
        title: "Opening",
        summary: "A concise opening.",
        target_duration_sec: 0,
        scene_asset_id: "scene_asset_1",
        status: "ready",
      },
      {
        id: "scene_2",
        project_id: projectId,
        story_blueprint_id: "story_approved",
        position: 1,
        title: null,
        summary: null,
        target_duration_sec: null,
        scene_asset_id: null,
        status: "draft",
      },
    ],
    story_beats: [
      {
        id: "beat_1",
        project_id: projectId,
        scene_id: "scene_1",
        beat_index: 0,
        intent: "Reveal the subject.",
        visual_description: "Centered composition.",
        dialogue_summary: null,
        narration: null,
        duration_sec: 0,
        status: "ready",
        beat_asset_id: "beat_asset_1",
      },
    ],
    story_panels: [
      {
        id: "panel_1",
        project_id: projectId,
        beat_id: "beat_1",
        panel_index: 0,
        image_asset_id: "image_asset_1",
        prompt_asset_id: null,
        status: "ready",
        is_selected: true,
        approved_at: "2026-07-30T12:00:00.000Z",
      },
    ],
  });
  const reader = createSupabaseGraphSnapshotReader(() => fixture.database);

  const [storyboards, scenes, beats, panels] = await Promise.all([
    reader.listStoryboards(projectId),
    reader.listScenes(projectId),
    reader.listBeats(projectId),
    reader.listPanels(projectId),
  ]);

  assert.deepEqual(storyboards, [
    {
      id: "story_approved",
      projectId,
      status: "approved",
      planAssetId: "plan_asset_1",
    },
    {
      id: "story_draft",
      projectId,
      status: "ready",
      planAssetId: null,
    },
    {
      id: "story_superseded",
      projectId,
      status: "ready",
      planAssetId: null,
    },
  ]);
  assert.deepEqual(scenes, [
    {
      id: "scene_1",
      projectId,
      storyboardId: "story_approved",
      sceneIndex: 0,
      title: "Opening",
      summary: "A concise opening.",
      durationSec: 0,
      sceneAssetId: "scene_asset_1",
      status: "ready",
    },
    {
      id: "scene_2",
      projectId,
      storyboardId: "story_approved",
      sceneIndex: 1,
      sceneAssetId: null,
      status: "draft",
    },
  ]);
  assert.deepEqual(beats, [
    {
      id: "beat_1",
      projectId,
      sceneId: "scene_1",
      beatIndex: 0,
      intent: "Reveal the subject.",
      visualDescription: "Centered composition.",
      durationSec: 0,
      status: "ready",
      beatAssetId: "beat_asset_1",
    },
  ]);
  assert.deepEqual(panels, [
    {
      id: "panel_1",
      projectId,
      beatId: "beat_1",
      panelIndex: 0,
      imageAssetId: "image_asset_1",
      promptAssetId: null,
      status: "ready",
      isSelected: true,
      approvedAt: "2026-07-30T12:00:00.000Z",
    },
  ]);

  assert.deepEqual(
    fixture.calls.map((call) => call.table),
    [
      "story_blueprints",
      "story_blueprint_scenes",
      "story_beats",
      "story_panels",
    ]
  );
  assert.ok(
    fixture.calls.every((call) =>
      call.filters.some(
        (filter) =>
          filter.column === "project_id" && filter.value === projectId
      )
    )
  );
  assert.match(
    fixture.calls[0]?.selected ?? "",
    /id, project_id, status, provenance/
  );
  assert.match(
    fixture.calls[1]?.selected ?? "",
    /story_blueprint_id, position/
  );

  const source = readFileSync(
    new URL("../graph-snapshot.ts", import.meta.url),
    "utf8"
  );
  for (const retiredTable of [
    "storyboards",
    "storyboard_scenes",
    "storyboard_beats",
    "storyboard_panels",
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`\\.from\\([\"']${retiredTable}[\"']\\)`)
    );
  }
});
