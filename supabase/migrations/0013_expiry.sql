-- pg_cron-driven batch maintenance: auto-expire stale reports + purge old notification logs.
-- pg_cron installs its own `cron` schema (cron.job, cron.schedule, ...), which is why we call
-- cron.schedule(...) below regardless of any schema clause. We omit `with schema extensions`
-- and use the extension default; Task A1 Step 2 verifies `db reset` applies this cleanly on the
-- local stack, and Phase D verifies the extension is enabled + jobs registered in cloud.
create extension if not exists pg_cron;

-- Flip active reports past their expires_at to 'expired'. Idempotent — safe to re-run every cycle.
-- Derived effects via existing RLS (no extra work):
--   * messages_insert requires status='active'  -> connected chats become read-only,
--   * report_detail / flyer / active_reports_in_bounds gate on status='active' -> auto-excluded.
create or replace function public.expire_old_reports()
returns void language sql security definer set search_path = public as $$
  update public.missing_reports
     set status = 'expired', updated_at = now()
   where status = 'active' and expires_at < now();
$$;

-- Retain notification_logs 30 days (crisis fan-out audit), then purge.
create or replace function public.purge_old_notification_logs()
returns void language sql security definer set search_path = public as $$
  delete from public.notification_logs where created_at < now() - interval '30 days';
$$;

-- cron runs these as the function owner; lock direct EXECUTE away from clients.
-- Revoke from public, anon, AND authenticated — only service_role (cron) may invoke these.
revoke execute on function public.expire_old_reports() from public, anon, authenticated;
grant execute on function public.expire_old_reports() to service_role;
revoke execute on function public.purge_old_notification_logs() from public, anon, authenticated;
grant execute on function public.purge_old_notification_logs() to service_role;

-- Daily schedule (server time): expire at 03:00, purge at 03:30.
-- cron.schedule upserts by job name, so re-applying is safe.
select cron.schedule('expire-reports',   '0 3 * * *',  $$ select public.expire_old_reports() $$);
select cron.schedule('purge-notif-logs', '30 3 * * *', $$ select public.purge_old_notification_logs() $$);
