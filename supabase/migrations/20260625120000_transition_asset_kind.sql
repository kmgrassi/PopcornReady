-- Transition as a first-class asset (foundation).
--
-- Adds the `transition` asset kind (media='data') so a transition between two
-- beats' clips can be its own graph node. The typed content payload is
-- `transition.v1` (see packages/shared/src/transitions.ts); boundary identity is
-- the selection slot `transition:${fromBeatId}`; endpoints are recorded as
-- asset_edges (role 'from' / 'to'). Full design: docs/scopes/transitions-as-assets.md.
--
-- The `transition` enum value is added in the preceding migration
-- (20260625110000_transition_asset_kind_enum.sql); a new graph_asset_kind value
-- cannot be referenced in the same transaction that adds it, so the constraint
-- update lives here, after that change has committed.
--
-- Additive (drop + recreate) per the no-history-rewrite rule. Both objects are
-- recreated from their current definition (20260616121000_story_blueprints.sql)
-- plus the `transition` kind/ref.

set check_function_bodies = off;

alter table public.assets drop constraint assets_kind_media;
alter table public.assets add constraint assets_kind_media check (
  (kind in ('brief','beat','narration_script','critique','plan','story_blueprint','composite','transition')
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
      end || '_' || substr(md5(gen_random_uuid()::text), 1, 6);
  end if;
  return new;
end;
$$;
