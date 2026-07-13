-- The legacy storyboard tables were removed in 20260624170000, but the
-- regeneration RPC still referenced storyboard_panels. Replace that stale
-- reference so an immutable image regeneration can complete.
create or replace function public.regenerate_asset_version(
  p_workspace_id uuid,
  p_old_asset_id uuid,
  p_filename text,
  p_storage_key text,
  p_storage_bucket text,
  p_params jsonb,
  p_content_hash text default null,
  p_duration_sec double precision default null,
  p_action_id uuid default null
)
returns public.assets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.assets;
  v_new public.assets;
  v_sel record;
  v_effective_params jsonb;
  v_inputs_fingerprint text;
  v_next_version integer;
begin
  select * into v_old from public.assets
  where id = p_old_asset_id and workspace_id = p_workspace_id
  for update;
  if not found then
    raise exception 'Asset not found: %', p_old_asset_id using errcode = 'no_data_found';
  end if;
  if v_old.media <> 'image' then
    raise exception 'Asset % is not an image (media=%); only images regenerate from a prompt.',
      p_old_asset_id, v_old.media using errcode = 'invalid_parameter_value';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_old.lineage_id::text));
  perform 1 from public.assets where lineage_id = v_old.lineage_id
    and workspace_id = p_workspace_id order by version for update;
  select coalesce(max(version), 0) + 1 into v_next_version from public.assets
  where lineage_id = v_old.lineage_id and workspace_id = p_workspace_id;
  v_effective_params := coalesce(p_params, v_old.params);
  select encode(extensions.digest(jsonb_build_object(
    'inputHashes', coalesce((select jsonb_agg(jsonb_build_object(
      'assetId', item.value->>'assetId', 'contentHash', coalesce(item.value->>'contentHash', '')
    ) order by item.value->>'assetId') from jsonb_array_elements(coalesce(v_old.inputs, '[]'::jsonb)) item(value)), '[]'::jsonb),
    'paramsHash', encode(extensions.digest(coalesce(v_effective_params, 'null'::jsonb)::text, 'sha256'), 'hex')
  )::text, 'sha256'), 'hex') into v_inputs_fingerprint;

  insert into public.assets (
    schema_version, workspace_id, project_id, lineage_id, version, kind, media, status, role,
    name, slug, filename, content, params, inputs, content_hash, inputs_fingerprint,
    created_by_action_id, remote_url, storage_key, storage_bucket, source, duration_sec,
    description, context, semantic_analysis, visibility
  ) values (
    v_old.schema_version, v_old.workspace_id, v_old.project_id, v_old.lineage_id, v_next_version,
    v_old.kind, v_old.media, 'ready', v_old.role, v_old.name, null, p_filename, v_old.content,
    v_effective_params, v_old.inputs, coalesce(p_content_hash, v_old.content_hash), v_inputs_fingerprint,
    coalesce(p_action_id, v_old.created_by_action_id), null, p_storage_key, p_storage_bucket,
    v_old.source, coalesce(p_duration_sec, v_old.duration_sec), v_old.description, v_old.context,
    v_old.semantic_analysis, v_old.visibility
  ) returning * into v_new;

  update public.story_panels
  set image_asset_id = v_new.id
  where project_id = v_old.project_id
    and image_asset_id in (
      select id from public.assets
      where project_id = v_old.project_id and lineage_id = v_old.lineage_id
    );

  for v_sel in
    select slot_owner_lineage_id, slot_role from public.current_selections
    where project_id = v_old.project_id
      and active_asset_id in (
        select id from public.assets
        where project_id = v_old.project_id and lineage_id = v_old.lineage_id
      )
  loop
    insert into public.selections (
      project_id, slot_owner_lineage_id, slot_role, active_asset_id, set_by_action_id
    ) values (
      v_old.project_id, v_sel.slot_owner_lineage_id, v_sel.slot_role, v_new.id, p_action_id
    );
  end loop;
  return v_new;
end;
$$;

comment on function public.regenerate_asset_version(
  uuid, uuid, text, text, text, jsonb, text, double precision, uuid
) is 'Atomically mint a new immutable image asset version and repoint story_panels + selection slots that referenced the prior version.';
