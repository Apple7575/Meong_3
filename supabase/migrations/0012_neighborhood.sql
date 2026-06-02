-- Active reports whose last-seen point falls in the map viewport (lng/lat envelope).
-- Returns safe fields only (no owner/phone). Authenticated-only.
create or replace function public.active_reports_in_bounds(
  min_lng double precision, min_lat double precision, max_lng double precision, max_lat double precision
)
returns table (id uuid, lat double precision, lng double precision, dog_name text, last_seen_at timestamptz, photo_path text)
language sql security definer set search_path = public as $$
  select r.id,
         st_y(r.last_seen_point::geometry), st_x(r.last_seen_point::geometry),
         d.name, r.last_seen_at,
         (select di.storage_path from public.dog_images di where di.dog_id = r.dog_id and di.is_primary = true limit 1)
  from public.missing_reports r
  join public.dogs d on d.id = r.dog_id
  where r.status = 'active'
    and st_intersects(r.last_seen_point::geometry, st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326));
$$;
revoke execute on function public.active_reports_in_bounds(double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.active_reports_in_bounds(double precision, double precision, double precision, double precision) to authenticated;

-- SECURITY (fixes a pre-existing SP3a leak): report_detail (0009) is SECURITY DEFINER and returns
-- active reports' owner_id + last-seen to ANY caller via the default PUBLIC execute grant — anon can
-- hit /rpc/report_detail directly. Lock it to authenticated + service_role (the flyer edge function
-- uses service_role; the in-app report detail uses authenticated).
revoke execute on function public.report_detail(uuid) from public, anon;
grant execute on function public.report_detail(uuid) to authenticated, service_role;
