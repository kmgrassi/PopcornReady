-- TEMPORARY: $20 promotional starter grant.
--
-- New users get 2000 credits ($20) instead of the standard 100 ($1) from
-- 20260623120000_credit_ledger.sql, to seed early adoption.
--
-- THIS IS MEANT TO BE REVERSED when the promo ends. To roll back, ship a
-- follow-up migration that CREATE OR REPLACEs grant_signup_credits() with the
-- 100-credit body (identical to this one with 2000 -> 100 and no promo metadata).
-- Reverting only changes FUTURE signups; already-granted credits are immutable
-- ledger rows and are unaffected. The `metadata.promo = 'launch_20_usd'` tag
-- makes the promo grants identifiable for accounting/clawback if ever needed.

create or replace function public.grant_signup_credits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.apply_credit_transaction(
    new.id,
    2000,                                  -- TEMPORARY promo: 2000 credits = $20 (standard is 100 = $1)
    'signup_grant'::public.credit_reason,
    null, null, null,
    'signup_grant:' || new.id::text,
    jsonb_build_object('promo', 'launch_20_usd')
  );
  return new;
end;
$$;
