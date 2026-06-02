# 멍백홈 SP3c — Expiry Batch + Moderation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pg_cron batch maintenance (auto-expire stale reports, purge old notification logs) and crisis-app moderation primitives (hide false sighting pins, block stalkers in chat, record content flags).

**Architecture:** Two SQL migrations (`0013_expiry.sql`, `0014_moderation.sql`) plus a thin `moderation.ts` service and small UI hooks on the owner tracking screen and the chat thread. Expiry is pure SQL run by pg_cron — `expired` status derives chat read-only (existing `messages_insert` requires `status='active'`) and drops the report out of flyer/map/detail public reads for free. Moderation adds an owner-only `hide_sighting` RPC, a `blocks` table wired into `messages_insert` + `my_chats`, and an insert-only `content_flags` table.

**Tech Stack:** Supabase (PostgreSQL · PostGIS · pg_cron · RLS · SECURITY DEFINER RPCs), Expo React Native (TypeScript), Jest (service unit tests with mocked supabase), ts-jest integration tests against local Supabase (`npm run test:rls`).

**Conventions to match (from existing code):**
- Migrations are plain `.sql` in `supabase/migrations/`, applied via `npx supabase db reset`.
- RPCs are `security definer set search_path = public`, authorize internally via `auth.uid()`, then `revoke execute ... from public, anon; grant execute ... to authenticated` (or `service_role` for cron-run functions). See `0011_chat_rpc.sql`.
- Integration tests live in `supabase/tests/*.test.ts`, run with `npm run test:rls`, use a `makeUser(email, nickname)` helper (admin `createUser` → sign in with anon key). See `supabase/tests/chat.test.ts`.
- Service unit tests mock `../lib/supabase` with `mock`-prefixed factory vars (jest hoisting). See `src/services/sightings.test.ts`.
- Commit per task with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Branch:** `feat/sp3c` (already created off `main` d83ffd3; spec committed at 3fd222b).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `supabase/migrations/0013_expiry.sql` (create) | pg_cron extension + `expire_old_reports()` + `purge_old_notification_logs()` + 2 cron schedules + execute locks |
| `supabase/migrations/0014_moderation.sql` (create) | `sightings.hidden` column + `hide_sighting` RPC + `report_sightings` hidden filter + `blocks` table & RLS + `messages_insert` block guard + `my_chats` rebuild (adds `other_id`, excludes blocked) + `content_flags` table & RLS |
| `supabase/tests/moderation.test.ts` (create) | Integration: expiry, purge, hide, block, flag, execute-lock |
| `src/services/moderation.ts` (create) | `hideSighting`, `blockUser`, `unblockUser`, `flagContent` |
| `src/services/moderation.test.ts` (create) | Unit tests (mocked supabase) |
| `src/types/db.ts` (modify) | Add `other_id: string` to `ChatListItem` |
| `app/(app)/report/[id]/track.tsx` (modify) | Owner per-sighting 숨김 + 신고 actions |
| `app/(app)/chat/[id].tsx` (modify) | Header 차단 action + message long-press 신고 |

---

## Phase A — Database

### Task A1: Expiry migration (`0013_expiry.sql`)

**Files:**
- Create: `supabase/migrations/0013_expiry.sql`

- [ ] **Step 1: Write the migration**

```sql
-- pg_cron-driven batch maintenance: auto-expire stale reports + purge old notification logs.
-- Installed without an explicit schema so the scheduling functions resolve as cron.schedule(...),
-- matching Supabase's documented usage. (The spec's "with schema extensions" would relocate
-- schedule() to the extensions schema and break the cron.schedule calls below.)
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
revoke execute on function public.expire_old_reports() from public, anon;
grant execute on function public.expire_old_reports() to service_role;
revoke execute on function public.purge_old_notification_logs() from public, anon;
grant execute on function public.purge_old_notification_logs() to service_role;

-- Daily schedule (server time): expire at 03:00, purge at 03:30.
-- cron.schedule upserts by job name, so re-applying is safe.
select cron.schedule('expire-reports',   '0 3 * * *',  $$ select public.expire_old_reports() $$);
select cron.schedule('purge-notif-logs', '30 3 * * *', $$ select public.purge_old_notification_logs() $$);
```

- [ ] **Step 2: Apply and verify it loads cleanly**

Run: `npx supabase db reset`
Expected: completes without error; output lists `Applying migration 0013_expiry.sql...` with no failure. If `db reset` errors that pg_cron is unavailable, STOP and report (local stack may need `npx supabase stop && npx supabase start`).

- [ ] **Step 3: Verify the cron jobs registered**

Run: `npx supabase db reset >/dev/null 2>&1; psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '\"')" -c "select jobname, schedule from cron.job order by jobname;"`

(If `psql`/`DB_URL` resolution is awkward in this environment, instead verify via the integration test in Task A3 and a manual dashboard check.)
Expected: two rows — `expire-reports | 0 3 * * *` and `purge-notif-logs | 30 3 * * *`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0013_expiry.sql
git commit -m "feat(sp3c): pg_cron expiry batch (expire reports 14d, purge notif logs 30d)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task A2: Moderation migration (`0014_moderation.sql`)

**Files:**
- Create: `supabase/migrations/0014_moderation.sql`

- [ ] **Step 1: Write the migration**

```sql
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
-- A user manages only their own block rows (select/insert/delete).
create policy "blocks_own" on public.blocks for all to authenticated
  using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- Bidirectional block guard on message sends: if either chat participant has blocked the other,
-- nobody in that chat can send. Rebuild of 0010's messages_insert with the extra `not exists` clause.
drop policy "messages_insert" on public.messages;
create policy "messages_insert" on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (select 1 from public.chats c join public.missing_reports r on r.id = c.report_id
                where c.id = chat_id and auth.uid() in (c.owner_id, c.reporter_id) and r.status = 'active')
    and not exists (
      select 1 from public.blocks b join public.chats c2 on c2.id = chat_id
       where (b.blocker_id = c2.owner_id    and b.blocked_id = c2.reporter_id)
          or (b.blocker_id = c2.reporter_id and b.blocked_id = c2.owner_id)
    )
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
```

- [ ] **Step 2: Apply and verify it loads cleanly**

Run: `npx supabase db reset`
Expected: completes without error; `Applying migration 0014_moderation.sql...` with no failure.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0014_moderation.sql
git commit -m "feat(sp3c): moderation schema (hide_sighting, blocks guard, content_flags)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task A3: Integration tests (`supabase/tests/moderation.test.ts`)

**Files:**
- Create: `supabase/tests/moderation.test.ts`

- [ ] **Step 1: Write the failing integration tests**

```ts
import { createClient } from '@supabase/supabase-js';

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

// Build an active report owned by `owner` with one sighting filed by `reporter`, returns ids.
async function makeReportWithSighting(owner: any, reporter: any) {
  const dog = await owner.client.from('dogs').insert({ owner_id: owner.id, name: '초코' }).select('id').single();
  const rep = await owner.client.from('missing_reports').insert({
    owner_id: owner.id, dog_id: (dog.data as any).id,
    last_seen_point: 'SRID=4326;POINT(127.07 37.65)', last_seen_at: new Date().toISOString(), alert_radius_m: 2000,
  }).select('id').single();
  const reportId = (rep.data as any).id;
  const sight = await reporter.client.from('sightings').insert({
    report_id: reportId, reporter_id: reporter.id,
    point: 'SRID=4326;POINT(127.071 37.651)', seen_at: new Date().toISOString(),
  }).select('id').single();
  return { reportId, sightingId: (sight.data as any).id };
}

describe('SP3c expiry + moderation', () => {
  test('expire_old_reports flips past-due active reports to expired and closes their chats', async () => {
    const t = Date.now();
    const owner = await makeUser(`exp-o-${t}@t.dev`, '보호자');
    const reporter = await makeUser(`exp-r-${t}@t.dev`, '제보자');
    const { reportId } = await makeReportWithSighting(owner, reporter);
    // make it past-due and open a chat while still active
    await admin.from('missing_reports').update({ expires_at: '2000-01-01T00:00:00Z' }).eq('id', reportId);
    const chat = await reporter.client.rpc('get_or_create_chat', { p_report_id: reportId, p_reporter_id: reporter.id });
    expect(chat.error).toBeNull();
    const chatId = chat.data as string;

    const r = await admin.rpc('expire_old_reports');
    expect(r.error).toBeNull();
    const row = (await admin.from('missing_reports').select('status').eq('id', reportId).single()).data as any;
    expect(row.status).toBe('expired');
    // chat is now read-only (messages_insert requires status='active')
    const ins = await reporter.client.from('messages').insert({ chat_id: chatId, sender_id: reporter.id, body: 'late' });
    expect(ins.error).not.toBeNull();
  });

  test('purge_old_notification_logs deletes rows older than 30 days, keeps recent', async () => {
    const t = Date.now();
    const owner = await makeUser(`pur-o-${t}@t.dev`, '보호자');
    const reporter = await makeUser(`pur-r-${t}@t.dev`, '제보자');
    const { reportId } = await makeReportWithSighting(owner, reporter);
    const oldLog = await admin.from('notification_logs').insert({
      report_id: reportId, user_id: reporter.id, token: 'tok-old', status: 'sent', created_at: '2000-01-01T00:00:00Z',
    }).select('id').single();
    const newLog = await admin.from('notification_logs').insert({
      report_id: reportId, user_id: reporter.id, token: 'tok-new', status: 'sent',
    }).select('id').single();

    const r = await admin.rpc('purge_old_notification_logs');
    expect(r.error).toBeNull();
    const oldGone = await admin.from('notification_logs').select('id').eq('id', (oldLog.data as any).id);
    expect(oldGone.data ?? []).toEqual([]);
    const newKept = await admin.from('notification_logs').select('id').eq('id', (newLog.data as any).id);
    expect((newKept.data ?? []).length).toBe(1);
  });

  test('hide_sighting: owner hides -> excluded from report_sightings; non-owner denied', async () => {
    const t = Date.now();
    const owner = await makeUser(`hid-o-${t}@t.dev`, '보호자');
    const reporter = await makeUser(`hid-r-${t}@t.dev`, '제보자');
    const { reportId, sightingId } = await makeReportWithSighting(owner, reporter);

    // reporter (non-owner) cannot hide
    const denied = await reporter.client.rpc('hide_sighting', { p_sighting_id: sightingId, p_hidden: true });
    expect(denied.error).not.toBeNull();

    // owner hides -> gone from report_sightings (for both owner and reporter views)
    const ok = await owner.client.rpc('hide_sighting', { p_sighting_id: sightingId, p_hidden: true });
    expect(ok.error).toBeNull();
    const ownerView = await owner.client.rpc('report_sightings', { p_report_id: reportId });
    expect((ownerView.data as any[]).some((s) => s.id === sightingId)).toBe(false);
    const reporterView = await reporter.client.rpc('report_sightings', { p_report_id: reportId });
    expect((reporterView.data as any[]).some((s) => s.id === sightingId)).toBe(false);

    // un-hide restores it
    await owner.client.rpc('hide_sighting', { p_sighting_id: sightingId, p_hidden: false });
    const restored = await owner.client.rpc('report_sightings', { p_report_id: reportId });
    expect((restored.data as any[]).some((s) => s.id === sightingId)).toBe(true);
  });

  test('block: A blocks B -> messages denied both ways + thread hidden from A my_chats', async () => {
    const t = Date.now();
    const owner = await makeUser(`blk-o-${t}@t.dev`, '보호자');
    const reporter = await makeUser(`blk-r-${t}@t.dev`, '제보자');
    const { reportId } = await makeReportWithSighting(owner, reporter);
    const chat = await reporter.client.rpc('get_or_create_chat', { p_report_id: reportId, p_reporter_id: reporter.id });
    const chatId = chat.data as string;
    // baseline: reporter can send
    expect((await reporter.client.from('messages').insert({ chat_id: chatId, sender_id: reporter.id, body: 'hi' })).error).toBeNull();

    // owner blocks reporter
    expect((await owner.client.from('blocks').insert({ blocker_id: owner.id, blocked_id: reporter.id })).error).toBeNull();

    // neither side can send now (bidirectional guard)
    expect((await reporter.client.from('messages').insert({ chat_id: chatId, sender_id: reporter.id, body: 'again' })).error).not.toBeNull();
    expect((await owner.client.from('messages').insert({ chat_id: chatId, sender_id: owner.id, body: 'reply' })).error).not.toBeNull();

    // thread excluded from the blocker's my_chats; still present for the blocked user
    const ownerChats = await owner.client.rpc('my_chats');
    expect((ownerChats.data as any[]).some((c) => c.chat_id === chatId)).toBe(false);
    const reporterChats = await reporter.client.rpc('my_chats');
    expect((reporterChats.data as any[]).some((c) => c.chat_id === chatId)).toBe(true);
  });

  test('my_chats exposes other_id (the other participant)', async () => {
    const t = Date.now();
    const owner = await makeUser(`oid-o-${t}@t.dev`, '보호자');
    const reporter = await makeUser(`oid-r-${t}@t.dev`, '제보자');
    const { reportId } = await makeReportWithSighting(owner, reporter);
    const chat = await reporter.client.rpc('get_or_create_chat', { p_report_id: reportId, p_reporter_id: reporter.id });
    const chatId = chat.data as string;
    const ownerChats = await owner.client.rpc('my_chats');
    const row = (ownerChats.data as any[]).find((c) => c.chat_id === chatId);
    expect(row.other_id).toBe(reporter.id);
  });

  test('content_flags: own insert allowed; impersonating another reporter denied', async () => {
    const t = Date.now();
    const user = await makeUser(`flg-${t}@t.dev`, '신고자');
    const other = await makeUser(`flg2-${t}@t.dev`, '타인');
    const ok = await user.client.from('content_flags').insert({
      content_type: 'message', content_id: '00000000-0000-0000-0000-000000000001', reporter_id: user.id, reason: '욕설',
    });
    expect(ok.error).toBeNull();
    const denied = await user.client.from('content_flags').insert({
      content_type: 'sighting', content_id: '00000000-0000-0000-0000-000000000002', reporter_id: other.id, reason: 'spoof',
    });
    expect(denied.error).not.toBeNull();
  });

  test('anonymous cannot execute expiry/purge functions (execute revoked)', async () => {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    expect((await anon.rpc('expire_old_reports')).error).not.toBeNull();
    expect((await anon.rpc('purge_old_notification_logs')).error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the integration tests**

Run: `npm run test:rls -- moderation`
Expected: all tests in `moderation.test.ts` PASS. (If the auth container returns 502 right after `db reset`, wait or run `npx supabase stop && npx supabase start`, then retry.)

- [ ] **Step 3: Run the full RLS suite to confirm no regressions**

Run: `npm run test:rls`
Expected: all integration suites PASS — in particular `chat.test.ts` (which asserts `my_chats` shape) still green after the `my_chats` rebuild.

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/moderation.test.ts
git commit -m "test(sp3c): integration tests for expiry, purge, hide, block, flag, execute-lock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase B — Moderation service (TDD)

### Task B1: `moderation.ts` service

**Files:**
- Create: `src/services/moderation.test.ts`
- Create: `src/services/moderation.ts`

- [ ] **Step 1: Write the failing unit test**

```ts
import { hideSighting, blockUser, unblockUser, flagContent } from './moderation';

const mockRpc = jest.fn();
const mockInsert = jest.fn();
const mockEq2 = jest.fn();
const mockEq1 = jest.fn(() => ({ eq: mockEq2 }));
const mockDelete = jest.fn(() => ({ eq: mockEq1 }));
const mockFrom = jest.fn(() => ({ insert: mockInsert, delete: mockDelete }));
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: (...a: any[]) => (mockFrom as any)(...a),
    rpc: (...a: any[]) => (mockRpc as any)(...a),
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u1' } } })) },
  },
}));
beforeEach(() => jest.clearAllMocks());

test('hideSighting calls hide_sighting rpc with sighting id + flag', async () => {
  mockRpc.mockResolvedValueOnce({ error: null });
  await hideSighting('s1', true);
  expect(mockRpc).toHaveBeenCalledWith('hide_sighting', { p_sighting_id: 's1', p_hidden: true });
});

test('hideSighting throws on rpc error', async () => {
  mockRpc.mockResolvedValueOnce({ error: { message: 'not authorized' } });
  await expect(hideSighting('s1', true)).rejects.toThrow('not authorized');
});

test('blockUser inserts a block row for the current user', async () => {
  mockInsert.mockResolvedValueOnce({ error: null });
  await blockUser('b2');
  expect(mockFrom).toHaveBeenCalledWith('blocks');
  expect(mockInsert).toHaveBeenCalledWith({ blocker_id: 'u1', blocked_id: 'b2' });
});

test('unblockUser deletes the block row matching blocker+blocked', async () => {
  mockEq2.mockResolvedValueOnce({ error: null });
  await unblockUser('b2');
  expect(mockFrom).toHaveBeenCalledWith('blocks');
  expect(mockEq1).toHaveBeenCalledWith('blocker_id', 'u1');
  expect(mockEq2).toHaveBeenCalledWith('blocked_id', 'b2');
});

test('flagContent inserts a content_flags row under the current user', async () => {
  mockInsert.mockResolvedValueOnce({ error: null });
  await flagContent('message', 'm1', '욕설');
  expect(mockFrom).toHaveBeenCalledWith('content_flags');
  expect(mockInsert).toHaveBeenCalledWith({ content_type: 'message', content_id: 'm1', reporter_id: 'u1', reason: '욕설' });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- moderation`
Expected: FAIL — `Cannot find module './moderation'`.

- [ ] **Step 3: Write the minimal implementation**

```ts
import { supabase } from '../lib/supabase';

export type FlagContentType = 'sighting' | 'message';

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) throw new Error('로그인이 필요합니다.');
  return data.user.id;
}

export async function hideSighting(sightingId: string, hidden: boolean): Promise<void> {
  const { error } = await supabase.rpc('hide_sighting', { p_sighting_id: sightingId, p_hidden: hidden });
  if (error) throw new Error(error.message);
}

export async function blockUser(blockedId: string): Promise<void> {
  const blocker_id = await uid();
  const { error } = await supabase.from('blocks').insert({ blocker_id, blocked_id: blockedId });
  if (error) throw new Error(error.message);
}

export async function unblockUser(blockedId: string): Promise<void> {
  const blocker_id = await uid();
  const { error } = await supabase.from('blocks').delete().eq('blocker_id', blocker_id).eq('blocked_id', blockedId);
  if (error) throw new Error(error.message);
}

export async function flagContent(type: FlagContentType, contentId: string, reason: string): Promise<void> {
  const reporter_id = await uid();
  const { error } = await supabase.from('content_flags').insert({ content_type: type, content_id: contentId, reporter_id, reason });
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- moderation`
Expected: PASS (5/5).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/moderation.ts src/services/moderation.test.ts
git commit -m "feat(sp3c): moderation service (hideSighting/blockUser/unblockUser/flagContent) TDD

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase C — UI

### Task C1: Add `other_id` to `ChatListItem`

**Files:**
- Modify: `src/types/db.ts`

- [ ] **Step 1: Add the field**

In `src/types/db.ts`, change the `ChatListItem` type to include `other_id`:

```ts
export type ChatListItem = {
  chat_id: string; report_id: string; other_id: string; other_nickname: string | null; dog_name: string | null;
  report_status: ReportStatus; last_message_at: string; last_body: string | null;
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/db.ts
git commit -m "feat(sp3c): expose other_id on ChatListItem for block UI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task C2: Owner moderation actions on the tracking screen

**Files:**
- Modify: `app/(app)/report/[id]/track.tsx`

The current screen fetches sightings in a `useEffect` and renders each as a `FlatList` row with a "💬 제보자와 대화" link. Add a reusable `load()` so hiding can refetch, and add 숨김 / 신고 actions per row.

- [ ] **Step 1: Replace the file contents**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Alert, StyleSheet, Pressable } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { router, useLocalSearchParams } from 'expo-router';
import { getReport } from '../../../../src/services/missingReports';
import { getOrCreateChat } from '../../../../src/services/chats';
import { listSightingsForReport } from '../../../../src/services/sightings';
import { hideSighting, flagContent } from '../../../../src/services/moderation';
import { supabase } from '../../../../src/lib/supabase';
import { ReportDetail, Sighting } from '../../../../src/types/db';

export default function TrackMap() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [sightings, setSightings] = useState<Sighting[]>([]);
  const [isOwner, setIsOwner] = useState(false);

  const loadSightings = useCallback(() => {
    listSightingsForReport(id).then(setSightings).catch((e) => Alert.alert('오류', e.message));
  }, [id]);

  useEffect(() => {
    getReport(id).then(setReport).catch((e) => Alert.alert('오류', e.message));
    loadSightings();
  }, [id, loadSightings]);

  // resolve ownership once the report is loaded (owner-only moderation controls)
  useEffect(() => {
    if (!report) return;
    supabase.auth.getUser().then(({ data }) => setIsOwner(data.user?.id === report.owner_id));
  }, [report]);

  function onHide(sightingId: string) {
    Alert.alert('제보 숨기기', '이 제보를 지도와 목록에서 숨길까요?', [
      { text: '취소', style: 'cancel' },
      { text: '숨기기', style: 'destructive', onPress: async () => {
        try { await hideSighting(sightingId, true); loadSightings(); }
        catch (e: any) { Alert.alert('오류', e.message); }
      } },
    ]);
  }
  function onFlag(sightingId: string) {
    Alert.alert('제보 신고', '이 제보를 부적절한 콘텐츠로 신고할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '신고', style: 'destructive', onPress: async () => {
        try { await flagContent('sighting', sightingId, '부적절한 제보'); Alert.alert('접수됨', '신고가 접수되었어요.'); }
        catch (e: any) { Alert.alert('오류', e.message); }
      } },
    ]);
  }

  const center = sightings.length
    ? { lat: sightings[sightings.length - 1].lat, lng: sightings[sightings.length - 1].lng }
    : report ? { lat: report.last_seen_lat, lng: report.last_seen_lng } : { lat: 37.6542, lng: 127.0568 };
  return (
    <View style={styles.c}>
      <View style={styles.map}>
        <MapView style={{ flex: 1 }} region={{ latitude: center.lat, longitude: center.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 }}>
          {report && <Marker coordinate={{ latitude: report.last_seen_lat, longitude: report.last_seen_lng }} title="마지막 목격" pinColor="#ef4444" />}
          {sightings.map((s, i) => (
            <Marker key={s.id} coordinate={{ latitude: s.lat, longitude: s.lng }} title={`제보 ${i + 1}`} description={new Date(s.seen_at).toLocaleString('ko-KR')} pinColor="#7c3aed" />
          ))}
        </MapView>
      </View>
      <Text style={styles.h}>제보 {sightings.length}건</Text>
      <FlatList data={sightings} keyExtractor={(s) => s.id}
        ListEmptyComponent={<Text style={styles.empty}>아직 제보가 없어요. 알림을 받은 이웃의 제보를 기다리는 중이에요.</Text>}
        renderItem={({ item, index }) => (
          <View style={styles.row}><Text style={styles.rowMain}>{index + 1}. {item.note || '목격 제보'}</Text>
            <Text style={styles.rowSub}>{new Date(item.seen_at).toLocaleString('ko-KR')}</Text>
            <View style={styles.actions}>
              <Pressable onPress={async () => {
                try { const cid = await getOrCreateChat(item.report_id, item.reporter_id); router.push(`/(app)/chat/${cid}`); }
                catch (e: any) { Alert.alert('오류', e.message); }
              }}>
                <Text style={styles.chatLink}>💬 제보자와 대화</Text>
              </Pressable>
              {isOwner && <Pressable onPress={() => onHide(item.id)}><Text style={styles.modLink}>숨김</Text></Pressable>}
              <Pressable onPress={() => onFlag(item.id)}><Text style={styles.flagLink}>신고</Text></Pressable>
            </View>
          </View>
        )} />
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1 }, map: { height: 300 },
  h: { fontWeight: '800', fontSize: 16, padding: 16, paddingBottom: 6 },
  empty: { color: '#64748b', padding: 16 },
  row: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  rowMain: { fontSize: 15, fontWeight: '600' }, rowSub: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 16, marginTop: 6, alignItems: 'center' },
  chatLink: { color: '#7c3aed', fontWeight: '700' },
  modLink: { color: '#64748b', fontWeight: '700' },
  flagLink: { color: '#ef4444', fontWeight: '700' },
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run unit tests (no regressions)**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/report/[id]/track.tsx"
git commit -m "feat(sp3c): owner hide + flag actions on tracking screen

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task C3: Block + message flag on the chat thread

**Files:**
- Modify: `app/(app)/chat/[id].tsx`

Capture `other_id` from `my_chats`, add a header 차단 action (blocks then makes the thread read-only), and a per-message long-press 신고.

- [ ] **Step 1: Replace the file contents**

```tsx
import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, Alert, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { listMessages, sendMessage, subscribeToChat, myChats } from '../../../src/services/chats';
import { blockUser, flagContent } from '../../../src/services/moderation';
import { supabase } from '../../../src/lib/supabase';
import { Message } from '../../../src/types/db';

export default function ChatThread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [me, setMe] = useState<string | null>(null);
  const [other, setOther] = useState<string>('대화');
  const [otherId, setOtherId] = useState<string | null>(null);
  const [closed, setClosed] = useState(true); // safe default: read-only until metadata confirms the report is active
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null)); }, []);
  useEffect(() => {
    // keep read-only on metadata failure (don't silently allow sends)
    myChats().then((rows) => { const c = rows.find((r) => r.chat_id === id); if (c) { setOther(c.other_nickname ?? '대화'); setOtherId(c.other_id); setClosed(c.report_status !== 'active'); } }).catch(() => {});
    const add = (m: Message) => setMessages((prev) => {
      const byId = new Map(prev.map((x) => [x.id, x])); byId.set(m.id, m);
      return Array.from(byId.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
    });
    // load history ONLY after the realtime channel is SUBSCRIBED → no message can slip through the setup gap
    const unsub = subscribeToChat(id, add, () => {
      listMessages(id)
        .then((hist) => setMessages((prev) => {
          const byId = new Map(prev.map((m) => [m.id, m])); for (const m of hist) byId.set(m.id, m);
          return Array.from(byId.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
        }))
        .catch((e) => Alert.alert('오류', e.message));
    });
    return unsub;
  }, [id]);

  async function send() {
    const body = text;
    try { setBusy(true); await sendMessage(id, body); setText(''); }
    catch (e: any) { Alert.alert('전송 실패', e.message); } // text kept on failure
    finally { setBusy(false); }
  }

  function onBlock() {
    if (!otherId) return;
    Alert.alert('차단', `${other}님을 차단할까요? 더 이상 메시지를 주고받을 수 없어요.`, [
      { text: '취소', style: 'cancel' },
      { text: '차단', style: 'destructive', onPress: async () => {
        try { await blockUser(otherId); setBlocked(true); }
        catch (e: any) { Alert.alert('오류', e.message); }
      } },
    ]);
  }
  function onFlagMessage(messageId: string) {
    Alert.alert('메시지 신고', '이 메시지를 신고할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '신고', style: 'destructive', onPress: async () => {
        try { await flagContent('message', messageId, '부적절한 메시지'); Alert.alert('접수됨', '신고가 접수되었어요.'); }
        catch (e: any) { Alert.alert('오류', e.message); }
      } },
    ]);
  }

  return (
    <KeyboardAvoidingView style={styles.c} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>{other}</Text>
        {otherId && !blocked && <Pressable onPress={onBlock}><Text style={styles.blockBtn}>차단</Text></Pressable>}
      </View>
      <FlatList ref={listRef} data={messages} keyExtractor={(m) => m.id} contentContainerStyle={{ padding: 12, gap: 8 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          <Pressable onLongPress={() => onFlagMessage(item.id)} style={[styles.bubble, item.sender_id === me ? styles.mine : styles.theirs]}>
            <Text style={item.sender_id === me ? styles.mineText : undefined}>{item.body}</Text>
          </Pressable>
        )} />
      {blocked ? (
        <Text style={styles.closed}>차단한 상대예요 (읽기 전용)</Text>
      ) : closed ? (
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
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 48, paddingBottom: 14, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  header: { fontSize: 17, fontWeight: '800' },
  blockBtn: { color: '#ef4444', fontWeight: '700' },
  bubble: { maxWidth: '78%', padding: 10, borderRadius: 14 },
  mine: { alignSelf: 'flex-end', backgroundColor: '#7c3aed' }, mineText: { color: '#fff' },
  theirs: { alignSelf: 'flex-start', backgroundColor: '#f1f5f9' },
  closed: { textAlign: 'center', color: '#94a3b8', padding: 16, borderTopWidth: 1, borderColor: '#e2e8f0' },
  inputRow: { flexDirection: 'row', gap: 8, padding: 10, borderTopWidth: 1, borderColor: '#e2e8f0', alignItems: 'flex-end' },
  input: { flex: 1, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, maxHeight: 100 },
  send: { backgroundColor: '#7c3aed', borderRadius: 18, paddingHorizontal: 16, justifyContent: 'center' }, sendText: { color: '#fff', fontWeight: '700' },
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run unit tests (no regressions)**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/chat/[id].tsx"
git commit -m "feat(sp3c): block participant + flag message on chat thread

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase D — Deploy / manual QA (deferred to user)

This phase is **manual** — it needs the deployed cloud Supabase project and a device build. Not executed by subagents.

- [ ] Apply migrations `0013`/`0014` to the cloud project (`npx supabase db push`).
- [ ] In the Supabase dashboard, enable the **pg_cron** extension if not already on, and confirm under *Database → Cron jobs* that `expire-reports` and `purge-notif-logs` are scheduled.
- [ ] Device QA: as a report owner, open the tracking screen → 숨김 a sighting (pin/list row disappears) and 신고 a sighting (접수 alert). As a chat participant, 차단 the other party (input becomes read-only; thread leaves the list) and long-press a message → 신고.
- [ ] (Optional) manually run `select public.expire_old_reports();` against a seeded past-due report to confirm the cron body behaves in cloud.

---

## Self-Review

**Spec coverage:**
- §2 Expiry batch — `expire_old_reports` (Task A1), `purge_old_notification_logs` (A1), security definer + revoke public/anon + grant service_role (A1), `cron.schedule` ×2 (A1), derived chat-closed + public-read exclusion (verified in A3 expiry test). ✓
- §3① Hide — `sightings.hidden` + `hide_sighting` owner-only RPC + `report_sightings` `not hidden` (A2), tested (A3). ✓
- §3② Block — `blocks` table + RLS, `messages_insert` bidirectional guard, `my_chats` exclusion (A2), tested (A3). ✓
- §3③ Flag — `content_flags` insert-only (A2), tested own + impersonation-denied (A3). ✓
- §4 Service/UI — `moderation.ts` (B1), track.tsx owner hide/flag (C2), chat header block + message flag (C3). ✓
- §5 Tests — service unit TDD (B1); integration expiry/purge/hide/block/flag/execute-lock (A3). ✓
- §6 dependency on pg_cron noted (A1 Step 2 guard). ✓

**Decisions/deviations from spec (intentional):**
1. `create extension if not exists pg_cron;` **without** `with schema extensions` — so `cron.schedule(...)` resolves (installing into `extensions` would relocate `schedule()` and break those calls). Documented inline in A1.
2. Added `other_id` to `my_chats` (and `ChatListItem`) — required so the chat screen knows who to block. Not in spec but necessary for §4's block UI; `chat.test.ts` shape assertions stay valid (only checks `other_nickname`/`dog_name`/no-`phone`).

**Placeholder scan:** none — every code/SQL step is complete. ✓

**Type consistency:** `hideSighting(sightingId, hidden)`, `blockUser(blockedId)`, `unblockUser(blockedId)`, `flagContent(type, contentId, reason)` consistent across B1 and C2/C3. `FlagContentType = 'sighting' | 'message'` matches the `content_flags.content_type` CHECK. `my_chats` return columns match `ChatListItem` (with `other_id`). RPC arg names (`p_sighting_id`, `p_hidden`, `p_report_id`) consistent between migration and service/tests. ✓
