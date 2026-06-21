-- System publisher: a stable, server-managed identity that AI-generated public
-- catalog content is attributed to, so "create a public set other users can
-- grab" is owned by the platform rather than any end-user. The account never
-- logs in (auth_id is NULL — the server-managed user pattern), and its workspace
-- exists only to anchor publisher attribution. Idempotent (on conflict do
-- nothing) so it respects the additive / no-history-rewrite migration rule.
insert into public.users (id, auth_id, email, full_name)
values (
  '00000000-0000-4000-a000-000000000001',
  null,
  'system-publisher@popcornready.system',
  'Popcorn Ready Studio'
)
on conflict (id) do nothing;

-- on_workspace_created auto-inserts the owner membership row for this workspace.
insert into public.workspaces (id, owner_id, name)
values (
  '00000000-0000-4000-a000-000000000002',
  '00000000-0000-4000-a000-000000000001',
  'System Publisher'
)
on conflict (id) do nothing;
