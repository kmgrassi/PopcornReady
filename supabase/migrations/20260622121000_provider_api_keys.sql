-- Per-user model-provider API keys.
--
-- Values are encrypted by the API before insert/update. Reads intentionally
-- expose only metadata and a short key hint; provider-call paths can request
-- decrypted values through trusted server helpers instead of returning secrets
-- to the browser.

create type public.model_provider as enum (
  'openai',
  'anthropic',
  'gemini',
  'elevenlabs',
  'runway',
  'ltx',
  'nvidia'
);

create table public.provider_api_keys (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  provider       public.model_provider not null,
  key_ciphertext text not null,
  key_hint       text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint provider_api_keys_unique_user_provider unique (user_id, provider)
);

create trigger provider_api_keys_set_updated_at
  before update on public.provider_api_keys
  for each row execute function public.set_updated_at();

create index provider_api_keys_user_idx
  on public.provider_api_keys (user_id, updated_at desc);

alter table public.provider_api_keys enable row level security;

create policy provider_api_keys_owner_select on public.provider_api_keys
  for select to authenticated
  using (user_id = public.current_app_user_id());

create policy provider_api_keys_owner_insert on public.provider_api_keys
  for insert to authenticated
  with check (user_id = public.current_app_user_id());

create policy provider_api_keys_owner_update on public.provider_api_keys
  for update to authenticated
  using (user_id = public.current_app_user_id())
  with check (user_id = public.current_app_user_id());

create policy provider_api_keys_owner_delete on public.provider_api_keys
  for delete to authenticated
  using (user_id = public.current_app_user_id());
