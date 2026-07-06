-- Audio mix graph asset and relational layer rows.
--
-- A mix is a data asset that records why a rendered export sounds the way it
-- does. Individual layers are relational rows because the UI auditions and the
-- agent targets them by id.

set check_function_bodies = off;

alter table public.assets drop constraint assets_kind_media;
alter table public.assets add constraint assets_kind_media check (
  (kind in ('brief','beat','narration_script','critique','plan','story_blueprint','composite','transition','audio_mix')
     and media = 'data')
  or (kind in ('anchor','keyframe','poster') and media = 'image')
  or (kind = 'audio_track' and media = 'audio')
  or (kind = 'clip' and media = 'video')
  or (kind in ('source_footage','render') and media <> 'data')
);

create or replace function public.assets_set_ref()
returns trigger
language plpgsql
as $$
begin
  if new.ref is null then
    new.ref :=
      case new.kind
        when 'source_footage'   then 'src'
        when 'brief'            then 'brief'
        when 'beat'             then 'beat'
        when 'anchor'           then 'anc'
        when 'keyframe'         then 'kf'
        when 'clip'             then 'clip'
        when 'audio_track'      then 'aud'
        when 'narration_script' then 'narr'
        when 'critique'         then 'crit'
        when 'plan'             then 'plan'
        when 'story_blueprint'  then 'story'
        when 'composite'        then 'cut'
        when 'render'           then 'rend'
        when 'poster'           then 'poster'
        when 'transition'       then 'trans'
        when 'audio_mix'        then 'mix'
      end || '_' || substr(md5(gen_random_uuid()::text), 1, 6);
  end if;
  return new;
end;
$$;

create table if not exists public.audio_mix_layers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  mix_asset_id uuid not null references public.assets(id) on delete cascade,
  position integer not null,
  audio_asset_id uuid not null references public.assets(id) on delete restrict,
  role text not null default 'mix_layer',
  gain_db numeric not null default 0,
  duck_under boolean not null default false,
  in_sec numeric not null default 0,
  out_sec numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint audio_mix_layers_position_nonnegative check (position >= 0),
  constraint audio_mix_layers_gain_range check (gain_db >= -60 and gain_db <= 12),
  constraint audio_mix_layers_time_order check (out_sec > in_sec and in_sec >= 0),
  unique (mix_asset_id, position)
);

create index if not exists audio_mix_layers_project_idx
  on public.audio_mix_layers(project_id, mix_asset_id, position);

create or replace function public.audio_mix_layers_validate_assets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mix public.assets%rowtype;
  v_audio public.assets%rowtype;
begin
  select * into v_mix from public.assets where id = new.mix_asset_id;
  if not found or v_mix.kind <> 'audio_mix'::public.graph_asset_kind or v_mix.media <> 'data'::public.asset_media then
    raise exception 'layer_not_audio_mix' using errcode = '23514';
  end if;

  select * into v_audio from public.assets where id = new.audio_asset_id;
  if not found or v_audio.kind <> 'audio_track'::public.graph_asset_kind or v_audio.media <> 'audio'::public.asset_media then
    raise exception 'layer_not_audio' using errcode = '23514';
  end if;

  if v_mix.workspace_id <> new.workspace_id
     or v_mix.project_id <> new.project_id
     or v_audio.workspace_id <> new.workspace_id
     or v_audio.project_id <> new.project_id then
    raise exception 'layer_project_mismatch' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists audio_mix_layers_validate_assets on public.audio_mix_layers;
create trigger audio_mix_layers_validate_assets
  before insert or update on public.audio_mix_layers
  for each row execute function public.audio_mix_layers_validate_assets();
