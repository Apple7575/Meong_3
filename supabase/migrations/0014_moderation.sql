-- ===== (1) Hide false sighting pins (owner-only) =====
alter table public.sightings add column hidden boolean not null default false;

-- Toggle a sighting's hidden flag. Only the owner of the report the sighting belongs to may call.
-- Column-safe: cannot alter coordinates/notes, only the hidden flag.
create or replace function public.hide_sighting(p_sighting_id uuid, p_hidden boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.sightings s
      join public.missing_reports r on r.id = s.report_id
     where s.id = p_sighting_id and r.owner_id = auth.uid()
  ) then
    raise exception 'not authorized to moderate this sighting';
  end if;
  update public.sightings set hidden = p_hidden where id = p_sighting_id;
end; $$;
revoke execute on function public.hide_sighting(uuid, boolean) from public, anon;
grant  execute on function public.hide_sighting(uuid, boolean) to authenticated;

-- Exclude hidden sightings from the tracking map/list (rebuild of 0009's report_sightings,
-- adding `and not s.hidden`). Same signature -> create or replace is fine.
create or replace function public.report_sightings(p_report_id uuid)
returns table (id uuid, report_id uuid, reporter_id uuid, seen_at timestamptz, note text, created_at timestamptz, lat double precision, lng double precision)
language sql security definer set search_path = public as $$
  select s.id, s.report_id, s.reporter_id, s.seen_at, s.note, s.created_at,
         st_y(s.point::geometry) as lat, st_x(s.point::geometry) as lng
  from public.sightings s
  where s.report_id = p_report_id
    and not s.hidden
    and (s.reporter_id = auth.uid()
         or exists (select 1 from public.missing_reports r where r.id = s.report_id and r.owner_id = auth.uid()))
  order by s.seen_at asc;
$$;

-- ===== (2) Block (stalking safety) =====
create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id)
);
alter table public.blocks enable row level security;
-- A user manages only their own block rows. Explicit select/insert/delete (no update) to match
-- the contract — a block row is immutable once created; you unblock by deleting it.
create policy "blocks_select_own" on public.blocks for select to authenticated using (blocker_id = auth.uid());
create policy "blocks_insert_own" on public.blocks for insert to authenticated with check (blocker_id = auth.uid());
create policy "blocks_delete_own" on public.blocks for delete to authenticated using (blocker_id = auth.uid());

-- Block existence check, SECURITY DEFINER so it bypasses `blocks` RLS. This is REQUIRED for a
-- bidirectional guard: blocks_select_own only exposes a user's OWN block rows, so if it were
-- queried directly inside the messages_insert policy (evaluated as the inserting user), the
-- blocked party would never see the blocker's row and could keep sending. The helper returns
-- only a boolean (no leak of who blocked whom) for the two participants of the given chat.
create or replace function public.chat_has_block(p_chat_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.blocks b join public.chats c on c.id = p_chat_id
     where (b.blocker_id = c.owner_id    and b.blocked_id = c.reporter_id)
        or (b.blocker_id = c.reporter_id and b.blocked_id = c.owner_id)
  );
$$;
revoke execute on function public.chat_has_block(uuid) from public, anon;
grant  execute on function public.chat_has_block(uuid) to authenticated;

-- Bidirectional block guard on message sends: if either chat participant has blocked the other,
-- nobody in that chat can send. Rebuild of 0010's messages_insert adding the chat_has_block clause.
drop policy "messages_insert" on public.messages;
create policy "messages_insert" on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (select 1 from public.chats c join public.missing_reports r on r.id = c.report_id
                where c.id = chat_id and auth.uid() in (c.owner_id, c.reporter_id) and r.status = 'active')
    and not public.chat_has_block(chat_id)
  );

-- Rebuild my_chats (0011) to (a) expose other_id for the block UI and (b) hide threads with
-- the other party I have blocked. Return-type changes, so DROP first (create-or-replace can't
-- alter a function's return table).
drop function if exists public.my_chats();
create function public.my_chats()
returns table (chat_id uuid, report_id uuid, other_id uuid, other_nickname text, dog_name text, report_status text, last_message_at timestamptz, last_body text)
language sql security definer set search_path = public as $$
  select c.id, c.report_id,
    case when c.owner_id = auth.uid() then c.reporter_id else c.owner_id end as other_id,
    (select p.nickname from public.profiles p
       where p.id = case when c.owner_id = auth.uid() then c.reporter_id else c.owner_id end),
    (select d.name from public.dogs d join public.missing_reports r on r.dog_id = d.id where r.id = c.report_id),
    (select r.status from public.missing_reports r where r.id = c.report_id),
    c.last_message_at,
    (select m.body from public.messages m where m.chat_id = c.id order by m.created_at desc limit 1)
  from public.chats c
  where auth.uid() in (c.owner_id, c.reporter_id)
    and not exists (
      select 1 from public.blocks b
       where b.blocker_id = auth.uid()
         and b.blocked_id = case when c.owner_id = auth.uid() then c.reporter_id else c.owner_id end
    )
  order by c.last_message_at desc;
$$;
revoke execute on function public.my_chats() from public, anon;
grant  execute on function public.my_chats() to authenticated;

-- ===== (3) Content flags (record only; no automated action) =====
create table public.content_flags (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('sighting','message')),
  content_id uuid not null,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.content_flags enable row level security;
-- Authenticated users file flags under their own name only; no select policy (admin tooling later).
create policy "content_flags_insert_own" on public.content_flags for insert to authenticated
  with check (reporter_id = auth.uid());
