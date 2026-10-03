-- Public marketing-site feedback (star rating + comment)
-- ---------------------------------------------------------------------------
-- Collects feedback submitted from the separate marketing/landing website
-- (not the main app). Visitors there are NOT signed-in Supabase users, so
-- this table accepts anonymous inserts — unlike every other table in this
-- project, which is scoped to auth.uid(). To keep that safe:
--   - INSERT is open to anon, but the policy caps rating/comment length and
--     requires sane values, so a malformed/abusive payload is rejected at
--     the database level even though anyone can reach this endpoint.
--   - SELECT/UPDATE/DELETE are NOT granted to anon or authenticated users —
--     only the service-role key (e.g. an admin view/export script) can read
--     submissions back. The public can write but never read other people's
--     feedback.
--
-- Run once in the Supabase SQL editor (or via `supabase db push`).

create table if not exists public.site_feedback (
  id         uuid primary key default gen_random_uuid(),
  name       text,
  email      text,
  rating     integer not null check (rating between 1 and 5),
  comment    text,
  source     text default 'marketing-site',
  created_at timestamptz not null default now(),
  constraint site_feedback_comment_len check (comment is null or char_length(comment) <= 2000),
  constraint site_feedback_name_len check (name is null or char_length(name) <= 200),
  constraint site_feedback_email_len check (email is null or char_length(email) <= 320)
);

alter table public.site_feedback enable row level security;

-- Anyone (including anonymous marketing-site visitors) can submit feedback.
drop policy if exists "anyone can submit feedback" on public.site_feedback;
create policy "anyone can submit feedback"
  on public.site_feedback for insert
  to anon, authenticated
  with check (true);

-- No select/update/delete policies => denied for anon/authenticated; only
-- the service-role key can read or manage submissions.

create index if not exists site_feedback_created_at_idx
  on public.site_feedback (created_at desc);
