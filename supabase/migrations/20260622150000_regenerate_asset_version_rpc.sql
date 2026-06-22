-- Atomic, immutability-compliant image regeneration.
--
-- Regenerating an image used to mutate the asset row in place (bump `version`,
-- rewrite `params`/`content_hash`). The asset-graph immutability guard
-- (`assets_guard_immutable`) forbids that — those are semantic fields — so every
-- in-place regenerate failed in production with
--   23514  "asset semantic fields are immutable — insert a new version".
--
-- The North Star model is: a semantic change MINTS A NEW IMMUTABLE VERSION
-- (new row, same `lineage_id`, `version + 1`) and the surfaces that point at the
-- old asset are repointed to the new one. This RPC does that whole move in a
-- single transaction so a regenerate can never half-apply (new bytes live but the
-- surface still showing the dead URL, or vice versa).
--
-- Who points at a regenerable image, and how this repoints it:
--   * storyboard_panels.image_asset_id  -> UPDATE in place to the new asset id.
--   * selections.active_asset_id        -> APPEND a new selection row (the table
--     is append-only; `current_selections` reads the highest `seq`). Covers the
--     beat_keyframe / character_anchor / scene_anchor / poster slots.
-- Immutable provenance (`asset_edges`) is left as history; the new version
-- records its own `inputs`, so the edge trigger wires its lineage afresh.
--
-- Slug note: `slug` is a project-unique handle (`assets_project_slug_idx`), so a
-- second version cannot carry the same slug. The new version is therefore created
-- with `slug = null` (regenerable images do not carry agent-authored slugs today).
-- If slugged images ever become regenerable, slug-head resolution is a separate
-- follow-up — it is NOT a reason to relax the immutability guard.

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
  -- Lock the source row so a concurrent regenerate of the same asset serializes
  -- behind us rather than racing to mint two version+1 rows.
  select * into v_old
  from public.assets
  where id = p_old_asset_id
    and workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'Asset not found: %', p_old_asset_id
      using errcode = 'no_data_found';
  end if;

  if v_old.media <> 'image' then
    raise exception 'Asset % is not an image (media=%); only images regenerate from a prompt.',
      p_old_asset_id, v_old.media
      using errcode = 'invalid_parameter_value';
  end if;

  -- Serialize all regenerations for this immutable lineage. Locking only the
  -- source row is not enough: a retry that starts from v1 after v2 exists must
  -- mint v3, not collide with v2's unique (lineage_id, version) entry.
  perform pg_advisory_xact_lock(hashtext(v_old.lineage_id::text));

  perform 1
  from public.assets
  where lineage_id = v_old.lineage_id
    and workspace_id = p_workspace_id
  order by version
  for update;

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.assets
  where lineage_id = v_old.lineage_id
    and workspace_id = p_workspace_id;

  v_effective_params := coalesce(p_params, v_old.params);

  -- Mirror the app-side inputsFingerprint shape: hash params, pair each input
  -- with the content hash it carried, sort by asset id, then hash the bundle.
  select encode(
    extensions.digest(
      jsonb_build_object(
        'inputHashes',
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'assetId', input_item.value->>'assetId',
                'contentHash', coalesce(input_item.value->>'contentHash', '')
              )
              order by input_item.value->>'assetId'
            )
            from jsonb_array_elements(coalesce(v_old.inputs, '[]'::jsonb)) as input_item(value)
          ),
          '[]'::jsonb
        ),
        'paramsHash',
        encode(extensions.digest(coalesce(v_effective_params, 'null'::jsonb)::text, 'sha256'), 'hex')
      )::text,
      'sha256'
    ),
    'hex'
  ) into v_inputs_fingerprint;

  -- Mint the new immutable version. `id` and `ref` are assigned by their
  -- defaults/triggers; the edge-sync trigger fires off the copied `inputs`.
  insert into public.assets (
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
    v_old.schema_version,
    v_old.workspace_id,
    v_old.project_id,
    v_old.lineage_id,
    v_next_version,
    v_old.kind,
    v_old.media,
    'ready',
    v_old.role,
    v_old.name,
    null,                                  -- slug: project-unique, see header note
    p_filename,
    v_old.content,
    v_effective_params,
    v_old.inputs,
    coalesce(p_content_hash, v_old.content_hash),
    v_inputs_fingerprint,
    coalesce(p_action_id, v_old.created_by_action_id),
    null,                                  -- fresh managed-storage object; no stale remote_url
    p_storage_key,
    p_storage_bucket,
    v_old.source,
    coalesce(p_duration_sec, v_old.duration_sec),
    v_old.description,
    v_old.context,
    v_old.semantic_analysis,
    v_old.visibility
  )
  returning * into v_new;

  -- Repoint storyboard panels that render the old image.
  update public.storyboard_panels
  set image_asset_id = v_new.id
  where project_id = v_old.project_id
    and image_asset_id in (
      select id
      from public.assets
      where project_id = v_old.project_id
        and lineage_id = v_old.lineage_id
    );

  -- Repoint any selection slot whose current head is the old asset by appending
  -- a fresh selection row (append-only table; `selections_set_seq` assigns seq).
  for v_sel in
    select slot_owner_lineage_id, slot_role
    from public.current_selections
    where project_id = v_old.project_id
      and active_asset_id in (
        select id
        from public.assets
        where project_id = v_old.project_id
          and lineage_id = v_old.lineage_id
      )
  loop
    insert into public.selections (
      project_id,
      slot_owner_lineage_id,
      slot_role,
      active_asset_id,
      set_by_action_id
    ) values (
      v_old.project_id,
      v_sel.slot_owner_lineage_id,
      v_sel.slot_role,
      v_new.id,
      p_action_id
    );
  end loop;

  return v_new;
end;
$$;

comment on function public.regenerate_asset_version(
  uuid, uuid, text, text, text, jsonb, text, double precision, uuid
) is
  'Atomically mint a new immutable image asset version (same lineage_id, version+1) '
  'from regenerated bytes and repoint storyboard_panels + selection slots that '
  'referenced the prior version. Replaces the old in-place UPDATE that violated '
  'assets_guard_immutable.';

revoke all on function public.regenerate_asset_version(
  uuid, uuid, text, text, text, jsonb, text, double precision, uuid
) from public, anon, authenticated;

grant execute on function public.regenerate_asset_version(
  uuid, uuid, text, text, text, jsonb, text, double precision, uuid
) to service_role;
