create table public.walk_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  dog_id uuid references public.dogs(id) on delete set null,
  route_geojson jsonb not null,
  distance_m double precision not null check (distance_m >= 0),
  duration_s int not null check (duration_s >= 0),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  use_for_missing_search boolean not null default false,
  created_at timestamptz not null default now(),
  check (ended_at >= started_at)
);
create index walk_records_user_started_idx on public.walk_records(user_id, started_at desc);

alter table public.walk_records enable row level security;
create policy "walks_all_own" on public.walk_records for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
