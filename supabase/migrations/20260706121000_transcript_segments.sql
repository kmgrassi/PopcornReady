-- Transcript assets and segment rows for audio-post voiceover sync PR 1.
--
-- The enum value is added in 20260706120000_transcript_asset_kind_enum.sql.
-- This migration keeps transcript identity/provenance in the asset graph and
-- stores user/agent-targetable utterances in relational rows.

set check_function_bodies = off;

alter table public.assets drop constraint assets_kind_media;
alter table public.assets add constraint assets_kind_media check (
  (kind in ('brief','beat','narration_script','critique','plan','story_blueprint','composite','transition','transcript')
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
        when 'transcript'       then 'trn'
      end || '_' || substr(md5(gen_random_uuid()::text), 1, 6);
  end if;
  return new;
end;
$$;

create table public.transcript_segments (
  id                    uuid primary key default gen_random_uuid(),
  schema_version        text not null default 'transcriptSegment.v1',
  workspace_id          uuid not null references public.workspaces (id) on delete cascade,
  project_id            uuid not null references public.projects (id) on delete cascade,
  transcript_asset_id   uuid not null references public.assets (id) on delete cascade,
  position              integer not null,
  start_sec             double precision not null,
  end_sec               double precision not null,
  text                  text not null,
  speaker               text,
  words                 jsonb not null default '[]'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint transcript_segments_position_nonnegative check (position >= 0),
  constraint transcript_segments_time_order check (start_sec >= 0 and end_sec >= start_sec),
  constraint transcript_segments_words_array check (jsonb_typeof(words) = 'array')
);

create unique index transcript_segments_asset_position_idx
  on public.transcript_segments (transcript_asset_id, position);
create index transcript_segments_project_asset_idx
  on public.transcript_segments (project_id, transcript_asset_id);

create trigger transcript_segments_set_updated_at
  before update on public.transcript_segments
  for each row execute function public.set_updated_at();
