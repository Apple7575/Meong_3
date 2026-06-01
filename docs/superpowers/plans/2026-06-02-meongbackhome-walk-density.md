# 멍백홈 Sub-project 2 「밀도 엔진 (산책 기록)」 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 백그라운드 GPS로 산책 경로를 기록·저장하고, 통계·연속 기록(스트릭)으로 매일 쓰게 만드는 밀도 엔진을 구축한다.

**Architecture:** 단일 공유 세션 싱글톤(`activeWalk.walkSession`)이 진실의 원천이다. 백그라운드 위치 태스크가 좌표를 받으면 이 싱글톤에 ingest → 즉시 AsyncStorage에 영속(화면 유무·강제종료와 무관). 화면은 같은 싱글톤을 구독한다. 이동 시간은 일시정지를 제외하고 누적한다. 저장은 DB 성공 후에만 버퍼를 비운다(데이터 분실 방지). 테스트 가능한 코어(geo·WalkSession·walks 서비스·통계 RPC)는 TDD.

**Tech Stack:** Expo SDK 56 (TypeScript) · expo-router · supabase-js v2 · expo-location · expo-task-manager · @react-native-async-storage/async-storage (SP1에서 이미 설치됨) · @react-native-kakao/core + @react-native-kakao/map · Jest · Supabase CLI(로컬)

**Branch:** `feat/walk-density` (SP1은 main에 머지됨; 이 브랜치는 동일 SP1 커밋 위에 있어 SP2 PR은 SP2 변경만 보여줌).

> **이 플랜은 Codex 교차 리뷰(2026-06-02)에서 발견된 6개 P1 + 주요 P2를 반영해 개정되었다.** 핵심 수정: ① 백그라운드 태스크가 화면 sink가 아니라 싱글톤→AsyncStorage에 직접 영속 ② 복구가 실제 활성 세션(싱글톤)에 연결 ③ 이동 시간이 일시정지 제외 ④ DB 저장 성공 후에만 버퍼 clear, 경로를 URL 파라미터로 넘기지 않음 ⑤ TaskManager 태스크를 앱 엔트리에서 전역 등록 ⑥ Kakao Map은 검증된 스파이크로.

---

## File Structure

```
supabase/migrations/0005_walks.sql        walk_records + RLS + CHECK 제약
supabase/migrations/0006_walk_stats.sql    my_walk_stats() RPC
supabase/tests/walks.test.ts               RLS + my_walk_stats 통합 테스트 (KST 정확)
src/types/db.ts                            (수정) WalkRecord, WalkStats, WalkWithDog
src/lib/geo.ts                             순수: 하버사인·acceptPoint(정확도/최소이동/최대속도)·filterNoise·거리·GeoJSON  (TDD)
src/lib/geo.test.ts
src/lib/walkSession.ts                     WalkSession 클래스(상태머신·이동시간·증분 ingest·finish/commit/discard·recover·직렬 persist) (TDD)
src/lib/walkSession.test.ts
src/lib/walkStorage.ts                     AsyncStorage PersistAdapter (어댑터)
src/lib/activeWalk.ts                       공유 싱글톤 walkSession 인스턴스
src/lib/walkLocation.ts                    expo-location/task-manager 전역 태스크 + 권한(fg/bg 폴백) + fg 서비스
src/services/walks.ts                      saveWalk/listMyWalks(dog 조인)/deleteWalk/getWalkStats  (TDD)
src/services/walks.test.ts
src/components/RouteMap.tsx                 Kakao Map + 경로 폴리라인 (검증 스파이크)
src/components/RouteThumbnail.tsx           경로 미니 SVG 썸네일 (히스토리용, 순수)
app/(app)/walk/index.tsx                   산책 시작(강아지 선택) + 산책 중
app/(app)/walk/summary.tsx                 종료 요약(동의·짧은산책 가드·저장후 clear)
app/(app)/walk/history.tsx                 히스토리 + 통계(강아지명·썸네일)
app/_layout.tsx                            (수정) walkLocation import로 태스크 전역 등록
app/(app)/home.tsx                         (수정) 산책 진입점 + 복구 배너(공유 싱글톤)
app.config.ts                              (수정) kakao/location plugins + iOS bg 모드 + 권한
```

의존 방향(순환 없음): `geo` ← `walkSession` ← `activeWalk` → `walkStorage`; `walkLocation` → `activeWalk`; 화면 → `activeWalk`+`walkLocation`+`walks`.

---

## Task 1: 네이티브 의존성 + config plugins

**Files:** Modify `package.json`, `app.config.ts`, `.env.example`.

- [ ] **Step 1: 의존성 설치 + 기존 의존성 확인**

```bash
cd /Users/cruel/Desktop/Projects/MeongBackHome
npx expo install expo-task-manager
npm i @react-native-kakao/core @react-native-kakao/map
node -e "require.resolve('@react-native-async-storage/async-storage'); console.log('async-storage OK')"
```
(`@react-native-async-storage/async-storage`는 SP1 Task 1에서 이미 설치됨 — 위 확인이 `async-storage OK`를 출력하면 추가 설치 불필요. 출력이 없으면 `npx expo install @react-native-async-storage/async-storage`.)

- [ ] **Step 2: `app.config.ts` plugins/권한 추가** — `plugins`에 추가(기존 유지):

```ts
['@react-native-kakao/core', { nativeAppKey: process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY }],
[
  'expo-location',
  {
    locationWhenInUsePermission: '산책 경로를 기록하기 위해 위치를 사용합니다.',
    locationAlwaysAndWhenInUsePermission: '화면이 꺼져 있어도 산책 경로를 기록하기 위해 위치를 사용합니다.',
    isAndroidBackgroundLocationEnabled: true,
    isAndroidForegroundServiceEnabled: true,
  },
],
```
`ios` 블록에 백그라운드 모드 추가:
```ts
ios: { bundleIdentifier: 'com.meongbackhome.app', supportsTablet: false, infoPlist: { UIBackgroundModes: ['location'] } },
```
`extra`에 `kakaoNativeAppKey: process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY` 추가.

- [ ] **Step 3: `.env.example`에 추가**

```
EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY=replace-with-kakao-native-app-key
```

- [ ] **Step 4: 검증** — `npx tsc --noEmit` clean; `npm test` (16 pass).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json app.config.ts .env.example
git commit -m "chore(sp2): add kakao-map + background-location deps and config"
```

> 네이티브 빌드/지도/백그라운드 동작의 실기기 검증은 Task 13(수동).

---

## Task 2: walk_records 마이그레이션 (0005) — CHECK 제약 포함

**Files:** Create `supabase/migrations/0005_walks.sql`.

- [ ] **Step 1: SQL 작성**

```sql
create table public.walk_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  dog_id uuid references public.dogs(id) on delete set null,
  route_geojson jsonb not null,
  distance_m double precision not null check (distance_m >= 0),
  duration_s int not null check (duration_s >= 0),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  use_for_missing_search boolean not null default false,
  created_at timestamptz not null default now(),
  check (ended_at >= started_at)
);
create index walk_records_user_started_idx on public.walk_records(user_id, started_at desc);

alter table public.walk_records enable row level security;
create policy "walks_all_own" on public.walk_records for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- [ ] **Step 2: 적용 + 클린 재적용** — `npx supabase migration up`; `npx supabase db reset --no-seed` (0001–0005 모두 클린 적용).

- [ ] **Step 3: 확인** — `docker exec supabase_db_MeongBackHome psql -U postgres -c "\d public.walk_records"` (컬럼·CHECK·RLS 확인).

- [ ] **Step 4: Commit** — `git add supabase/migrations/0005_walks.sql && git commit -m "feat(db): walk_records table + RLS + sanity CHECK constraints"`

---

## Task 3: my_walk_stats() RPC + 통합 테스트 (KST 스트릭)

**Files:** Create `supabase/migrations/0006_walk_stats.sql`, `supabase/tests/walks.test.ts`.

- [ ] **Step 1: RPC SQL** — `supabase/migrations/0006_walk_stats.sql`:

```sql
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
```

- [ ] **Step 2: 적용** — `npx supabase migration up`.

- [ ] **Step 3: 실패하는 통합 테스트** — `supabase/tests/walks.test.ts`:

```ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

async function makeUser(email: string): Promise<{ id: string; client: SupabaseClient }> {
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const s = await client.auth.signInWithPassword({ email, password: 'password123' });
  if (s.error) throw s.error;
  return { id: data.user!.id, client };
}

async function insertWalk(userId: string, startedAt: string, distanceM = 1000) {
  const { error } = await admin.from('walk_records').insert({
    user_id: userId, dog_id: null,
    route_geojson: { type: 'LineString', coordinates: [[127, 37], [127.001, 37.001]] },
    distance_m: distanceM, duration_s: 600, started_at: startedAt, ended_at: startedAt,
  });
  if (error) throw error;
}

// "오늘"을 KST 기준으로 잡고 n일 전 KST 정오의 UTC ISO를 만든다 (UTC 경계 흔들림 방지).
function kstNoonNDaysAgo(n: number): string {
  const KST_OFFSET_MS = 9 * 3600 * 1000;
  const kstNow = new Date(Date.now() + KST_OFFSET_MS); // KST wall-clock as if UTC
  const y = kstNow.getUTCFullYear(), m = kstNow.getUTCMonth(), d = kstNow.getUTCDate();
  // KST 정오 = UTC 03:00 그날
  const utcMs = Date.UTC(y, m, d - n, 3, 0, 0);
  return new Date(utcMs).toISOString();
}

describe('walk_records RLS + my_walk_stats', () => {
  let alice: { id: string; client: SupabaseClient };
  let bob: { id: string; client: SupabaseClient };
  beforeAll(async () => {
    const stamp = Date.now();
    alice = await makeUser(`wa-${stamp}@test.dev`);
    bob = await makeUser(`wb-${stamp}@test.dev`);
    await insertWalk(alice.id, kstNoonNDaysAgo(0), 1500);
    await insertWalk(alice.id, kstNoonNDaysAgo(1), 1000);
    await insertWalk(alice.id, kstNoonNDaysAgo(2), 500);
    await insertWalk(alice.id, kstNoonNDaysAgo(10), 2000);
  });

  test('alice cannot see bob walks (RLS)', async () => {
    await insertWalk(bob.id, kstNoonNDaysAgo(0));
    const { data } = await alice.client.from('walk_records').select('*');
    expect(data?.every((w: any) => w.user_id === alice.id)).toBe(true);
  });

  test('my_walk_stats totals + streak', async () => {
    const { data, error } = await alice.client.rpc('my_walk_stats').single();
    expect(error).toBeNull();
    const s = data as any;
    expect(s.total_count).toBe(4);
    expect(s.total_distance_m).toBeCloseTo(5000, 0);
    expect(s.current_streak).toBe(3);
  });
});
```

- [ ] **Step 4: 통과 확인** — `npx jest --config supabase/tests/jest.rls.config.js` (walks + 기존 rls 모두 PASS). 스트릭이 3이 아니면 RPC SQL을 고친다(테스트 약화 금지).

- [ ] **Step 5: Commit** — `git add supabase/migrations/0006_walk_stats.sql supabase/tests/walks.test.ts && git commit -m "feat(db): my_walk_stats RPC (KST streak) + integration tests"`

---

## Task 4: geo.ts (acceptPoint + 최대속도 필터) — TDD

**Files:** Create `src/lib/geo.ts`, `src/lib/geo.test.ts`.

- [ ] **Step 1: 실패하는 테스트** — `src/lib/geo.test.ts`:

```ts
import { haversineMeters, acceptPoint, filterNoise, accumulateDistance, toGeoJSONLineString, GeoPoint } from './geo';

describe('geo', () => {
  test('haversine ~111km per 1° lat', () => {
    const d = haversineMeters({ lat: 37, lng: 127 }, { lat: 38, lng: 127 });
    expect(d).toBeGreaterThan(110000); expect(d).toBeLessThan(112000);
  });
  test('acceptPoint rejects bad accuracy', () => {
    expect(acceptPoint(null, { lat: 37, lng: 127, accuracy: 99, t: 0 })).toBe(false);
    expect(acceptPoint(null, { lat: 37, lng: 127, accuracy: 5, t: 0 })).toBe(true);
  });
  test('acceptPoint rejects sub-minMove jitter', () => {
    const last: GeoPoint = { lat: 37, lng: 127, accuracy: 5, t: 0 };
    expect(acceptPoint(last, { lat: 37.00001, lng: 127, accuracy: 5, t: 60000 })).toBe(false); // ~1.1m
  });
  test('acceptPoint rejects implausible speed jump', () => {
    const last: GeoPoint = { lat: 37, lng: 127, accuracy: 5, t: 0 };
    // ~111m in 1s = 111 m/s >> 8 m/s → reject (GPS spike after signal loss)
    expect(acceptPoint(last, { lat: 37.001, lng: 127, accuracy: 5, t: 1000 })).toBe(false);
  });
  test('acceptPoint accepts plausible walking move', () => {
    const last: GeoPoint = { lat: 37, lng: 127, accuracy: 5, t: 0 };
    // ~111m in 90s = 1.23 m/s → accept
    expect(acceptPoint(last, { lat: 37.001, lng: 127, accuracy: 5, t: 90000 })).toBe(true);
  });
  test('filterNoise applies acceptPoint across buffer', () => {
    const pts: GeoPoint[] = [
      { lat: 37, lng: 127, accuracy: 5, t: 0 },
      { lat: 37, lng: 127, accuracy: 99, t: 30000 },   // bad accuracy → drop
      { lat: 37.001, lng: 127, accuracy: 5, t: 90000 },// plausible → keep
    ];
    expect(filterNoise(pts).length).toBe(2);
  });
  test('accumulateDistance sums legs', () => {
    const d = accumulateDistance([{ lat: 37, lng: 127 }, { lat: 37.001, lng: 127 }, { lat: 37.002, lng: 127 }]);
    expect(d).toBeGreaterThan(220); expect(d).toBeLessThan(225);
  });
  test('toGeoJSONLineString uses [lng,lat]', () => {
    expect(toGeoJSONLineString([{ lat: 37, lng: 127 }])).toEqual({ type: 'LineString', coordinates: [[127, 37]] });
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx jest src/lib/geo.test.ts` → FAIL.

- [ ] **Step 3: 구현** — `src/lib/geo.ts`:

```ts
export type LatLng = { lat: number; lng: number };
export type GeoPoint = LatLng & { accuracy?: number; t: number };

const EARTH_R = 6371000;
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

export type AcceptOpts = { maxAccuracy?: number; minMoveMeters?: number; maxSpeedMps?: number };
export function acceptPoint(last: GeoPoint | null, p: GeoPoint, opts: AcceptOpts = {}): boolean {
  const maxAccuracy = opts.maxAccuracy ?? 30;
  const minMove = opts.minMoveMeters ?? 5;
  const maxSpeed = opts.maxSpeedMps ?? 8; // ~28.8km/h; walks never exceed, GPS spikes do
  if (p.accuracy != null && p.accuracy > maxAccuracy) return false;
  if (!last) return true;
  const dist = haversineMeters(last, p);
  if (dist < minMove) return false;
  const dtSec = (p.t - last.t) / 1000;
  if (dtSec > 0 && dist / dtSec > maxSpeed) return false;
  return true;
}

export function filterNoise(points: GeoPoint[], opts: AcceptOpts = {}): GeoPoint[] {
  const out: GeoPoint[] = [];
  for (const p of points) if (acceptPoint(out[out.length - 1] ?? null, p, opts)) out.push(p);
  return out;
}

export function accumulateDistance(points: LatLng[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversineMeters(points[i - 1], points[i]);
  return d;
}

export function toGeoJSONLineString(points: LatLng[]): { type: 'LineString'; coordinates: number[][] } {
  return { type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat]) };
}
```

- [ ] **Step 4: 통과 확인** — `npx jest src/lib/geo.test.ts` → PASS (8 tests).

- [ ] **Step 5: Commit** — `git add src/lib/geo.ts src/lib/geo.test.ts && git commit -m "feat(sp2): geo utils + acceptPoint(accuracy/minMove/maxSpeed) TDD"`

---

## Task 5: 타입 + walks 서비스 (dog 조인) — TDD

**Files:** Modify `src/types/db.ts`; create `src/services/walks.ts`, `src/services/walks.test.ts`.

- [ ] **Step 1: 타입 추가** — append to `src/types/db.ts`:

```ts
export type WalkRecord = {
  id: string; user_id: string; dog_id: string | null;
  route_geojson: { type: 'LineString'; coordinates: number[][] };
  distance_m: number; duration_s: number;
  started_at: string; ended_at: string; use_for_missing_search: boolean; created_at: string;
};
export type WalkWithDog = WalkRecord & { dog: { name: string } | null };
export type WalkStats = { total_distance_m: number; total_count: number; this_week_count: number; current_streak: number };
```

- [ ] **Step 2: 실패하는 테스트** — `src/services/walks.test.ts`:

```ts
import { saveWalk, listMyWalks, deleteWalk, getWalkStats } from './walks';

const mockSingle = jest.fn();
const mockInsert = jest.fn(() => ({ select: jest.fn(() => ({ single: mockSingle })) }));
const mockOrder = jest.fn();
const mockEqList = jest.fn(() => ({ order: mockOrder }));
const mockSelect = jest.fn(() => ({ eq: mockEqList }));
const mockEqDelete = jest.fn();
const mockDelete = jest.fn(() => ({ eq: mockEqDelete }));
const mockFrom = jest.fn(() => ({ insert: mockInsert, select: mockSelect, delete: mockDelete }));
const mockRpc = jest.fn();
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: (...a: any[]) => (mockFrom as (...x: any[]) => any)(...a),
    rpc: (...a: any[]) => (mockRpc as (...x: any[]) => any)(...a),
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u1' } } })) },
  },
}));
beforeEach(() => jest.clearAllMocks());

test('saveWalk inserts with user_id, dog_id, consent', async () => {
  mockSingle.mockResolvedValueOnce({ data: { id: 'w1' }, error: null });
  const id = await saveWalk({
    dogId: 'd9', routeGeojson: { type: 'LineString', coordinates: [] },
    distanceM: 1234, durationS: 600, startedAt: 'a', endedAt: 'b', useForMissingSearch: true,
  });
  expect(mockFrom).toHaveBeenCalledWith('walk_records');
  expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u1', dog_id: 'd9', use_for_missing_search: true, distance_m: 1234 }));
  expect(id).toBe('w1');
});
test('listMyWalks selects with dog join, ordered desc', async () => {
  mockOrder.mockResolvedValueOnce({ data: [{ id: 'w1', dog: { name: '초코' } }], error: null });
  const rows = await listMyWalks();
  expect(mockSelect).toHaveBeenCalledWith('*, dog:dogs(name)');
  expect(mockEqList).toHaveBeenCalledWith('user_id', 'u1');
  expect(mockOrder).toHaveBeenCalledWith('started_at', { ascending: false });
  expect(rows[0].dog?.name).toBe('초코');
});
test('deleteWalk by id', async () => {
  mockEqDelete.mockResolvedValueOnce({ error: null });
  await deleteWalk('w1');
  expect(mockEqDelete).toHaveBeenCalledWith('id', 'w1');
});
test('getWalkStats via RPC', async () => {
  mockRpc.mockReturnValueOnce({ single: jest.fn(async () => ({ data: { total_count: 3, current_streak: 2, total_distance_m: 10, this_week_count: 1 }, error: null })) });
  const s = await getWalkStats();
  expect(mockRpc).toHaveBeenCalledWith('my_walk_stats');
  expect(s.current_streak).toBe(2);
});
```

- [ ] **Step 3: 실패 확인** — `npx jest src/services/walks.test.ts` → FAIL.

- [ ] **Step 4: 구현** — `src/services/walks.ts`:

```ts
import { supabase } from '../lib/supabase';
import { WalkWithDog, WalkStats } from '../types/db';

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) throw new Error('로그인이 필요합니다.');
  return data.user.id;
}
export type SaveWalkInput = {
  dogId: string | null; routeGeojson: unknown; distanceM: number; durationS: number;
  startedAt: string; endedAt: string; useForMissingSearch: boolean;
};
export async function saveWalk(input: SaveWalkInput): Promise<string> {
  const user_id = await uid();
  const { data, error } = await supabase.from('walk_records').insert({
    user_id, dog_id: input.dogId, route_geojson: input.routeGeojson,
    distance_m: input.distanceM, duration_s: input.durationS,
    started_at: input.startedAt, ended_at: input.endedAt, use_for_missing_search: input.useForMissingSearch,
  }).select('id').single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}
export async function listMyWalks(): Promise<WalkWithDog[]> {
  const user_id = await uid();
  const { data, error } = await supabase.from('walk_records')
    .select('*, dog:dogs(name)').eq('user_id', user_id).order('started_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as WalkWithDog[];
}
export async function deleteWalk(id: string): Promise<void> {
  const { error } = await supabase.from('walk_records').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
export async function getWalkStats(): Promise<WalkStats> {
  const { data, error } = await supabase.rpc('my_walk_stats').single();
  if (error) throw new Error(error.message);
  return data as WalkStats;
}
```

- [ ] **Step 5: 통과 + tsc** — `npx jest src/services/walks.test.ts` PASS (4); `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit** — `git add src/types/db.ts src/services/walks.ts src/services/walks.test.ts && git commit -m "feat(sp2): walks service (save/list+dogjoin/delete/stats) TDD"`

---

## Task 6: WalkSession 클래스 (이동시간·증분 ingest·저장후 clear·복구) — TDD

**Files:** Create `src/lib/walkSession.ts`, `src/lib/walkSession.test.ts`.

- [ ] **Step 1: 실패하는 테스트** — `src/lib/walkSession.test.ts`:

```ts
import { WalkSession, PersistAdapter } from './walkSession';

function memoryStore(): PersistAdapter & { dump: () => string | null } {
  let v: string | null = null;
  return { save: async (s) => { v = s; }, load: async () => v, clear: async () => { v = null; }, dump: () => v };
}
const P = (lat: number, t: number) => ({ lat, lng: 127, accuracy: 5, t });

test('ingest filters jitter/spikes; distance from accepted points', async () => {
  const s = new WalkSession(memoryStore());
  await s.start('2026-06-02T00:00:00Z', 'dog1');
  s.ingest([P(37, 0), P(37.00001, 60000), P(37.001, 120000)]); // mid is jitter
  expect(s.getPoints().length).toBe(2);
  expect(s.getDistanceM()).toBeGreaterThan(110);
});
test('moving time excludes pause', async () => {
  const s = new WalkSession(memoryStore());
  await s.start('2026-06-02T00:00:00Z'); // segStart = 0ms (parsed)
  s.pause(60_000);   // 60s moving
  s.resume(120_000); // paused 60s (not counted)
  // at 150_000 → moving = 60 + 30 = 90s
  expect(s.getMovingSeconds(150_000)).toBe(90);
});
test('finish keeps buffer until commitSaved; summary uses moving time', async () => {
  const store = memoryStore();
  const s = new WalkSession(store);
  await s.start('2026-06-02T00:00:00Z', 'dog1');
  s.ingest([P(37, 0), P(37.001, 120000)]);
  const summary = s.finish('2026-06-02T00:02:00Z'); // 120s moving
  expect(summary.durationS).toBe(120);
  expect(summary.routeGeojson.type).toBe('LineString');
  expect(summary.dogId).toBe('dog1');
  expect(store.dump()).not.toBeNull();          // NOT cleared yet
  await s.commitSaved();
  expect(await store.load()).toBeNull();         // cleared only after commit
});
test('discard clears buffer', async () => {
  const store = memoryStore();
  const s = new WalkSession(store);
  await s.start('2026-06-02T00:00:00Z');
  s.ingest([P(37, 0)]);
  await s.discard();
  expect(await store.load()).toBeNull();
});
test('recover restores points as paused (recording crash)', async () => {
  const store = memoryStore();
  const a = new WalkSession(store);
  await a.start('2026-06-02T00:00:00Z', 'dog1');
  a.ingest([P(37, 0), P(37.001, 120000)]);
  const b = new WalkSession(store);
  const r = await b.recover();
  expect(r.found).toBe(true);
  expect(r.state).toBe('paused');
  expect(b.getPoints().length).toBe(2);
  expect(b.getPendingSummary()?.dogId).toBe('dog1');
});
test('recover restores finished state', async () => {
  const store = memoryStore();
  const a = new WalkSession(store);
  await a.start('2026-06-02T00:00:00Z');
  a.ingest([P(37, 0), P(37.001, 120000)]);
  a.finish('2026-06-02T00:02:00Z');
  const b = new WalkSession(store);
  const r = await b.recover();
  expect(r.state).toBe('finished');
  expect(b.getPendingSummary()?.durationS).toBe(120);
});
test('subscribe notified on ingest', async () => {
  const s = new WalkSession(memoryStore());
  let n = 0; s.subscribe(() => (n = s.getPoints().length));
  await s.start('2026-06-02T00:00:00Z');
  s.ingest([P(37, 0)]);
  expect(n).toBe(1);
});
```

- [ ] **Step 2: 실패 확인** — `npx jest src/lib/walkSession.test.ts` → FAIL.

- [ ] **Step 3: 구현** — `src/lib/walkSession.ts`:

```ts
import { GeoPoint, LatLng, acceptPoint, accumulateDistance, toGeoJSONLineString } from './geo';

export type PersistAdapter = {
  save: (serialized: string) => Promise<void>;
  load: () => Promise<string | null>;
  clear: () => Promise<void>;
};
export type WalkSummary = {
  routeGeojson: { type: 'LineString'; coordinates: number[][] };
  distanceM: number; durationS: number; startedAt: string; endedAt: string; dogId: string | null;
};
export type State = 'idle' | 'recording' | 'paused' | 'finished';
type Snapshot = { startedAt: string; endedAt: string | null; dogId: string | null; points: GeoPoint[]; movingMs: number; state: State };

export class WalkSession {
  private state: State = 'idle';
  private startedAt: string | null = null;
  private endedAt: string | null = null;
  private dogId: string | null = null;
  private points: GeoPoint[] = [];
  private movingMs = 0;
  private segStart: number | null = null; // ms epoch when current recording segment began
  private listeners = new Set<() => void>();
  private chain: Promise<void> = Promise.resolve();

  constructor(private store: PersistAdapter) {}

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { this.listeners.forEach((l) => l()); }

  async start(startedAt: string, dogId: string | null = null): Promise<void> {
    this.state = 'recording'; this.startedAt = startedAt; this.endedAt = null; this.dogId = dogId;
    this.points = []; this.movingMs = 0; this.segStart = Date.parse(startedAt);
    await this.persist(); this.emit();
  }

  ingest(pts: GeoPoint[]): void {
    if (this.state !== 'recording') return;
    let changed = false;
    for (const p of pts) {
      const last = this.points[this.points.length - 1] ?? null;
      if (acceptPoint(last, p)) { this.points.push(p); changed = true; }
    }
    if (changed) { void this.persist(); this.emit(); }
  }
  addPoint(p: GeoPoint): void { this.ingest([p]); }

  pause(nowMs: number = Date.now()): void {
    if (this.state !== 'recording') return;
    if (this.segStart != null) { this.movingMs += nowMs - this.segStart; this.segStart = null; }
    this.state = 'paused'; void this.persist(); this.emit();
  }
  resume(nowMs: number = Date.now()): void {
    if (this.state !== 'paused') return;
    this.segStart = nowMs; this.state = 'recording'; void this.persist(); this.emit();
  }

  getMovingSeconds(nowMs: number = Date.now()): number {
    let ms = this.movingMs;
    if (this.state === 'recording' && this.segStart != null) ms += nowMs - this.segStart;
    return Math.floor(ms / 1000);
  }
  getDistanceM(): number { return accumulateDistance(this.points); }
  getPoints(): GeoPoint[] { return this.points; }
  getState(): State { return this.state; }
  getStartedAt(): string | null { return this.startedAt; }

  finish(endedAt: string): WalkSummary {
    const endMs = Date.parse(endedAt);
    if (this.state === 'recording' && this.segStart != null) { this.movingMs += endMs - this.segStart; this.segStart = null; }
    this.endedAt = endedAt; this.state = 'finished';
    void this.persist();
    return this.getPendingSummary()!;
  }

  getPendingSummary(): WalkSummary | null {
    if (!this.startedAt) return null;
    const coords: LatLng[] = this.points.map((p) => ({ lat: p.lat, lng: p.lng }));
    return {
      routeGeojson: toGeoJSONLineString(coords),
      distanceM: accumulateDistance(coords),
      durationS: Math.round(this.movingMs / 1000),
      startedAt: this.startedAt, endedAt: this.endedAt ?? this.startedAt, dogId: this.dogId,
    };
  }

  async commitSaved(): Promise<void> { await this.reset(); }
  async discard(): Promise<void> { await this.reset(); }
  private async reset(): Promise<void> {
    this.state = 'idle'; this.startedAt = null; this.endedAt = null; this.dogId = null;
    this.points = []; this.movingMs = 0; this.segStart = null;
    await this.store.clear(); this.emit();
  }

  async recover(): Promise<{ found: boolean; state: State }> {
    const raw = await this.store.load();
    if (!raw) return { found: false, state: 'idle' };
    const snap = JSON.parse(raw) as Snapshot;
    this.startedAt = snap.startedAt; this.endedAt = snap.endedAt; this.dogId = snap.dogId;
    this.points = snap.points; this.movingMs = snap.movingMs; this.segStart = null;
    // recording crash → resume paused so the offline gap is not counted as moving time
    this.state = snap.state === 'finished' ? 'finished' : 'paused';
    this.emit();
    return { found: true, state: this.state };
  }

  private persist(): Promise<void> {
    if (!this.startedAt) return Promise.resolve();
    const snap: Snapshot = {
      startedAt: this.startedAt, endedAt: this.endedAt, dogId: this.dogId,
      points: this.points, movingMs: this.movingMs, state: this.state,
    };
    const s = JSON.stringify(snap);
    this.chain = this.chain.then(() => this.store.save(s)).catch(() => {});
    return this.chain;
  }
}
```

- [ ] **Step 4: 통과 + tsc** — `npx jest src/lib/walkSession.test.ts` PASS (7); `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit** — `git add src/lib/walkSession.ts src/lib/walkSession.test.ts && git commit -m "feat(sp2): WalkSession (moving-time, incremental ingest, save-before-clear, recovery) TDD"`

---

## Task 7: 저장 어댑터 + 공유 싱글톤 + 위치 태스크(전역 등록·fg폴백)

**Files:** Create `src/lib/walkStorage.ts`, `src/lib/activeWalk.ts`, `src/lib/walkLocation.ts`. (통합 — tsc + 실기기 검증.)

- [ ] **Step 1: 저장 어댑터** — `src/lib/walkStorage.ts`:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PersistAdapter } from './walkSession';

const KEY = 'meong.walk.inprogress';
export const asyncStorageAdapter: PersistAdapter = {
  save: (s) => AsyncStorage.setItem(KEY, s),
  load: () => AsyncStorage.getItem(KEY),
  clear: () => AsyncStorage.removeItem(KEY),
};
```

- [ ] **Step 2: 공유 싱글톤** — `src/lib/activeWalk.ts`:

```ts
import { WalkSession } from './walkSession';
import { asyncStorageAdapter } from './walkStorage';

// 앱 전역에서 단 하나의 산책 세션. 백그라운드 태스크·모든 화면·복구가 이 인스턴스를 공유한다.
export const walkSession = new WalkSession(asyncStorageAdapter);
```

- [ ] **Step 3: 위치 태스크 + 권한** — `src/lib/walkLocation.ts`:

```ts
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { GeoPoint } from './geo';
import { walkSession } from './activeWalk';

export const WALK_TASK = 'meong-walk-location';

// 전역(모듈 로드 시) 등록. app/_layout.tsx가 이 모듈을 import 하여 앱 엔트리에서 실행되게 한다.
TaskManager.defineTask(WALK_TASK, ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  const pts: GeoPoint[] = locations.map((l) => ({
    lat: l.coords.latitude, lng: l.coords.longitude,
    accuracy: l.coords.accuracy ?? undefined, t: l.timestamp,
  }));
  walkSession.ingest(pts); // 싱글톤이 필터+AsyncStorage 영속 (화면 유무와 무관)
});

export type WalkPermission = { foreground: boolean; background: boolean };
export async function requestWalkPermissions(): Promise<WalkPermission> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return { foreground: false, background: false };
  const bg = await Location.requestBackgroundPermissionsAsync();
  return { foreground: true, background: bg.status === 'granted' };
}

export async function startWalkUpdates(): Promise<void> {
  await Location.startLocationUpdatesAsync(WALK_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 3000, distanceInterval: 5,
    showsBackgroundLocationIndicator: true,
    foregroundService: { notificationTitle: '산책 기록 중', notificationBody: '멍백홈이 산책 경로를 기록하고 있어요.' },
  });
}
export async function stopWalkUpdates(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(WALK_TASK)) await Location.stopLocationUpdatesAsync(WALK_TASK);
}
```

- [ ] **Step 4: 전역 등록** — modify `app/_layout.tsx`: add this import near the TOP OF FILE (with the other imports, NOT inside the component) so the task registers at app entry:
```tsx
import '../src/lib/walkLocation';
```

- [ ] **Step 5: tsc + 회귀** — `npx tsc --noEmit` clean; `npm test` green (geo+walkSession+walks+SP1 = 16 기존 + 신규).

- [ ] **Step 6: Commit** — `git add src/lib/walkStorage.ts src/lib/activeWalk.ts src/lib/walkLocation.ts app/_layout.tsx && git commit -m "feat(sp2): shared walk session singleton + global location task (bg-direct persist, fg fallback)"`

---

## Task 8: RouteMap (Kakao Map, 검증 스파이크) + RouteThumbnail (SVG, 순수)

**Files:** Create `src/components/RouteMap.tsx`, `src/components/RouteThumbnail.tsx`.

- [ ] **Step 1: 설치된 Kakao Map API 확인 (스파이크)** — 코드를 쓰기 전에 실제 export를 확인한다:
```bash
ls node_modules/@react-native-kakao/map/lib 2>/dev/null
cat node_modules/@react-native-kakao/map/lib/typescript/**/index.d.ts 2>/dev/null | head -80 || \
  find node_modules/@react-native-kakao/map -name "*.d.ts" | xargs grep -lE "export (const|function|default)" | head
```
설치된 버전의 **맵 뷰 컴포넌트명**과 **폴리라인/경로 오버레이 컴포넌트명·props**를 확인해 메모한다. 아래 Step 2 코드를 그 실제 이름에 맞춰 작성한다(예시 이름이 다르면 교체). 폴리라인 오버레이를 못 찾으면 `MapMarker`로 시작점만 표시하고 경로는 RouteThumbnail/요약에서 SVG로 보여주는 것으로 폴백하고, 그 사실을 커밋 메시지에 적는다.

- [ ] **Step 2: RouteMap 작성** — `src/components/RouteMap.tsx` (Step 1에서 확인한 실제 API에 맞춰 식별자 교체):

```tsx
import { StyleSheet, View } from 'react-native';
// NOTE: Step1에서 확인한 실제 export로 교체할 것.
import { KakaoMapView, MapPolyline } from '@react-native-kakao/map';
import { LatLng } from '../lib/geo';

type Props = { points: LatLng[] };
export function RouteMap({ points }: Props) {
  const center = points.length ? points[points.length - 1] : { lat: 37.6542, lng: 127.0568 }; // 노원 기본
  return (
    <View style={styles.fill}>
      <KakaoMapView style={styles.fill} initialRegion={{ latitude: center.lat, longitude: center.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 }}>
        {points.length > 1 && (
          <MapPolyline coordinates={points.map((p) => ({ latitude: p.lat, longitude: p.lng }))} strokeColor="#7c3aed" strokeWidth={5} />
        )}
      </KakaoMapView>
    </View>
  );
}
const styles = StyleSheet.create({ fill: { flex: 1 } });
```

- [ ] **Step 3: RouteThumbnail 작성 (순수 SVG, 지도 SDK 불필요)** — `src/components/RouteThumbnail.tsx`. (히스토리 행에서 N개의 지도 인스턴스를 피하기 위해 경량 SVG로 경로 모양만.)

```tsx
import Svg, { Polyline } from 'react-native-svg';

type Props = { coordinates: number[][]; size?: number };
// GeoJSON [lng,lat] 배열을 size×size 박스에 정규화해 그린다.
export function RouteThumbnail({ coordinates, size = 40 }: Props) {
  if (!coordinates || coordinates.length < 2) return <Svg width={size} height={size} />;
  const lngs = coordinates.map((c) => c[0]); const lats = coordinates.map((c) => c[1]);
  const minX = Math.min(...lngs), maxX = Math.max(...lngs), minY = Math.min(...lats), maxY = Math.max(...lats);
  const spanX = maxX - minX || 1e-6, spanY = maxY - minY || 1e-6;
  const pad = 4;
  const pts = coordinates.map((c) => {
    const x = pad + ((c[0] - minX) / spanX) * (size - 2 * pad);
    const y = size - pad - ((c[1] - minY) / spanY) * (size - 2 * pad); // y축 반전
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <Svg width={size} height={size}>
      <Polyline points={pts} fill="none" stroke="#7c3aed" strokeWidth={2} />
    </Svg>
  );
}
```
Run: `npx expo install react-native-svg` (Step 1과 함께). Then `npx tsc --noEmit` clean.

- [ ] **Step 4: Commit** — `git add src/components/RouteMap.tsx src/components/RouteThumbnail.tsx package.json package-lock.json && git commit -m "feat(sp2): RouteMap (kakao, verified) + RouteThumbnail (svg)"`

---

## Task 9: 산책 화면 (강아지 선택 + 진행 + finished→summary 라우팅)

**Files:** Create `app/(app)/walk/index.tsx`.

- [ ] **Step 1: 화면 작성** — `app/(app)/walk/index.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { View, Text, Pressable, Alert, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { RouteMap } from '../../../src/components/RouteMap';
import { walkSession } from '../../../src/lib/activeWalk';
import { requestWalkPermissions, startWalkUpdates, stopWalkUpdates } from '../../../src/lib/walkLocation';
import { listMyDogs } from '../../../src/services/dogs';
import { Dog } from '../../../src/types/db';
import { LatLng } from '../../../src/lib/geo';

export default function WalkScreen() {
  const [state, setState] = useState(walkSession.getState());
  const [points, setPoints] = useState<LatLng[]>([]);
  const [distanceM, setDistanceM] = useState(0);
  const [moving, setMoving] = useState(0);
  const [dogs, setDogs] = useState<Dog[]>([]);
  const [dogId, setDogId] = useState<string | null>(null);

  // finished 상태로 진입(복구 등) → 요약으로
  useEffect(() => { if (walkSession.getState() === 'finished') router.replace('/(app)/walk/summary'); }, []);

  useEffect(() => {
    const sync = () => {
      setState(walkSession.getState());
      setPoints(walkSession.getPoints().map((p) => ({ lat: p.lat, lng: p.lng })));
      setDistanceM(walkSession.getDistanceM());
    };
    const unsub = walkSession.subscribe(sync); sync();
    return unsub;
  }, []);

  useEffect(() => { listMyDogs().then(setDogs).catch(() => {}); }, []);

  useEffect(() => {
    const id = setInterval(() => setMoving(walkSession.getMovingSeconds()), 1000);
    return () => clearInterval(id);
  }, []);

  async function start() {
    const perm = await requestWalkPermissions();
    if (!perm.foreground) { Alert.alert('위치 권한 필요', '위치 권한을 허용해야 산책을 기록할 수 있어요.'); return; }
    if (!perm.background) Alert.alert('백그라운드 권한 제한', '화면을 켠 채로 기록됩니다. 정확한 기록을 위해 설정에서 "항상 허용"을 권장해요.');
    await walkSession.start(new Date().toISOString(), dogId);
    await startWalkUpdates();
  }
  async function finish() {
    await stopWalkUpdates();
    walkSession.finish(new Date().toISOString());
    router.push('/(app)/walk/summary');
  }

  const km = (distanceM / 1000).toFixed(2);
  const mmss = `${String(Math.floor(moving / 60)).padStart(2, '0')}:${String(moving % 60).padStart(2, '0')}`;
  const recording = state === 'recording' || state === 'paused';

  return (
    <View style={styles.c}>
      <View style={styles.map}><RouteMap points={points} /></View>
      {!recording && (
        <ScrollView horizontal style={styles.dogRow} contentContainerStyle={{ gap: 8, padding: 12 }}>
          <Pressable style={[styles.dog, dogId === null && styles.dogOn]} onPress={() => setDogId(null)}><Text>강아지 없이</Text></Pressable>
          {dogs.map((d) => (
            <Pressable key={d.id} style={[styles.dog, dogId === d.id && styles.dogOn]} onPress={() => setDogId(d.id)}><Text>🐶 {d.name}</Text></Pressable>
          ))}
        </ScrollView>
      )}
      <View style={styles.stats}>
        <View style={styles.stat}><Text style={styles.num}>{km}<Text style={styles.unit}>km</Text></Text><Text style={styles.lbl}>거리</Text></View>
        <View style={styles.stat}><Text style={styles.num}>{mmss}</Text><Text style={styles.lbl}>시간</Text></View>
      </View>
      {!recording ? (
        <Pressable style={styles.start} onPress={start}><Text style={styles.startText}>산책 시작</Text></Pressable>
      ) : (
        <View style={styles.row}>
          <Pressable style={styles.pause} onPress={() => (state === 'paused' ? walkSession.resume() : walkSession.pause())}>
            <Text style={styles.pauseText}>{state === 'paused' ? '▶ 재개' : '⏸ 일시정지'}</Text>
          </Pressable>
          <Pressable style={styles.stop} onPress={finish}><Text style={styles.stopText}>⏹ 종료</Text></Pressable>
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1 }, map: { flex: 1 },
  dogRow: { maxHeight: 56, flexGrow: 0 },
  dog: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  dogOn: { backgroundColor: '#ede9fe', borderColor: '#7c3aed' },
  stats: { flexDirection: 'row', padding: 16 },
  stat: { flex: 1, alignItems: 'center' }, num: { fontSize: 28, fontWeight: '800' }, unit: { fontSize: 13 },
  lbl: { fontSize: 12, color: '#64748b' },
  start: { backgroundColor: '#7c3aed', margin: 16, padding: 16, borderRadius: 12, alignItems: 'center' },
  startText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  row: { flexDirection: 'row', gap: 10, padding: 16 },
  pause: { flex: 1, backgroundColor: '#f1f5f9', padding: 16, borderRadius: 12, alignItems: 'center' }, pauseText: { fontWeight: '700' },
  stop: { flex: 1, backgroundColor: '#ef4444', padding: 16, borderRadius: 12, alignItems: 'center' }, stopText: { color: '#fff', fontWeight: '700' },
});
```

- [ ] **Step 2: tsc** — `npx tsc --noEmit` clean.

- [ ] **Step 3: Commit** — `git add "app/(app)/walk/index.tsx" && git commit -m "feat(sp2): walk screen (dog select, moving-time timer, finished→summary)"`

---

## Task 10: 종료 요약 화면 (싱글톤 read · 저장후 clear · 실패시 버퍼 유지)

**Files:** Create `app/(app)/walk/summary.tsx`.

- [ ] **Step 1: 화면 작성** — `app/(app)/walk/summary.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, Pressable, Switch, Alert, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { RouteMap } from '../../../src/components/RouteMap';
import { walkSession } from '../../../src/lib/activeWalk';
import { saveWalk } from '../../../src/services/walks';
import { LatLng } from '../../../src/lib/geo';

export default function WalkSummary() {
  const summary = walkSession.getPendingSummary();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!summary) {
    return <View style={styles.c}><Text style={styles.empty}>표시할 산책이 없어요.</Text>
      <Pressable style={styles.save} onPress={() => router.replace('/(app)/home')}><Text style={styles.saveText}>홈으로</Text></Pressable></View>;
  }
  const coords: LatLng[] = summary.routeGeojson.coordinates.map((c) => ({ lat: c[1], lng: c[0] }));
  const km = (summary.distanceM / 1000).toFixed(2);
  const min = Math.round(summary.durationS / 60);
  const speed = summary.durationS > 0 ? ((summary.distanceM / 1000) / (summary.durationS / 3600)).toFixed(1) : '0.0';

  async function save() {
    if (summary!.distanceM < 50 || summary!.durationS < 60) {
      const ok = await new Promise<boolean>((res) => Alert.alert('짧은 산책', '거리·시간이 매우 짧아요. 그래도 저장할까요?', [
        { text: '취소', style: 'cancel', onPress: () => res(false) }, { text: '저장', onPress: () => res(true) }]));
      if (!ok) return;
    }
    try {
      setBusy(true);
      await saveWalk({
        dogId: summary!.dogId, routeGeojson: summary!.routeGeojson,
        distanceM: summary!.distanceM, durationS: summary!.durationS,
        startedAt: summary!.startedAt, endedAt: summary!.endedAt, useForMissingSearch: consent,
      });
      await walkSession.commitSaved(); // DB 성공 후에만 버퍼 clear
      router.replace('/(app)/walk/history');
    } catch (e: any) {
      Alert.alert('저장 실패', `${e.message}\n경로는 보관돼 있어요. 다시 시도해주세요.`); // 버퍼 유지
    } finally { setBusy(false); }
  }
  function discard() {
    Alert.alert('산책 삭제', '저장하지 않고 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: async () => { await walkSession.discard(); router.replace('/(app)/home'); } }]);
  }

  return (
    <View style={styles.c}>
      <View style={styles.map}><RouteMap points={coords} /></View>
      <View style={styles.stats}>
        <View style={styles.stat}><Text style={styles.num}>{km}km</Text><Text style={styles.lbl}>거리</Text></View>
        <View style={styles.stat}><Text style={styles.num}>{min}분</Text><Text style={styles.lbl}>시간</Text></View>
        <View style={styles.stat}><Text style={styles.num}>{speed}</Text><Text style={styles.lbl}>km/h</Text></View>
      </View>
      <View style={styles.consent}>
        <Switch value={consent} onValueChange={setConsent} />
        <Text style={styles.consentText}>이 경로를 실종 수색에 활용 허용 (선택)</Text>
      </View>
      <View style={styles.row}>
        <Pressable style={styles.discard} onPress={discard}><Text style={styles.discardText}>삭제</Text></Pressable>
        <Pressable style={styles.save} disabled={busy} onPress={save}><Text style={styles.saveText}>{busy ? '저장 중...' : '저장'}</Text></Pressable>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1 }, map: { flex: 1 }, empty: { textAlign: 'center', color: '#64748b', padding: 24 },
  stats: { flexDirection: 'row', padding: 16 }, stat: { flex: 1, alignItems: 'center' },
  num: { fontSize: 22, fontWeight: '800' }, lbl: { fontSize: 11, color: '#64748b' },
  consent: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  consentText: { fontSize: 13, color: '#475569', flex: 1 },
  row: { flexDirection: 'row', gap: 10, padding: 16 },
  discard: { flex: 1, backgroundColor: '#f1f5f9', padding: 16, borderRadius: 12, alignItems: 'center' }, discardText: { color: '#64748b', fontWeight: '700' },
  save: { flex: 2, backgroundColor: '#7c3aed', padding: 16, borderRadius: 12, alignItems: 'center' }, saveText: { color: '#fff', fontWeight: '700' },
});
```

- [ ] **Step 2: tsc** — `npx tsc --noEmit` clean.

- [ ] **Step 3: Commit** — `git add "app/(app)/walk/summary.tsx" && git commit -m "feat(sp2): summary screen (singleton read, save-then-clear, retry on failure)"`

---

## Task 11: 히스토리 + 통계 (강아지명 + SVG 썸네일)

**Files:** Create `app/(app)/walk/history.tsx`.

- [ ] **Step 1: 화면 작성** — `app/(app)/walk/history.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Alert } from 'react-native';
import { listMyWalks, getWalkStats } from '../../../src/services/walks';
import { WalkWithDog, WalkStats } from '../../../src/types/db';
import { RouteThumbnail } from '../../../src/components/RouteThumbnail';

export default function WalkHistory() {
  const [stats, setStats] = useState<WalkStats | null>(null);
  const [walks, setWalks] = useState<WalkWithDog[]>([]);
  useEffect(() => {
    (async () => {
      try { setStats(await getWalkStats()); setWalks(await listMyWalks()); }
      catch (e: any) { Alert.alert('오류', e.message); }
    })();
  }, []);
  return (
    <View style={styles.c}>
      <View style={styles.grid}>
        <Stat emoji="🔥" value={`${stats?.current_streak ?? 0}일`} label="연속 기록" hi />
        <Stat value={`${((stats?.total_distance_m ?? 0) / 1000).toFixed(1)}km`} label="누적 거리" />
        <Stat value={`${stats?.total_count ?? 0}회`} label="총 산책" />
        <Stat value={`${stats?.this_week_count ?? 0}회`} label="이번 주" />
      </View>
      <Text style={styles.section}>지난 산책</Text>
      <FlatList data={walks} keyExtractor={(w) => w.id}
        ListEmptyComponent={<Text style={styles.empty}>아직 산책 기록이 없어요.</Text>}
        renderItem={({ item }) => (
          <View style={styles.rowItem}>
            <RouteThumbnail coordinates={item.route_geojson?.coordinates ?? []} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowMain}>{(item.distance_m / 1000).toFixed(2)}km · {Math.round(item.duration_s / 60)}분</Text>
              <Text style={styles.rowSub}>{new Date(item.started_at).toLocaleString('ko-KR')}{item.dog ? ` · ${item.dog.name}` : ''}</Text>
            </View>
          </View>
        )} />
    </View>
  );
}
function Stat({ emoji, value, label, hi }: { emoji?: string; value: string; label: string; hi?: boolean }) {
  return (
    <View style={[styles.stat, hi && styles.statHi]}>
      <Text style={styles.statVal}>{emoji ? `${emoji} ` : ''}{value}</Text>
      <Text style={styles.statLbl}>{label}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, padding: 16, paddingTop: 48 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { width: '48%', backgroundColor: '#f1f5f9', borderRadius: 12, padding: 14, alignItems: 'center' },
  statHi: { backgroundColor: '#f5f3ff' }, statVal: { fontSize: 20, fontWeight: '800' }, statLbl: { fontSize: 11, color: '#64748b', marginTop: 2 },
  section: { fontWeight: '800', fontSize: 16, marginTop: 20, marginBottom: 8 },
  empty: { color: '#64748b', textAlign: 'center', paddingVertical: 24 },
  rowItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  rowMain: { fontSize: 15, fontWeight: '700' }, rowSub: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
});
```

- [ ] **Step 2: tsc + 테스트** — `npx tsc --noEmit` clean; `npm test` green.

- [ ] **Step 3: Commit** — `git add "app/(app)/walk/history.tsx" && git commit -m "feat(sp2): history + stats (dog name + svg route thumbnails)"`

---

## Task 12: 홈 진입점 + 복구 배너 (공유 싱글톤)

**Files:** Modify `app/(app)/home.tsx`.

- [ ] **Step 1: import 추가 (파일 최상단의 import 구역에, 컴포넌트 밖)** — add to the TOP OF THE FILE alongside existing imports:
```tsx
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { walkSession } from '../../src/lib/activeWalk';
```

- [ ] **Step 2: 복구 감지 추가 (컴포넌트 본문 안, return 위)** — inside `Home()`, before `return`:
```tsx
  useFocusEffect(useCallback(() => {
    walkSession.recover().then((r) => {
      if (!r.found) return;
      Alert.alert('진행 중이던 산책', '저장하지 못한 산책이 있어요. 이어서 진행할까요?', [
        { text: '나중에', style: 'cancel' },
        { text: '산책 화면으로', onPress: () => router.push('/(app)/walk') },
      ]);
    });
  }, []));
```
(복구된 세션은 `walkSession` 싱글톤에 그대로 적재되므로, `/walk`는 같은 인스턴스를 읽어 이어서 진행/요약한다. finished면 walk 화면이 summary로 라우팅.)

- [ ] **Step 3: 진입 버튼 추가 (로그아웃 Pressable 위)** — add just above the 로그아웃 Pressable:
```tsx
      <Pressable style={styles.walkCta} onPress={() => router.push('/(app)/walk')}>
        <Text style={styles.walkCtaText}>🐾 산책 시작</Text>
      </Pressable>
      <Pressable style={styles.walkHist} onPress={() => router.push('/(app)/walk/history')}>
        <Text style={styles.walkHistText}>산책 기록 보기</Text>
      </Pressable>
```
Add to the StyleSheet:
```tsx
  walkCta: { backgroundColor: '#16a34a', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  walkCtaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  walkHist: { padding: 12, alignItems: 'center' }, walkHistText: { color: '#7c3aed', fontWeight: '700' },
```

- [ ] **Step 4: tsc + 테스트** — `npx tsc --noEmit` clean; `npm test` all green.

- [ ] **Step 5: Commit** — `git add "app/(app)/home.tsx" && git commit -m "feat(sp2): home walk entry + crash-recovery via shared session"`

---

## Task 13: Dev Client 빌드 + 실기기 QA (수동)

> 외부 Kakao 키 + 실기기 필요. 자동화 불가. SP1 Task 22와 합류.

- [ ] **Step 1: Kakao 키** — 카카오 개발자 콘솔 네이티브 앱 키 → `.env`의 `EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY`. iOS/Android 플랫폼 등록(`com.meongbackhome.app`).
- [ ] **Step 2: 빌드** — `npx expo prebuild --clean` → `eas build --profile development --platform ios`(또는 android).
- [ ] **Step 3: 실기기 QA 체크리스트**
  - [ ] 강아지 선택(또는 없이) → 산책 시작 → 위치 권한 프롬프트
  - [ ] 걷는 동안 지도에 경로 실시간, 거리·시간(이동 시간) 증가
  - [ ] **화면 끄고/백그라운드** 상태로 걸어도 경로 계속 기록(포그라운드 서비스 알림)
  - [ ] 일시정지 → 거리·시간 멈춤 / 재개 → 다시 증가 (일시정지 구간은 시간에 미포함)
  - [ ] 종료 → 요약(경로·거리·이동시간·평균속도), 동의 토글 OFF 기본
  - [ ] 저장 → 히스토리에 강아지명·SVG 썸네일 표시, Supabase `walk_records` 행 + `route_geojson` 확인
  - [ ] 통계: 스트릭·누적·이번 주 정확
  - [ ] 저장 중 네트워크 끊기 → "경로 보관됨, 재시도" 안내, 재시도 시 저장됨 (데이터 분실 없음)
  - [ ] 산책 중 강제 종료 → 재실행 → 홈 복구 배너 → 산책 화면에서 이어서 종료/저장 가능
  - [ ] 백그라운드 권한 거부(앱 사용 중만 허용) → 경고 후 포그라운드로 기록됨, 크래시 없음
- [ ] **Step 4: Commit** — `git add app.config.ts && git commit -m "chore(sp2): kakao key config for dev build"` (`.env`·키 파일 커밋 금지).

---

## Self-Review (작성자 점검 — Codex 반영 후)

**Codex P1 해소 확인:**
- P1-1 (bg sink) → Task 7: 태스크가 `walkSession.ingest`로 싱글톤에 직접 ingest → 즉시 AsyncStorage 영속. 화면 sink 제거. ✅
- P1-2 (복구 미연결) → Task 7/12: 단일 `activeWalk.walkSession` 싱글톤을 홈·산책화면·복구가 공유. ✅
- P1-3 (일시정지 시간) → Task 6: `movingMs` 세그먼트 누적, `getMovingSeconds`, summary `durationS`=이동시간. UI 타이머도 싱글톤 기준. ✅
- P1-4 (clear-before-save / URL param) → Task 6/10: `finish`는 clear 안 함, summary는 싱글톤 `getPendingSummary` read, DB 저장 성공 후에만 `commitSaved`로 clear, 실패 시 버퍼 유지+재시도. URL 파라미터로 경로 안 넘김. ✅
- P1-5 (전역 등록) → Task 7 Step4: `app/_layout.tsx` 최상단 import로 태스크 전역 등록. ✅
- P1-6 (Kakao API 추측) → Task 8 Step1: 코드 전 실제 export 확인 스파이크 + 폴백 명시. ✅

**Codex P2 해소:**
- 스트릭 테스트 KST → Task 3 `kstNoonNDaysAgo`(KST offset 기반). ✅
- 속도 점프 필터 → Task 4 `acceptPoint` maxSpeed + 테스트. ✅
- O(n²)/persist 경합 → Task 6 증분 ingest + 직렬 persist 체인. ✅
- bg 거부 폴백 → Task 7/9 fg-only로 진행 + 경고. ✅
- 강아지 선택/표시 → Task 9 선택 + Task 5/11 dog 조인·표시. ✅
- 히스토리 썸네일 → Task 8 RouteThumbnail + Task 11. ✅
- async-storage 설치 → Task 1 Step1 확인(SP1에서 설치됨). ✅
- Task 12 import 위치 → "파일 최상단"으로 명시. ✅
- DB 제약 → Task 2 CHECK 3종. ✅

**Spec coverage:** walk_records+RLS+stats(Task2,3), 백그라운드(1,7), 세션/복구(6,7,12), 거리·노이즈(4), 화면(9,10,11), 동의 OFF 기본(10), Kakao 첫 도입(1,8), dog 선택(9)·표시(11), 에러(권한·저장실패·짧은산책·복구)(9,10,12) 전부 매핑.

**Type consistency:** `WalkSummary`(+dogId), `SaveWalkInput`, `WalkWithDog`(dog 조인), `WalkStats`, `GeoPoint`/`LatLng`/`AcceptOpts`, `PersistAdapter`, `WALK_TASK`, 싱글톤 `walkSession` — 태스크 간 시그니처 일치.

> **알려진 한계:** 화면·지도·위치 어댑터는 tsc + 실기기 QA(Task 13). 테스트 가능한 코어(geo·walkSession·walks·stats RPC·RLS)는 TDD/통합. Kakao Map 폴리라인 API는 Task 8에서 설치 버전 확인 후 확정(폴백: 시작점 마커 + SVG 썸네일).
