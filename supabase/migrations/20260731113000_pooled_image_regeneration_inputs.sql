-- Preserve proposal-approved dependency inputs when a Visuals worker mints an
-- immutable pooled image revision. The active domain claim remains the atomic
-- authority fence for the asset insert.
drop function if exists public.regenerate_asset_version_pooled(
  uuid, uuid, text, text, text, jsonb, text, double precision, uuid, uuid, bigint
);

create function public.regenerate_asset_version_pooled(
  p_workspace_id uuid,
  p_old_asset_id uuid,
  p_filename text,
  p_storage_key text,
  p_storage_bucket text,
  p_params jsonb,
  p_content_hash text default null,
  p_duration_sec double precision default null,
  p_action_id uuid default null,
  p_run_id uuid default null,
  p_session_claim_generation bigint default null,
  p_inputs jsonb default null
)
returns public.assets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.assets;
  v_new public.assets;
  v_effective_params jsonb;
  v_effective_inputs jsonb;
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
    raise exception 'Asset % is not an image', p_old_asset_id
      using errcode = 'invalid_parameter_value';
  end if;
  if (p_run_id is null) <> (p_session_claim_generation is null) then
    raise exception 'Pooled regeneration requires both run and session claim generation'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_run_id is not null then
    perform 1
    from public.orchestrator_runs r
    join public.agent_sessions s on s.id = r.agent_session_id
    where r.id = p_run_id
      and r.project_id = v_old.project_id
      and r.agent_role = 'visuals'
      and r.status in ('running', 'waiting')
      and s.active_run_id = r.id
      and s.claim_generation = p_session_claim_generation
    for update of r, s;
    if not found then
      raise exception 'stale_session_claim: run % no longer owns generation %',
        p_run_id, p_session_claim_generation using errcode = 'object_not_in_prerequisite_state';
    end if;
  end if;

  v_effective_inputs := coalesce(p_inputs, v_old.inputs, '[]'::jsonb);
  if jsonb_typeof(v_effective_inputs) <> 'array' then
    raise exception 'Pooled regeneration inputs must be a JSON array'
      using errcode = 'invalid_parameter_value';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_old.lineage_id::text));
  perform 1 from public.assets where lineage_id = v_old.lineage_id
    and workspace_id = p_workspace_id order by version for update;
  select coalesce(max(version), 0) + 1 into v_next_version from public.assets
  where lineage_id = v_old.lineage_id and workspace_id = p_workspace_id;
  v_effective_params := coalesce(p_params, v_old.params);
  select encode(extensions.digest(jsonb_build_object(
    'inputHashes', coalesce((select jsonb_agg(jsonb_build_object(
      'assetId', item.value->>'assetId', 'contentHash',
      coalesce(item.value->>'contentHash', '')
    ) order by item.value->>'assetId')
    from jsonb_array_elements(v_effective_inputs) item(value)), '[]'::jsonb),
    'paramsHash', encode(extensions.digest(
      coalesce(v_effective_params, 'null'::jsonb)::text, 'sha256'
    ), 'hex')
  )::text, 'sha256'), 'hex') into v_inputs_fingerprint;

  insert into public.assets (
    schema_version, workspace_id, project_id, lineage_id, version, kind, media,
    status, role, name, slug, filename, content, params, inputs, content_hash,
    inputs_fingerprint, created_by_action_id, remote_url, storage_key,
    storage_bucket, source, duration_sec, description, context,
    semantic_analysis, visibility
  ) values (
    v_old.schema_version, v_old.workspace_id, v_old.project_id, v_old.lineage_id,
    v_next_version, v_old.kind, v_old.media, 'ready', v_old.role, v_old.name,
    null, p_filename, v_old.content, v_effective_params, v_effective_inputs,
    coalesce(p_content_hash, v_old.content_hash), v_inputs_fingerprint,
    coalesce(p_action_id, v_old.created_by_action_id), null, p_storage_key,
    p_storage_bucket, v_old.source, coalesce(p_duration_sec, v_old.duration_sec),
    v_old.description, v_old.context, v_old.semantic_analysis, v_old.visibility
  ) returning * into v_new;

  return v_new;
end;
$$;

revoke all on function public.regenerate_asset_version_pooled(
  uuid, uuid, text, text, text, jsonb, text, double precision, uuid, uuid, bigint, jsonb
) from public, anon, authenticated;

grant execute on function public.regenerate_asset_version_pooled(
  uuid, uuid, text, text, text, jsonb, text, double precision, uuid, uuid, bigint, jsonb
) to service_role;
