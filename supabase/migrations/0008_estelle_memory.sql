-- User-controlled, specialist-scoped long-term memory for Estelle.
-- Apply through the Supabase SQL editor or `supabase db push`.

create table if not exists public.estelle_memory_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.estelle_memory_settings enable row level security;

drop policy if exists "read own Estelle memory settings" on public.estelle_memory_settings;
create policy "read own Estelle memory settings"
  on public.estelle_memory_settings for select
  using (auth.uid() = user_id);

drop policy if exists "insert own Estelle memory settings" on public.estelle_memory_settings;
create policy "insert own Estelle memory settings"
  on public.estelle_memory_settings for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own Estelle memory settings" on public.estelle_memory_settings;
create policy "update own Estelle memory settings"
  on public.estelle_memory_settings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete own Estelle memory settings" on public.estelle_memory_settings;
create policy "delete own Estelle memory settings"
  on public.estelle_memory_settings for delete
  using (auth.uid() = user_id);

create table if not exists public.estelle_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null check (char_length(content) between 1 and 500),
  specialist text not null check (specialist in ('general', 'budget', 'goals', 'loans', 'investments', 'remittances')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '365 days')
);

create index if not exists estelle_memories_user_expiry_idx
  on public.estelle_memories (user_id, expires_at desc);

alter table public.estelle_memories enable row level security;

drop policy if exists "read own Estelle memories" on public.estelle_memories;
create policy "read own Estelle memories"
  on public.estelle_memories for select
  using (auth.uid() = user_id);

drop policy if exists "insert own Estelle memories" on public.estelle_memories;
create policy "insert own Estelle memories"
  on public.estelle_memories for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own Estelle memories" on public.estelle_memories;
create policy "update own Estelle memories"
  on public.estelle_memories for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete own Estelle memories" on public.estelle_memories;
create policy "delete own Estelle memories"
  on public.estelle_memories for delete
  using (auth.uid() = user_id);
