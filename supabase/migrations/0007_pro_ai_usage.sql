-- Server-tracked monthly AI-upload usage for paid Pro subscribers
-- ---------------------------------------------------------------------------
-- Pro was previously unlimited on AI uploads (receipt/statement scans) once
-- isPaidOrTrialing was true in the anthropic Edge Function's entitlement
-- check. Pro now has a monthly cap too (PRO_LIMITS.aiUploads in App.jsx),
-- so this needs its own server-owned counter — keyed by (user_id, month) so
-- it resets naturally each calendar month with no reset job required.
--
-- Written ONLY by the anthropic Edge Function (service-role key, bypasses
-- RLS) via an upsert. Users can read their own rows but never write them.
--
-- Run once in the Supabase SQL editor (or via `supabase db push`).

create table if not exists public.pro_ai_usage (
  user_id      uuid not null references auth.users (id) on delete cascade,
  month        text not null, -- 'YYYY-MM', server-computed (UTC)
  ai_uploads   integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (user_id, month)
);

alter table public.pro_ai_usage enable row level security;

drop policy if exists "read own pro ai usage" on public.pro_ai_usage;
create policy "read own pro ai usage"
  on public.pro_ai_usage for select
  using (auth.uid() = user_id);

-- No insert/update/delete policies => denied for normal users; only the
-- service-role key (used by the anthropic Edge Function) can write.
