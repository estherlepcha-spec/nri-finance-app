-- Stripe subscriptions table
-- ---------------------------------------------------------------------------
-- Single source of truth for who has an active subscription. Written ONLY by
-- the stripe-webhook Edge Function (via the service-role key, which bypasses
-- RLS). Users can READ their own row but never write it — so no one can
-- self-grant access by hitting the REST API.
--
-- Run once in the Supabase SQL editor.

create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id     text,
  stripe_subscription_id text,
  status                 text,          -- trialing | active | past_due | canceled | unpaid | incomplete
  price_id               text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean default false,
  updated_at             timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

-- Read-only for the owner. (No insert/update/delete policies => those are
-- denied for normal users; only the service-role key can write.)
drop policy if exists "read own subscription" on public.subscriptions;
create policy "read own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- Helpful index for webhook upserts that look up by Stripe customer id.
create index if not exists subscriptions_stripe_customer_idx
  on public.subscriptions (stripe_customer_id);

-- Convenience: a boolean view of "is this user entitled right now?".
-- Treats trialing + active as entitled. (past_due/canceled are not.)
-- The frontend can just read the subscriptions row and apply the same rule;
-- this view is here for SQL-side checks if needed.
--
-- security_invoker: run the view with the QUERYING user's permissions (PG15+),
-- so it enforces the subscriptions RLS policy instead of the creator's rights.
-- Without this, a view defaults to SECURITY DEFINER and bypasses RLS.
create or replace view public.my_entitlement
  with (security_invoker = true) as
  select
    user_id,
    status,
    current_period_end,
    (status in ('trialing', 'active')
       and (current_period_end is null or current_period_end > now())) as entitled
  from public.subscriptions
  where user_id = auth.uid();
