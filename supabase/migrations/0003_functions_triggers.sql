-- 가입 시 profiles 행 자동 생성
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 사용자당 최신 1개 위치 upsert (lat/lng → geography)
create or replace function public.upsert_my_location(lat double precision, lng double precision)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_locations(user_id, geom, updated_at)
  values (auth.uid(), st_setsrid(st_makepoint(lng, lat), 4326)::geography, now())
  on conflict (user_id) do update set geom = excluded.geom, updated_at = now();
end; $$;
