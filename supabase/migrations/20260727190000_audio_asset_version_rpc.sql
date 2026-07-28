-- Specialist-agent orchestration PR 11: immutable Audio revisions.
--
-- A delivery/mix revision is not a new unrelated soundtrack. It mints the next
-- row in the existing audio lineage while preserving the old bytes and graph
-- history. Selection movement remains a separate, explicitly pinned operation;
-- this RPC never repoints a slot implicitly.

create or replace function public.mint_audio_asset_version(
  p_workspace_id uuid,
  p_project_id uuid,
  p_source_asset_id uuid,
  p_action_id uuid,
  p_asset jsonb
)
returns public.assets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.assets;
  v_new public.assets;
  v_next_version integer;
  v_inputs jsonb;
begin
  select * into v_source
  from public.assets
  where id = p_source_asset_id
    and workspace_id = p_workspace_id
    and project_id = p_project_id;

  if not found then
    raise exception 'audio_revision_source_not_found'
      using errcode = 'no_data_found';
  end if;
  if v_source.media <> 'audio'
     or v_source.kind <> 'audio_track'
     or v_source.status <> 'ready' then
    raise exception 'audio_revision_source_invalid'
      using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(p_asset->>'workspace_id', '') <> p_workspace_id::text
     or coalesce(p_asset->>'project_id', '') <> p_project_id::text
     or coalesce(p_asset->>'media', '') <> 'audio'
     or coalesce(p_asset->>'kind', '') <> 'audio_track' then
    raise exception 'audio_revision_payload_invalid'
      using errcode = 'invalid_parameter_value';
  end if;

  v_inputs := coalesce(p_asset->'inputs', '[]'::jsonb);
  if not exists (
    select 1
    from jsonb_array_elements(v_inputs) item
    where item->>'assetId' = p_source_asset_id::text
      and item->>'role' = 'source'
  ) then
    raise exception 'audio_revision_source_edge_required'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Acquire lineage authority before any row lock. Locking two different source
  -- versions first would allow cross-version revisions to deadlock while each
  -- waited on the other's row.
  perform pg_advisory_xact_lock(hashtextextended(v_source.lineage_id::text, 0));

  select * into v_source
  from public.assets
  where id = p_source_asset_id
    and workspace_id = p_workspace_id
    and project_id = p_project_id
  for update;

  if not found then
    raise exception 'audio_revision_source_not_found'
      using errcode = 'no_data_found';
  end if;
  if v_source.media <> 'audio'
     or v_source.kind <> 'audio_track'
     or v_source.status <> 'ready' then
    raise exception 'audio_revision_source_invalid'
      using errcode = 'invalid_parameter_value';
  end if;
  perform 1
  from public.assets
  where lineage_id = v_source.lineage_id
    and workspace_id = p_workspace_id
  order by version
  for update;

  select coalesce(max(version), 0) + 1
  into v_next_version
  from public.assets
  where lineage_id = v_source.lineage_id
    and workspace_id = p_workspace_id;

  insert into public.assets (
    id,
    schema_version,
    workspace_id,
    project_id,
    lineage_id,
    version,
    kind,
    media,
    status,
    role,
    name,
    slug,
    filename,
    content,
    params,
    inputs,
    content_hash,
    inputs_fingerprint,
    created_by_action_id,
    remote_url,
    storage_key,
    storage_bucket,
    source,
    duration_sec,
    description,
    context,
    semantic_analysis,
    visibility
  ) values (
    (p_asset->>'id')::uuid,
    coalesce(p_asset->>'schema_version', v_source.schema_version),
    p_workspace_id,
    p_project_id,
    v_source.lineage_id,
    v_next_version,
    'audio_track',
    'audio',
    'ready',
    coalesce(p_asset->>'role', v_source.role),
    coalesce(p_asset->>'name', v_source.name),
    null,
    coalesce(p_asset->>'filename', v_source.filename),
    null,
    p_asset->'params',
    v_inputs,
    nullif(p_asset->>'content_hash', ''),
    nullif(p_asset->>'inputs_fingerprint', ''),
    p_action_id,
    null,
    nullif(p_asset->>'storage_key', ''),
    nullif(p_asset->>'storage_bucket', ''),
    coalesce(p_asset->'source', v_source.source),
    nullif(p_asset->>'duration_sec', '')::double precision,
    nullif(p_asset->>'description', ''),
    p_asset->'context',
    p_asset->'semantic_analysis',
    v_source.visibility
  )
  returning * into v_new;

  return v_new;
end;
$$;

comment on function public.mint_audio_asset_version(
  uuid, uuid, uuid, uuid, jsonb
) is
  'Mints one immutable audio_track version in an existing lineage with an explicit source edge; never moves selections.';

revoke all on function public.mint_audio_asset_version(
  uuid, uuid, uuid, uuid, jsonb
) from public, anon, authenticated;

grant execute on function public.mint_audio_asset_version(
  uuid, uuid, uuid, uuid, jsonb
) to service_role;
