import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const imageEnumVersion = "20260727180500";
const audioMixEnumReplayVersion = "20260727180600";
const combinedWiringVersion = "20260727181000";

const audioMixEnumReplay = readFileSync(
  new URL(
    `../../../../../../supabase/migrations/${audioMixEnumReplayVersion}_replay_audio_mix_asset_kind_enum.sql`,
    import.meta.url
  ),
  "utf8"
);
const audioMixLayersReplay = readFileSync(
  new URL(
    "../../../../../../supabase/migrations/20260729143000_replay_audio_mix_layers.sql",
    import.meta.url
  ),
  "utf8"
);
const audioMixLayersStatements = audioMixLayersReplay.replace(/^--.*$/gm, "");

test("audio_mix enum replay commits before the combined asset wiring", () => {
  assert.ok(imageEnumVersion < audioMixEnumReplayVersion);
  assert.ok(audioMixEnumReplayVersion < combinedWiringVersion);
  assert.match(
    audioMixEnumReplay,
    /alter type public\.graph_asset_kind add value if not exists 'audio_mix';/
  );
  assert.doesNotMatch(audioMixEnumReplay, /assets_kind_media|assets_set_ref|create table/i);
});

test("audio_mix layer replay restores relational validation and access controls only", () => {
  assert.match(audioMixLayersReplay, /create table if not exists public\.audio_mix_layers/);
  assert.match(
    audioMixLayersReplay,
    /workspace_id uuid not null references public\.workspaces\(id\) on delete cascade/
  );
  assert.match(
    audioMixLayersReplay,
    /project_id uuid not null references public\.projects\(id\) on delete cascade/
  );
  assert.match(
    audioMixLayersReplay,
    /mix_asset_id uuid not null references public\.assets\(id\) on delete cascade/
  );
  assert.match(
    audioMixLayersReplay,
    /audio_asset_id uuid not null references public\.assets\(id\) on delete restrict/
  );
  assert.match(
    audioMixLayersReplay,
    /constraint audio_mix_layers_position_nonnegative check \(position >= 0\)/
  );
  assert.match(
    audioMixLayersReplay,
    /constraint audio_mix_layers_gain_range check \(gain_db >= -60 and gain_db <= 12\)/
  );
  assert.match(
    audioMixLayersReplay,
    /constraint audio_mix_layers_time_order check \(out_sec > in_sec and in_sec >= 0\)/
  );
  assert.match(audioMixLayersReplay, /unique \(mix_asset_id, position\)/);
  assert.match(audioMixLayersReplay, /create index if not exists audio_mix_layers_project_idx/);
  assert.match(
    audioMixLayersReplay,
    /create or replace function public\.audio_mix_layers_validate_assets\(\)[\s\S]*?security definer[\s\S]*?set search_path = public/
  );
  assert.match(
    audioMixLayersReplay,
    /v_mix\.kind <> 'audio_mix'::public\.graph_asset_kind[\s\S]*?v_mix\.media <> 'data'::public\.asset_media[\s\S]*?raise exception 'layer_not_audio_mix'/
  );
  assert.match(
    audioMixLayersReplay,
    /v_audio\.kind <> 'audio_track'::public\.graph_asset_kind[\s\S]*?v_audio\.media <> 'audio'::public\.asset_media[\s\S]*?raise exception 'layer_not_audio'/
  );
  assert.match(
    audioMixLayersReplay,
    /v_mix\.workspace_id <> new\.workspace_id[\s\S]*?v_audio\.project_id <> new\.project_id[\s\S]*?raise exception 'layer_project_mismatch'/
  );
  assert.match(
    audioMixLayersReplay,
    /drop trigger if exists audio_mix_layers_validate_assets on public\.audio_mix_layers;[\s\S]*?create trigger audio_mix_layers_validate_assets/
  );
  assert.match(
    audioMixLayersReplay,
    /alter table public\.audio_mix_layers enable row level security;/
  );
  assert.match(
    audioMixLayersReplay,
    /drop policy if exists audio_mix_layers_owner[\s\S]*?create policy audio_mix_layers_owner[\s\S]*?for all using \(public\.owns_project\(project_id\)\)[\s\S]*?with check \(public\.owns_project\(project_id\)\)/
  );
  assert.match(
    audioMixLayersReplay,
    /drop policy if exists audio_mix_layers_public_read[\s\S]*?create policy audio_mix_layers_public_read[\s\S]*?for select to anon, authenticated[\s\S]*?public\.project_is_public\(project_id\)/
  );
  assert.doesNotMatch(audioMixLayersStatements, /assets_kind_media|assets_set_ref|alter type/i);
});
