create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  store jsonb not null default '{}'::jsonb,
  activities jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.league_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic_id text not null,
  topic_label text not null,
  raw_score numeric not null default 0,
  score_per_question numeric not null default 0,
  time_remaining_total numeric not null default 0,
  time_bonus numeric not null default 0,
  league_rating numeric not null default 0,
  answered integer not null default 0,
  correct integer not null default 0,
  wrong integer not null default 0,
  percent integer not null default 0,
  duration_seconds integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.user_states enable row level security;
alter table public.league_results enable row level security;

drop policy if exists "profiles are readable" on public.profiles;
drop policy if exists "users insert their own profile" on public.profiles;
drop policy if exists "users update their own profile" on public.profiles;
drop policy if exists "users read their own state" on public.user_states;
drop policy if exists "users insert their own state" on public.user_states;
drop policy if exists "users update their own state" on public.user_states;
drop policy if exists "league results are readable" on public.league_results;
drop policy if exists "users insert their own league results" on public.league_results;

create policy "profiles are readable"
  on public.profiles for select
  using (true);

create policy "users insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = user_id);

create policy "users update their own profile"
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users read their own state"
  on public.user_states for select
  using (auth.uid() = user_id);

create policy "users insert their own state"
  on public.user_states for insert
  with check (auth.uid() = user_id);

create policy "users update their own state"
  on public.user_states for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "league results are readable"
  on public.league_results for select
  using (true);

create policy "users insert their own league results"
  on public.league_results for insert
  with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id, username, email)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (user_id) do nothing;

  insert into public.user_states (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
