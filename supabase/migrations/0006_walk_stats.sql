create or replace function public.my_walk_stats()
returns table (total_distance_m double precision, total_count int, this_week_count int, current_streak int)
language sql security definer set search_path = public as $$
  with mine as (select * from public.walk_records where user_id = auth.uid()),
  days as (select distinct ((started_at at time zone 'Asia/Seoul')::date) as d from mine),
  grp as (select d, (d - (row_number() over (order by d))::int) as g from days),
  runs as (select g, count(*)::int as len, max(d) as last_d from grp group by g),
  latest as (select len, last_d from runs order by last_d desc limit 1)
  select
    coalesce((select sum(distance_m) from mine), 0)::double precision,
    (select count(*) from mine)::int,
    (select count(*) from mine
       where (started_at at time zone 'Asia/Seoul')::date >= (date_trunc('week', (now() at time zone 'Asia/Seoul')))::date)::int,
    coalesce((select len from latest
              where last_d >= (((now() at time zone 'Asia/Seoul')::date) - interval '1 day')), 0)::int;
$$;
