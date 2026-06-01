-- Create-or-fetch the (report, reporter) chat. Caller must be the report owner (chatting with a
-- reporter who has a sighting on the report) OR that reporter themself.
create or replace function public.get_or_create_chat(p_report_id uuid, p_reporter_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_chat uuid;
begin
  select owner_id into v_owner from public.missing_reports where id = p_report_id;
  if v_owner is null then raise exception 'report not found'; end if;
  if p_reporter_id = v_owner then raise exception 'cannot chat with the report owner (self)'; end if;

  if auth.uid() = v_owner then
    if not exists (select 1 from public.sightings s where s.report_id = p_report_id and s.reporter_id = p_reporter_id) then
      raise exception 'that user has no sighting on this report';
    end if;
  elsif auth.uid() = p_reporter_id then
    if not exists (select 1 from public.sightings s where s.report_id = p_report_id and s.reporter_id = auth.uid()) then
      raise exception 'you have no sighting on this report';
    end if;
  else
    raise exception 'not authorized';
  end if;

  insert into public.chats (report_id, reporter_id, owner_id)
  values (p_report_id, p_reporter_id, v_owner)
  on conflict (report_id, reporter_id) do update set report_id = excluded.report_id
  returning id into v_chat;
  return v_chat;
end; $$;

-- The caller's chats with the OTHER participant's nickname (nickname only — never phone),
-- dog name, report status (for closed), and a last-message snippet.
create or replace function public.my_chats()
returns table (chat_id uuid, report_id uuid, other_nickname text, dog_name text, report_status text, last_message_at timestamptz, last_body text)
language sql security definer set search_path = public as $$
  select c.id, c.report_id,
    (select p.nickname from public.profiles p
       where p.id = case when c.owner_id = auth.uid() then c.reporter_id else c.owner_id end),
    (select d.name from public.dogs d join public.missing_reports r on r.dog_id = d.id where r.id = c.report_id),
    (select r.status from public.missing_reports r where r.id = c.report_id),
    c.last_message_at,
    (select m.body from public.messages m where m.chat_id = c.id order by m.created_at desc limit 1)
  from public.chats c
  where auth.uid() in (c.owner_id, c.reporter_id)
  order by c.last_message_at desc;
$$;

-- These RPCs validate via auth.uid() internally; lock EXECUTE to authenticated (consistent with 0008).
revoke execute on function public.get_or_create_chat(uuid, uuid) from public, anon;
grant execute on function public.get_or_create_chat(uuid, uuid) to authenticated;
revoke execute on function public.my_chats() from public, anon;
grant execute on function public.my_chats() to authenticated;
