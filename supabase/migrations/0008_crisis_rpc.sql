-- 신고 작성 미리보기: 반경 내 사용자 수 (본인 제외)
create or replace function public.count_users_near(lat double precision, lng double precision, radius_m double precision)
returns int language sql security definer set search_path = public as $$
  select count(*)::int from public.user_locations ul
  where st_dwithin(ul.geom, st_setsrid(st_makepoint(lng, lat), 4326)::geography, radius_m)
    and ul.user_id <> auth.uid();
$$;

-- Edge Function용: 신고 반경 내 사용자들의 FCM 토큰 (소유자 제외)
create or replace function public.tokens_near_report(p_report_id uuid)
returns table (user_id uuid, token text, platform text)
language sql security definer set search_path = public as $$
  select distinct t.user_id, t.token, t.platform
  from public.missing_reports r
  join public.user_locations ul
    on st_dwithin(ul.geom, r.last_seen_point, r.alert_radius_m)
  join public.fcm_tokens t on t.user_id = ul.user_id
  where r.id = p_report_id and ul.user_id <> r.owner_id;
$$;

-- SECURITY: tokens_near_report exposes FCM tokens. Only the Edge Function (service_role) may call it.
revoke execute on function public.tokens_near_report(uuid) from public, anon, authenticated;
grant execute on function public.tokens_near_report(uuid) to service_role;
