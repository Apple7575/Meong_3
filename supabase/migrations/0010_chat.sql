create table public.chats (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.missing_reports(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (report_id, reporter_id)
);
create index chats_owner_idx on public.chats(owner_id, last_message_at desc);
create index chats_reporter_idx on public.chats(reporter_id, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now()
);
create index messages_chat_idx on public.messages(chat_id, created_at);

alter table public.chats enable row level security;
alter table public.messages enable row level security;

-- chats: participants read; no direct write policies (creation only via get_or_create_chat RPC)
create policy "chats_select_participant" on public.chats for select to authenticated
  using (auth.uid() = owner_id or auth.uid() = reporter_id);

-- messages: participants read; insert only by sender-participant AND while report is active (closed policy)
create policy "messages_select_participant" on public.messages for select to authenticated
  using (exists (select 1 from public.chats c where c.id = chat_id and auth.uid() in (c.owner_id, c.reporter_id)));
create policy "messages_insert" on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (select 1 from public.chats c join public.missing_reports r on r.id = c.report_id
                where c.id = chat_id and auth.uid() in (c.owner_id, c.reporter_id) and r.status = 'active')
  );

-- bump chats.last_message_at on new message (thread ordering)
create or replace function public.bump_chat_last_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.chats set last_message_at = new.created_at where id = new.chat_id;
  return new;
end; $$;
create trigger messages_bump_chat after insert on public.messages
  for each row execute function public.bump_chat_last_message();

-- Realtime: clients subscribe to message inserts (RLS-aware)
alter publication supabase_realtime add table public.messages;
