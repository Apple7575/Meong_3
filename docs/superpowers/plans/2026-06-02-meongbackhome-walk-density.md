# 멍백홈 Sub-project 2 「밀도 엔진 (산책 기록)」 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 백그라운드 GPS로 산책 경로를 기록·저장하고, 통계·연속 기록(스트릭)으로 매일 쓰게 만드는 밀도 엔진을 동작하는 형태로 구축한다.

**Architecture:** 테스트 가능한 코어(거리/노이즈 계산 `geo.ts`, 산책 세션 상태 `walkSession`, 서비스 `walks.ts`, 통계 RPC)는 TDD. 백그라운드 위치는 `expo-location`+`expo-task-manager`, 지도는 `@react-native-kakao/map`. 경로는 `walk_records.route_geojson`(jsonb)에 저장하고 요약(거리·시간)은 비정규화. SP1 코드/스타일 위에 그대로 올라간다.

**Tech Stack:** Expo SDK 56 (TypeScript) · expo-router · supabase-js v2 · expo-location · expo-task-manager · @react-native-async-storage/async-storage · @react-native-kakao/core + @react-native-kakao/map · Jest · Supabase CLI(로컬)

**Branch:** `feat/walk-density` (SP1 `feat/foundation-identity` 위에서 분기됨). SP1이 main에 머지되면 rebase 고려.

---

## File Structure

```
supabase/migrations/0005_walks.sql        walk_records 테이블 + RLS
supabase/migrations/0006_walk_stats.sql    my_walk_stats() RPC
supabase/tests/walks.test.ts               walk_records RLS + my_walk_stats 통합 테스트
src/types/db.ts                            (수정) WalkRecord, WalkStats 타입 추가
src/lib/geo.ts                             순수 함수: 하버사인·노이즈필터·거리누적·GeoJSON  (TDD)
src/lib/geo.test.ts
src/lib/walkSession.ts                     산책 세션 싱글톤(상태머신·버퍼·영속·복구·리스너)
src/lib/walkSession.test.ts
src/services/walks.ts                      saveWalk/listMyWalks/deleteWalk/getWalkStats  (TDD)
src/services/walks.test.ts
src/components/RouteMap.tsx                 Kakao Map + 경로 폴리라인 렌더 (통합)
app/(app)/walk/index.tsx                   산책 시작 + 산책 중 화면
app/(app)/walk/summary.tsx                 종료 요약(동의 토글·저장/삭제)
app/(app)/walk/history.tsx                 히스토리 + 통계 대시보드
app/(app)/home.tsx                         (수정) "산책" 진입점 추가
app.config.ts                              (수정) kakao/location config plugins + 권한
```

검증 가능한 로직은 `src/lib`·`src/services`에 순수/주입형으로 두어 TDD. 지도·화면·네이티브 설정은 통합 태스크로 `tsc` + 실기기 검증.

---

## Task 1: 네이티브 의존성 + config plugins (Kakao Map · 백그라운드 위치)

**Files:** Modify `package.json`, `app.config.ts`, create `.env` 추가 키.

- [ ] **Step 1: 의존성 설치**

```bash
cd /Users/cruel/Desktop/Projects/MeongBackHome
npx expo install expo-task-manager
npm i @react-native-kakao/core @react-native-kakao/map
```

- [ ] **Step 2: `app.config.ts`에 plugins/권한 추가**

`plugins` 배열에 추가 (기존 항목 유지):
```ts
[
  '@react-native-kakao/core',
  { nativeAppKey: process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY },
],
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
And add iOS background mode to the `ios` block:
```ts
ios: {
  bundleIdentifier: 'com.meongbackhome.app',
  supportsTablet: false,
  infoPlist: { UIBackgroundModes: ['location'] },
},
```
Add to `extra`: `kakaoNativeAppKey: process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY`.

- [ ] **Step 3: `.env` / `.env.example`에 Kakao 키 추가**

Append to `.env.example`:
```
EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY=replace-with-kakao-native-app-key
```
(Put the real key in `.env`, which is gitignored. For local unit tests no real key is needed.)

- [ ] **Step 4: tsc + 기존 테스트 회귀 확인**

Run: `npx tsc --noEmit` → clean. `npm test` → 16 tests still pass.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json app.config.ts .env.example
git commit -m "chore(sp2): add kakao-map + background-location deps and config"
```

> Native build / device verification of the map + background location happens in Task 12 (manual). This task only wires deps + config.

---

## Task 2: walk_records 마이그레이션 (0005)

**Files:** Create `supabase/migrations/0005_walks.sql`.

- [ ] **Step 1: SQL 작성**

```sql
create table public.walk_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  dog_id uuid references public.dogs(id) on delete set null,
  route_geojson jsonb not null,
  distance_m double precision not null,
  duration_s int not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  use_for_missing_search boolean not null default false,
  created_at timestamptz not null default now()
);
create index walk_records_user_started_idx on public.walk_records(user_id, started_at desc);

alter table public.walk_records enable row level security;
create policy "walks_all_own" on public.walk_records for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- [ ] **Step 2: 적용 + 클린 재적용**

Run: `npx supabase migration up` (no error). Then `npx supabase db reset --no-seed` (all 5 migrations apply clean from scratch).

- [ ] **Step 3: 테이블 확인**

Run: `docker exec supabase_db_MeongBackHome psql -U postgres -c "\d public.walk_records"`
Expected: table with the columns above; RLS enabled.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0005_walks.sql
git commit -m "feat(db): walk_records table + owner-only RLS"
```

---

## Task 3: my_walk_stats() RPC + 통합 테스트 (스트릭 포함)

**Files:** Create `supabase/migrations/0006_walk_stats.sql`, `supabase/tests/walks.test.ts`.

- [ ] **Step 1: RPC SQL 작성** — `supabase/migrations/0006_walk_stats.sql`:

```sql
create or replace function public.my_walk_stats()
returns table (
  total_distance_m double precision,
  total_count int,
  this_week_count int,
  current_streak int
)
language sql security definer set search_path = public as $$
  with mine as (
    select * from public.walk_records where user_id = auth.uid()
  ),
  days as (
    select distinct ((started_at at time zone 'Asia/Seoul')::date) as d from mine
  ),
  grp as (
    select d, (d - (row_number() over (order by d))::int) as g from days
  ),
  runs as (
    select g, count(*)::int as len, max(d) as last_d from grp group by g
  ),
  latest as (
    select len, last_d from runs order by last_d desc limit 1
  )
  select
    coalesce((select sum(distance_m) from mine), 0)::double precision as total_distance_m,
    (select count(*) from mine)::int as total_count,
    (select count(*) from mine
       where (started_at at time zone 'Asia/Seoul')::date
             >= (date_trunc('week', (now() at time zone 'Asia/Seoul')))::date)::int as this_week_count,
    coalesce(
      (select len from latest
        where last_d >= (((now() at time zone 'Asia/Seoul')::date) - interval '1 day')),
      0
    )::int as current_streak;
$$;
```

Streak 로직 설명: 산책한 distinct 날짜를 모아 `d - row_number()`(연속이면 상수) gaps-and-islands로 묶고, 가장 최근 묶음의 길이를 구한다. 그 묶음의 마지막 날이 오늘 또는 어제면 그 길이가 현재 스트릭, 아니면 0. 주(this_week)는 월요일 시작(`date_trunc('week')`).

- [ ] **Step 2: 적용** — `npx supabase migration up` (no error).

- [ ] **Step 3: 실패하는 통합 테스트 작성** — `supabase/tests/walks.test.ts`:

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

// admin insert bypasses RLS; sets user_id explicitly
async function insertWalk(userId: string, startedAt: string, distanceM = 1000) {
  const { error } = await admin.from('walk_records').insert({
    user_id: userId, dog_id: null,
    route_geojson: { type: 'LineString', coordinates: [[127, 37], [127.001, 37.001]] },
    distance_m: distanceM, duration_s: 600,
    started_at: startedAt, ended_at: startedAt,
  });
  if (error) throw error;
}

function kstDateNDaysAgo(n: number): string {
  // build an ISO timestamp at 12:00 KST, n days before "today" — computed from server now via a fixed offset
  const now = new Date();
  const d = new Date(now.getTime() - n * 24 * 3600 * 1000);
  // noon UTC is safely within the same KST day for our assertions
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 3, 0, 0)).toISOString();
}

describe('walk_records RLS + my_walk_stats', () => {
  let alice: { id: string; client: SupabaseClient };
  let bob: { id: string; client: SupabaseClient };

  beforeAll(async () => {
    const stamp = Date.now();
    alice = await makeUser(`wa-${stamp}@test.dev`);
    bob = await makeUser(`wb-${stamp}@test.dev`);
    // alice: walks today, yesterday, 2-days-ago (streak 3), plus one 10 days ago (breaks)
    await insertWalk(alice.id, kstDateNDaysAgo(0), 1500);
    await insertWalk(alice.id, kstDateNDaysAgo(1), 1000);
    await insertWalk(alice.id, kstDateNDaysAgo(2), 500);
    await insertWalk(alice.id, kstDateNDaysAgo(10), 2000);
  });

  test('alice cannot see bob walks (RLS)', async () => {
    await insertWalk(bob.id, kstDateNDaysAgo(0));
    const { data } = await alice.client.from('walk_records').select('*');
    expect(data?.every((w: any) => w.user_id === alice.id)).toBe(true);
  });

  test('my_walk_stats totals + streak', async () => {
    const { data, error } = await alice.client.rpc('my_walk_stats').single();
    expect(error).toBeNull();
    const s = data as any;
    expect(s.total_count).toBe(4);
    expect(s.total_distance_m).toBeCloseTo(5000, 0);
    expect(s.current_streak).toBe(3); // today + yesterday + 2-days-ago consecutive
  });
});
```

- [ ] **Step 4: 실행 — 통과 확인** (로컬 Supabase 실행 중이어야 함)

Run: `npx jest --config supabase/tests/jest.rls.config.js`
Expected: walks tests PASS (plus the existing rls.test.ts). If streak ≠ 3, fix the RPC SQL — not the test.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0006_walk_stats.sql supabase/tests/walks.test.ts
git commit -m "feat(db): my_walk_stats RPC (totals + KST streak) with integration tests"
```

---

## Task 4: geo.ts 순수 함수 (TDD)

**Files:** Create `src/lib/geo.ts`, `src/lib/geo.test.ts`.

- [ ] **Step 1: 실패하는 테스트** — `src/lib/geo.test.ts`:

```ts
import { haversineMeters, filterNoise, accumulateDistance, toGeoJSONLineString, GeoPoint } from './geo';

describe('geo', () => {
  test('haversine ~111km per 1° latitude', () => {
    const d = haversineMeters({ lat: 37, lng: 127 }, { lat: 38, lng: 127 });
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });
  test('haversine ~0 for same point', () => {
    expect(haversineMeters({ lat: 37, lng: 127 }, { lat: 37, lng: 127 })).toBeCloseTo(0, 5);
  });
  test('filterNoise drops low-accuracy points', () => {
    const pts: GeoPoint[] = [
      { lat: 37, lng: 127, accuracy: 5, t: 1 },
      { lat: 37.01, lng: 127, accuracy: 99, t: 2 }, // bad accuracy → dropped
    ];
    expect(filterNoise(pts).length).toBe(1);
  });
  test('filterNoise drops jitter under minMove', () => {
    const pts: GeoPoint[] = [
      { lat: 37, lng: 127, accuracy: 5, t: 1 },
      { lat: 37.000001, lng: 127, accuracy: 5, t: 2 }, // ~0.1m → dropped
      { lat: 37.001, lng: 127, accuracy: 5, t: 3 },    // ~111m → kept
    ];
    expect(filterNoise(pts).length).toBe(2);
  });
  test('accumulateDistance sums consecutive legs', () => {
    const d = accumulateDistance([{ lat: 37, lng: 127 }, { lat: 37.001, lng: 127 }, { lat: 37.002, lng: 127 }]);
    expect(d).toBeGreaterThan(220);
    expect(d).toBeLessThan(225);
  });
  test('toGeoJSONLineString uses [lng,lat] order', () => {
    expect(toGeoJSONLineString([{ lat: 37, lng: 127 }])).toEqual({ type: 'LineString', coordinates: [[127, 37]] });
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx jest src/lib/geo.test.ts` → FAIL (module not found).

- [ ] **Step 3: 구현** — `src/lib/geo.ts`:

```ts
export type LatLng = { lat: number; lng: number };
export type GeoPoint = LatLng & { accuracy?: number; t: number };

const EARTH_R = 6371000;
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

export type NoiseFilterOpts = { maxAccuracy?: number; minMoveMeters?: number };
export function filterNoise(points: GeoPoint[], opts: NoiseFilterOpts = {}): GeoPoint[] {
  const maxAccuracy = opts.maxAccuracy ?? 30;
  const minMove = opts.minMoveMeters ?? 5;
  const out: GeoPoint[] = [];
  for (const p of points) {
    if (p.accuracy != null && p.accuracy > maxAccuracy) continue;
    if (out.length === 0) { out.push(p); continue; }
    if (haversineMeters(out[out.length - 1], p) >= minMove) out.push(p);
  }
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

- [ ] **Step 4: 통과 확인** — `npx jest src/lib/geo.test.ts` → PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/geo.ts src/lib/geo.test.ts
git commit -m "feat(sp2): geo utils (haversine, noise filter, distance) TDD"
```

---

## Task 5: WalkRecord/WalkStats 타입 + walks 서비스 (TDD)

**Files:** Modify `src/types/db.ts`; create `src/services/walks.ts`, `src/services/walks.test.ts`.

- [ ] **Step 1: 타입 추가** — append to `src/types/db.ts`:

```ts
export type WalkRecord = {
  id: string; user_id: string; dog_id: string | null;
  route_geojson: unknown; distance_m: number; duration_s: number;
  started_at: string; ended_at: string; use_for_missing_search: boolean; created_at: string;
};
export type WalkStats = {
  total_distance_m: number; total_count: number; this_week_count: number; current_streak: number;
};
```

- [ ] **Step 2: 실패하는 테스트** — `src/services/walks.test.ts`:

```ts
import { saveWalk, listMyWalks, deleteWalk, getWalkStats } from './walks';

const mockSingle = jest.fn();
const mockInsertSelectSingle = { select: jest.fn(() => ({ single: mockSingle })) };
const mockInsert = jest.fn(() => mockInsertSelectSingle);
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

test('saveWalk inserts with user_id and returns id', async () => {
  mockSingle.mockResolvedValueOnce({ data: { id: 'w1' }, error: null });
  const id = await saveWalk({
    dogId: null, routeGeojson: { type: 'LineString', coordinates: [] },
    distanceM: 1234, durationS: 600, startedAt: '2026-06-02T00:00:00Z',
    endedAt: '2026-06-02T00:10:00Z', useForMissingSearch: false,
  });
  expect(mockFrom).toHaveBeenCalledWith('walk_records');
  expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
    user_id: 'u1', dog_id: null, distance_m: 1234, duration_s: 600, use_for_missing_search: false,
  }));
  expect(id).toBe('w1');
});

test('listMyWalks queries own walks ordered by started_at desc', async () => {
  mockOrder.mockResolvedValueOnce({ data: [{ id: 'w1' }], error: null });
  const rows = await listMyWalks();
  expect(mockEqList).toHaveBeenCalledWith('user_id', 'u1');
  expect(mockOrder).toHaveBeenCalledWith('started_at', { ascending: false });
  expect(rows).toHaveLength(1);
});

test('deleteWalk deletes by id', async () => {
  mockEqDelete.mockResolvedValueOnce({ error: null });
  await deleteWalk('w1');
  expect(mockFrom).toHaveBeenCalledWith('walk_records');
  expect(mockEqDelete).toHaveBeenCalledWith('id', 'w1');
});

test('getWalkStats calls RPC and returns row', async () => {
  mockRpc.mockReturnValueOnce({ single: jest.fn(async () => ({ data: { total_count: 3, current_streak: 2, total_distance_m: 100, this_week_count: 1 }, error: null })) });
  const s = await getWalkStats();
  expect(mockRpc).toHaveBeenCalledWith('my_walk_stats');
  expect(s.current_streak).toBe(2);
});
```

- [ ] **Step 3: 실패 확인** — `npx jest src/services/walks.test.ts` → FAIL.

- [ ] **Step 4: 구현** — `src/services/walks.ts`:

```ts
import { supabase } from '../lib/supabase';
import { WalkRecord, WalkStats } from '../types/db';

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) throw new Error('로그인이 필요합니다.');
  return data.user.id;
}

export type SaveWalkInput = {
  dogId: string | null;
  routeGeojson: unknown;
  distanceM: number;
  durationS: number;
  startedAt: string;
  endedAt: string;
  useForMissingSearch: boolean;
};

export async function saveWalk(input: SaveWalkInput): Promise<string> {
  const user_id = await uid();
  const { data, error } = await supabase
    .from('walk_records')
    .insert({
      user_id,
      dog_id: input.dogId,
      route_geojson: input.routeGeojson,
      distance_m: input.distanceM,
      duration_s: input.durationS,
      started_at: input.startedAt,
      ended_at: input.endedAt,
      use_for_missing_search: input.useForMissingSearch,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function listMyWalks(): Promise<WalkRecord[]> {
  const user_id = await uid();
  const { data, error } = await supabase
    .from('walk_records').select('*').eq('user_id', user_id).order('started_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as WalkRecord[];
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

- [ ] **Step 5: 통과 확인** — `npx jest src/services/walks.test.ts` → PASS (4 tests). Then `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/types/db.ts src/services/walks.ts src/services/walks.test.ts
git commit -m "feat(sp2): walks service (save/list/delete/stats) TDD"
```

---

## Task 6: 산책 세션 싱글톤 walkSession (TDD)

**Files:** Create `src/lib/walkSession.ts`, `src/lib/walkSession.test.ts`.

세션 코어는 **위치 소스/저장소를 주입**받는 순수 로직으로 만들어 TDD하고, 실제 expo-location/AsyncStorage 연결은 얇은 어댑터로 둔다(어댑터는 실기기에서 검증).

- [ ] **Step 1: 실패하는 테스트** — `src/lib/walkSession.test.ts`:

```ts
import { WalkSession, PersistAdapter } from './walkSession';
import { GeoPoint } from './geo';

function memoryStore(): PersistAdapter & { dump: () => string | null } {
  let v: string | null = null;
  return {
    save: async (s) => { v = s; },
    load: async () => v,
    clear: async () => { v = null; },
    dump: () => v,
  };
}

test('records points and computes distance, ignoring jitter', async () => {
  const store = memoryStore();
  const s = new WalkSession(store);
  await s.start('2026-06-02T00:00:00Z');
  s.addPoint({ lat: 37, lng: 127, accuracy: 5, t: 1 });
  s.addPoint({ lat: 37.000001, lng: 127, accuracy: 5, t: 2 }); // jitter, ignored
  s.addPoint({ lat: 37.001, lng: 127, accuracy: 5, t: 3 });    // ~111m
  expect(s.getDistanceM()).toBeGreaterThan(110);
  expect(s.getPoints().length).toBe(2);
});

test('pause stops accumulating distance', async () => {
  const store = memoryStore();
  const s = new WalkSession(store);
  await s.start('2026-06-02T00:00:00Z');
  s.addPoint({ lat: 37, lng: 127, accuracy: 5, t: 1 });
  s.pause();
  s.addPoint({ lat: 38, lng: 127, accuracy: 5, t: 2 }); // dropped while paused
  expect(s.getPoints().length).toBe(1);
  s.resume();
  s.addPoint({ lat: 37.001, lng: 127, accuracy: 5, t: 3 });
  expect(s.getPoints().length).toBe(2);
});

test('persists to store on each point and recovers', async () => {
  const store = memoryStore();
  const s = new WalkSession(store);
  await s.start('2026-06-02T00:00:00Z');
  s.addPoint({ lat: 37, lng: 127, accuracy: 5, t: 1 });
  expect(store.dump()).not.toBeNull();

  const recovered = new WalkSession(store);
  const found = await recovered.recover();
  expect(found).toBe(true);
  expect(recovered.getPoints().length).toBe(1);
});

test('stop returns summary and clears store', async () => {
  const store = memoryStore();
  const s = new WalkSession(store);
  await s.start('2026-06-02T00:00:00Z');
  s.addPoint({ lat: 37, lng: 127, accuracy: 5, t: 1 });
  s.addPoint({ lat: 37.001, lng: 127, accuracy: 5, t: 2 });
  const summary = await s.stop('2026-06-02T00:10:00Z');
  expect(summary.distanceM).toBeGreaterThan(110);
  expect(summary.routeGeojson.type).toBe('LineString');
  expect(summary.startedAt).toBe('2026-06-02T00:00:00Z');
  expect(await store.load()).toBeNull();
});

test('notifies listeners on point', async () => {
  const store = memoryStore();
  const s = new WalkSession(store);
  const seen: number[] = [];
  s.subscribe(() => seen.push(s.getPoints().length));
  await s.start('2026-06-02T00:00:00Z');
  s.addPoint({ lat: 37, lng: 127, accuracy: 5, t: 1 });
  expect(seen[seen.length - 1]).toBe(1);
});
```

- [ ] **Step 2: 실패 확인** — `npx jest src/lib/walkSession.test.ts` → FAIL.

- [ ] **Step 3: 구현** — `src/lib/walkSession.ts`:

```ts
import { GeoPoint, LatLng, filterNoise, accumulateDistance, toGeoJSONLineString } from './geo';

export type PersistAdapter = {
  save: (serialized: string) => Promise<void>;
  load: () => Promise<string | null>;
  clear: () => Promise<void>;
};

export type WalkSummary = {
  routeGeojson: { type: 'LineString'; coordinates: number[][] };
  distanceM: number;
  durationS: number;
  startedAt: string;
  endedAt: string;
};

type State = 'idle' | 'recording' | 'paused';
type Snapshot = { startedAt: string; points: GeoPoint[] };

export class WalkSession {
  private state: State = 'idle';
  private startedAt: string | null = null;
  private points: GeoPoint[] = [];
  private listeners = new Set<() => void>();

  constructor(private store: PersistAdapter) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() { this.listeners.forEach((l) => l()); }

  async start(startedAt: string): Promise<void> {
    this.state = 'recording';
    this.startedAt = startedAt;
    this.points = [];
    await this.persist();
    this.emit();
  }

  addPoint(p: GeoPoint): void {
    if (this.state !== 'recording') return;
    const candidate = filterNoise([...this.points, p]);
    if (candidate.length > this.points.length) {
      this.points = candidate;
      void this.persist();
      this.emit();
    }
  }

  pause(): void { if (this.state === 'recording') { this.state = 'paused'; this.emit(); } }
  resume(): void { if (this.state === 'paused') { this.state = 'recording'; this.emit(); } }

  getPoints(): GeoPoint[] { return this.points; }
  getDistanceM(): number { return accumulateDistance(this.points); }
  getState(): State { return this.state; }
  getStartedAt(): string | null { return this.startedAt; }

  async stop(endedAt: string): Promise<WalkSummary> {
    const startedAt = this.startedAt ?? endedAt;
    const coords: LatLng[] = this.points.map((p) => ({ lat: p.lat, lng: p.lng }));
    const summary: WalkSummary = {
      routeGeojson: toGeoJSONLineString(coords),
      distanceM: accumulateDistance(coords),
      durationS: Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)),
      startedAt,
      endedAt,
    };
    this.state = 'idle';
    this.startedAt = null;
    this.points = [];
    await this.store.clear();
    this.emit();
    return summary;
  }

  async recover(): Promise<boolean> {
    const raw = await this.store.load();
    if (!raw) return false;
    const snap = JSON.parse(raw) as Snapshot;
    this.startedAt = snap.startedAt;
    this.points = snap.points;
    this.state = 'paused'; // recovered walks start paused for user to decide
    this.emit();
    return true;
  }

  private async persist(): Promise<void> {
    if (!this.startedAt) return;
    const snap: Snapshot = { startedAt: this.startedAt, points: this.points };
    await this.store.save(JSON.stringify(snap));
  }
}
```

- [ ] **Step 4: 통과 확인** — `npx jest src/lib/walkSession.test.ts` → PASS (5 tests). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/walkSession.ts src/lib/walkSession.test.ts
git commit -m "feat(sp2): WalkSession state machine + persistence/recovery TDD"
```

---

## Task 7: 위치/저장 어댑터 (expo-location + AsyncStorage + TaskManager)

**Files:** Create `src/lib/walkLocation.ts`. (얇은 통합 어댑터 — 실기기 검증, 단위 테스트는 walkSession 측에서 끝냈으므로 여기선 tsc만.)

- [ ] **Step 1: 구현** — `src/lib/walkLocation.ts`:

```ts
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PersistAdapter } from './walkSession';
import { GeoPoint } from './geo';

export const WALK_TASK = 'meong-walk-location';
const STORE_KEY = 'meong.walk.inprogress';

export const asyncStorageAdapter: PersistAdapter = {
  save: (s) => AsyncStorage.setItem(STORE_KEY, s),
  load: () => AsyncStorage.getItem(STORE_KEY),
  clear: () => AsyncStorage.removeItem(STORE_KEY),
};

// The background task forwards points via this module-level callback,
// set by the walk screen while a walk is active.
let onLocations: ((pts: GeoPoint[]) => void) | null = null;
export function setLocationSink(fn: ((pts: GeoPoint[]) => void) | null) { onLocations = fn; }

TaskManager.defineTask(WALK_TASK, ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  const pts: GeoPoint[] = locations.map((l) => ({
    lat: l.coords.latitude, lng: l.coords.longitude,
    accuracy: l.coords.accuracy ?? undefined, t: l.timestamp,
  }));
  onLocations?.(pts);
});

export async function requestWalkPermissions(): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return false;
  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.status === 'granted';
}

export async function startWalkUpdates(): Promise<void> {
  await Location.startLocationUpdatesAsync(WALK_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 3000,
    distanceInterval: 5,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: '산책 기록 중',
      notificationBody: '멍백홈이 산책 경로를 기록하고 있어요.',
    },
  });
}

export async function stopWalkUpdates(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(WALK_TASK)) {
    await Location.stopLocationUpdatesAsync(WALK_TASK);
  }
}
```

- [ ] **Step 2: tsc + 회귀 테스트** — `npx tsc --noEmit` clean; `npm test` still green (this file has no unit test; it's a device-verified adapter).

- [ ] **Step 3: Commit**

```bash
git add src/lib/walkLocation.ts
git commit -m "feat(sp2): expo-location/task-manager + AsyncStorage walk adapter"
```

---

## Task 8: RouteMap 컴포넌트 (Kakao Map + 폴리라인)

**Files:** Create `src/components/RouteMap.tsx`. 통합 컴포넌트 — 실기기 검증. 구현 시 설치된 `@react-native-kakao/map` 버전의 정확한 폴리라인 API를 패키지 타입/문서에서 확인할 것.

- [ ] **Step 1: 컴포넌트 작성** — `src/components/RouteMap.tsx`:

```tsx
import { StyleSheet, View } from 'react-native';
import { KakaoMapView, MapPolyline } from '@react-native-kakao/map';
import { LatLng } from '../lib/geo';

type Props = { points: LatLng[]; followLast?: boolean };

/**
 * 경로 폴리라인을 그리는 지도. points가 비면 기본 좌표(서울 노원구)로 표시.
 * 주의: 설치된 @react-native-kakao/map 버전의 폴리라인 컴포넌트/프롭 이름을
 * 패키지 d.ts에서 확인하고 맞출 것. 아래는 일반적 형태.
 */
export function RouteMap({ points, followLast }: Props) {
  const center = points.length
    ? points[points.length - 1]
    : { lat: 37.6542, lng: 127.0568 }; // 노원구 기본
  return (
    <View style={styles.fill}>
      <KakaoMapView
        style={styles.fill}
        initialRegion={{ latitude: center.lat, longitude: center.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
      >
        {points.length > 1 && (
          <MapPolyline
            coordinates={points.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
            strokeColor="#7c3aed"
            strokeWidth={5}
          />
        )}
      </KakaoMapView>
    </View>
  );
}
const styles = StyleSheet.create({ fill: { flex: 1 } });
```

- [ ] **Step 2: tsc** — `npx tsc --noEmit`. If the import names (`KakaoMapView`/`MapPolyline`) differ in the installed version, fix them to match the package's exported names so tsc is clean. Do NOT leave broken imports.

- [ ] **Step 3: Commit**

```bash
git add src/components/RouteMap.tsx
git commit -m "feat(sp2): RouteMap component (kakao map + route polyline)"
```

---

## Task 9: 산책 중 화면 (시작 + 진행)

**Files:** Create `app/(app)/walk/index.tsx`.

- [ ] **Step 1: 화면 작성** — `app/(app)/walk/index.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Alert, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { RouteMap } from '../../../src/components/RouteMap';
import { WalkSession } from '../../../src/lib/walkSession';
import { asyncStorageAdapter, requestWalkPermissions, startWalkUpdates, stopWalkUpdates, setLocationSink } from '../../../src/lib/walkLocation';
import { LatLng } from '../../../src/lib/geo';

const session = new WalkSession(asyncStorageAdapter);

export default function WalkScreen() {
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [points, setPoints] = useState<LatLng[]>([]);
  const [distanceM, setDistanceM] = useState(0);
  const startRef = useRef<number>(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const unsub = session.subscribe(() => {
      setPoints(session.getPoints().map((p) => ({ lat: p.lat, lng: p.lng })));
      setDistanceM(session.getDistanceM());
      setRecording(session.getState() !== 'idle');
      setPaused(session.getState() === 'paused');
    });
    setLocationSink((pts) => pts.forEach((p) => session.addPoint(p)));
    return () => { unsub(); setLocationSink(null); };
  }, []);

  useEffect(() => {
    if (!recording || paused) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [recording, paused]);

  async function start() {
    const ok = await requestWalkPermissions();
    if (!ok) { Alert.alert('위치 권한 필요', '백그라운드 위치 권한을 허용해야 산책을 기록할 수 있어요. 설정에서 허용해주세요.'); return; }
    startRef.current = Date.now();
    await session.start(new Date(startRef.current).toISOString());
    await startWalkUpdates();
  }
  async function finish() {
    await stopWalkUpdates();
    const summary = await session.stop(new Date().toISOString());
    router.push({ pathname: '/(app)/walk/summary', params: {
      distanceM: String(Math.round(summary.distanceM)),
      durationS: String(summary.durationS),
      startedAt: summary.startedAt, endedAt: summary.endedAt,
      route: JSON.stringify(summary.routeGeojson),
    } });
  }

  const km = (distanceM / 1000).toFixed(2);
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <View style={styles.c}>
      <View style={styles.map}><RouteMap points={points} followLast /></View>
      <View style={styles.stats}>
        <View style={styles.stat}><Text style={styles.statNum}>{km}<Text style={styles.unit}>km</Text></Text><Text style={styles.statLabel}>거리</Text></View>
        <View style={styles.stat}><Text style={styles.statNum}>{mmss}</Text><Text style={styles.statLabel}>시간</Text></View>
      </View>
      {!recording ? (
        <Pressable style={styles.start} onPress={start}><Text style={styles.startText}>산책 시작</Text></Pressable>
      ) : (
        <View style={styles.row}>
          <Pressable style={styles.pause} onPress={() => (paused ? session.resume() : session.pause())}>
            <Text style={styles.pauseText}>{paused ? '▶ 재개' : '⏸ 일시정지'}</Text>
          </Pressable>
          <Pressable style={styles.stop} onPress={finish}><Text style={styles.stopText}>⏹ 종료</Text></Pressable>
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1 },
  map: { flex: 1 },
  stats: { flexDirection: 'row', padding: 16 },
  stat: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 28, fontWeight: '800' },
  unit: { fontSize: 13 },
  statLabel: { fontSize: 12, color: '#64748b' },
  start: { backgroundColor: '#7c3aed', margin: 16, padding: 16, borderRadius: 12, alignItems: 'center' },
  startText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  row: { flexDirection: 'row', gap: 10, padding: 16 },
  pause: { flex: 1, backgroundColor: '#f1f5f9', padding: 16, borderRadius: 12, alignItems: 'center' },
  pauseText: { fontWeight: '700' },
  stop: { flex: 1, backgroundColor: '#ef4444', padding: 16, borderRadius: 12, alignItems: 'center' },
  stopText: { color: '#fff', fontWeight: '700' },
});
```

- [ ] **Step 2: tsc** — `npx tsc --noEmit` clean.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/walk/index.tsx"
git commit -m "feat(sp2): walk in-progress screen (start/pause/stop + live map)"
```

---

## Task 10: 종료 요약 화면 (동의 토글 + 저장)

**Files:** Create `app/(app)/walk/summary.tsx`.

- [ ] **Step 1: 화면 작성** — `app/(app)/walk/summary.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, Pressable, Switch, Alert, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { RouteMap } from '../../../src/components/RouteMap';
import { saveWalk } from '../../../src/services/walks';
import { LatLng } from '../../../src/lib/geo';

export default function WalkSummary() {
  const p = useLocalSearchParams<{ distanceM: string; durationS: string; startedAt: string; endedAt: string; route: string }>();
  const route = JSON.parse(p.route || '{"type":"LineString","coordinates":[]}');
  const coords: LatLng[] = (route.coordinates || []).map((c: number[]) => ({ lat: c[1], lng: c[0] }));
  const distanceM = Number(p.distanceM || 0);
  const durationS = Number(p.durationS || 0);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  const km = (distanceM / 1000).toFixed(2);
  const min = Math.round(durationS / 60);
  const speed = durationS > 0 ? ((distanceM / 1000) / (durationS / 3600)).toFixed(1) : '0.0';

  async function save() {
    if (distanceM < 50 || durationS < 60) {
      const ok = await new Promise<boolean>((res) => Alert.alert('짧은 산책', '거리·시간이 매우 짧아요. 그래도 저장할까요?', [
        { text: '취소', style: 'cancel', onPress: () => res(false) },
        { text: '저장', onPress: () => res(true) },
      ]));
      if (!ok) return;
    }
    try {
      setBusy(true);
      await saveWalk({
        dogId: null, routeGeojson: route, distanceM, durationS,
        startedAt: p.startedAt, endedAt: p.endedAt, useForMissingSearch: consent,
      });
      router.replace('/(app)/walk/history');
    } catch (e: any) { Alert.alert('저장 실패', e.message); }
    finally { setBusy(false); }
  }
  function discard() {
    Alert.alert('산책 삭제', '이 산책을 저장하지 않고 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => router.replace('/(app)/home') },
    ]);
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
  c: { flex: 1 },
  map: { flex: 1 },
  stats: { flexDirection: 'row', padding: 16 },
  stat: { flex: 1, alignItems: 'center' },
  num: { fontSize: 22, fontWeight: '800' },
  lbl: { fontSize: 11, color: '#64748b' },
  consent: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  consentText: { fontSize: 13, color: '#475569', flex: 1 },
  row: { flexDirection: 'row', gap: 10, padding: 16 },
  discard: { flex: 1, backgroundColor: '#f1f5f9', padding: 16, borderRadius: 12, alignItems: 'center' },
  discardText: { color: '#64748b', fontWeight: '700' },
  save: { flex: 2, backgroundColor: '#7c3aed', padding: 16, borderRadius: 12, alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '700' },
});
```

- [ ] **Step 2: tsc** — `npx tsc --noEmit` clean.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/walk/summary.tsx"
git commit -m "feat(sp2): walk summary screen (consent toggle + save)"
```

---

## Task 11: 히스토리 + 통계 화면

**Files:** Create `app/(app)/walk/history.tsx`.

- [ ] **Step 1: 화면 작성** — `app/(app)/walk/history.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Alert } from 'react-native';
import { listMyWalks, getWalkStats } from '../../../src/services/walks';
import { WalkRecord, WalkStats } from '../../../src/types/db';

export default function WalkHistory() {
  const [stats, setStats] = useState<WalkStats | null>(null);
  const [walks, setWalks] = useState<WalkRecord[]>([]);

  useEffect(() => {
    (async () => {
      try {
        setStats(await getWalkStats());
        setWalks(await listMyWalks());
      } catch (e: any) { Alert.alert('오류', e.message); }
    })();
  }, []);

  return (
    <View style={styles.c}>
      <View style={styles.grid}>
        <Stat emoji="🔥" value={`${stats?.current_streak ?? 0}일`} label="연속 기록" highlight />
        <Stat value={`${((stats?.total_distance_m ?? 0) / 1000).toFixed(1)}km`} label="누적 거리" />
        <Stat value={`${stats?.total_count ?? 0}회`} label="총 산책" />
        <Stat value={`${stats?.this_week_count ?? 0}회`} label="이번 주" />
      </View>
      <Text style={styles.section}>지난 산책</Text>
      <FlatList
        data={walks}
        keyExtractor={(w) => w.id}
        ListEmptyComponent={<Text style={styles.empty}>아직 산책 기록이 없어요.</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.rowMain}>{(item.distance_m / 1000).toFixed(2)}km · {Math.round(item.duration_s / 60)}분</Text>
            <Text style={styles.rowSub}>{new Date(item.started_at).toLocaleString('ko-KR')}</Text>
          </View>
        )}
      />
    </View>
  );
}
function Stat({ emoji, value, label, highlight }: { emoji?: string; value: string; label: string; highlight?: boolean }) {
  return (
    <View style={[styles.stat, highlight && styles.statHi]}>
      <Text style={styles.statVal}>{emoji ? `${emoji} ` : ''}{value}</Text>
      <Text style={styles.statLbl}>{label}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, padding: 16, paddingTop: 48 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { width: '48%', backgroundColor: '#f1f5f9', borderRadius: 12, padding: 14, alignItems: 'center' },
  statHi: { backgroundColor: '#f5f3ff' },
  statVal: { fontSize: 20, fontWeight: '800' },
  statLbl: { fontSize: 11, color: '#64748b', marginTop: 2 },
  section: { fontWeight: '800', fontSize: 16, marginTop: 20, marginBottom: 8 },
  empty: { color: '#64748b', textAlign: 'center', paddingVertical: 24 },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  rowMain: { fontSize: 15, fontWeight: '700' },
  rowSub: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
});
```

- [ ] **Step 2: tsc** — `npx tsc --noEmit` clean; `npm test` green.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/walk/history.tsx"
git commit -m "feat(sp2): walk history + stats dashboard screen"
```

---

## Task 12: 홈 진입점 + 강제 종료 복구 배너

**Files:** Modify `app/(app)/home.tsx`.

- [ ] **Step 1: 홈에 "산책" 진입 + 복구 감지 추가** — modify `app/(app)/home.tsx`. Add imports and, inside the component, a recovery check + two navigation buttons. Add at the top of the component body:

```tsx
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { WalkSession } from '../../src/lib/walkSession';
import { asyncStorageAdapter } from '../../src/lib/walkLocation';
```
Add inside `Home()` before `return`:
```tsx
  useFocusEffect(useCallback(() => {
    const s = new WalkSession(asyncStorageAdapter);
    s.recover().then((found) => {
      if (found) {
        Alert.alert('진행 중이던 산책', '저장하지 못한 산책이 있어요. 이어서 종료할까요?', [
          { text: '나중에', style: 'cancel' },
          { text: '산책 화면으로', onPress: () => router.push('/(app)/walk') },
        ]);
      }
    });
  }, []));
```
Add the two entry buttons just above the existing 로그아웃 Pressable:
```tsx
      <Pressable style={styles.walkCta} onPress={() => router.push('/(app)/walk')}>
        <Text style={styles.walkCtaText}>🐾 산책 시작</Text>
      </Pressable>
      <Pressable style={styles.walkHist} onPress={() => router.push('/(app)/walk/history')}>
        <Text style={styles.walkHistText}>산책 기록 보기</Text>
      </Pressable>
```
Add styles to the existing StyleSheet:
```tsx
  walkCta: { backgroundColor: '#16a34a', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  walkCtaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  walkHist: { padding: 12, alignItems: 'center' },
  walkHistText: { color: '#7c3aed', fontWeight: '700' },
```

- [ ] **Step 2: tsc + 회귀 테스트** — `npx tsc --noEmit` clean; `npm test` all green (16 + new unit tests).

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/home.tsx"
git commit -m "feat(sp2): home walk entry points + crash-recovery banner"
```

---

## Task 13: Dev Client 빌드 + 실기기 QA (수동)

> 외부 키(Kakao) + 실기기 필요. 자동화 불가, 체크리스트로 수행. SP1 Task 22와 합류.

**Files:** Modify `app.config.ts`(Kakao 키 경로 확인), `.env`(Kakao 키).

- [ ] **Step 1: Kakao 키 발급** — Kakao 개발자 콘솔에서 네이티브 앱 키 발급 → `.env`의 `EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY`에 입력. iOS/Android 플랫폼 등록(번들ID/패키지명 `com.meongbackhome.app`).
- [ ] **Step 2: prebuild + Dev Client 빌드** — `npx expo prebuild --clean` → `eas build --profile development --platform ios`(또는 android).
- [ ] **Step 3: 실기기 QA 체크리스트**
  - [ ] 산책 시작 → 위치 권한(항상 허용/백그라운드) 프롬프트 → 허용
  - [ ] 걷는 동안 지도에 경로 폴리라인이 실시간으로 그려짐, 거리·시간 증가
  - [ ] **폰 화면을 끄고/앱을 백그라운드로** 두고 걸어도 경로가 계속 기록됨(포그라운드 서비스 알림 표시)
  - [ ] 일시정지 → 거리 멈춤 / 재개 → 다시 증가
  - [ ] 종료 → 요약 화면에 경로·거리·시간, 동의 토글 OFF 기본
  - [ ] 저장 → 히스토리에 표시, Supabase `walk_records`에 행 + `route_geojson` 확인
  - [ ] 통계: 연속 기록(스트릭)·누적 거리·이번 주 숫자가 맞음
  - [ ] 산책 중 앱 강제 종료 후 재실행 → 홈에서 "진행 중이던 산책" 복구 배너
  - [ ] 권한 거부 시 안내 메시지, 앱은 크래시 없이 동작
- [ ] **Step 4: Commit (설정 변경분)** — `git add app.config.ts && git commit -m "chore(sp2): kakao key config for dev build"` (`.env`·키 파일은 커밋 금지).

---

## Self-Review (작성자 점검)

**1. Spec coverage:**
- walk_records + RLS + my_walk_stats(스트릭) → Task 2, 3 ✅
- 백그라운드 추적(expo-location+task-manager, 포그라운드 서비스) → Task 1, 7 ✅
- 세션 상태/버퍼/영속/복구 → Task 6 (+ 복구 UI Task 12) ✅
- 거리·노이즈 필터 → Task 4 ✅
- 화면(산책 중/요약/히스토리·통계) → Task 9, 10, 11 ✅
- 동의 토글 기본 OFF → Task 10 ✅
- Kakao Map 첫 도입 → Task 1(config), Task 8(컴포넌트) ✅
- dog_id 선택 → Task 2(nullable), saveWalk dogId 파라미터 ✅ (현재 화면은 dogId=null 전달; 강아지 선택 UI는 후속 — 스펙은 "선택"이라 충족)
- 에러 처리(권한 거부·저장 실패·짧은 산책) → Task 9(권한)·10(저장 실패 Alert) ✅. 짧은 산책 경고는 미반영 → 아래 갭 참조.

**갭 발견 & 처리:**
- **짧은 산책 경고(<1분/<50m)**: Task 10 `save()` 첫 줄에 가드를 직접 포함시켜 해결(플랜 코드에 반영됨).
- **dogId 선택 UI**: SP2 화면은 dogId=null로 저장한다(스펙의 "선택" 요건 충족). 산책에 강아지 연결 UI는 후속 개선으로 남긴다 — 스펙 위반 아님.

**2. Placeholder scan:** 코드 스텝은 전부 실제 코드. Task 8(RouteMap)·Task 1(Kakao plugin)은 "설치된 패키지 API 확인" 지시가 있으나 이는 외부 SDK 통합의 정상 절차이며 TDD 대상 아님(실기기 검증). RPC·서비스·세션·geo는 완전한 코드+테스트.

**3. Type consistency:** `WalkSummary`(routeGeojson/distanceM/durationS/startedAt/endedAt), `SaveWalkInput`(dogId/routeGeojson/distanceM/...), `WalkStats`(total_distance_m/total_count/this_week_count/current_streak), `GeoPoint`/`LatLng`, `PersistAdapter`(save/load/clear), `WALK_TASK` — 태스크 간 시그니처 일치 확인. summary 화면이 넘기는 params 키(distanceM/durationS/startedAt/endedAt/route)와 saveWalk 입력 매핑 일치.

> **알려진 한계:** 화면·지도·위치 어댑터는 단위 테스트 대신 tsc + 실기기 QA(Task 13). 테스트 가능한 로직(geo·walkSession·walks·stats RPC·RLS)은 TDD/통합 테스트로 덮었다. Kakao Map 폴리라인 API의 정확한 이름은 설치 버전에서 확인이 필요하다(Task 8에 명시).
