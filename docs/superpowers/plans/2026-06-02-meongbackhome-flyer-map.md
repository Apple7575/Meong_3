# 멍백홈 Sub-project 3b 「온라인 전단 + 동네 실종 지도」 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 보호자가 신고를 QR/링크로 살포해 비-사용자도 무설치 웹에서 강아지 정보를 보고(제보는 앱), 앱 사용자는 동네 지도로 주변 활성 신고를 탐색하게 한다.

**Architecture:** 공개 웹 상세는 Edge Function이 HTML 서빙(service role로 기존 `report_detail` RPC 호출 → auth.uid()=null이라 active만 반환 → active-only·phone 미노출이 자동 보장; Google Static Maps 썸네일). 동네 지도는 react-native-maps + 클러스터링 + `active_reports_in_bounds` RPC(authenticated). 순수 로직(렌더 헬퍼·URL 빌더·서비스)은 TDD. SP1–SP4 코드/커밋 패턴을 따른다.

**Tech Stack:** Expo RN(TS) · Supabase Edge Functions(Deno) + PostGIS · react-native-maps · react-native-map-clustering · react-native-qrcode-svg · Google Static Maps API · Jest · Deno test.

**Branch:** `feat/flyer-map` (off main with SP1–SP4). 로컬 Node/Docker(colima)/Supabase 준비됨.

---

## File Structure

```
supabase/migrations/0012_neighborhood.sql      active_reports_in_bounds RPC (authenticated only)
supabase/tests/neighborhood.test.ts             RPC integration (envelope active-only, anon denied)
supabase/functions/flyer/render.ts              pure: escapeHtml, staticMapUrl, renderFlyerHtml (no phone field)
supabase/functions/flyer/render.test.ts         Deno unit tests
supabase/functions/flyer/index.ts               public HTML serving (service role → report_detail)
src/services/flyer.ts + .test.ts                flyerUrl(pure)/buildFlyerUrl/shareMessage (TDD)
src/services/neighborhoodMap.ts + .test.ts      reportsInBounds(bounds) rpc (TDD)
src/components/FlyerShare.tsx                    QR + share sheet (owner)
app/(app)/map.tsx                               neighborhood map (cluster, debounce, recency filter)
app/(app)/report/[id]/index.tsx (modify)        "전단 공유" entry (owner only)
app/(app)/home.tsx (modify)                     "동네 지도" entry
package.json                                    + react-native-qrcode-svg, react-native-map-clustering
```

---

## Task 1: 의존성

**Files:** Modify `package.json`.

- [ ] **Step 1: 설치**

```bash
cd /Users/cruel/Desktop/Projects/MeongBackHome
npm i react-native-qrcode-svg react-native-map-clustering --legacy-peer-deps
node -e "require.resolve('react-native-svg'); require.resolve('react-native-maps'); console.log('peers OK')"
```
(`react-native-svg`(SP2)·`react-native-maps`(SP2)는 이미 설치됨 — qrcode-svg/clustering의 peer.)

- [ ] **Step 2: 검증** — `npx tsc --noEmit` clean; `npm test` (현재 54) 유지.
- [ ] **Step 3: Commit** — `git add package.json package-lock.json && git commit -m "chore(sp3b): add qrcode-svg + map-clustering deps"`

---

## Task 2: 마이그레이션 0012 — active_reports_in_bounds RPC

**Files:** Create `supabase/migrations/0012_neighborhood.sql`.

- [ ] **Step 1: SQL 작성**

```sql
-- Active reports whose last-seen point falls in the map viewport (lng/lat envelope).
-- Returns safe fields only (no owner/phone). Authenticated-only.
create or replace function public.active_reports_in_bounds(
  min_lng double precision, min_lat double precision, max_lng double precision, max_lat double precision
)
returns table (id uuid, lat double precision, lng double precision, dog_name text, last_seen_at timestamptz, photo_path text)
language sql security definer set search_path = public as $$
  select r.id,
         st_y(r.last_seen_point::geometry), st_x(r.last_seen_point::geometry),
         d.name, r.last_seen_at,
         (select di.storage_path from public.dog_images di where di.dog_id = r.dog_id and di.is_primary = true limit 1)
  from public.missing_reports r
  join public.dogs d on d.id = r.dog_id
  where r.status = 'active'
    and st_intersects(r.last_seen_point::geometry, st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326));
$$;
revoke execute on function public.active_reports_in_bounds(double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.active_reports_in_bounds(double precision, double precision, double precision, double precision) to authenticated;
```

- [ ] **Step 2: 적용 + 클린 재적용** — `npx supabase migration up`; `npx supabase db reset --no-seed` (0001–0012 클린). **주의:** db reset 후 auth 컨테이너가 잠깐 재기동되니, 통합 테스트(Task 3) 전에 `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:54321/auth/v1/health`가 200인지 확인하고, 아니면 몇 초 대기/`npx supabase start`.
- [ ] **Step 3: Commit** — `git add supabase/migrations/0012_neighborhood.sql && git commit -m "feat(db): active_reports_in_bounds RPC (authenticated, viewport envelope)"`

---

## Task 3: 동네 지도 RPC 통합 테스트

**Files:** Create `supabase/tests/neighborhood.test.ts`.

- [ ] **Step 1: 실패하는 테스트 작성** — `supabase/tests/neighborhood.test.ts`:

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

describe('active_reports_in_bounds', () => {
  let viewer: Awaited<ReturnType<typeof makeUser>>;
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let center: { lat: number; lng: number };
  let activeId: string; let resolvedId: string; let farId: string;

  beforeAll(async () => {
    const t = Date.now();
    viewer = await makeUser(`v-${t}@t.dev`);
    owner = await makeUser(`o-${t}@t.dev`);
    // unique per-run center (remote band) so the envelope only contains this run's reports
    const hx = parseInt(owner.id.replace(/-/g, '').slice(0, 6), 16);
    center = { lat: 5 + (hx % 1000) / 100, lng: 160 + (hx % 1000) / 100 };
    const dog = await owner.client.from('dogs').insert({ owner_id: owner.id, name: '초코' }).select('id').single();
    const dogId = (dog.data as any).id;
    const mk = async (lat: number, lng: number, status: string) => {
      const r = await admin.from('missing_reports').insert({
        owner_id: owner.id, dog_id: dogId, status,
        last_seen_point: `SRID=4326;POINT(${lng} ${lat})`, last_seen_at: new Date().toISOString(), alert_radius_m: 2000,
      }).select('id').single();
      return (r.data as any).id;
    };
    activeId = await mk(center.lat, center.lng, 'active');
    resolvedId = await mk(center.lat, center.lng, 'resolved');     // same spot but resolved
    farId = await mk(center.lat + 1, center.lng + 1, 'active');    // ~111km away → outside the small envelope
  });

  test('returns active reports inside the envelope, excludes resolved and out-of-bounds', async () => {
    const d = 0.02; // ~2km half-box
    const { data, error } = await viewer.client.rpc('active_reports_in_bounds', {
      min_lng: center.lng - d, min_lat: center.lat - d, max_lng: center.lng + d, max_lat: center.lat + d,
    });
    expect(error).toBeNull();
    const ids = (data as any[]).map((x) => x.id);
    expect(ids).toContain(activeId);
    expect(ids).not.toContain(resolvedId); // resolved excluded
    expect(ids).not.toContain(farId);      // outside envelope excluded
    const row = (data as any[]).find((x) => x.id === activeId);
    expect(row.dog_name).toBe('초코');
    expect(typeof row.lat).toBe('number');
  });

  test('anonymous cannot call it (authenticated only)', async () => {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const { error } = await anon.rpc('active_reports_in_bounds', { min_lng: 0, min_lat: 0, max_lng: 1, max_lat: 1 });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: 통과 확인** — `npx jest --config supabase/tests/jest.rls.config.js` → neighborhood(2) + 기존(chat/crisis/walks/rls 22) 모두 PASS. 실패 시 마이그레이션 수정.
- [ ] **Step 3: Commit** — `git add supabase/tests/neighborhood.test.ts && git commit -m "test(db): active_reports_in_bounds integration (envelope active-only, anon denied)"`

---

## Task 4: flyer render.ts (순수 헬퍼, Deno TDD)

**Files:** Create `supabase/functions/flyer/render.ts` + `render.test.ts`.

- [ ] **Step 1: 실패하는 Deno 테스트** — `supabase/functions/flyer/render.test.ts`:

```ts
import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { escapeHtml, staticMapUrl, renderFlyerHtml } from './render.ts';

Deno.test('escapeHtml escapes angle brackets/quotes', () => {
  assertEquals(escapeHtml(`<b>"초코"&</b>`), '&lt;b&gt;&quot;초코&quot;&amp;&lt;/b&gt;');
});
Deno.test('staticMapUrl centers + markers on the point with the key', () => {
  const u = staticMapUrl(37.65, 127.07, 'KEY123');
  assertStringIncludes(u, 'maps.googleapis.com/maps/api/staticmap');
  assertStringIncludes(u, 'center=37.65,127.07');
  assertStringIncludes(u, 'key=KEY123');
});
Deno.test('renderFlyerHtml escapes content, embeds static map + app deep link, has NO phone', () => {
  const html = renderFlyerHtml(
    { dogName: '<b>초코</b>', breed: '말티즈', features: '흰색', lastSeenAt: '2026-06-02T00:00:00Z', lat: 37.65, lng: 127.07, photoUrl: 'https://x/p.jpg' },
    { staticMapKey: 'KEY', appDeepLink: 'meongbackhome://report/r1' },
  );
  assertStringIncludes(html, '&lt;b&gt;초코&lt;/b&gt;');           // escaped, not raw
  assertStringIncludes(html, 'maps.googleapis.com/maps/api/staticmap');
  assertStringIncludes(html, 'meongbackhome://report/r1');
  // SafeReport has no phone field by design → output cannot contain one
  assertEquals(/01\d{8,9}/.test(html), false);
});
```

- [ ] **Step 2: 실패 확인** — `deno test supabase/functions/flyer/render.test.ts` → FAIL.
- [ ] **Step 3: 구현** — `supabase/functions/flyer/render.ts`:

```ts
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function staticMapUrl(lat: number, lng: number, key: string): string {
  return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=15&size=600x300&markers=color:red%7C${lat},${lng}&key=${key}`;
}

// SafeReport intentionally has NO phone/owner fields — the render layer cannot leak them.
export type SafeReport = {
  dogName: string; breed: string | null; features: string | null;
  lastSeenAt: string; lat: number; lng: number; photoUrl: string | null;
};

export function renderFlyerHtml(r: SafeReport, opts: { staticMapKey: string; appDeepLink: string }): string {
  const name = escapeHtml(r.dogName);
  const meta = escapeHtml([r.breed, r.features].filter(Boolean).join(' · '));
  const when = escapeHtml(new Date(r.lastSeenAt).toLocaleString('ko-KR'));
  const photo = r.photoUrl ? `<img src="${escapeHtml(r.photoUrl)}" alt="${name}" style="width:100%;max-width:420px;border-radius:12px"/>` : '';
  const map = `<img src="${staticMapUrl(r.lat, r.lng, opts.staticMapKey)}" alt="마지막 목격 위치" style="width:100%;max-width:420px;border-radius:12px"/>`;
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${name} - 멍백홈 실종 신고</title>
<meta property="og:title" content="${name}를 찾고 있어요 - 멍백홈"/>
<meta property="og:description" content="${meta}"/>
${r.photoUrl ? `<meta property="og:image" content="${escapeHtml(r.photoUrl)}"/>` : ''}
</head><body style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:20px;color:#1e293b">
<h1 style="font-size:24px">🐶 ${name} <span style="font-size:14px;color:#ef4444">실종</span></h1>
<p style="color:#64748b">${meta}</p>
${photo}
<h2 style="font-size:16px;margin-top:20px">📍 마지막 목격</h2>
<p style="color:#64748b">${when}</p>
${map}
<a href="${escapeHtml(opts.appDeepLink)}" style="display:block;background:#7c3aed;color:#fff;text-align:center;padding:14px;border-radius:12px;text-decoration:none;font-weight:700;margin-top:20px">멍백홈 앱에서 목격 제보하기</a>
<p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:12px">멍백홈 · 우리 동네 유실견 구조</p>
</body></html>`;
}
```

- [ ] **Step 4: 통과 확인** — `deno test supabase/functions/flyer/render.test.ts` → PASS (3).
- [ ] **Step 5: Commit** — `git add supabase/functions/flyer/render.ts supabase/functions/flyer/render.test.ts && git commit -m "feat(sp3b): flyer render helpers (escape/static-map/html, no phone) Deno TDD"`

---

## Task 5: flyer Edge Function 핸들러

**Files:** Create `supabase/functions/flyer/index.ts`.

- [ ] **Step 1: 작성** — `supabase/functions/flyer/index.ts`:

```ts
import { adminClient } from '../_shared/fcm.ts';
import { renderFlyerHtml, SafeReport } from './render.ts';

function page(body: string, status = 200): Response {
  return new Response(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/></head><body style="font-family:sans-serif;max-width:480px;margin:40px auto;padding:20px;text-align:center;color:#475569">${body}</body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

Deno.serve(async (req) => {
  try {
    const reportId = new URL(req.url).searchParams.get('report');
    if (!reportId) return page('<h1>잘못된 링크입니다</h1>');
    const supabase = adminClient();
    // report_detail returns the report only when active (service role → auth.uid() is null → "owner OR active" = active),
    // and never includes phone — so active-only + privacy are enforced by the RPC.
    const { data: rep } = await supabase.rpc('report_detail', { p_id: reportId }).maybeSingle();
    if (!rep) return page('<h1>종료되었거나 찾을 수 없는 신고입니다</h1><p>이미 해결되었을 수 있어요. 멍백홈을 이용해 주셔서 감사합니다.</p>');
    const r = rep as any;
    // primary photo signed URL (service role bypasses RLS)
    let photoUrl: string | null = null;
    const { data: img } = await supabase.from('dog_images').select('storage_path').eq('dog_id', r.dog_id).eq('is_primary', true).limit(1).maybeSingle();
    if (img?.storage_path) {
      const { data: signed } = await supabase.storage.from('dog-images').createSignedUrl(img.storage_path, 3600);
      photoUrl = signed?.signedUrl ?? null;
    }
    const safe: SafeReport = {
      dogName: r.dog?.name ?? '실종견', breed: r.dog?.breed ?? null, features: r.dog?.features ?? null,
      lastSeenAt: r.last_seen_at, lat: r.last_seen_lat, lng: r.last_seen_lng, photoUrl,
    };
    const html = renderFlyerHtml(safe, {
      staticMapKey: Deno.env.get('GOOGLE_STATIC_MAPS_KEY') ?? '',
      appDeepLink: `meongbackhome://report/${reportId}`,
    });
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (_e) {
    return page('<h1>일시적인 오류입니다</h1><p>잠시 후 다시 시도해 주세요.</p>', 500);
  }
});
```

- [ ] **Step 2: 타입체크** — `deno check supabase/functions/flyer/index.ts` (esm.sh 네트워크 실패만 허용; 타입 에러 없어야). `npm test` 영향 없음(54 유지).
- [ ] **Step 3: Commit** — `git add supabase/functions/flyer/index.ts && git commit -m "feat(sp3b): public flyer edge function (report_detail via service role, active-only)"`

---

## Task 6: flyer 서비스 (buildFlyerUrl + 공유 문구) TDD

**Files:** Create `src/services/flyer.ts` + `.test.ts`.

- [ ] **Step 1: 실패하는 테스트** — `src/services/flyer.test.ts`:

```ts
import { flyerUrl, shareMessage } from './flyer';

test('flyerUrl builds the public function URL', () => {
  expect(flyerUrl('https://abc.supabase.co', 'r1')).toBe('https://abc.supabase.co/functions/v1/flyer?report=r1');
  expect(flyerUrl('https://abc.supabase.co/', 'r1')).toBe('https://abc.supabase.co/functions/v1/flyer?report=r1'); // trailing slash tolerated
});
test('shareMessage includes dog name and url', () => {
  const m = shareMessage('초코', 'https://abc.supabase.co/functions/v1/flyer?report=r1');
  expect(m).toContain('초코');
  expect(m).toContain('https://abc.supabase.co/functions/v1/flyer?report=r1');
});
```

- [ ] **Step 2: 실패 확인** — `npx jest src/services/flyer.test.ts` → FAIL.
- [ ] **Step 3: 구현** — `src/services/flyer.ts`:

```ts
import Constants from 'expo-constants';

export function flyerUrl(supabaseUrl: string, reportId: string): string {
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/flyer?report=${reportId}`;
}
export function buildFlyerUrl(reportId: string): string {
  const base = (Constants.expoConfig?.extra?.supabaseUrl as string) ?? '';
  return flyerUrl(base, reportId);
}
export function shareMessage(dogName: string, url: string): string {
  return `우리 강아지 ${dogName}를 찾고 있어요 🐶 보신 분은 멍백홈으로 알려주세요!\n${url}`;
}
```

- [ ] **Step 4: 통과 + tsc** — `npx jest src/services/flyer.test.ts` PASS (2); `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git add src/services/flyer.ts src/services/flyer.test.ts && git commit -m "feat(sp3b): flyer url + share message (TDD)"`

---

## Task 7: neighborhoodMap 서비스 (reportsInBounds) TDD

**Files:** Create `src/services/neighborhoodMap.ts` + `.test.ts`; add `NeighborhoodReport` type to `src/types/db.ts`.

- [ ] **Step 1: 타입** — append to `src/types/db.ts`:

```ts
export type NeighborhoodReport = { id: string; lat: number; lng: number; dog_name: string | null; last_seen_at: string; photo_path: string | null };
export type MapBounds = { minLng: number; minLat: number; maxLng: number; maxLat: number };
```

- [ ] **Step 2: 실패하는 테스트** — `src/services/neighborhoodMap.test.ts`:

```ts
import { reportsInBounds } from './neighborhoodMap';

const mockRpc = jest.fn();
jest.mock('../lib/supabase', () => ({ supabase: { rpc: (...a: any[]) => (mockRpc as any)(...a) } }));
beforeEach(() => jest.clearAllMocks());

test('reportsInBounds calls active_reports_in_bounds with lng/lat envelope', async () => {
  mockRpc.mockResolvedValueOnce({ data: [{ id: 'r1', lat: 37, lng: 127, dog_name: '초코', last_seen_at: 'iso', photo_path: null }], error: null });
  const rows = await reportsInBounds({ minLng: 127.0, minLat: 37.6, maxLng: 127.1, maxLat: 37.7 });
  expect(mockRpc).toHaveBeenCalledWith('active_reports_in_bounds', { min_lng: 127.0, min_lat: 37.6, max_lng: 127.1, max_lat: 37.7 });
  expect(rows[0].dog_name).toBe('초코');
});
test('throws on rpc error', async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
  await expect(reportsInBounds({ minLng: 0, minLat: 0, maxLng: 1, maxLat: 1 })).rejects.toThrow('boom');
});
```

- [ ] **Step 3: 실패 확인** — `npx jest src/services/neighborhoodMap.test.ts` → FAIL.
- [ ] **Step 4: 구현** — `src/services/neighborhoodMap.ts`:

```ts
import { supabase } from '../lib/supabase';
import { NeighborhoodReport, MapBounds } from '../types/db';

export async function reportsInBounds(b: MapBounds): Promise<NeighborhoodReport[]> {
  const { data, error } = await supabase.rpc('active_reports_in_bounds', {
    min_lng: b.minLng, min_lat: b.minLat, max_lng: b.maxLng, max_lat: b.maxLat,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as NeighborhoodReport[];
}
```

- [ ] **Step 5: 통과 + tsc** — `npx jest src/services/neighborhoodMap.test.ts` PASS (2); `npx tsc --noEmit` clean.
- [ ] **Step 6: Commit** — `git add src/types/db.ts src/services/neighborhoodMap.ts src/services/neighborhoodMap.test.ts && git commit -m "feat(sp3b): neighborhoodMap service (reportsInBounds) TDD"`

---

## Task 8: 동네 지도 화면

**Files:** Create `app/(app)/map.tsx`.

- [ ] **Step 1: 작성** — `app/(app)/map.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Alert, StyleSheet } from 'react-native';
import MapView from 'react-native-map-clustering';
import { Marker, Region } from 'react-native-maps';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { reportsInBounds } from '../../src/services/neighborhoodMap';
import { NeighborhoodReport } from '../../src/types/db';

const NOWON = { latitude: 37.6542, longitude: 127.0568, latitudeDelta: 0.05, longitudeDelta: 0.05 };

export default function NeighborhoodMap() {
  const [reports, setReports] = useState<NeighborhoodReport[]>([]);
  const [recentOnly, setRecentOnly] = useState(false);
  const [initial, setInitial] = useState<Region>(NOWON);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Location.getForegroundPermissionsAsync().then(async (p) => {
      if (p.granted) { const pos = await Location.getCurrentPositionAsync({}); setInitial({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }); }
    });
  }, []);

  function fetchFor(region: Region) {
    const minLat = region.latitude - region.latitudeDelta / 2;
    const maxLat = region.latitude + region.latitudeDelta / 2;
    const minLng = region.longitude - region.longitudeDelta / 2;
    const maxLng = region.longitude + region.longitudeDelta / 2;
    reportsInBounds({ minLng, minLat, maxLng, maxLat }).then(setReports).catch((e: any) => Alert.alert('오류', e.message));
  }
  function onRegionChange(region: Region) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fetchFor(region), 400); // debounce viewport queries
  }
  useEffect(() => { fetchFor(initial); }, [initial]);

  const cutoff = Date.now() - 3 * 24 * 3600 * 1000;
  const shown = recentOnly ? reports.filter((r) => Date.parse(r.last_seen_at) >= cutoff) : reports;

  return (
    <View style={styles.c}>
      <MapView style={{ flex: 1 }} initialRegion={initial} onRegionChangeComplete={onRegionChange}>
        {shown.map((r) => (
          <Marker key={r.id} coordinate={{ latitude: r.lat, longitude: r.lng }} title={r.dog_name ?? '실종견'}
            pinColor="#ef4444" onCalloutPress={() => router.push(`/(app)/report/${r.id}`)}
            onPress={() => router.push(`/(app)/report/${r.id}`)} />
        ))}
      </MapView>
      <View style={styles.bar}>
        <Text style={styles.count}>활성 신고 {shown.length}건</Text>
        <Pressable style={[styles.filter, recentOnly && styles.filterOn]} onPress={() => setRecentOnly((v) => !v)}>
          <Text style={recentOnly ? styles.filterOnText : styles.filterText}>최근 3일</Text>
        </Pressable>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1 },
  bar: { position: 'absolute', top: 48, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  count: { backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, fontWeight: '700', overflow: 'hidden' },
  filter: { backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: '#cbd5e1' },
  filterOn: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  filterText: { color: '#334155', fontWeight: '700' }, filterOnText: { color: '#fff', fontWeight: '700' },
});
```

- [ ] **Step 2: tsc** — `npx tsc --noEmit` clean. (`react-native-map-clustering`의 기본 export가 MapView 대체. 타입 이슈 시 `// @ts-expect-error` 대신 패키지 타입을 확인해 맞출 것; 최후수단으로만 캐스팅하고 보고.)
- [ ] **Step 3: Commit** — `git add "app/(app)/map.tsx" && git commit -m "feat(sp3b): neighborhood map (cluster + debounce + recency filter)"`

---

## Task 9: 전단 공유 진입(신고 상세) + 홈 진입

**Files:** Create `src/components/FlyerShare.tsx`; modify `app/(app)/report/[id]/index.tsx`, `app/(app)/home.tsx`.

- [ ] **Step 1: FlyerShare 컴포넌트** — `src/components/FlyerShare.tsx`:

```tsx
import { View, Text, Pressable, Share, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { buildFlyerUrl, shareMessage } from '../services/flyer';

export function FlyerShare({ reportId, dogName }: { reportId: string; dogName: string }) {
  const url = buildFlyerUrl(reportId);
  return (
    <View style={styles.c}>
      <Text style={styles.h}>전단 공유</Text>
      <View style={styles.qr}><QRCode value={url} size={140} /></View>
      <Pressable style={styles.btn} onPress={() => Share.share({ message: shareMessage(dogName, url) })}>
        <Text style={styles.btnText}>링크 공유하기</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  c: { alignItems: 'center', padding: 16, gap: 10 },
  h: { fontWeight: '800', fontSize: 16 },
  qr: { padding: 12, backgroundColor: '#fff', borderRadius: 12 },
  btn: { backgroundColor: '#7c3aed', paddingHorizontal: 20, padding: 12, borderRadius: 12 },
  btnText: { color: '#fff', fontWeight: '700' },
});
```

- [ ] **Step 2: 신고 상세에 owner 전용 전단 공유 노출** — modify `app/(app)/report/[id]/index.tsx`: import `FlyerShare` + the current user id check; show `<FlyerShare reportId={id} dogName={report.dog?.name ?? '실종견'} />` only when the viewer is the report owner. Add:
```tsx
import { FlyerShare } from '../../../../src/components/FlyerShare';
// inside component, after report loaded:
const [isOwner, setIsOwner] = useState(false);
useEffect(() => { supabase.auth.getUser().then(({ data }) => setIsOwner(!!report && data.user?.id === report.owner_id)); }, [report]);
```
Render `{isOwner && report && <FlyerShare reportId={id} dogName={report.dog?.name ?? '실종견'} />}` above the CTA. (`report` is `ReportDetail`, has `owner_id`.)

- [ ] **Step 3: 홈에 "동네 지도" 진입** — modify `app/(app)/home.tsx`: above 로그아웃 (keep existing buttons):
```tsx
      <Pressable style={styles.walkHist} onPress={() => router.push('/(app)/map')}>
        <Text style={styles.walkHistText}>🗺️ 동네 실종 지도</Text>
      </Pressable>
```

- [ ] **Step 4: tsc + 전체 테스트** — `npx tsc --noEmit` clean; `npm test` (54 + flyer 2 + neighborhoodMap 2 ≈ 58); `npm run test:rls` (24: neighborhood 2 + 22) pass; `deno test supabase/functions/flyer/render.test.ts` (3).
- [ ] **Step 5: Commit** — `git add src/components/FlyerShare.tsx "app/(app)/report/[id]/index.tsx" "app/(app)/home.tsx" && git commit -m "feat(sp3b): flyer share (QR) on report detail + home map entry"`

---

## Task 10: flyer 함수 배포 + 키 + 수동 QA (수동)

> Google Static Maps 키 + 실기기/브라우저 필요.

- [ ] **Step 1: 키/배포** — Google Cloud에서 **Static Maps API** 키 발급(referrer 제한: 함수 도메인). `npx supabase secrets set GOOGLE_STATIC_MAPS_KEY=...`. `npx supabase functions deploy flyer --no-verify-jwt` (공개 페이지라 JWT 미검증).
- [ ] **Step 2: 딥링크 확인** — `app.config.ts` scheme `meongbackhome` 이미 등록됨(SP1). expo-router가 `meongbackhome://report/<id>`를 `/report/[id]` 라우트로 매핑하는지 실기기 확인(필요 시 linking 설정).
- [ ] **Step 3: QA 체크리스트**
  - [ ] 보호자: 신고 상세 "전단 공유" → QR 표시 + 링크 공유(카톡 등 미리보기 OG)
  - [ ] 브라우저(앱 미설치)로 링크 열기 → 강아지 사진·특징·정적 지도·시각 표시, **전화 미노출**, "앱에서 제보" 버튼
  - [ ] resolved 신고 링크 → "종료되었거나 찾을 수 없는 신고" 페이지
  - [ ] 앱에서 "동네 지도" → 주변 활성 신고 마커, 저줌 클러스터, 영역 이동 시 갱신, "최근 3일" 필터, 마커 탭 → 신고 상세
  - [ ] "앱에서 제보" 버튼 탭(앱 설치 기기) → 딥링크로 신고 상세 진입
- [ ] **Step 4: Commit (설정)** — `git add supabase/config.toml && git commit -m "chore(sp3b): flyer deploy + static maps key config"` (키 커밋 금지).

---

## Self-Review (작성자 점검)

**1. Spec coverage:** 공개 웹 상세 Edge Function(T4 render + T5 handler; active-only via report_detail+service role; static map; phone 미노출)·QR/전단 공유(T6 service + T9 component)·동네 지도(T2 RPC + T3 test + T7 service + T8 screen; 클러스터·디바운스·최근성 필터·탭→상세)·홈 진입(T9)·딥링크(T5 CTA + T10 확인). 전부 매핑. `flyers` 테이블/이미지 합성/웹 제보 제외(스펙대로). ✅

**2. Placeholder scan:** 코드 스텝 전부 실제 코드. T10(배포·키·QA)는 본질적 수동.

**3. Type consistency:** `SafeReport`(no phone), `renderFlyerHtml(r, {staticMapKey, appDeepLink})`, `flyerUrl(supabaseUrl, reportId)`/`buildFlyerUrl`/`shareMessage`, `NeighborhoodReport`/`MapBounds`, `reportsInBounds(b)`→rpc `active_reports_in_bounds{min_lng,min_lat,max_lng,max_lat}`. flyer 핸들러가 기존 `report_detail` RPC(SP3a, last_seen_lat/lng + dog jsonb) 재사용 — 시그니처 일치.

> **알려진 한계/리스크:** ① flyer 실제 HTML·정적지도·딥링크는 배포+브라우저/실기기 검증(T10). 통합 테스트는 RPC(DB)만; render.ts 순수 헬퍼는 Deno. ② report_detail가 service role(auth.uid null)에서 active만 반환함에 의존 — 이 불변식이 flyer의 active-only·privacy를 보장(SP3a 0009 정의). ③ 지도 마커 대량 시 클러스터로 완화, 상한 필요하면 후속. ④ Static Maps 키는 img URL로 브라우저 노출 — referrer 제한 필수(T10).
