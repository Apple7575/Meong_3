-- report detail with last-seen lat/lng decomposed (visibility: owner OR active), + dog as jsonb
create or replace function public.report_detail(p_id uuid)
returns table (
  id uuid, owner_id uuid, dog_id uuid, status text,
  last_seen_at timestamptz, alert_radius_m int, note text,
  expires_at timestamptz, created_at timestamptz, updated_at timestamptz, resolved_at timestamptz,
  last_seen_lat double precision, last_seen_lng double precision, dog jsonb
)
language sql security definer set search_path = public as $$
  select r.id, r.owner_id, r.dog_id, r.status,
         r.last_seen_at, r.alert_radius_m, r.note,
         r.expires_at, r.created_at, r.updated_at, r.resolved_at,
         st_y(r.last_seen_point::geometry), st_x(r.last_seen_point::geometry),
         jsonb_build_object('name', d.name, 'breed', d.breed, 'features', d.features)
  from public.missing_reports r join public.dogs d on d.id = r.dog_id
  where r.id = p_id and (r.owner_id = auth.uid() or r.status = 'active');
$$;

create or replace function public.report_sightings(p_report_id uuid)
returns table (id uuid, report_id uuid, reporter_id uuid, seen_at timestamptz, note text, created_at timestamptz, lat double precision, lng double precision)
language sql security definer set search_path = public as $$
  select s.id, s.report_id, s.reporter_id, s.seen_at, s.note, s.created_at,
         st_y(s.point::geometry) as lat, st_x(s.point::geometry) as lng
  from public.sightings s
  where s.report_id = p_report_id
    and (s.reporter_id = auth.uid()
         or exists (select 1 from public.missing_reports r where r.id = s.report_id and r.owner_id = auth.uid()))
  order by s.seen_at asc;
$$;
