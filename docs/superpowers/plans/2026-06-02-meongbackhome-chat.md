# 멍백홈 Sub-project 4 「채팅 (보호자 ↔ 제보자 1:1)」 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 신고-제보자 쌍당 1:1 텍스트 채팅(Supabase Realtime) + 새 메시지 푸시 + report 만료 시 읽기전용(closed)을 동작하는 형태로 구축한다.

**Architecture:** 채팅 생성/조회/목록은 SECURITY DEFINER RPC로(규칙·프로필 닉네임 노출을 한 곳에서, phone 누출 없이) 처리; 메시지 읽기/쓰기는 참여자 RLS(쓰기는 report active 필요=closed 정책). 실시간은 messages publication 구독. 푸시는 SP3a에서 추출한 `_shared/fcm.ts`를 notify-nearby·notify-message가 공유. SP1–3 코드/커밋 패턴을 따른다.

**Tech Stack:** Expo RN(TS) · supabase-js(Realtime 포함) · Supabase Edge Functions(Deno) + Database Webhook · FCM HTTP v1 · Jest(unit+integration) · Deno test(edge).

**Branch:** `feat/chat` (off main with SP1+SP2+SP3a). 로컬 Node/Docker(colima)/Supabase 준비됨.

---

## File Structure

```
supabase/migrations/0010_chat.sql            chats/messages + RLS + last_message_at 트리거 + realtime publication
supabase/migrations/0011_chat_rpc.sql         get_or_create_chat() · my_chats()
supabase/tests/chat.test.ts                   RLS + RPC + closed + 트리거 통합 테스트
supabase/functions/_shared/fcm.ts             추출 공통: getAccessToken·dispatchPush·buildLogRows·invalidTokensFrom
supabase/functions/_shared/fcm.test.ts        Deno 단위 테스트(로그/무효토큰/메시지)
supabase/functions/notify-nearby/index.ts     (리팩터) _shared/fcm 사용
supabase/functions/notify-nearby/logic.ts     (삭제) → _shared/fcm로 이동
supabase/functions/notify-nearby/logic.test.ts (삭제) → _shared/fcm.test.ts로 이동
supabase/functions/notify-message/index.ts    메시지 알림
src/types/db.ts (수정)                         Chat, ChatListItem, Message
src/validation/message.ts + .test.ts          빈/공백 거부 (TDD)
src/services/chats.ts + .test.ts              getOrCreateChat·myChats·listMessages·sendMessage·subscribeToChat (TDD)
src/lib/pushNav.ts (수정)                      chat_message 딥링크
app/(app)/chat/[id].tsx                        스레드 화면
app/(app)/chats.tsx                            채팅 목록
app/(app)/report/[id]/track.tsx (수정)         제보 항목 "대화"(보호자)
app/(app)/report/[id]/index.tsx (수정)         "보호자와 대화"(제보자)
app/(app)/home.tsx (수정)                      "채팅" 진입점
```

---

## Task 1: 마이그레이션 0010 — chats/messages + RLS + 트리거 + Realtime

**Files:** Create `supabase/migrations/0010_chat.sql`.

- [ ] **Step 1: SQL 작성**

```sql
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
```

- [ ] **Step 2: 적용 + 클린 재적용** — `npx supabase migration up`; `npx supabase db reset --no-seed` (0001–0010 클린).
- [ ] **Step 3: 확인** — `docker exec supabase_db_MeongBackHome psql -U postgres -c "\dt public.chats public.messages"` + `psql -c "select policyname from pg_policies where tablename in ('chats','messages')"` + 트리거/publication 확인: `psql -c "select tgname from pg_trigger where tgrelid='public.messages'::regclass"` , `psql -c "select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename='messages'"`.
- [ ] **Step 4: Commit** — `git add supabase/migrations/0010_chat.sql && git commit -m "feat(db): chats/messages + participant RLS + last_message trigger + realtime"`

---

## Task 2: 마이그레이션 0011 — get_or_create_chat + my_chats RPC

**Files:** Create `supabase/migrations/0011_chat_rpc.sql`.

- [ ] **Step 1: SQL 작성**

```sql
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
```

- [ ] **Step 2: 적용** — `npx supabase migration up`.
- [ ] **Step 3: Commit** — `git add supabase/migrations/0011_chat_rpc.sql && git commit -m "feat(db): get_or_create_chat + my_chats RPCs"`

---

## Task 3: 채팅 통합 테스트 (RLS + RPC + closed + 트리거)

**Files:** Create `supabase/tests/chat.test.ts`.

- [ ] **Step 1: 실패하는 테스트 작성** — `supabase/tests/chat.test.ts`:

```ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

async function makeUser(email: string, nickname: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true });
  if (error) throw error;
  await admin.from('profiles').update({ nickname, phone: '01000000000' }).eq('id', data.user!.id);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const s = await client.auth.signInWithPassword({ email, password: 'password123' });
  if (s.error) throw s.error;
  return { id: data.user!.id, client };
}

describe('chat RLS + RPC + closed', () => {
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let reporter: Awaited<ReturnType<typeof makeUser>>;
  let stranger: Awaited<ReturnType<typeof makeUser>>;
  let reportId: string; let chatId: string;

  beforeAll(async () => {
    const t = Date.now();
    owner = await makeUser(`o-${t}@t.dev`, '보호자');
    reporter = await makeUser(`r-${t}@t.dev`, '제보자');
    stranger = await makeUser(`s-${t}@t.dev`, '낯선이');
    const dog = await owner.client.from('dogs').insert({ owner_id: owner.id, name: '초코' }).select('id').single();
    const rep = await owner.client.from('missing_reports').insert({
      owner_id: owner.id, dog_id: (dog.data as any).id,
      last_seen_point: 'SRID=4326;POINT(127.07 37.65)', last_seen_at: new Date().toISOString(), alert_radius_m: 2000,
    }).select('id').single();
    reportId = (rep.data as any).id;
    // reporter files a sighting (precondition for chat)
    await reporter.client.from('sightings').insert({
      report_id: reportId, reporter_id: reporter.id,
      point: 'SRID=4326;POINT(127.071 37.651)', seen_at: new Date().toISOString(),
    });
  });

  test('reporter can get_or_create_chat; owner gets the SAME chat (idempotent)', async () => {
    const r1 = await reporter.client.rpc('get_or_create_chat', { p_report_id: reportId, p_reporter_id: reporter.id });
    expect(r1.error).toBeNull();
    chatId = r1.data as string;
    const r2 = await owner.client.rpc('get_or_create_chat', { p_report_id: reportId, p_reporter_id: reporter.id });
    expect(r2.data).toBe(chatId); // same thread
  });

  test('stranger cannot get_or_create_chat (no sighting / not authorized)', async () => {
    const r = await stranger.client.rpc('get_or_create_chat', { p_report_id: reportId, p_reporter_id: stranger.id });
    expect(r.error).not.toBeNull();
  });

  test('participants send + read; stranger denied; trigger bumps last_message_at', async () => {
    // controlled OLD timestamp so the trigger bump is observable as a STRICT increase (not a trivial >=)
    await admin.from('chats').update({ last_message_at: '2000-01-01T00:00:00Z' }).eq('id', chatId);
    const ins = await reporter.client.from('messages').insert({ chat_id: chatId, sender_id: reporter.id, body: '봤어요!' });
    expect(ins.error).toBeNull();
    const ownerRead = await owner.client.from('messages').select('body').eq('chat_id', chatId);
    expect(ownerRead.data?.some((m: any) => m.body === '봤어요!')).toBe(true);
    const strangerRead = await stranger.client.from('messages').select('*').eq('chat_id', chatId);
    expect(strangerRead.data ?? []).toEqual([]);
    const after = (await admin.from('chats').select('last_message_at').eq('id', chatId).single()).data as any;
    expect(new Date(after.last_message_at).getTime()).toBeGreaterThan(new Date('2000-01-01T00:00:00Z').getTime());
  });

  test('stranger cannot send into a chat they are not in', async () => {
    const ins = await stranger.client.from('messages').insert({ chat_id: chatId, sender_id: stranger.id, body: 'hi' });
    expect(ins.error).not.toBeNull();
  });

  test('closed (resolved) report blocks new messages but allows reading', async () => {
    await owner.client.from('missing_reports').update({ status: 'resolved' }).eq('id', reportId);
    try {
      const ins = await reporter.client.from('messages').insert({ chat_id: chatId, sender_id: reporter.id, body: 'late' });
      expect(ins.error).not.toBeNull(); // closed
      const read = await reporter.client.from('messages').select('body').eq('chat_id', chatId);
      expect((read.data ?? []).length).toBeGreaterThan(0); // history still readable
    } finally {
      await owner.client.from('missing_reports').update({ status: 'active' }).eq('id', reportId); // restore even if asserts fail
    }
  });

  test('owner cannot open a self-chat (reporter = owner)', async () => {
    const r = await owner.client.rpc('get_or_create_chat', { p_report_id: reportId, p_reporter_id: owner.id });
    expect(r.error).not.toBeNull();
  });

  test('anonymous cannot call chat RPCs (execute revoked)', async () => {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    expect((await anon.rpc('my_chats')).error).not.toBeNull();
    expect((await anon.rpc('get_or_create_chat', { p_report_id: reportId, p_reporter_id: reporter.id })).error).not.toBeNull();
  });

  test('my_chats returns the other participant nickname (no phone)', async () => {
    const r = await owner.client.rpc('my_chats');
    const row = (r.data as any[]).find((x) => x.chat_id === chatId);
    expect(row.other_nickname).toBe('제보자');
    expect(row.dog_name).toBe('초코');
    expect(row).not.toHaveProperty('phone');
  });
});
```

- [ ] **Step 2: 실행 — 통과 확인** (로컬 Supabase 실행 중) — `npx jest --config supabase/tests/jest.rls.config.js` → chat(6) + crisis + walks + rls 모두 PASS. 실패 시 마이그레이션 수정(테스트 약화 금지).
- [ ] **Step 3: Commit** — `git add supabase/tests/chat.test.ts && git commit -m "test(db): chat RLS + get_or_create_chat + closed + trigger integration"`

---

## Task 4: 타입 + 메시지 검증 (TDD)

**Files:** Modify `src/types/db.ts`; create `src/validation/message.ts` + `.test.ts`.

- [ ] **Step 1: 타입 추가** — append to `src/types/db.ts`:

```ts
export type Message = { id: string; chat_id: string; sender_id: string; body: string; created_at: string };
export type ChatListItem = {
  chat_id: string; report_id: string; other_nickname: string | null; dog_name: string | null;
  report_status: ReportStatus; last_message_at: string; last_body: string | null;
};
```

- [ ] **Step 2: 실패하는 테스트** — `src/validation/message.test.ts`:

```ts
import { cleanMessageBody, isValidMessage } from './message';

test('isValidMessage rejects empty/whitespace, accepts real text', () => {
  expect(isValidMessage('')).toBe(false);
  expect(isValidMessage('   ')).toBe(false);
  expect(isValidMessage('안녕하세요')).toBe(true);
});
test('cleanMessageBody trims', () => {
  expect(cleanMessageBody('  hi  ')).toBe('hi');
});
```

- [ ] **Step 3: 실패 확인** — `npx jest src/validation/message.test.ts` → FAIL.
- [ ] **Step 4: 구현** — `src/validation/message.ts`:

```ts
export function cleanMessageBody(raw: string): string {
  return raw.trim();
}
export function isValidMessage(raw: string): boolean {
  return cleanMessageBody(raw).length > 0;
}
```

- [ ] **Step 5: 통과 + tsc** — `npx jest src/validation/message.test.ts` PASS; `npx tsc --noEmit` clean.
- [ ] **Step 6: Commit** — `git add src/types/db.ts src/validation/message.ts src/validation/message.test.ts && git commit -m "feat(sp4): message validation + chat types (TDD)"`

---

## Task 5: chats 서비스 (TDD)

**Files:** Create `src/services/chats.ts` + `.test.ts`.

- [ ] **Step 1: 실패하는 테스트** — `src/services/chats.test.ts`:

```ts
import { getOrCreateChat, myChats, listMessages, sendMessage, subscribeToChat } from './chats';

const mockSingle = jest.fn();
const mockOrder = jest.fn();
const mockEq = jest.fn(() => ({ order: mockOrder }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockInsert = jest.fn();
const mockFrom = jest.fn(() => ({ select: mockSelect, insert: mockInsert }));
const mockRpc = jest.fn();
const mockOn = jest.fn(function (this: any) { return this; });
const mockSubscribe = jest.fn(function (this: any) { return this; });
const mockChannel = jest.fn(() => ({ on: mockOn, subscribe: mockSubscribe }));
const mockRemoveChannel = jest.fn();
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: (...a: any[]) => (mockFrom as any)(...a),
    rpc: (...a: any[]) => (mockRpc as any)(...a),
    channel: (...a: any[]) => (mockChannel as any)(...a),
    removeChannel: (...a: any[]) => (mockRemoveChannel as any)(...a),
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u1' } } })) },
  },
}));
beforeEach(() => jest.clearAllMocks());

test('getOrCreateChat calls rpc, returns chat id', async () => {
  mockRpc.mockResolvedValueOnce({ data: 'c1', error: null });
  const id = await getOrCreateChat('r1', 'rep1');
  expect(mockRpc).toHaveBeenCalledWith('get_or_create_chat', { p_report_id: 'r1', p_reporter_id: 'rep1' });
  expect(id).toBe('c1');
});
test('myChats calls rpc', async () => {
  mockRpc.mockResolvedValueOnce({ data: [{ chat_id: 'c1' }], error: null });
  const rows = await myChats();
  expect(mockRpc).toHaveBeenCalledWith('my_chats');
  expect(rows).toHaveLength(1);
});
test('listMessages selects by chat ordered by created_at', async () => {
  mockOrder.mockResolvedValueOnce({ data: [{ id: 'm1' }], error: null });
  const rows = await listMessages('c1');
  expect(mockFrom).toHaveBeenCalledWith('messages');
  expect(mockEq).toHaveBeenCalledWith('chat_id', 'c1');
  expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: true });
  expect(rows).toHaveLength(1);
});
test('sendMessage inserts trimmed body with sender = current user', async () => {
  mockInsert.mockResolvedValueOnce({ error: null });
  await sendMessage('c1', '  안녕  ');
  expect(mockInsert).toHaveBeenCalledWith({ chat_id: 'c1', sender_id: 'u1', body: '안녕' });
});
test('sendMessage rejects empty body before hitting the DB', async () => {
  await expect(sendMessage('c1', '   ')).rejects.toThrow();
  expect(mockInsert).not.toHaveBeenCalled();
});
test('subscribeToChat opens a channel filtered by chat_id and returns an unsubscribe', () => {
  const unsub = subscribeToChat('c1', () => {});
  expect(mockChannel).toHaveBeenCalledWith('chat:c1');
  expect(mockOn).toHaveBeenCalledWith('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'messages', filter: 'chat_id=eq.c1' }, expect.any(Function));
  unsub();
  expect(mockRemoveChannel).toHaveBeenCalled();
});
```

- [ ] **Step 2: 실패 확인** — `npx jest src/services/chats.test.ts` → FAIL.
- [ ] **Step 3: 구현** — `src/services/chats.ts`:

```ts
import { supabase } from '../lib/supabase';
import { ChatListItem, Message } from '../types/db';
import { cleanMessageBody, isValidMessage } from '../validation/message';

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) throw new Error('로그인이 필요합니다.');
  return data.user.id;
}

export async function getOrCreateChat(reportId: string, reporterId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_or_create_chat', { p_report_id: reportId, p_reporter_id: reporterId });
  if (error) throw new Error(error.message);
  return data as string;
}
export async function myChats(): Promise<ChatListItem[]> {
  const { data, error } = await supabase.rpc('my_chats');
  if (error) throw new Error(error.message);
  return (data ?? []) as ChatListItem[];
}
export async function listMessages(chatId: string): Promise<Message[]> {
  const { data, error } = await supabase.from('messages').select('*').eq('chat_id', chatId).order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Message[];
}
export async function sendMessage(chatId: string, raw: string): Promise<void> {
  if (!isValidMessage(raw)) throw new Error('메시지를 입력하세요.');
  const sender_id = await uid();
  const { error } = await supabase.from('messages').insert({ chat_id: chatId, sender_id, body: cleanMessageBody(raw) });
  if (error) throw new Error(error.message);
}
export function subscribeToChat(chatId: string, onInsert: (m: Message) => void): () => void {
  const channel = supabase
    .channel(`chat:${chatId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
      (payload: { new: Message }) => onInsert(payload.new))
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
```

- [ ] **Step 4: 통과 + tsc** — `npx jest src/services/chats.test.ts` PASS (6); `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git add src/services/chats.ts src/services/chats.test.ts && git commit -m "feat(sp4): chats service (rpc/list/send/subscribe) TDD"`

---

## Task 6: `_shared/fcm.ts` 추출 + notify-nearby 리팩터 (Deno TDD)

**Files:** Create `supabase/functions/_shared/fcm.ts` + `.test.ts`; modify `supabase/functions/notify-nearby/index.ts`; delete `supabase/functions/notify-nearby/logic.ts` + `logic.test.ts`.

- [ ] **Step 1: `_shared/fcm.ts` 작성** (notify-nearby/logic.ts + index.ts의 getAccessToken/발송 로직을 통합):

```ts
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type SendResult = { user_id: string; token: string; ok: boolean; errorCode?: string };
export type LogRow = { report_id: string; user_id: string; token: string; status: 'sent' | 'failed' };

export function buildLogRows(reportId: string, results: SendResult[]): LogRow[] {
  return results.map((r) => ({ report_id: reportId, user_id: r.user_id, token: r.token, status: r.ok ? 'sent' : 'failed' }));
}
const CLEANUP_CODES = new Set(['UNREGISTERED', 'INVALID_ARGUMENT']);
export function invalidTokensFrom(results: SendResult[]): string[] {
  return results.filter((r) => !r.ok && r.errorCode && CLEANUP_CODES.has(r.errorCode)).map((r) => r.token);
}

/** The chat participant who is NOT the sender. null if the sender isn't a participant. */
export function recipientOf(chat: { owner_id: string; reporter_id: string }, senderId: string): string | null {
  if (senderId === chat.owner_id) return chat.reporter_id;
  if (senderId === chat.reporter_id) return chat.owner_id;
  return null;
}

export async function getAccessToken(saJson: string): Promise<{ token: string; projectId: string }> {
  const sa = JSON.parse(saJson);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const toSign = `${enc(header)}.${enc(claim)}`;
  const keyData = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const der = Uint8Array.from(atob(keyData), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(toSign));
  const jwt = `${toSign}.${btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}`;
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const j = await resp.json();
  if (!resp.ok || !j.access_token) throw new Error(`oauth token request failed: ${resp.status} ${JSON.stringify(j)}`);
  return { token: j.access_token, projectId: sa.project_id };
}

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

/** Send one FCM v1 push per recipient, log to notification_logs, clean up invalid tokens. Returns a summary. */
export async function dispatchPush(
  supabase: SupabaseClient,
  opts: { reportId: string; recipients: { user_id: string; token: string }[]; notification: { title: string; body: string }; data: Record<string, string> },
): Promise<{ sent: number; total: number; logged: boolean; cleaned: boolean }> {
  if (opts.recipients.length === 0) return { sent: 0, total: 0, logged: true, cleaned: true };
  const { token: accessToken, projectId } = await getAccessToken(Deno.env.get('FCM_SERVICE_ACCOUNT')!);
  const results: SendResult[] = [];
  for (const r of opts.recipients) {
    try {
      const fr = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token: r.token, notification: opts.notification, data: opts.data } }),
      });
      if (fr.ok) results.push({ user_id: r.user_id, token: r.token, ok: true });
      else {
        const err = await fr.json().catch(() => ({}));
        // only a genuine FcmError detail drives token cleanup (not request-level errors)
        const fcmErrorCode = (err?.error?.details ?? []).find(
          (d: any) => typeof d?.['@type'] === 'string' && d['@type'].includes('FcmError') && typeof d?.errorCode === 'string',
        )?.errorCode;
        results.push({ user_id: r.user_id, token: r.token, ok: false, errorCode: fcmErrorCode });
      }
    } catch (_e) {
      results.push({ user_id: r.user_id, token: r.token, ok: false });
    }
  }
  let logged = true; let cleaned = true;
  const logs = buildLogRows(opts.reportId, results);
  if (logs.length) { const { error: e } = await supabase.from('notification_logs').insert(logs); if (e) { logged = false; console.error('log insert failed', e); } }
  const bad = invalidTokensFrom(results);
  if (bad.length) { const { error: e } = await supabase.from('fcm_tokens').delete().in('token', bad); if (e) { cleaned = false; console.error('token cleanup failed', e); } }
  return { sent: results.filter((r) => r.ok).length, total: results.length, logged, cleaned };
}
```

- [ ] **Step 2: `_shared/fcm.test.ts`** (notify-nearby/logic.test.ts 내용을 옮기고 import 경로만 변경):

```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildLogRows, invalidTokensFrom, recipientOf } from './fcm.ts';

Deno.test('buildLogRows maps send results to log rows', () => {
  assertEquals(buildLogRows('r1', [{ user_id: 'u1', token: 't1', ok: true }, { user_id: 'u2', token: 't2', ok: false }]), [
    { report_id: 'r1', user_id: 'u1', token: 't1', status: 'sent' },
    { report_id: 'r1', user_id: 'u2', token: 't2', status: 'failed' },
  ]);
});
Deno.test('invalidTokensFrom cleans only FcmError codes, ignores request-level errors', () => {
  assertEquals(invalidTokensFrom([
    { user_id: 'u1', token: 't1', ok: false, errorCode: undefined },
    { user_id: 'u2', token: 't2', ok: false, errorCode: 'UNREGISTERED' },
    { user_id: 'u3', token: 't3', ok: false, errorCode: 'INTERNAL' },
  ]), ['t2']);
});
Deno.test('recipientOf returns the non-sender participant, null for a non-participant', () => {
  const chat = { owner_id: 'o', reporter_id: 'r' };
  assertEquals(recipientOf(chat, 'o'), 'r');
  assertEquals(recipientOf(chat, 'r'), 'o');
  assertEquals(recipientOf(chat, 'x'), null);
});
```

- [ ] **Step 3: notify-nearby/index.ts 리팩터** — replace its inline getAccessToken/loop/log with `_shared/fcm.ts`:

```ts
import { adminClient, dispatchPush } from '../_shared/fcm.ts';

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const reportId: string = payload.record?.id ?? payload.report_id;
    if (!reportId) return new Response('no report id', { status: 400 });
    const supabase = adminClient();
    const { data: report } = await supabase.from('missing_reports').select('id, dog:dogs(name)').eq('id', reportId).single();
    const dogName = (report as any)?.dog?.name ?? '실종견';
    const { data: recipients, error } = await supabase.rpc('tokens_near_report', { p_report_id: reportId });
    if (error) return new Response(error.message, { status: 500 });
    const summary = await dispatchPush(supabase, {
      reportId,
      recipients: (recipients ?? []) as { user_id: string; token: string }[],
      notification: { title: '우리 동네 실종견', body: `${dogName}를 찾고 있어요. 혹시 보셨나요?` },
      data: { type: 'missing_report', report_id: reportId },
    });
    return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) { return new Response(String(e), { status: 500 }); }
});
```

- [ ] **Step 4: 옛 파일 삭제** — `git rm supabase/functions/notify-nearby/logic.ts supabase/functions/notify-nearby/logic.test.ts`.
- [ ] **Step 5: Deno 테스트 + check** — `deno test supabase/functions/_shared/fcm.test.ts` → PASS (2). `deno check supabase/functions/notify-nearby/index.ts` (esm.sh 미해결 네트워크 에러는 무시, 타입 에러는 없어야). `npm test` 여전히 46(영향 없음).
- [ ] **Step 6: Commit** — `git add -A && git commit -m "refactor(sp4): extract _shared/fcm.ts; notify-nearby uses dispatchPush"`

---

## Task 7: notify-message Edge Function

**Files:** Create `supabase/functions/notify-message/index.ts`.

- [ ] **Step 1: 작성**

```ts
import { adminClient, dispatchPush, recipientOf } from '../_shared/fcm.ts';

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const msg = payload.record; // { id, chat_id, sender_id, body }
    if (!msg?.chat_id) return new Response('no message', { status: 400 });
    const supabase = adminClient();
    const { data: chat, error: chatErr } = await supabase.from('chats').select('owner_id, reporter_id, report_id').eq('id', msg.chat_id).single();
    if (chatErr || !chat) return new Response('no chat', { status: 404 });
    const recipientId = recipientOf(chat as any, msg.sender_id);
    if (!recipientId) return new Response('sender not a participant', { status: 400 });
    const { data: tokens, error: tokErr } = await supabase.from('fcm_tokens').select('user_id, token').eq('user_id', recipientId);
    if (tokErr) return new Response(tokErr.message, { status: 500 });
    const summary = await dispatchPush(supabase, {
      reportId: (chat as any).report_id,
      recipients: (tokens ?? []) as { user_id: string; token: string }[],
      notification: { title: '멍백홈', body: '새 메시지가 도착했어요' }, // body preview intentionally hidden (privacy)
      data: { type: 'chat_message', chat_id: msg.chat_id, report_id: (chat as any).report_id },
    });
    return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) { return new Response(String(e), { status: 500 }); }
});
```

- [ ] **Step 2: check** — `deno check supabase/functions/notify-message/index.ts` (esm.sh 네트워크 에러만 허용). 로컬 기동 시도 `npx supabase functions serve notify-message --no-verify-jwt` 가 구문 에러 없이 뜨는지.
- [ ] **Step 3: Commit** — `git add supabase/functions/notify-message/index.ts && git commit -m "feat(sp4): notify-message edge function (recipient=non-sender, generic body)"`

---

## Task 8: pushNav — chat_message 딥링크

**Files:** Modify `src/lib/pushNav.ts`.

- [ ] **Step 1: routeFromData 확장** — replace the routing helper:

```ts
function routeFromData(data?: Record<string, string | object>) {
  const d = data as any;
  if (!d) return;
  if (d.type === 'missing_report' && d.report_id) router.push(`/(app)/report/${d.report_id}`);
  else if (d.type === 'chat_message' && d.chat_id) router.push(`/(app)/chat/${d.chat_id}`);
}
```

- [ ] **Step 2: tsc + 회귀** — `npx tsc --noEmit` clean; `npm test` 46.
- [ ] **Step 3: Commit** — `git add src/lib/pushNav.ts && git commit -m "feat(sp4): push deep-link for chat_message"`

---

## Task 9: 채팅 스레드 화면

**Files:** Create `app/(app)/chat/[id].tsx`.

- [ ] **Step 1: 작성** — `app/(app)/chat/[id].tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, Alert, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { listMessages, sendMessage, subscribeToChat, myChats } from '../../../src/services/chats';
import { supabase } from '../../../src/lib/supabase';
import { Message } from '../../../src/types/db';

export default function ChatThread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [me, setMe] = useState<string | null>(null);
  const [other, setOther] = useState<string>('대화');
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null)); }, []);
  useEffect(() => {
    myChats().then((rows) => { const c = rows.find((r) => r.chat_id === id); if (c) { setOther(c.other_nickname ?? '대화'); setClosed(c.report_status !== 'active'); } }).catch(() => {});
    // subscribe FIRST so a message arriving during the initial history fetch isn't dropped
    const add = (m: Message) => setMessages((prev) => {
      const byId = new Map(prev.map((x) => [x.id, x])); byId.set(m.id, m);
      return Array.from(byId.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
    });
    const unsub = subscribeToChat(id, add);
    // then load history and MERGE (union by id) with anything realtime already delivered
    listMessages(id)
      .then((hist) => setMessages((prev) => {
        const byId = new Map(prev.map((m) => [m.id, m])); for (const m of hist) byId.set(m.id, m);
        return Array.from(byId.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
      }))
      .catch((e) => Alert.alert('오류', e.message));
    return unsub;
  }, [id]);

  async function send() {
    const body = text;
    try { setBusy(true); await sendMessage(id, body); setText(''); }
    catch (e: any) { Alert.alert('전송 실패', e.message); } // text kept on failure
    finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView style={styles.c} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.header}>{other}</Text>
      <FlatList ref={listRef} data={messages} keyExtractor={(m) => m.id} contentContainerStyle={{ padding: 12, gap: 8 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.sender_id === me ? styles.mine : styles.theirs]}>
            <Text style={item.sender_id === me ? styles.mineText : undefined}>{item.body}</Text>
          </View>
        )} />
      {closed ? (
        <Text style={styles.closed}>종료된 신고예요 (읽기 전용)</Text>
      ) : (
        <View style={styles.inputRow}>
          <TextInput style={styles.input} value={text} onChangeText={setText} placeholder="메시지" multiline />
          <Pressable style={styles.send} disabled={busy} onPress={send}><Text style={styles.sendText}>전송</Text></Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1 },
  header: { fontSize: 17, fontWeight: '800', padding: 14, paddingTop: 48, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  bubble: { maxWidth: '78%', padding: 10, borderRadius: 14 },
  mine: { alignSelf: 'flex-end', backgroundColor: '#7c3aed' }, mineText: { color: '#fff' },
  theirs: { alignSelf: 'flex-start', backgroundColor: '#f1f5f9' },
  closed: { textAlign: 'center', color: '#94a3b8', padding: 16, borderTopWidth: 1, borderColor: '#e2e8f0' },
  inputRow: { flexDirection: 'row', gap: 8, padding: 10, borderTopWidth: 1, borderColor: '#e2e8f0', alignItems: 'flex-end' },
  input: { flex: 1, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, maxHeight: 100 },
  send: { backgroundColor: '#7c3aed', borderRadius: 18, paddingHorizontal: 16, justifyContent: 'center' }, sendText: { color: '#fff', fontWeight: '700' },
});
```

- [ ] **Step 2: tsc** — `npx tsc --noEmit` clean.
- [ ] **Step 3: Commit** — `git add "app/(app)/chat/[id].tsx" && git commit -m "feat(sp4): chat thread screen (realtime, closed read-only)"`

---

## Task 10: 채팅 목록 화면

**Files:** Create `app/(app)/chats.tsx`.

- [ ] **Step 1: 작성** — `app/(app)/chats.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, Alert, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { myChats } from '../../src/services/chats';
import { ChatListItem } from '../../src/types/db';

export default function Chats() {
  const [chats, setChats] = useState<ChatListItem[]>([]);
  useEffect(() => { myChats().then(setChats).catch((e: any) => Alert.alert('오류', e.message)); }, []);
  return (
    <View style={styles.c}>
      <Text style={styles.h}>채팅</Text>
      <FlatList data={chats} keyExtractor={(c) => c.chat_id}
        ListEmptyComponent={<Text style={styles.empty}>아직 대화가 없어요.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => router.push(`/(app)/chat/${item.chat_id}`)}>
            <Text style={styles.title}>{item.other_nickname ?? '대화'} · 🐶 {item.dog_name ?? ''}{item.report_status !== 'active' ? ' (종료)' : ''}</Text>
            <Text style={styles.sub} numberOfLines={1}>{item.last_body ?? '새 대화'}</Text>
          </Pressable>
        )} />
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, padding: 16, paddingTop: 48 },
  h: { fontSize: 22, fontWeight: '800', marginBottom: 12 },
  empty: { color: '#64748b', textAlign: 'center', paddingVertical: 24 },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  title: { fontSize: 16, fontWeight: '700' }, sub: { fontSize: 13, color: '#94a3b8', marginTop: 2 },
});
```

- [ ] **Step 2: tsc** — `npx tsc --noEmit` clean.
- [ ] **Step 3: Commit** — `git add "app/(app)/chats.tsx" && git commit -m "feat(sp4): chat list screen"`

---

## Task 11: 진입점 (추적 화면·신고 상세·홈)

**Files:** Modify `app/(app)/report/[id]/track.tsx`, `app/(app)/report/[id]/index.tsx`, `app/(app)/home.tsx`.

- [ ] **Step 1: 추적 화면(보호자) — 제보 항목에 "대화"** — in `app/(app)/report/[id]/track.tsx`, import `getOrCreateChat` and add a 대화 action per sighting row. Add import at top: `import { getOrCreateChat } from '../../../../src/services/chats';`. In the sighting `renderItem`, wrap/append a Pressable:

```tsx
            <Pressable onPress={async () => {
              try { const cid = await getOrCreateChat(item.report_id, item.reporter_id); router.push(`/(app)/chat/${cid}`); }
              catch (e: any) { Alert.alert('오류', e.message); }
            }}>
              <Text style={{ color: '#7c3aed', fontWeight: '700', marginTop: 4 }}>💬 제보자와 대화</Text>
            </Pressable>
```
`Sighting` already has `report_id` and `reporter_id`. **track.tsx currently imports only `Alert` from react-native and `useLocalSearchParams` from expo-router** — you MUST also add `Pressable` to the `react-native` import and `router` to the `expo-router` import, or this won't compile. After editing, run `npx tsc --noEmit`.

- [ ] **Step 2: 신고 상세(제보자) — "보호자와 대화"** — in `app/(app)/report/[id]/index.tsx`, after load, check whether the current user has a sighting on this report; if so show a 대화 button. Add imports: `import { getOrCreateChat } from '../../../../src/services/chats';`. Add state + check:

```tsx
  const [canChat, setCanChat] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const me = data.user?.id; if (!me) return;
      const s = await supabase.from('sightings').select('id').eq('report_id', id).eq('reporter_id', me).limit(1);
      setCanChat((s.data?.length ?? 0) > 0);
    });
  }, [id]);
```
Add a button above the existing "목격했어요" CTA (only when canChat):
```tsx
      {canChat && (
        <Pressable style={[styles.cta, { backgroundColor: '#16a34a', marginBottom: 8 }]} onPress={async () => {
          try { const { data } = await supabase.auth.getUser(); const cid = await getOrCreateChat(id, data.user!.id); router.push(`/(app)/chat/${cid}`); }
          catch (e: any) { Alert.alert('오류', e.message); }
        }}>
          <Text style={styles.ctaText}>💬 보호자와 대화</Text>
        </Pressable>
      )}
```

- [ ] **Step 3: 홈 — "채팅" 진입점** — in `app/(app)/home.tsx`, add above 로그아웃 (keep walk + report buttons):
```tsx
      <Pressable style={styles.walkHist} onPress={() => router.push('/(app)/chats')}>
        <Text style={styles.walkHistText}>채팅</Text>
      </Pressable>
```

- [ ] **Step 4: tsc + 전체 테스트** — `npx tsc --noEmit` clean; `npm test` 46 (+ message/chats unit tests added in T4/T5 → expect ~54); `npm run test:rls` (chat + crisis + walks + rls) all pass.
- [ ] **Step 5: Commit** — `git add "app/(app)/report/[id]/track.tsx" "app/(app)/report/[id]/index.tsx" "app/(app)/home.tsx" && git commit -m "feat(sp4): chat entry points (track, report detail, home)"`

---

## Task 12: 배포 + Webhook + 실기기 QA (수동)

> Firebase 서비스계정 + Supabase 클라우드 + 2 실기기 필요. 자동화 불가.

- [ ] **Step 1: 배포** — `npx supabase functions deploy notify-message` (notify-nearby도 리팩터됐으니 재배포: `npx supabase functions deploy notify-nearby`). `_shared/fcm.ts`는 두 함수가 import하므로 함께 번들됨.
- [ ] **Step 2: Webhook** — Supabase 대시보드 → Database → Webhooks → `messages` INSERT → HTTP POST → `notify-message` 함수 URL (service role 헤더).
- [ ] **Step 3: 2기기 QA 체크리스트**
  - [ ] 제보자가 신고 상세에서 "보호자와 대화" → 채팅 진입, 메시지 전송
  - [ ] 보호자 기기: 새 메시지 푸시("새 메시지가 도착했어요") 수신 → 탭 → 해당 채팅 딥링크
  - [ ] 보호자가 추적 화면 제보 항목 "대화"로 같은 스레드 진입(동일 chat)
  - [ ] 양쪽 실시간 주고받기(앱 둘 다 열어둔 상태)
  - [ ] 보호자가 신고 종료(resolved) → 채팅 입력창 비활성 + "종료된 신고예요" + 기존 메시지 읽기 가능
  - [ ] 채팅 목록(홈→채팅)에 상대 닉네임·강아지·마지막 메시지 표시, 최신순 정렬
  - [ ] `notification_logs`에 메시지 알림 기록
- [ ] **Step 4: Commit (설정)** — `git add supabase/config.toml && git commit -m "chore(sp4): notify-message deploy + webhook config"` (서비스계정 키 커밋 금지).

---

## Self-Review (작성자 점검)

**1. Spec coverage:** chats/messages+RLS(T1)·closed=active(T1 messages_insert)·get_or_create_chat/my_chats(T2)·통합검증(T3)·메시지검증(T4)·chats 서비스+Realtime 구독(T5)·_shared/fcm 추출+notify-nearby 리팩터(T6)·notify-message+생략 본문(T7)·딥링크(T8)·스레드 화면(T9)·목록(T10)·진입점/홈(T11)·last_message_at 트리거(T1)·닉네임만 노출(T2 my_chats, no phone). 전부 매핑. ✅

**2. Placeholder scan:** 코드 스텝 전부 실제 코드. T12(배포·webhook·QA)는 본질적 수동. 옛 notify-nearby/logic.* 삭제를 T6에 명시(중복 방지).

**3. Type consistency:** `Message`(chat_id/sender_id/body), `ChatListItem`(chat_id/other_nickname/report_status/last_message_at/last_body), `getOrCreateChat(reportId,reporterId)`→rpc `{p_report_id,p_reporter_id}`, `myChats()`→rpc `my_chats`, `sendMessage(chatId,raw)` trims, `subscribeToChat(chatId,onInsert)` filter `chat_id=eq.{id}`, Edge `dispatchPush(supabase,{reportId,recipients,notification,data})`·`adminClient()` — 태스크 간 일치. notify-nearby 리팩터가 dispatchPush 시그니처와 일치.

> **알려진 한계/리스크:** ① Realtime 실수신·Webhook·FCM 발송은 실기기+클라우드 검증(T12). 통합 테스트는 DB 레벨(RLS/RPC/트리거)만. ② `_shared/fcm.ts` 추출은 SP3a 머지 코드를 리팩터 — notify-nearby의 동작/테스트가 유지되는지 T6에서 확인. ③ 메시지 페이지네이션 없음(초기 전체 로드) — 긴 대화는 후속. ④ 차단/신고는 SP3c 모더레이션과 함께(이번 범위 아님).

**Codex 교차 리뷰(2026-06-02) 반영:** ① 두 RPC EXECUTE를 authenticated로 잠금(public/anon revoke) ② track.tsx에 Pressable/router import 추가 명시(미추가 시 컴파일 실패) ③ 스레드 화면 race 수정(subscribe 먼저 → history 병합, id 유니온) ④ FCM 무효토큰 정리를 `@type FcmError` detail로 한정 ⑤ `recipientOf` 순수 함수 추출 + Deno 테스트 + notify-message가 사용(비참여자 sender 거부·에러 체크) ⑥ 트리거 테스트를 통제된 과거 시각 기준 strict 증가로 ⑦ closed 테스트 try/finally 복구 ⑧ self-chat 금지(reporter=owner raise) + 익명 RPC 거부 테스트 추가.
