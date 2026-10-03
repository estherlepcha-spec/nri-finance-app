-- Server-tracked free-trial usage (pre-Stripe-checkout grace window)
-- ---------------------------------------------------------------------------
-- Before a user starts Stripe Checkout they get a 14-day, no-card grace
-- window so they can try the app. That window and the AI-upload count inside
-- it were previously tracked only in browser localStorage, which any user can
-- clear or bypass to reset their trial or exceed the AI-upload cap (each
-- upload costs real Anthropic API spend). This table makes both server-owned.
--
-- Written ONLY by the anthropic Edge Function (service-role key, bypasses
-- RLS) via an upsert. Users can read their own row but never write it.
--
-- Run once in the Supabase SQL editor (or via `supabase db push`).

create table if not exists public.trial_usage (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  trial_start  timestamptz not null default now(),
  ai_uploads   integer not null default 0,
  updated_at   timestamptz not null default now()
);

alter table public.trial_usage enable row level security;

drop policy if exists "read own trial usage" on public.trial_usage;
create policy "read own trial usage"
  on public.trial_usage for select
  using (auth.uid() = user_id);

-- No insert/update/delete policies => denied for normal users; only the
-- service-role key (used by the anthropic Edge Function) can write.
