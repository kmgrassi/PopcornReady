-- Per-user credit ledger (monetization Phase 1).
--
-- Model: the platform is free; generating on the platform's provider keys spends
-- credits, where 1 credit = $0.01 to the user. Users either bring their own
-- provider key (free, see provider_api_keys) or buy credits.
--
-- Two tables: an append-only `credit_transactions` ledger (the audit trail of
-- every grant/purchase/debit/refund) and a denormalized `user_credits.balance`
-- kept in lockstep by the `apply_credit_transaction` RPC, which is the ONLY way
-- to move credits — it locks the balance, rejects debits that would go negative,
-- and is idempotent on an optional key (so a retried Stripe webhook or
-- generation debit never double-applies). Debits/grants are server-side only;
-- clients can read their own balance + history but never write.

create type public.credit_reason as enum (
  'signup_grant',     -- starter credits on account creation
  'purchase',         -- bought via Stripe (Phase 3)
  'generation_debit', -- spent running a platform-key generation (Phase 2)
  'refund',           -- failed generation / support credit back
  'adjustment'        -- manual ops correction
);

-- Append-only ledger. balance_after snapshots the balance immediately after the
-- row, so history is self-describing without replaying every prior delta.
create table public.credit_transactions (
  id              uuid primary key default gen_random_uuid(),
  -- Monotonic ordinal for deterministic newest-first ordering (timestamps can
  -- tie when several transactions land in the same instant).
  seq             bigint generated always as identity,
  user_id         uuid not null references public.users(id) on delete cascade,
  delta_credits   integer not null,   -- + grant/purchase/refund, - debit
  reason          public.credit_reason not null,
  balance_after   integer not null,
  -- Provenance (mostly for generation_debit / purchase).
  run_id          uuid,
  action_id       uuid,
  cost_usd        double precision,   -- raw provider cost the debit was derived from
  idempotency_key text,               -- e.g. stripe event id, or run/action debit key
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create unique index credit_transactions_idempotency_idx
  on public.credit_transactions (idempotency_key)
  where idempotency_key is not null;

create index credit_transactions_user_idx
  on public.credit_transactions (user_id, seq desc);

-- Denormalized balance for cheap reads + the row we lock to serialize debits.
create table public.user_credits (
  user_id         uuid primary key references public.users(id) on delete cascade,
  balance_credits integer not null default 0,
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- The single mutation path: atomic, balance-guarded, idempotent.
-- ---------------------------------------------------------------------------
create or replace function public.apply_credit_transaction(
  p_user_id         uuid,
  p_delta           integer,
  p_reason          public.credit_reason,
  p_run_id          uuid default null,
  p_action_id       uuid default null,
  p_cost_usd        double precision default null,
  p_idempotency_key text default null,
  p_metadata        jsonb default '{}'::jsonb
)
returns public.credit_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_new     integer;
  v_tx      public.credit_transactions;
begin
  -- Idempotency: a key seen before returns its original transaction, unchanged.
  if p_idempotency_key is not null then
    select * into v_tx from public.credit_transactions
      where idempotency_key = p_idempotency_key;
    if found then return v_tx; end if;
  end if;

  -- Lock the balance row (materialize at 0 on first touch).
  insert into public.user_credits (user_id, balance_credits)
    values (p_user_id, 0)
    on conflict (user_id) do nothing;
  select balance_credits into v_balance
    from public.user_credits where user_id = p_user_id for update;

  v_new := v_balance + p_delta;
  if v_new < 0 then
    raise exception 'insufficient credits: balance % cannot apply delta %',
      v_balance, p_delta
      using errcode = 'check_violation';
  end if;

  update public.user_credits
    set balance_credits = v_new, updated_at = now()
    where user_id = p_user_id;

  insert into public.credit_transactions (
    user_id, delta_credits, reason, balance_after,
    run_id, action_id, cost_usd, idempotency_key, metadata
  ) values (
    p_user_id, p_delta, p_reason, v_new,
    p_run_id, p_action_id, p_cost_usd, p_idempotency_key,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_tx;

  return v_tx;
end;
$$;

-- ---------------------------------------------------------------------------
-- Starter grant: every new app user gets a small trial balance so they can make
-- one short video before paying. Idempotent per user.
-- ---------------------------------------------------------------------------
create or replace function public.grant_signup_credits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.apply_credit_transaction(
    new.id,
    100,                                   -- 100 credits = $1.00 trial
    'signup_grant'::public.credit_reason,
    null, null, null,
    'signup_grant:' || new.id::text,
    '{}'::jsonb
  );
  return new;
end;
$$;

create trigger users_grant_signup_credits
  after insert on public.users
  for each row execute function public.grant_signup_credits();

-- ---------------------------------------------------------------------------
-- RLS: a user reads only their own ledger + balance. All writes go through the
-- security-definer RPC (service-role), never directly from a client.
-- ---------------------------------------------------------------------------
alter table public.credit_transactions enable row level security;
alter table public.user_credits enable row level security;

create policy credit_transactions_owner_select on public.credit_transactions
  for select to authenticated
  using (user_id = public.current_app_user_id());

create policy user_credits_owner_select on public.user_credits
  for select to authenticated
  using (user_id = public.current_app_user_id());

-- No client write grants; service_role bypasses RLS for the RPC + server reads.
revoke insert, update, delete on public.credit_transactions from anon, authenticated;
revoke insert, update, delete on public.user_credits from anon, authenticated;

revoke all on function public.apply_credit_transaction(
  uuid, integer, public.credit_reason, uuid, uuid, double precision, text, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_credit_transaction(
  uuid, integer, public.credit_reason, uuid, uuid, double precision, text, jsonb
) to service_role;

comment on function public.apply_credit_transaction(
  uuid, integer, public.credit_reason, uuid, uuid, double precision, text, jsonb
) is
  'The only way to move credits: atomically locks the user balance, rejects '
  'debits that would go negative, appends an immutable ledger row, and is '
  'idempotent on idempotency_key. 1 credit = $0.01.';
