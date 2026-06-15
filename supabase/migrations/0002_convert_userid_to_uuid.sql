-- Convert nri_finance_data.user_id from text → uuid and apply RLS,
-- WITHOUT losing the legacy user_id='default' data.
-- ---------------------------------------------------------------------------
-- Context: the table predates auth and stored user_id as the text 'default'.
-- We park those rows under an all-zeros placeholder uuid so the column can be
-- retyped to uuid, then RLS is applied. After you sign in for the first time,
-- run 0003_claim_legacy_data.sql to reassign the placeholder rows to YOU.
--
-- Run this whole script once in the Supabase SQL editor.

-- 1. Drop any policies/realtime that might reference the column (safe if absent).
drop policy if exists "own rows: select" on public.nri_finance_data;
drop policy if exists "own rows: insert" on public.nri_finance_data;
drop policy if exists "own rows: update" on public.nri_finance_data;
drop policy if exists "own rows: delete" on public.nri_finance_data;

-- 2. Re-point legacy 'default' (and any other non-uuid) rows to a placeholder
--    uuid so the type conversion below can succeed. The all-zeros uuid is a
--    valid uuid that no real auth user will ever have.
update public.nri_finance_data
  set user_id = '00000000-0000-0000-0000-000000000000'
  where user_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

-- 3. Drop the legacy column default (it was the text 'default', which can't be
--    cast to uuid and blocks the type change below).
alter table public.nri_finance_data
  alter column user_id drop default;

-- 4. Convert the column type text → uuid (every value is now a valid uuid).
alter table public.nri_finance_data
  alter column user_id type uuid using user_id::uuid;

-- 5. Enable RLS (denies all by default until policies exist).
alter table public.nri_finance_data enable row level security;

-- 6. Per-user policies: a user may only touch rows whose user_id = their JWT.
create policy "own rows: select"
  on public.nri_finance_data for select
  using (auth.uid() = user_id);

create policy "own rows: insert"
  on public.nri_finance_data for insert
  with check (auth.uid() = user_id);

create policy "own rows: update"
  on public.nri_finance_data for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own rows: delete"
  on public.nri_finance_data for delete
  using (auth.uid() = user_id);

-- 7. Realtime (safe to skip the error if it says "already a member").
do $$
begin
  alter publication supabase_realtime add table public.nri_finance_data;
exception when duplicate_object then
  null; -- already in the publication
end $$;

-- Done. Your legacy data now lives under user_id =
--   00000000-0000-0000-0000-000000000000
-- It is invisible to everyone (no one signs in as the zero uuid) until you
-- claim it with 0003_claim_legacy_data.sql after your first sign-in.
