-- Claim the legacy 'default' data to YOUR account.
-- ---------------------------------------------------------------------------
-- Run this ONCE, AFTER you have signed in to the app with Google at least once
-- (so that your user exists in auth.users).
--
-- It moves the parked legacy rows (user_id = all-zeros placeholder) onto your
-- real account. Replace the email below with the Google address you signed in
-- with — the query looks up your real user id for you.

-- Safety: if you already have your own rows for a key, the legacy row for that
-- key is dropped instead of overwriting your newer data.

do $$
declare
  my_id uuid;
begin
  select id into my_id from auth.users
    where email = 'estherlepcha@gmail.com'   -- your Google account
    limit 1;

  if my_id is null then
    raise exception 'No auth user found for that email — sign in to the app first, then re-run.';
  end if;

  -- Remove legacy rows that would collide with data you already own.
  delete from public.nri_finance_data legacy
   where legacy.user_id = '00000000-0000-0000-0000-000000000000'
     and exists (
       select 1 from public.nri_finance_data mine
        where mine.user_id = my_id and mine.key = legacy.key
     );

  -- Reassign the rest to you.
  update public.nri_finance_data
     set user_id = my_id
   where user_id = '00000000-0000-0000-0000-000000000000';

  raise notice 'Legacy data claimed for %', my_id;
end $$;
