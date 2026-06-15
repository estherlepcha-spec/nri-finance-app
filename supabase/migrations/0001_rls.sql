-- Row-Level Security for nri_finance_data
-- ----------------------------------------
-- This is the security boundary that keeps each user's financial data
-- private. Without it, the anon API key could read/write every row.
--
-- ⚠️ IF YOUR TABLE ALREADY EXISTS with user_id typed as TEXT (it did, from the
-- pre-auth 'default' era), this script FAILS with "operator does not exist:
-- uuid = text". Use 0002_convert_userid_to_uuid.sql instead — it retypes the
-- column safely and preserves the legacy data. This 0001 file is the clean
-- "fresh table" version, kept for reference.
--
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query) once.

-- 1. The table (created here if it doesn't already exist, matching the shape
--    supabase.js reads/writes: user_id + key + value JSON).
create table if not exists public.nri_finance_data (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  key        text        not null,
  value      jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- 2. Turn on RLS. Until policies exist, this DENIES all access by default —
--    which is exactly what we want as a safe baseline.
alter table public.nri_finance_data enable row level security;

-- 3. Policies: a user may only touch rows whose user_id matches their JWT.
--    auth.uid() is the authenticated user's id from the Supabase session.
--    Drop-then-create makes this migration idempotent.

drop policy if exists "own rows: select" on public.nri_finance_data;
create policy "own rows: select"
  on public.nri_finance_data for select
  using (auth.uid() = user_id);

drop policy if exists "own rows: insert" on public.nri_finance_data;
create policy "own rows: insert"
  on public.nri_finance_data for insert
  with check (auth.uid() = user_id);

drop policy if exists "own rows: update" on public.nri_finance_data;
create policy "own rows: update"
  on public.nri_finance_data for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own rows: delete" on public.nri_finance_data;
create policy "own rows: delete"
  on public.nri_finance_data for delete
  using (auth.uid() = user_id);

-- 4. Realtime: allow the table to broadcast row changes (the app subscribes
--    to its own rows). RLS still filters what each client receives.
alter publication supabase_realtime add table public.nri_finance_data;

-- NOTE on the legacy user_id = 'default' rows:
-- Those were written before auth and use a non-UUID id, so they are now
-- invisible to every authenticated user (and cannot be written anymore).
-- Migrating them to a real account is a deliberate, separate step — see
-- TODO(data-migration) in App.jsx.
