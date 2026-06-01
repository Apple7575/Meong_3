# 멍백홈 Sub-project 3a 「위기 코어 루프 (검증 웨지)」 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실종 신고 → 서버 주도 주변 푸시(Webhook→Edge Function→PostGIS 반경→FCM) → 신고 상세(딥링크) → 목격 제보 → 보호자 추적 지도, 의 최소 검증 루프를 동작하는 형태로 구축한다.

**Architecture:** 수신자 선정(반경)은 PostGIS RPC로 두어 **통합 테스트**로 강하게 검증; Edge Function은 그 RPC를 호출해 FCM 발송 + `notification_logs` 기록 + 무효 토큰 정리만 한다(핵심 로직은 순수 함수로 분리해 Deno 테스트). RLS는 "활성 신고 + 연결 dog"를 인증 사용자에게 공개. 화면은 react-native-maps. SP1/SP2 코드·커밋 패턴을 따른다.

**Tech Stack:** Expo RN(TS) · supabase-js · Supabase Edge Functions(Deno) + Database Webhook · PostGIS · FCM HTTP v1(Firebase Admin) · react-native-maps · @react-native-firebase/messaging · Jest(unit+integration) · Deno test(edge logic).

**Branch:** `feat/crisis-loop` (off main with SP1+SP2). 로컬 Node/Docker(colima)/Supabase 준비됨.

---

## File Structure

```
supabase/migrations/0007_crisis.sql          missing_reports/sightings/sighting_images/notification_logs + RLS확장 + storage bucket
supabase/migrations/0008_crisis_rpc.sql        tokens_near_report() · count_users_near()
supabase/tests/crisis.test.ts                  RLS + 반경 RPC 통합 테스트
supabase/functions/notify-nearby/index.ts      Edge Function 핸들러
supabase/functions/notify-nearby/logic.ts      순수 로직(메시지 빌드·결과 파싱·무효토큰 추출)
supabase/functions/notify-nearby/logic.test.ts Deno 단위 테스트
src/types/db.ts (수정)                          MissingReport·MissingReportWithDog·Sighting·SightingImage 타입
src/validation/report.ts + .test.ts            신고/제보 폼 검증 (TDD)
src/services/missingReports.ts + .test.ts      create/list/get/resolve/countNear (TDD)
src/services/sightings.ts + .test.ts           create/list + 이미지 업로드 (TDD)
src/lib/pushNav.ts                              알림 탭 → 딥링크 라우팅
app/_layout.tsx (수정)                          pushNav import(전역 알림 핸들러)
app/(app)/report/new.tsx                        신고 작성(지도 핀+반경+도달수)
app/(app)/report/[id]/index.tsx                 신고 상세(이웃)
app/(app)/report/[id]/sighting.tsx             목격 제보
app/(app)/report/[id]/track.tsx                추적 지도(보호자)
app/(app)/reports.tsx                           내 신고 목록
app/(app)/home.tsx (수정)                       "실종 신고" 진입점
```

---

## Task 1: 마이그레이션 0007 — 테이블 + RLS 확장 + Storage

**Files:** Create `supabase/migrations/0007_crisis.sql`.

- [ ] **Step 1: SQL 작성**

```sql
-- ===== tables =====
create table public.missing_reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  dog_id uuid not null references public.dogs(id) on delete cascade,
  status text not null default 'active' check (status in ('active','resolved','expired')),
  last_seen_point geography(Point,4326) not null,
  last_seen_at timestamptz not null,
  alert_radius_m int not null check (alert_radius_m between 300 and 10000),
  note text,
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index missing_reports_owner_idx on public.missing_reports(owner_id, created_at desc);
create index missing_reports_geom_idx on public.missing_reports using gist (last_seen_point);
create index missing_reports_status_idx on public.missing_reports(status);

create table public.sightings (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.missing_reports(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  point geography(Point,4326) not null,
  seen_at timestamptz not null,
  note text,
  created_at timestamptz not null default now()
);
create index sightings_report_idx on public.sightings(report_id, seen_at);

create table public.sighting_images (
  id uuid primary key default gen_random_uuid(),
  sighting_id uuid not null references public.sightings(id) on delete cascade,
  storage_path text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.missing_reports(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null,
  status text not null check (status in ('sent','failed')),
  created_at timestamptz not null default now()
);

-- ===== RLS =====
alter table public.missing_reports enable row level security;
alter table public.sightings enable row level security;
alter table public.sighting_images enable row level security;
alter table public.notification_logs enable row level security;

-- missing_reports: owner full; any AUTHENTICATED user reads ACTIVE (anon excluded via TO authenticated).
-- INSERT/UPDATE additionally require the dog to belong to the reporting owner.
create policy "mr_select" on public.missing_reports for select to authenticated
  using (owner_id = auth.uid() or status = 'active');
create policy "mr_insert_own" on public.missing_reports for insert to authenticated
  with check (owner_id = auth.uid() and exists (select 1 from public.dogs d where d.id = dog_id and d.owner_id = auth.uid()));
create policy "mr_update_own" on public.missing_reports for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and exists (select 1 from public.dogs d where d.id = dog_id and d.owner_id = auth.uid()));
create policy "mr_delete_own" on public.missing_reports for delete to authenticated using (owner_id = auth.uid());

-- dogs / dog_images: add SELECT for dogs linked to an ACTIVE report (SP1 left this as a TODO). Authed only.
create policy "dogs_select_active_report" on public.dogs for select to authenticated
  using (exists (select 1 from public.missing_reports r where r.dog_id = dogs.id and r.status = 'active'));
create policy "dog_images_select_active_report" on public.dog_images for select to authenticated
  using (exists (select 1 from public.dogs d join public.missing_reports r on r.dog_id = d.id
                 where d.id = dog_images.dog_id and r.status = 'active'));

-- sightings: insert by reporter on active report; read by reporter or report owner
create policy "s_insert" on public.sightings for insert to authenticated
  with check (reporter_id = auth.uid()
              and exists (select 1 from public.missing_reports r where r.id = report_id and r.status = 'active'));
create policy "s_select" on public.sightings for select to authenticated
  using (reporter_id = auth.uid()
         or exists (select 1 from public.missing_reports r where r.id = report_id and r.owner_id = auth.uid()));

-- sighting_images: follow parent sighting visibility
create policy "si_insert" on public.sighting_images for insert to authenticated
  with check (exists (select 1 from public.sightings s where s.id = sighting_id and s.reporter_id = auth.uid()));
create policy "si_select" on public.sighting_images for select to authenticated
  using (exists (select 1 from public.sightings s where s.id = sighting_id
                 and (s.reporter_id = auth.uid()
                      or exists (select 1 from public.missing_reports r where r.id = s.report_id and r.owner_id = auth.uid()))));

-- notification_logs: no public policies (Edge Function uses service role, bypasses RLS)

-- ===== storage =====
insert into storage.buckets (id, name, public) values ('sightings','sightings',false) on conflict (id) do nothing;
create policy "sight_img_insert_own" on storage.objects for insert
  with check (bucket_id = 'sightings' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "sight_img_select_owner_or_reporter" on storage.objects for select
  using (bucket_id = 'sightings' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.sightings s join public.missing_reports r on r.id = s.report_id
               where s.id::text = (storage.foldername(name))[2] and r.owner_id = auth.uid())
  ));

-- dog-images (SP1 bucket, path {user_id}/{dog_id}/...): allow authed read when the dog is in an ACTIVE report
-- (OR's with SP1's owner-only policy, so neighbors can see the missing dog's photo).
create policy "dog_img_select_active_report" on storage.objects for select to authenticated
  using (bucket_id = 'dog-images' and exists (
    select 1 from public.missing_reports r
    where r.dog_id::text = (storage.foldername(name))[2] and r.status = 'active'));
```

- [ ] **Step 2: 적용 + 클린 재적용** — `npx supabase migration up`; `npx supabase db reset --no-seed` (0001–0007 클린).
- [ ] **Step 3: 확인** — `docker exec supabase_db_MeongBackHome psql -U postgres -c "\dt public.*"` (새 4테이블) + `psql -c "select policyname from pg_policies where schemaname='public' order by tablename"` (새 정책들 + dogs/dog_images 확장 정책 존재).
- [ ] **Step 4: Commit** — `git add supabase/migrations/0007_crisis.sql && git commit -m "feat(db): crisis tables + active-report RLS expansion + sightings bucket"`

---

## Task 2: 마이그레이션 0008 — 반경 RPC

**Files:** Create `supabase/migrations/0008_crisis_rpc.sql`.

- [ ] **Step 1: SQL 작성**

```sql
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
revoke execute on function public.tokens_near_report(uuid) from anon, authenticated;
grant execute on function public.tokens_near_report(uuid) to service_role;
```

- [ ] **Step 2: 적용** — `npx supabase migration up`.
- [ ] **Step 3: Commit** — `git add supabase/migrations/0008_crisis_rpc.sql && git commit -m "feat(db): tokens_near_report + count_users_near PostGIS RPCs"`

---

## Task 3: 위기 통합 테스트 (RLS + 반경)

**Files:** Create `supabase/tests/crisis.test.ts`.

- [ ] **Step 1: 실패하는 테스트 작성** — `supabase/tests/crisis.test.ts`:

```ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

async function makeUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const s = await client.auth.signInWithPassword({ email, password: 'password123' });
  if (s.error) throw s.error;
  return { id: data.user!.id, client };
}
// admin RPC to set a user's location (bypasses RLS via service role calling the RPC as that user is not possible;
// instead insert user_locations directly with admin)
async function setLocation(userId: string, lat: number, lng: number) {
  const { error } = await admin.from('user_locations')
    .upsert({ user_id: userId, geom: `SRID=4326;POINT(${lng} ${lat})`, updated_at: new Date().toISOString() });
  if (error) throw error;
}

describe('crisis RLS + radius', () => {
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let near: Awaited<ReturnType<typeof makeUser>>;
  let far: Awaited<ReturnType<typeof makeUser>>;
  let dogId: string; let reportId: string;

  beforeAll(async () => {
    const stamp = Date.now();
    owner = await makeUser(`own-${stamp}@t.dev`);
    near = await makeUser(`near-${stamp}@t.dev`);
    far = await makeUser(`far-${stamp}@t.dev`);
    // dog owned by owner
    const dog = await owner.client.from('dogs').insert({ owner_id: owner.id, name: '초코' }).select('id').single();
    dogId = (dog.data as any).id;
    // locations: owner + near within radius of (37.65,127.07), far ~5km away
    await setLocation(owner.id, 37.650, 127.070);
    await setLocation(near.id, 37.651, 127.071);
    await setLocation(far.id, 37.70, 127.13);
    // tokens for ALL three so owner-exclusion (by owner_id) and far-exclusion (out of radius) are actually exercised
    await admin.from('fcm_tokens').insert([
      { user_id: owner.id, token: `tok-own-${stamp}`, platform: 'ios' },
      { user_id: near.id, token: `tok-near-${stamp}`, platform: 'ios' },
      { user_id: far.id, token: `tok-far-${stamp}`, platform: 'ios' },
    ]);
    // owner creates active report, radius 2000m at (37.65,127.07)
    const rep = await owner.client.from('missing_reports').insert({
      owner_id: owner.id, dog_id: dogId,
      last_seen_point: 'SRID=4326;POINT(127.07 37.65)',
      last_seen_at: new Date().toISOString(), alert_radius_m: 2000,
    }).select('id').single();
    reportId = (rep.data as any).id;
  });

  test('neighbor can read an ACTIVE report and the linked dog', async () => {
    const r = await near.client.from('missing_reports').select('id,status').eq('id', reportId).single();
    expect(r.data?.status).toBe('active');
    const d = await near.client.from('dogs').select('name').eq('id', dogId).single();
    expect(d.data?.name).toBe('초코');
  });

  test('neighbor canNOT read a RESOLVED report', async () => {
    await owner.client.from('missing_reports').update({ status: 'resolved' }).eq('id', reportId);
    const r = await near.client.from('missing_reports').select('id').eq('id', reportId);
    expect(r.data).toEqual([]);
    await owner.client.from('missing_reports').update({ status: 'active' }).eq('id', reportId); // restore
  });

  test('neighbor can insert a sighting on active report; far cannot read others sightings', async () => {
    const ins = await near.client.from('sightings').insert({
      report_id: reportId, reporter_id: near.id,
      point: 'SRID=4326;POINT(127.071 37.651)', seen_at: new Date().toISOString(), note: '봤어요',
    });
    expect(ins.error).toBeNull();
    const farView = await far.client.from('sightings').select('*').eq('report_id', reportId);
    expect(farView.data).toEqual([]); // far is neither reporter nor owner
    const ownerView = await owner.client.from('sightings').select('*').eq('report_id', reportId);
    expect(ownerView.data?.length).toBe(1); // owner sees it
  });

  test('count_users_near excludes caller, counts only within radius', async () => {
    // owner previews reach at the report point with 2km: near(in) counts, far(out) excluded, owner(self) excluded
    const { data, error } = await owner.client.rpc('count_users_near', { lat: 37.65, lng: 127.07, radius_m: 2000 });
    expect(error).toBeNull();
    expect(data).toBe(1);
  });

  test('tokens_near_report returns nearby non-owner tokens (owner+far have tokens too, must be excluded)', async () => {
    const { data, error } = await admin.rpc('tokens_near_report', { p_report_id: reportId });
    expect(error).toBeNull();
    expect((data as any[]).some((row) => row.user_id === near.id)).toBe(true);  // in radius
    expect((data as any[]).some((row) => row.user_id === owner.id)).toBe(false); // excluded by owner_id (even though in radius + has token)
    expect((data as any[]).some((row) => row.user_id === far.id)).toBe(false);   // out of radius (even though has token)
  });

  test('anonymous (signed-out) cannot read active reports (TO authenticated)', async () => {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const { data } = await anon.from('missing_reports').select('id').eq('id', reportId);
    expect(data ?? []).toEqual([]);
  });

  test('cannot create a report for a dog you do not own', async () => {
    const { error } = await near.client.from('missing_reports').insert({
      owner_id: near.id, dog_id: dogId, // owner's dog, not near's
      last_seen_point: 'SRID=4326;POINT(127.07 37.65)', last_seen_at: new Date().toISOString(), alert_radius_m: 2000,
    });
    expect(error).not.toBeNull(); // mr_insert with-check requires dog ownership
  });

  test('clients cannot call tokens_near_report (execute revoked)', async () => {
    const { error } = await near.client.rpc('tokens_near_report', { p_report_id: reportId });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: 실행 — 통과 확인** (로컬 Supabase 실행 중) — `npx jest --config supabase/tests/jest.rls.config.js` → crisis(5) + walks + rls 모두 PASS. 실패 시 마이그레이션 수정(테스트 약화 금지).
- [ ] **Step 3: Commit** — `git add supabase/tests/crisis.test.ts && git commit -m "test(db): crisis RLS + radius RPC integration tests"`

---

## Task 4: 타입 + 신고/제보 검증 (TDD)

**Files:** Modify `src/types/db.ts`; create `src/validation/report.ts` + `.test.ts`.

- [ ] **Step 1: 타입 추가** — append to `src/types/db.ts`:

```ts
export type ReportStatus = 'active' | 'resolved' | 'expired';
export type MissingReport = {
  id: string; owner_id: string; dog_id: string; status: ReportStatus;
  last_seen_at: string; alert_radius_m: number; note: string | null;
  expires_at: string; created_at: string; updated_at: string; resolved_at: string | null;
};
export type MissingReportWithDog = MissingReport & { dog: { name: string; breed: string | null; features: string | null } | null };
// getReport() returns this — last-seen coords resolved by the report_detail RPC (list leaves them off).
export type ReportDetail = MissingReportWithDog & { last_seen_lat: number; last_seen_lng: number };
export type Sighting = {
  id: string; report_id: string; reporter_id: string;
  seen_at: string; note: string | null; created_at: string;
  lat: number; lng: number; // resolved client-side from geometry via RPC/select
};
```

- [ ] **Step 2: 실패하는 검증 테스트** — `src/validation/report.test.ts`:

```ts
import { validateReportForm, validateSightingForm } from './report';

describe('report validation', () => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  const past = new Date(Date.now() - 3600_000).toISOString();

  test('report requires dog, valid coords, valid radius, non-future last_seen', () => {
    expect(validateReportForm({ dogId: '', radiusM: 2000, lastSeenAt: past, lat: 37, lng: 127 }).valid).toBe(false);
    expect(validateReportForm({ dogId: 'd1', radiusM: 2000, lastSeenAt: past, lat: null, lng: null }).valid).toBe(false); // no coords
    expect(validateReportForm({ dogId: 'd1', radiusM: 2000, lastSeenAt: past, lat: 999, lng: 127 }).valid).toBe(false);   // out of range
    expect(validateReportForm({ dogId: 'd1', radiusM: 50, lastSeenAt: past, lat: 37, lng: 127 }).valid).toBe(false);      // radius too small
    expect(validateReportForm({ dogId: 'd1', radiusM: 99999, lastSeenAt: past, lat: 37, lng: 127 }).valid).toBe(false);   // too big
    expect(validateReportForm({ dogId: 'd1', radiusM: 2000, lastSeenAt: future, lat: 37, lng: 127 }).valid).toBe(false);  // future
    expect(validateReportForm({ dogId: 'd1', radiusM: 2000, lastSeenAt: past, lat: 37, lng: 127 }).valid).toBe(true);
  });
  test('sighting requires non-future seen_at and a point', () => {
    expect(validateSightingForm({ seenAt: future, lat: 37, lng: 127 }).valid).toBe(false);
    expect(validateSightingForm({ seenAt: past, lat: null, lng: null }).valid).toBe(false);
    expect(validateSightingForm({ seenAt: past, lat: 37, lng: 127 }).valid).toBe(true);
  });
});
```

- [ ] **Step 3: 실패 확인** — `npx jest src/validation/report.test.ts` → FAIL.
- [ ] **Step 4: 구현** — `src/validation/report.ts`:

```ts
export const MIN_RADIUS_M = 300;
export const MAX_RADIUS_M = 10000;

// finite + earth-range guard — coords feed a WKT string sent to PostGIS, so reject NaN/Infinity/out-of-range.
export function isValidCoord(lat: number | null, lng: number | null): boolean {
  return lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function validateReportForm(input: { dogId: string; radiusM: number; lastSeenAt: string; lat: number | null; lng: number | null }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!input.dogId) errors.push('실종된 반려견을 선택하세요.');
  if (!isValidCoord(input.lat, input.lng)) errors.push('마지막 목격 위치를 지도에서 선택하세요.');
  if (input.radiusM < MIN_RADIUS_M || input.radiusM > MAX_RADIUS_M) errors.push(`알림 반경은 ${MIN_RADIUS_M}m~${MAX_RADIUS_M}m 사이여야 합니다.`);
  if (Date.parse(input.lastSeenAt) > Date.now()) errors.push('마지막 목격 시각이 미래일 수 없습니다.');
  return { valid: errors.length === 0, errors };
}
export function validateSightingForm(input: { seenAt: string; lat: number | null; lng: number | null }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isValidCoord(input.lat, input.lng)) errors.push('목격 위치를 지도에서 선택하세요.');
  if (Date.parse(input.seenAt) > Date.now()) errors.push('목격 시각이 미래일 수 없습니다.');
  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 5: 통과 + tsc** — `npx jest src/validation/report.test.ts` PASS; `npx tsc --noEmit` clean.
- [ ] **Step 6: Commit** — `git add src/types/db.ts src/validation/report.ts src/validation/report.test.ts && git commit -m "feat(sp3a): report/sighting validation + types (TDD)"`

---

## Task 5: missingReports 서비스 (TDD)

**Files:** Create `src/services/missingReports.ts` + `.test.ts`.

- [ ] **Step 1: 실패하는 테스트** — `src/services/missingReports.test.ts`:

```ts
import { createReport, listMyReports, resolveReport, countUsersNear } from './missingReports';

const mockSingle = jest.fn();
const mockInsert = jest.fn(() => ({ select: jest.fn(() => ({ single: mockSingle })) }));
const mockOrder = jest.fn();
const mockEqSel = jest.fn(() => ({ order: mockOrder }));
const mockSelect = jest.fn(() => ({ eq: mockEqSel }));
const mockEqUpd = jest.fn();
const mockUpdate = jest.fn(() => ({ eq: mockEqUpd }));
const mockFrom = jest.fn(() => ({ insert: mockInsert, select: mockSelect, update: mockUpdate }));
const mockRpc = jest.fn();
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: (...a: any[]) => (mockFrom as any)(...a),
    rpc: (...a: any[]) => (mockRpc as any)(...a),
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u1' } } })) },
  },
}));
beforeEach(() => jest.clearAllMocks());

test('createReport inserts WKT point + owner + radius, returns id', async () => {
  mockSingle.mockResolvedValueOnce({ data: { id: 'r1' }, error: null });
  const id = await createReport({ dogId: 'd1', lat: 37.65, lng: 127.07, radiusM: 2000, lastSeenAt: 'iso', note: 'x' });
  expect(mockFrom).toHaveBeenCalledWith('missing_reports');
  expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
    owner_id: 'u1', dog_id: 'd1', alert_radius_m: 2000,
    last_seen_point: 'SRID=4326;POINT(127.07 37.65)', last_seen_at: 'iso',
  }));
  expect(id).toBe('r1');
});
test('resolveReport sets status resolved', async () => {
  mockEqUpd.mockResolvedValueOnce({ error: null });
  await resolveReport('r1');
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'resolved' }));
  expect(mockEqUpd).toHaveBeenCalledWith('id', 'r1');
});
test('countUsersNear calls rpc', async () => {
  mockRpc.mockResolvedValueOnce({ data: 12, error: null });
  const n = await countUsersNear(37.65, 127.07, 2000);
  expect(mockRpc).toHaveBeenCalledWith('count_users_near', { lat: 37.65, lng: 127.07, radius_m: 2000 });
  expect(n).toBe(12);
});
test('listMyReports queries own ordered desc', async () => {
  mockOrder.mockResolvedValueOnce({ data: [{ id: 'r1' }], error: null });
  const rows = await listMyReports();
  expect(mockEqSel).toHaveBeenCalledWith('owner_id', 'u1');
  expect(rows).toHaveLength(1);
});
```

- [ ] **Step 2: 실패 확인** — `npx jest src/services/missingReports.test.ts` → FAIL.
- [ ] **Step 3: 구현** — `src/services/missingReports.ts`:

```ts
import { supabase } from '../lib/supabase';
import { MissingReport, MissingReportWithDog } from '../types/db';

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) throw new Error('로그인이 필요합니다.');
  return data.user.id;
}
const wkt = (lat: number, lng: number) => `SRID=4326;POINT(${lng} ${lat})`;

export async function createReport(input: { dogId: string; lat: number; lng: number; radiusM: number; lastSeenAt: string; note?: string }): Promise<string> {
  const owner_id = await uid();
  const { data, error } = await supabase.from('missing_reports').insert({
    owner_id, dog_id: input.dogId, last_seen_point: wkt(input.lat, input.lng),
    last_seen_at: input.lastSeenAt, alert_radius_m: input.radiusM, note: input.note ?? null,
  }).select('id').single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}
export async function listMyReports(): Promise<MissingReportWithDog[]> {
  const owner_id = await uid();
  const { data, error } = await supabase.from('missing_reports')
    .select('*, dog:dogs(name,breed,features)').eq('owner_id', owner_id).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as MissingReportWithDog[];
}
export async function getReport(id: string): Promise<ReportDetail> {
  // report_detail RPC returns report fields + dog + last_seen_lat/lng (geography decomposed),
  // with RLS-equivalent visibility enforced inside the SECURITY DEFINER function.
  const { data, error } = await supabase.rpc('report_detail', { p_id: id }).single();
  if (error) throw new Error(error.message);
  return data as ReportDetail;
}
export async function resolveReport(id: string): Promise<void> {
  const { error } = await supabase.from('missing_reports')
    .update({ status: 'resolved', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
}
export async function countUsersNear(lat: number, lng: number, radiusM: number): Promise<number> {
  const { data, error } = await supabase.rpc('count_users_near', { lat, lng, radius_m: radiusM });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}
```

- [ ] **Step 4: 통과 + tsc** — `npx jest src/services/missingReports.test.ts` PASS (4); `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git add src/services/missingReports.ts src/services/missingReports.test.ts && git commit -m "feat(sp3a): missingReports service (TDD)"`

---

## Task 6: sightings 서비스 + 이미지 업로드 (TDD)

**Files:** Create `src/services/sightings.ts` + `.test.ts`.

- [ ] **Step 1: 실패하는 테스트** — `src/services/sightings.test.ts`:

```ts
import { createSighting, listSightingsForReport, buildSightingImagePath } from './sightings';

const mockSingle = jest.fn();
const mockInsert = jest.fn(() => ({ select: jest.fn(() => ({ single: mockSingle })) }));
const mockOrder = jest.fn();
const mockEq = jest.fn(() => ({ order: mockOrder }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn(() => ({ insert: mockInsert, select: mockSelect }));
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: (...a: any[]) => (mockFrom as any)(...a),
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u1' } } })) },
  },
}));
beforeEach(() => jest.clearAllMocks());

test('buildSightingImagePath nests reporter/sighting', () => {
  expect(buildSightingImagePath('u1', 's1', 'abc')).toBe('u1/s1/abc.jpg');
});
test('createSighting inserts WKT point + reporter + report', async () => {
  mockSingle.mockResolvedValueOnce({ data: { id: 's1' }, error: null });
  const id = await createSighting({ reportId: 'r1', lat: 37.6, lng: 127.0, seenAt: 'iso', note: 'n' });
  expect(mockFrom).toHaveBeenCalledWith('sightings');
  expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
    report_id: 'r1', reporter_id: 'u1', point: 'SRID=4326;POINT(127 37.6)', seen_at: 'iso',
  }));
  expect(id).toBe('s1');
});
test('listSightingsForReport orders by seen_at asc', async () => {
  mockOrder.mockResolvedValueOnce({ data: [{ id: 's1' }], error: null });
  const rows = await listSightingsForReport('r1');
  expect(mockEq).toHaveBeenCalledWith('report_id', 'r1');
  expect(mockOrder).toHaveBeenCalledWith('seen_at', { ascending: true });
  expect(rows).toHaveLength(1);
});
```

- [ ] **Step 2: 실패 확인** — `npx jest src/services/sightings.test.ts` → FAIL.
- [ ] **Step 3: 구현** — `src/services/sightings.ts`:

```ts
import { supabase } from '../lib/supabase';
import { Sighting } from '../types/db';

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) throw new Error('로그인이 필요합니다.');
  return data.user.id;
}
const wkt = (lat: number, lng: number) => `SRID=4326;POINT(${lng} ${lat})`;

export function buildSightingImagePath(userId: string, sightingId: string, fileId: string): string {
  return `${userId}/${sightingId}/${fileId}.jpg`;
}

export async function createSighting(input: { reportId: string; lat: number; lng: number; seenAt: string; note?: string }): Promise<string> {
  const reporter_id = await uid();
  const { data, error } = await supabase.from('sightings').insert({
    report_id: input.reportId, reporter_id, point: wkt(input.lat, input.lng),
    seen_at: input.seenAt, note: input.note ?? null,
  }).select('id').single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function listSightingsForReport(reportId: string): Promise<Sighting[]> {
  const { data, error } = await supabase.from('sightings').select('*').eq('report_id', reportId).order('seen_at', { ascending: true });
  if (error) throw new Error(error.message);
  // geography column comes back as GeoJSON/EWKB depending on config; resolve lat/lng best-effort
  return (data ?? []).map((r: any) => ({ ...r, lat: r.lat ?? null, lng: r.lng ?? null })) as Sighting[];
}

export async function uploadSightingImages(userId: string, sightingId: string, localUris: string[]): Promise<void> {
  const uploaded: string[] = [];
  const rowIds: string[] = [];
  try {
    for (let i = 0; i < localUris.length; i++) {
      const path = buildSightingImagePath(userId, sightingId, `${Date.now()}-${i}`);
      const res = await fetch(localUris[i]);
      const buffer = await res.arrayBuffer();
      const up = await supabase.storage.from('sightings').upload(path, buffer, { contentType: 'image/jpeg', upsert: false });
      if (up.error) throw new Error(up.error.message);
      uploaded.push(path);
      const row = await supabase.from('sighting_images').insert({ sighting_id: sightingId, storage_path: path, sort_order: i }).select('id').single();
      if (row.error) throw new Error(row.error.message);
      if (row.data?.id) rowIds.push(row.data.id as string);
    }
  } catch (e) {
    if (rowIds.length) await supabase.from('sighting_images').delete().in('id', rowIds);
    if (uploaded.length) await supabase.storage.from('sightings').remove(uploaded);
    throw e;
  }
}
```

> NOTE: reading `point` back as lat/lng — Supabase returns geography as GeoJSON when selected via PostgREST only if a view/cast is set; otherwise it's EWKB hex. To keep the tracking map simple, the implementer should add a DB VIEW or select `st_y(point::geometry) as lat, st_x(point::geometry) as lng` via an RPC. **Decide in Task 13 (tracking screen):** add a small RPC `report_sightings(report_id)` returning rows with `lat`,`lng` columns. The service's `listSightingsForReport` should call that RPC instead of selecting the raw geography. (Update this function accordingly when Task 13 is implemented; the test above only checks the insert path + ordering contract.)

- [ ] **Step 4: 통과 + tsc** — `npx jest src/services/sightings.test.ts` PASS (3); `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git add src/services/sightings.ts src/services/sightings.test.ts && git commit -m "feat(sp3a): sightings service + image upload (TDD)"`

---

## Task 7: 제보 위치 읽기 RPC (lat/lng) + 마이그레이션

**Files:** Create `supabase/migrations/0009_sighting_points.sql`; update `listSightingsForReport`.

> geography 컬럼을 PostgREST로 직접 select하면 lat/lng가 안 나오므로, 좌표를 분해해 주는 RPC를 둔다.

- [ ] **Step 1: RPC 작성** — `supabase/migrations/0009_sighting_points.sql`:

```sql
-- report detail with last-seen lat/lng decomposed (visibility: owner OR active), + dog as jsonb
create or replace function public.report_detail(p_id uuid)
returns table (
  id uuid, owner_id uuid, dog_id uuid, status text,
  last_seen_at timestamptz, alert_radius_m int, note text,
  expires_at timestamptz, created_at timestamptz, updated_at timestamptz, resolved_at timestamptz,
  last_seen_lat double precision, last_seen_lng double precision, dog jsonb
)
language sql security definer set search_path = public as $$
  select r.id, r.owner_id, r.dog_id, r.status,
         r.last_seen_at, r.alert_radius_m, r.note,
         r.expires_at, r.created_at, r.updated_at, r.resolved_at,
         st_y(r.last_seen_point::geometry), st_x(r.last_seen_point::geometry),
         jsonb_build_object('name', d.name, 'breed', d.breed, 'features', d.features)
  from public.missing_reports r join public.dogs d on d.id = r.dog_id
  where r.id = p_id and (r.owner_id = auth.uid() or r.status = 'active');
$$;

create or replace function public.report_sightings(p_report_id uuid)
returns table (id uuid, report_id uuid, reporter_id uuid, seen_at timestamptz, note text, created_at timestamptz, lat double precision, lng double precision)
language sql security definer set search_path = public as $$
  select s.id, s.report_id, s.reporter_id, s.seen_at, s.note, s.created_at,
         st_y(s.point::geometry) as lat, st_x(s.point::geometry) as lng
  from public.sightings s
  where s.report_id = p_report_id
    and (s.reporter_id = auth.uid()
         or exists (select 1 from public.missing_reports r where r.id = s.report_id and r.owner_id = auth.uid()))
  order by s.seen_at asc;
$$;
```
(RLS-equivalent visibility re-checked inside the SECURITY DEFINER function via auth.uid().)

- [ ] **Step 2: 적용** — `npx supabase migration up`.
- [ ] **Step 3: update `listSightingsForReport`** to call the RPC:

```ts
export async function listSightingsForReport(reportId: string): Promise<Sighting[]> {
  const { data, error } = await supabase.rpc('report_sightings', { p_report_id: reportId });
  if (error) throw new Error(error.message);
  return (data ?? []) as Sighting[];
}
```
Update `src/services/sightings.test.ts`'s list test to expect the rpc call instead:
```ts
test('listSightingsForReport calls report_sightings rpc', async () => {
  const mockRpc = jest.fn(async () => ({ data: [{ id: 's1', lat: 37, lng: 127 }], error: null }));
  // re-mock supabase.rpc for this file: add `rpc: (...a)=>(mockRpc as any)(...a)` to the jest.mock factory at top,
  // and assert mockRpc called with ('report_sightings', { p_report_id: 'r1' }).
  // (Add mockRpc to the existing jest.mock supabase object.)
});
```
(Implementer: add `rpc` to the `jest.mock('../lib/supabase')` object in sightings.test.ts and replace the old list test with the rpc-based assertion.)

- [ ] **Step 4: 통과 + tsc** — `npx jest src/services/sightings.test.ts` PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git add supabase/migrations/0009_sighting_points.sql src/services/sightings.ts src/services/sightings.test.ts && git commit -m "feat(sp3a): report_sightings RPC returns lat/lng; service uses it"`

---

## Task 8: Edge Function notify-nearby — 순수 로직 (Deno TDD)

**Files:** Create `supabase/functions/notify-nearby/logic.ts` + `logic.test.ts`.

- [ ] **Step 1: deno 설치 확인** — `command -v deno || brew install deno`.
- [ ] **Step 2: 실패하는 Deno 테스트** — `supabase/functions/notify-nearby/logic.test.ts`:

```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildLogRows, invalidTokensFrom } from './logic.ts';

Deno.test('buildLogRows maps send results to log rows', () => {
  const rows = buildLogRows('r1', [
    { user_id: 'u1', token: 't1', ok: true },
    { user_id: 'u2', token: 't2', ok: false },
  ]);
  assertEquals(rows, [
    { report_id: 'r1', user_id: 'u1', token: 't1', status: 'sent' },
    { report_id: 'r1', user_id: 'u2', token: 't2', status: 'failed' },
  ]);
});
Deno.test('invalidTokensFrom collects tokens FCM rejected as unregistered', () => {
  const bad = invalidTokensFrom([
    { user_id: 'u1', token: 't1', ok: true, errorCode: undefined },
    { user_id: 'u2', token: 't2', ok: false, errorCode: 'UNREGISTERED' },
    { user_id: 'u3', token: 't3', ok: false, errorCode: 'INTERNAL' },
  ]);
  assertEquals(bad, ['t2']); // only UNREGISTERED/INVALID_ARGUMENT-style get cleaned
});
```

- [ ] **Step 3: 실패 확인** — `deno test supabase/functions/notify-nearby/logic.test.ts` → FAIL.
- [ ] **Step 4: 구현** — `supabase/functions/notify-nearby/logic.ts`:

```ts
export type SendResult = { user_id: string; token: string; ok: boolean; errorCode?: string };
export type LogRow = { report_id: string; user_id: string; token: string; status: 'sent' | 'failed' };

export function buildLogRows(reportId: string, results: SendResult[]): LogRow[] {
  return results.map((r) => ({ report_id: reportId, user_id: r.user_id, token: r.token, status: r.ok ? 'sent' : 'failed' }));
}

const CLEANUP_CODES = new Set(['UNREGISTERED', 'INVALID_ARGUMENT']);
export function invalidTokensFrom(results: SendResult[]): string[] {
  return results.filter((r) => !r.ok && r.errorCode && CLEANUP_CODES.has(r.errorCode)).map((r) => r.token);
}

export function buildFcmMessage(token: string, report: { id: string; dogName: string }): Record<string, unknown> {
  return {
    message: {
      token,
      notification: { title: '우리 동네 실종견', body: `${report.dogName}를 찾고 있어요. 혹시 보셨나요?` },
      data: { type: 'missing_report', report_id: report.id },
    },
  };
}
```

- [ ] **Step 5: 통과 확인** — `deno test supabase/functions/notify-nearby/logic.test.ts` → PASS (2).
- [ ] **Step 6: Commit** — `git add supabase/functions/notify-nearby/logic.ts supabase/functions/notify-nearby/logic.test.ts && git commit -m "feat(sp3a): notify-nearby pure logic (Deno TDD)"`

---

## Task 9: Edge Function notify-nearby — 핸들러

**Files:** Create `supabase/functions/notify-nearby/index.ts`.

- [ ] **Step 1: 핸들러 작성** — `supabase/functions/notify-nearby/index.ts`:

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildLogRows, invalidTokensFrom, buildFcmMessage, SendResult } from './logic.ts';

// FCM HTTP v1 access token from the service account (cached per cold start).
async function getAccessToken(saJson: string): Promise<{ token: string; projectId: string }> {
  const sa = JSON.parse(saJson);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  };
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
  return { token: j.access_token, projectId: sa.project_id };
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const reportId: string = payload.record?.id ?? payload.report_id;
    if (!reportId) return new Response('no report id', { status: 400 });

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: report } = await supabase.from('missing_reports').select('id, dog:dogs(name)').eq('id', reportId).single();
    const dogName = (report as any)?.dog?.name ?? '실종견';

    const { data: recipients, error } = await supabase.rpc('tokens_near_report', { p_report_id: reportId });
    if (error) return new Response(error.message, { status: 500 });

    const { token: accessToken, projectId } = await getAccessToken(Deno.env.get('FCM_SERVICE_ACCOUNT')!);
    const results: SendResult[] = [];
    for (const r of recipients as { user_id: string; token: string }[]) {
      const fr = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildFcmMessage(r.token, { id: reportId, dogName })),
      });
      if (fr.ok) results.push({ user_id: r.user_id, token: r.token, ok: true });
      else {
        const err = await fr.json().catch(() => ({}));
        // FCM v1 puts UNREGISTERED in error.details[].errorCode (not error.status)
        const code = (err?.error?.details ?? []).find((d: any) => d?.errorCode)?.errorCode ?? err?.error?.status;
        results.push({ user_id: r.user_id, token: r.token, ok: false, errorCode: code });
      }
    }

    const logs = buildLogRows(reportId, results);
    if (logs.length) await supabase.from('notification_logs').insert(logs);
    const bad = invalidTokensFrom(results);
    if (bad.length) await supabase.from('fcm_tokens').delete().in('token', bad);

    return new Response(JSON.stringify({ sent: results.filter((r) => r.ok).length, total: results.length }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});
```

- [ ] **Step 2: 로컬 기동 확인** — `npx supabase functions serve notify-nearby --no-verify-jwt` 가 에러 없이 뜨는지(핸들러 import/구문). FCM 실발송은 실제 서비스계정·실기기 필요 → Task 15. `deno check supabase/functions/notify-nearby/index.ts`로 타입체크.
- [ ] **Step 3: Commit** — `git add supabase/functions/notify-nearby/index.ts && git commit -m "feat(sp3a): notify-nearby edge function handler (FCM v1 + log + token cleanup)"`

---

## Task 10: 알림 탭 딥링크 라우팅

**Files:** Create `src/lib/pushNav.ts`; modify `app/_layout.tsx`.

- [ ] **Step 1: pushNav 작성** — `src/lib/pushNav.ts`:

```ts
import { useEffect } from 'react';
import { router } from 'expo-router';
import messaging from '@react-native-firebase/messaging';

function routeFromData(data?: Record<string, string | object>) {
  if (data && (data as any).type === 'missing_report' && (data as any).report_id) {
    router.push(`/(app)/report/${(data as any).report_id}`);
  }
}

/** 알림 탭으로 앱이 열렸을 때(백그라운드/종료) 신고 상세로 딥링크. 앱 엔트리에서 1회 설치. */
export function usePushNavigation() {
  useEffect(() => {
    const unsub = messaging().onNotificationOpenedApp((m) => routeFromData(m?.data));
    messaging().getInitialNotification().then((m) => { if (m) routeFromData(m.data); });
    return unsub;
  }, []);
}
```

- [ ] **Step 2: _layout 설치** — modify `app/_layout.tsx`: inside `RootLayout()` component body, call `usePushNavigation();` (add `import { usePushNavigation } from '../src/lib/pushNav';` at top of file). Keep existing session-provider logic.
- [ ] **Step 3: tsc + 회귀** — `npx tsc --noEmit` clean; `npm test` green.
- [ ] **Step 4: Commit** — `git add src/lib/pushNav.ts app/_layout.tsx && git commit -m "feat(sp3a): push tap deep-links to report detail"`

---

## Task 11: 신고 작성 화면

**Files:** Create `app/(app)/report/new.tsx`.

- [ ] **Step 1: 화면 작성** — `app/(app)/report/new.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, Alert, StyleSheet, ScrollView } from 'react-native';
import MapView, { Marker, Circle } from 'react-native-maps';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { listMyDogs } from '../../../src/services/dogs';
import { createReport, countUsersNear } from '../../../src/services/missingReports';
import { validateReportForm, MIN_RADIUS_M, MAX_RADIUS_M } from '../../../src/validation/report';
import { Dog } from '../../../src/types/db';

export default function NewReport() {
  const [dogs, setDogs] = useState<Dog[]>([]);
  const [dogId, setDogId] = useState<string>('');
  const [coord, setCoord] = useState({ lat: 37.6542, lng: 127.0568 });
  const [radius, setRadius] = useState(2000);
  const [reach, setReach] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { listMyDogs().then((d) => { setDogs(d); if (d[0]) setDogId(d[0].id); }).catch(() => {}); }, []);
  useEffect(() => {
    Location.getForegroundPermissionsAsync().then(async (p) => {
      if (p.granted) { const pos = await Location.getCurrentPositionAsync({}); setCoord({ lat: pos.coords.latitude, lng: pos.coords.longitude }); }
    });
  }, []);
  useEffect(() => { countUsersNear(coord.lat, coord.lng, radius).then(setReach).catch(() => setReach(null)); }, [coord, radius]);

  async function submit() {
    const lastSeenAt = new Date().toISOString();
    const v = validateReportForm({ dogId, radiusM: radius, lastSeenAt, lat: coord.lat, lng: coord.lng });
    if (!v.valid) return Alert.alert('확인', v.errors.join('\n'));
    try {
      setBusy(true);
      const id = await createReport({ dogId, lat: coord.lat, lng: coord.lng, radiusM: radius, lastSeenAt, note: note || undefined });
      if (reach === 0) Alert.alert('신고 완료', '주변에 알림 받을 사용자가 아직 없어요. 링크 공유로도 알릴 수 있어요(추후 기능).');
      router.replace(`/(app)/report/${id}/track`);
    } catch (e: any) { Alert.alert('신고 실패', e.message); }
    finally { setBusy(false); }
  }

  return (
    <ScrollView contentContainerStyle={styles.c}>
      <View style={styles.map}>
        <MapView style={{ flex: 1 }} region={{ latitude: coord.lat, longitude: coord.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
          onPress={(e) => setCoord({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })}>
          <Marker draggable coordinate={{ latitude: coord.lat, longitude: coord.lng }}
            onDragEnd={(e) => setCoord({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })} />
          <Circle center={{ latitude: coord.lat, longitude: coord.lng }} radius={radius} strokeColor="#ef4444" fillColor="rgba(239,68,68,0.12)" />
        </MapView>
      </View>
      <Text style={styles.label}>반려견</Text>
      <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
        {dogs.map((d) => (
          <Pressable key={d.id} style={[styles.dog, dogId === d.id && styles.dogOn]} onPress={() => setDogId(d.id)}><Text>🐶 {d.name}</Text></Pressable>
        ))}
      </ScrollView>
      <Text style={styles.label}>알림 반경: {(radius / 1000).toFixed(1)}km · {reach == null ? '...' : `약 ${reach}명에게 알림`}</Text>
      <View style={styles.radiusRow}>
        {[500, 1000, 2000, 5000].map((r) => (
          <Pressable key={r} style={[styles.rb, radius === r && styles.rbOn]} onPress={() => setRadius(r)}><Text style={radius === r ? styles.rbOnText : undefined}>{r / 1000}km</Text></Pressable>
        ))}
      </View>
      <Text style={styles.label}>메모</Text>
      <TextInput style={styles.in} multiline value={note} onChangeText={setNote} placeholder="상황·특징 (선택)" />
      <Pressable style={styles.submit} disabled={busy} onPress={submit}><Text style={styles.submitText}>{busy ? '신고 중...' : '실종 신고하기'}</Text></Pressable>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  c: { padding: 16, gap: 8 }, map: { height: 240, borderRadius: 14, overflow: 'hidden' },
  label: { fontWeight: '700', color: '#475569', marginTop: 8 },
  dog: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  dogOn: { backgroundColor: '#ede9fe', borderColor: '#7c3aed' },
  radiusRow: { flexDirection: 'row', gap: 6 },
  rb: { flex: 1, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 8, alignItems: 'center' },
  rbOn: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' }, rbOnText: { color: '#fff', fontWeight: '700' },
  in: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, padding: 12, minHeight: 60 },
  submit: { backgroundColor: '#ef4444', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
```

- [ ] **Step 2: tsc** — `npx tsc --noEmit` clean.
- [ ] **Step 3: Commit** — `git add "app/(app)/report/new.tsx" && git commit -m "feat(sp3a): missing report create screen (map pin + radius + reach)"`

---

## Task 12: 신고 상세 화면 (이웃)

**Files:** Create `app/(app)/report/[id]/index.tsx`.

- [ ] **Step 1: 화면 작성** — `app/(app)/report/[id]/index.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { View, Text, Pressable, Image, Alert, StyleSheet } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { router, useLocalSearchParams } from 'expo-router';
import { getReport } from '../../../../src/services/missingReports';
import { ReportDetail as ReportDetailDto } from '../../../../src/types/db'; // aliased: component below is also named ReportDetail
import { supabase } from '../../../../src/lib/supabase';

export default function ReportDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [report, setReport] = useState<ReportDetailDto | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    getReport(id).then(async (r) => {
      setReport(r);
      const img = await supabase.from('dog_images').select('storage_path').eq('dog_id', r.dog_id).eq('is_primary', true).limit(1).maybeSingle();
      if (img.data?.storage_path) {
        const { data } = await supabase.storage.from('dog-images').createSignedUrl(img.data.storage_path, 3600);
        setPhoto(data?.signedUrl ?? null);
      }
    }).catch((e) => Alert.alert('오류', e.message));
  }, [id]);

  if (!report) return <View style={styles.c}><Text>불러오는 중...</Text></View>;
  const d = report.dog;
  return (
    <View style={styles.c}>
      {photo ? <Image source={{ uri: photo }} style={styles.photo} /> : <View style={[styles.photo, styles.ph]}><Text style={{ fontSize: 40 }}>🐕</Text></View>}
      <Text style={styles.name}>{d?.name ?? '실종견'} <Text style={styles.badge}>실종</Text></Text>
      <Text style={styles.meta}>{[d?.breed, d?.features].filter(Boolean).join(' · ')}</Text>
      <View style={styles.box}><Text style={styles.boxText}>📍 마지막 목격: {new Date(report.last_seen_at).toLocaleString('ko-KR')}</Text>
        {report.note ? <Text style={styles.boxText}>{report.note}</Text> : null}</View>
      <View style={styles.miniMap}>
        <MapView style={{ flex: 1 }} region={{ latitude: report.last_seen_lat, longitude: report.last_seen_lng, latitudeDelta: 0.01, longitudeDelta: 0.01 }}>
          <Marker coordinate={{ latitude: report.last_seen_lat, longitude: report.last_seen_lng }} title="마지막 목격" pinColor="#ef4444" />
        </MapView>
      </View>
      <Pressable style={styles.cta} onPress={() => router.push(`/(app)/report/${id}/sighting`)}>
        <Text style={styles.ctaText}>👀 목격했어요 제보하기</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, padding: 20 },
  photo: { width: '100%', height: 220, borderRadius: 14, backgroundColor: '#e2e8f0' },
  ph: { alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 24, fontWeight: '800', marginTop: 14 },
  badge: { fontSize: 13, color: '#ef4444', backgroundColor: '#fee2e2', borderRadius: 6, paddingHorizontal: 6, overflow: 'hidden' },
  meta: { color: '#64748b', marginTop: 4 },
  box: { backgroundColor: '#f1f5f9', borderRadius: 10, padding: 12, marginTop: 14, gap: 4 },
  boxText: { color: '#475569', fontSize: 13 },
  miniMap: { height: 140, borderRadius: 12, overflow: 'hidden', marginTop: 12 },
  cta: { backgroundColor: '#7c3aed', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 'auto' },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
```

- [ ] **Step 2: tsc** — `npx tsc --noEmit` clean.
- [ ] **Step 3: Commit** — `git add "app/(app)/report/[id]/index.tsx" && git commit -m "feat(sp3a): report detail screen (neighbor view)"`

---

## Task 13: 목격 제보 화면

**Files:** Create `app/(app)/report/[id]/sighting.tsx`.

- [ ] **Step 1: 화면 작성** — `app/(app)/report/[id]/sighting.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, Image, Alert, StyleSheet, ScrollView } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { router, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../../../src/lib/supabase';
import { createSighting, uploadSightingImages } from '../../../../src/services/sightings';
import { validateSightingForm } from '../../../../src/validation/report';

export default function SightingForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [coord, setCoord] = useState({ lat: 37.6542, lng: 127.0568 });
  const [uris, setUris] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Location.getForegroundPermissionsAsync().then(async (p) => {
      if (p.granted) { const pos = await Location.getCurrentPositionAsync({}); setCoord({ lat: pos.coords.latitude, lng: pos.coords.longitude }); }
    });
  }, []);

  async function pick() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, quality: 0.6 });
    if (!res.canceled) setUris(res.assets.map((a) => a.uri));
  }
  async function submit() {
    const seenAt = new Date().toISOString();
    const v = validateSightingForm({ seenAt, lat: coord.lat, lng: coord.lng });
    if (!v.valid) return Alert.alert('확인', v.errors.join('\n'));
    try {
      setBusy(true);
      const sid = await createSighting({ reportId: id, lat: coord.lat, lng: coord.lng, seenAt, note: note || undefined });
      if (uris.length) { const { data } = await supabase.auth.getUser(); const u = data.user?.id; if (!u) throw new Error('세션 만료'); await uploadSightingImages(u, sid, uris); }
      Alert.alert('제보 완료', '소중한 제보 감사합니다!');
      router.back();
    } catch (e: any) { Alert.alert('제보 실패', e.message); }
    finally { setBusy(false); }
  }

  return (
    <ScrollView contentContainerStyle={styles.c}>
      <Pressable style={styles.photo} onPress={pick}>
        {uris[0] ? <Image source={{ uri: uris[0] }} style={{ width: '100%', height: '100%', borderRadius: 12 }} /> : <Text style={{ color: '#64748b' }}>＋ 사진 추가 {uris.length > 1 ? `(${uris.length})` : ''}</Text>}
      </Pressable>
      <Text style={styles.label}>목격 위치 (지도 탭/드래그)</Text>
      <View style={styles.map}>
        <MapView style={{ flex: 1 }} region={{ latitude: coord.lat, longitude: coord.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
          onPress={(e) => setCoord({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })}>
          <Marker draggable coordinate={{ latitude: coord.lat, longitude: coord.lng }} onDragEnd={(e) => setCoord({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })} />
        </MapView>
      </View>
      <Text style={styles.label}>메모</Text>
      <TextInput style={styles.in} multiline value={note} onChangeText={setNote} placeholder="어디서·어떤 상태로 봤는지 (선택)" />
      <Pressable style={styles.submit} disabled={busy} onPress={submit}><Text style={styles.submitText}>{busy ? '제보 중...' : '제보 보내기'}</Text></Pressable>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  c: { padding: 16, gap: 8 },
  photo: { height: 110, borderRadius: 12, backgroundColor: '#f1f5f9', borderWidth: 2, borderColor: '#cbd5e1', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  label: { fontWeight: '700', color: '#475569', marginTop: 8 },
  map: { height: 200, borderRadius: 12, overflow: 'hidden' },
  in: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, padding: 12, minHeight: 60 },
  submit: { backgroundColor: '#7c3aed', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
```

- [ ] **Step 2: tsc** — `npx tsc --noEmit` clean.
- [ ] **Step 3: Commit** — `git add "app/(app)/report/[id]/sighting.tsx" && git commit -m "feat(sp3a): sighting submission screen"`

---

## Task 14: 추적 지도 화면 (보호자) + 내 신고 목록 + 홈 진입

**Files:** Create `app/(app)/report/[id]/track.tsx`, `app/(app)/reports.tsx`; modify `app/(app)/home.tsx`.

- [ ] **Step 1: 추적 지도** — `app/(app)/report/[id]/track.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { View, Text, FlatList, Alert, StyleSheet } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useLocalSearchParams } from 'expo-router';
import { getReport } from '../../../../src/services/missingReports';
import { listSightingsForReport } from '../../../../src/services/sightings';
import { ReportDetail, Sighting } from '../../../../src/types/db';

export default function TrackMap() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [sightings, setSightings] = useState<Sighting[]>([]);

  useEffect(() => {
    getReport(id).then(setReport).catch((e) => Alert.alert('오류', e.message));
    listSightingsForReport(id).then(setSightings).catch((e) => Alert.alert('오류', e.message));
  }, [id]);

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
            <Text style={styles.rowSub}>{new Date(item.seen_at).toLocaleString('ko-KR')}</Text></View>
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
});
```

- [ ] **Step 2: 내 신고 목록** — `app/(app)/reports.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, Alert, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { listMyReports, resolveReport } from '../../src/services/missingReports';
import { MissingReportWithDog } from '../../src/types/db';

export default function MyReports() {
  const [reports, setReports] = useState<MissingReportWithDog[]>([]);
  async function refresh() { try { setReports(await listMyReports()); } catch (e: any) { Alert.alert('오류', e.message); } }
  useEffect(() => { refresh(); }, []);
  return (
    <View style={styles.c}>
      <Text style={styles.h}>내 실종 신고</Text>
      <FlatList data={reports} keyExtractor={(r) => r.id}
        ListEmptyComponent={<Text style={styles.empty}>아직 신고가 없어요.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => router.push(`/(app)/report/${item.id}/track`)}>
            <Text style={styles.rowMain}>{item.dog?.name ?? '실종견'} · {item.status === 'active' ? '🔴 진행 중' : '✅ 종료'}</Text>
            <Text style={styles.rowSub}>{new Date(item.created_at).toLocaleString('ko-KR')}</Text>
            {item.status === 'active' && (
              <Pressable onPress={() => resolveReport(item.id).then(refresh)}><Text style={styles.resolve}>찾았어요(종료)</Text></Pressable>
            )}
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
  rowMain: { fontSize: 16, fontWeight: '700' }, rowSub: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  resolve: { color: '#16a34a', fontWeight: '700', marginTop: 6 },
});
```

- [ ] **Step 3: 홈 진입점** — modify `app/(app)/home.tsx`: add two buttons above 로그아웃 (keep existing walk buttons):
```tsx
      <Pressable style={styles.reportCta} onPress={() => router.push('/(app)/report/new')}>
        <Text style={styles.reportCtaText}>🚨 실종 신고</Text>
      </Pressable>
      <Pressable style={styles.walkHist} onPress={() => router.push('/(app)/reports')}>
        <Text style={styles.walkHistText}>내 실종 신고</Text>
      </Pressable>
```
Add styles: `reportCta: { backgroundColor: '#ef4444', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 12 }, reportCtaText: { color: '#fff', fontWeight: '700', fontSize: 16 },`

- [ ] **Step 4: tsc + 전체 테스트** — `npx tsc --noEmit` clean; `npm test` green; `npm run test:rls` green (crisis + walks + rls).
- [ ] **Step 5: Commit** — `git add "app/(app)/report/[id]/track.tsx" "app/(app)/reports.tsx" "app/(app)/home.tsx" && git commit -m "feat(sp3a): tracking map + my reports + home entry"`

---

## Task 15: Edge Function 배포 + Webhook + 실기기 QA (수동)

> Firebase 서비스계정 + Supabase 클라우드 + 2 실기기 필요. 자동화 불가.

- [ ] **Step 1: secrets/배포** — `npx supabase functions deploy notify-nearby`; `npx supabase secrets set FCM_SERVICE_ACCOUNT="$(cat service-account.json)"`. (SUPABASE_URL/SERVICE_ROLE_KEY는 Edge 런타임 기본 제공.)
- [ ] **Step 2: Database Webhook** — Supabase 대시보드 → Database → Webhooks → `missing_reports` INSERT → HTTP POST → `notify-nearby` 함수 URL (service role 헤더). 또는 SQL로 `supabase_functions.http_request` 트리거 등록.
- [ ] **Step 3: 2기기 QA 체크리스트**
  - [ ] 보호자: 등록견으로 신고 생성(지도 핀·반경·"약 N명") → track 화면 이동
  - [ ] 이웃 기기: 푸시 수신 → 탭 → 신고 상세(강아지 사진·특징·마지막 위치) 딥링크 진입
  - [ ] 이웃: 목격 제보(사진·지도 핀·시각·메모) 제출
  - [ ] 보호자: track 지도에 제보 핀 + 목록 표시
  - [ ] `notification_logs`에 sent 기록, 반경 밖 사용자는 미수신
  - [ ] resolved 처리 후 이웃이 그 신고 못 봄(RLS)
  - [ ] 반경 내 0명일 때 신고는 생성되되 안내 표시
- [ ] **Step 4: Commit (설정)** — `git add supabase/config.toml && git commit -m "chore(sp3a): notify-nearby deploy + webhook config"` (서비스계정 키는 커밋 금지).

---

## Self-Review (작성자 점검)

**1. Spec coverage:** 실종 신고(T11)·미리보기 도달수(count RPC T2/T11)·서버 푸시(T8/T9 + webhook T15)·딥링크(T10)·신고상세(T12)·목격제보(T6/T13)·추적지도(T7/T14)·내신고/resolve(T14)·RLS 확장(T1)·반경(T2)·통합검증(T3) — 전부 매핑. notification_logs/무효토큰정리(T8/T9). ✅

**2. Placeholder scan:** 코드 스텝 전부 실제 코드. T15(배포·webhook·QA)는 본질적 수동. T7은 geography→lat/lng RPC 필요성을 명시적 태스크로 분리(플레이스홀더 아님). T6 list 함수는 T7에서 RPC로 교체됨을 명시.

**3. Type consistency:** `MissingReport`/`MissingReportWithDog`(dog 조인)·`Sighting`(lat/lng 포함, report_sightings RPC가 채움)·`ReportStatus`·`createReport`/`createSighting`(WKT `SRID=4326;POINT(lng lat)`)·`countUsersNear(lat,lng,radiusM)`→rpc `count_users_near{lat,lng,radius_m}`·`tokens_near_report{p_report_id}`·Edge `buildLogRows/invalidTokensFrom/buildFcmMessage` — 태스크 간 일치.

> **알려진 한계/리스크:** ① Edge Function의 FCM 실발송·Webhook은 실기기+클라우드에서만 검증(T15). ② geography 좌표 직렬화는 `report_sightings` RPC로 우회(T7) — 신고 상세의 마지막 위치 지도도 필요 시 같은 패턴. ③ JWT 서명(서비스계정) 코드는 Deno crypto.subtle 기반 — 실배포 전 토큰 발급을 한 번 검증할 것. ④ WKT 문자열 주입은 좌표 finite/range 검증(`isValidCoord`)으로 보장.

**Codex 교차 리뷰(2026-06-02) 반영:** ① 활성 신고/연결 dog 읽기를 `TO authenticated`로 제한(익명 노출 차단) ② 신고 INSERT/UPDATE에 dog 소유권 with-check 추가 ③ `tokens_near_report` EXECUTE를 service_role로만 제한(토큰 하베스팅 차단) ④ dog-images Storage에 활성-신고 읽기 정책 추가(이웃이 사진 보임) ⑤ `report_detail` RPC로 마지막 목격 좌표 제공 + 상세/추적 지도에 ★마커 ⑥ `alert_radius_m` DB CHECK(300~10000) ⑦ 통합 테스트에 owner/far 위치·토큰 부여(배제 실검증) + 익명거부·타인dog신고·tokens_near_report 클라이언트거부 테스트 추가 ⑧ FCM 무효토큰 파싱을 `error.details[].errorCode`로 수정 ⑨ 좌표 finite/range 검증.
