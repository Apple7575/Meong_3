-- ===== tables =====
create table public.missing_reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  dog_id uuid not null references public.dogs(id) on delete cascade,
  status text not null default 'active' check (status in ('active','resolved','expired')),
  last_seen_point geography(Point,4326) not null,
  last_seen_at timestamptz not null,
  alert_radius_m int not null check (alert_radius_m between 300 and 10000),
  note text,
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index missing_reports_owner_idx on public.missing_reports(owner_id, created_at desc);
create index missing_reports_geom_idx on public.missing_reports using gist (last_seen_point);
create index missing_reports_status_idx on public.missing_reports(status);

create table public.sightings (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.missing_reports(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  point geography(Point,4326) not null,
  seen_at timestamptz not null,
  note text,
  created_at timestamptz not null default now()
);
create index sightings_report_idx on public.sightings(report_id, seen_at);

create table public.sighting_images (
  id uuid primary key default gen_random_uuid(),
  sighting_id uuid not null references public.sightings(id) on delete cascade,
  storage_path text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.missing_reports(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null,
  status text not null check (status in ('sent','failed')),
  created_at timestamptz not null default now()
);

-- ===== RLS =====
alter table public.missing_reports enable row level security;
alter table public.sightings enable row level security;
alter table public.sighting_images enable row level security;
alter table public.notification_logs enable row level security;

-- missing_reports: owner full; any AUTHENTICATED user reads ACTIVE (anon excluded via TO authenticated).
-- INSERT/UPDATE additionally require the dog to belong to the reporting owner.
create policy "mr_select" on public.missing_reports for select to authenticated
  using (owner_id = auth.uid() or status = 'active');
create policy "mr_insert_own" on public.missing_reports for insert to authenticated
  with check (owner_id = auth.uid() and exists (select 1 from public.dogs d where d.id = dog_id and d.owner_id = auth.uid()));
create policy "mr_update_own" on public.missing_reports for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and exists (select 1 from public.dogs d where d.id = dog_id and d.owner_id = auth.uid()));
create policy "mr_delete_own" on public.missing_reports for delete to authenticated using (owner_id = auth.uid());

-- dogs / dog_images: add SELECT for dogs linked to an ACTIVE report (SP1 left this as a TODO). Authed only.
create policy "dogs_select_active_report" on public.dogs for select to authenticated
  using (exists (select 1 from public.missing_reports r where r.dog_id = dogs.id and r.status = 'active'));
create policy "dog_images_select_active_report" on public.dog_images for select to authenticated
  using (exists (select 1 from public.dogs d join public.missing_reports r on r.dog_id = d.id
                 where d.id = dog_images.dog_id and r.status = 'active'));

-- sightings: insert by reporter on active report; read by reporter or report owner
create policy "s_insert" on public.sightings for insert to authenticated
  with check (reporter_id = auth.uid()
              and exists (select 1 from public.missing_reports r where r.id = report_id and r.status = 'active'));
create policy "s_select" on public.sightings for select to authenticated
  using (reporter_id = auth.uid()
         or exists (select 1 from public.missing_reports r where r.id = report_id and r.owner_id = auth.uid()));

-- sighting_images: follow parent sighting visibility
create policy "si_insert" on public.sighting_images for insert to authenticated
  with check (exists (select 1 from public.sightings s where s.id = sighting_id and s.reporter_id = auth.uid()));
create policy "si_select" on public.sighting_images for select to authenticated
  using (exists (select 1 from public.sightings s where s.id = sighting_id
                 and (s.reporter_id = auth.uid()
                      or exists (select 1 from public.missing_reports r where r.id = s.report_id and r.owner_id = auth.uid()))));

-- notification_logs: no public policies (Edge Function uses service role, bypasses RLS)

-- ===== storage =====
insert into storage.buckets (id, name, public) values ('sightings','sightings',false) on conflict (id) do nothing;
create policy "sight_img_insert_own" on storage.objects for insert
  with check (bucket_id = 'sightings' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "sight_img_select_owner_or_reporter" on storage.objects for select
  using (bucket_id = 'sightings' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.sightings s join public.missing_reports r on r.id = s.report_id
               where s.id::text = (storage.foldername(name))[2] and r.owner_id = auth.uid())
  ));

-- dog-images (SP1 bucket, path {user_id}/{dog_id}/...): allow authed read when the dog is in an ACTIVE report
-- (OR's with SP1's owner-only policy, so neighbors can see the missing dog's photo).
create policy "dog_img_select_active_report" on storage.objects for select to authenticated
  using (bucket_id = 'dog-images' and exists (
    select 1 from public.missing_reports r
    where r.dog_id::text = (storage.foldername(name))[2] and r.status = 'active'));
