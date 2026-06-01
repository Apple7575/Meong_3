# 멍백홈 Sub-project 1 「기반 & 신원」 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expo(Dev Client) + Supabase 기반으로 로그인(카카오·구글·이메일)·프로필/온보딩·반려견 등록·FCM 토큰/위치 적재와 5개 테이블 데이터 모델(RLS+가입 트리거)을 동작하는 형태로 구축한다.

**Architecture:** Expo RN 앱(expo-router) — 화면 계층 / 순수 함수 + Supabase 클라이언트를 감싼 서비스 계층(`src/services`) / expo-secure-store 세션. 백엔드는 Supabase(Auth·Postgres+PostGIS·Storage)로, DB 스키마는 `supabase/migrations`의 SQL 마이그레이션으로 버전 관리한다. 테스트 가능한 로직(검증·온보딩 판정·서비스)은 Jest로 TDD, RLS 격리는 로컬 Supabase 통합 테스트로 검증한다.

**Tech Stack:** Expo SDK 53 (TypeScript) · expo-router · supabase-js v2 · @react-native-firebase/app+messaging (config plugin) · expo-web-browser · expo-auth-session · expo-secure-store · expo-location · expo-image-picker · Jest + @testing-library/react-native · Supabase CLI(로컬)

---

## File Structure

앱은 저장소 루트에 둔다(이미 `docs/`, `.gitignore` 존재).

```
app/                                 expo-router 라우트 (화면)
  _layout.tsx                        루트 레이아웃 + 세션 provider
  index.tsx                          진입 게이트(세션→온보딩→홈 분기)
  (auth)/_layout.tsx
  (auth)/login.tsx                   로그인(카카오/구글/이메일 버튼)
  (auth)/email.tsx                   이메일+비밀번호 로그인/가입
  (onboarding)/profile.tsx           닉네임·연락처 입력(게이트)
  (app)/_layout.tsx
  (app)/home.tsx                     홈(반려견 등록 CTA)
  (app)/dogs/new.tsx                 반려견 등록 폼
src/
  lib/supabase.ts                    supabase 클라이언트(secure-store 어댑터)
  lib/session.ts                     세션 컨텍스트/훅
  services/profile.ts                프로필 조회·갱신·온보딩 판정
  services/dogs.ts                   반려견 CRUD
  services/images.ts                 사진 업로드(Storage)
  services/location.ts               위치 upsert(RPC)
  services/push.ts                   FCM 토큰 등록
  validation/profile.ts              연락처/닉네임 검증(순수 함수)
  validation/dogs.ts                 반려견 폼 검증(순수 함수)
  types/db.ts                        DB 행 타입
supabase/
  migrations/0001_init.sql
  migrations/0002_rls.sql
  migrations/0003_functions_triggers.sql
  migrations/0004_storage.sql
  tests/rls.test.ts                  RLS 격리 통합 테스트
app.config.ts                        Expo 설정 + config plugins + 딥링크 스킴
eas.json
.env.example
jest.config.js
jest.setup.ts
```

각 서비스 파일은 단일 책임(한 테이블/도메인). 검증 로직은 UI에서 분리해 `src/validation`에 순수 함수로 두어 TDD 한다.

---

## Phase 0 — 스캐폴딩 & 인프라

### Task 1: Expo 프로젝트 + 의존성 + 테스트 환경

**Files:**
- Create: `package.json`, `app.config.ts`, `tsconfig.json`, `jest.config.js`, `jest.setup.ts`, `.env.example`, `babel.config.js`

- [ ] **Step 1: Expo 앱을 저장소 루트에 생성**

Run:
```bash
cd /Users/cruel/Desktop/Projects/MeongBackHome
npx create-expo-app@latest . --template blank-typescript
```
(루트가 비어있지 않다는 경고가 나오면 `docs/`·`.git`·`.gitignore`는 유지하고 진행한다. 충돌 시 임시 폴더에 생성 후 내용물만 루트로 이동.)

- [ ] **Step 2: 런타임 의존성 설치**

Run:
```bash
npx expo install expo-router expo-secure-store expo-web-browser expo-auth-session expo-linking expo-location expo-image-picker expo-dev-client
npx expo install @supabase/supabase-js @react-native-async-storage/async-storage react-native-url-polyfill
npx expo install @react-native-firebase/app @react-native-firebase/messaging
```

- [ ] **Step 3: 개발/테스트 의존성 설치**

Run:
```bash
npm i -D jest jest-expo @testing-library/react-native @types/jest ts-node dotenv
```

- [ ] **Step 4: jest 설정 작성**

`jest.config.js`:
```js
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@react-navigation/.*|@supabase/.*))',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/supabase/tests/'],
};
```

`jest.setup.ts`:
```ts
// Silence native module warnings in unit tests.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
```

- [ ] **Step 5: package.json 스크립트 추가**

`package.json` 의 `"scripts"` 에 추가:
```json
{
  "scripts": {
    "test": "jest",
    "test:rls": "ts-node --project tsconfig.json node_modules/.bin/jest --config supabase/tests/jest.rls.config.js",
    "lint": "expo lint"
  }
}
```

- [ ] **Step 6: app.config.ts 작성 (딥링크 스킴 + config plugins)**

`app.config.ts`:
```ts
import { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: '멍백홈',
  slug: 'meongbackhome',
  scheme: 'meongbackhome',
  version: '0.1.0',
  orientation: 'portrait',
  newArchEnabled: true,
  ios: { bundleIdentifier: 'com.meongbackhome.app', supportsTablet: false },
  android: { package: 'com.meongbackhome.app' },
  plugins: [
    'expo-router',
    'expo-secure-store',
    '@react-native-firebase/app',
    '@react-native-firebase/messaging',
    ['expo-build-properties', { ios: { useFrameworks: 'static' } }],
  ],
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  },
};
export default config;
```

Run: `npx expo install expo-build-properties`

- [ ] **Step 7: .env.example 작성**

`.env.example`:
```
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=replace-with-local-anon-key
# RLS 통합 테스트 전용 (절대 커밋 금지, .env 사용)
SUPABASE_SERVICE_ROLE_KEY=replace-with-local-service-role-key
```

- [ ] **Step 8: 빈 테스트로 jest 동작 확인**

Create `src/validation/profile.ts`:
```ts
export const PLACEHOLDER = true;
```
Create `src/validation/profile.test.ts`:
```ts
import { PLACEHOLDER } from './profile';
test('jest runs', () => { expect(PLACEHOLDER).toBe(true); });
```

Run: `npm test`
Expected: PASS (1 test)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold Expo app + jest + config plugins"
```

---

### Task 2: 로컬 Supabase 기동

**Files:**
- Create: `supabase/config.toml` (CLI가 생성)

- [ ] **Step 1: Supabase 초기화**

Run:
```bash
npx supabase init
```
Expected: `supabase/config.toml` 생성

- [ ] **Step 2: 로컬 스택 기동**

Run:
```bash
npx supabase start
```
Expected: API URL(`http://127.0.0.1:54321`), `anon key`, `service_role key` 출력

- [ ] **Step 3: 키를 .env에 기록**

`.env`(gitignore됨) 파일에 Step 2 출력의 `anon key`·`service_role key`·API URL을 `.env.example` 키 이름대로 채운다.

- [ ] **Step 4: Commit**

```bash
git add supabase/config.toml
git commit -m "chore: init local supabase stack"
```

---

## Phase 1 — 데이터 모델 & RLS

### Task 3: 테이블 마이그레이션 (0001_init.sql)

**Files:**
- Create: `supabase/migrations/0001_init.sql`

- [ ] **Step 1: 마이그레이션 SQL 작성**

`supabase/migrations/0001_init.sql`:
```sql
create extension if not exists postgis;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fcm_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios','android')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index fcm_tokens_user_id_idx on public.fcm_tokens(user_id);

create table public.user_locations (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  geom geography(Point,4326) not null,
  updated_at timestamptz not null default now()
);
create index user_locations_geom_idx on public.user_locations using gist (geom);

create table public.dogs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  breed text,
  gender text check (gender in ('male','female','unknown')),
  is_neutered boolean,
  features text,
  emergency_contact text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index dogs_owner_id_idx on public.dogs(owner_id);

create table public.dog_images (
  id uuid primary key default gen_random_uuid(),
  dog_id uuid not null references public.dogs(id) on delete cascade,
  storage_path text not null,
  is_primary boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index dog_images_dog_id_idx on public.dog_images(dog_id);
```

- [ ] **Step 2: 마이그레이션 적용**

Run: `npx supabase migration up`
Expected: 에러 없이 5개 테이블 생성

- [ ] **Step 3: 테이블 존재 확인**

Run:
```bash
npx supabase db reset --no-seed
```
Expected: 마이그레이션이 처음부터 깨끗하게 적용됨 (구문 오류 없음)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0001_init.sql
git commit -m "feat(db): create profiles/fcm_tokens/user_locations/dogs/dog_images"
```

---

### Task 4: RLS 정책 (0002_rls.sql)

**Files:**
- Create: `supabase/migrations/0002_rls.sql`

- [ ] **Step 1: RLS SQL 작성**

`supabase/migrations/0002_rls.sql`:
```sql
alter table public.profiles enable row level security;
alter table public.fcm_tokens enable row level security;
alter table public.user_locations enable row level security;
alter table public.dogs enable row level security;
alter table public.dog_images enable row level security;

create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "fcm_select_own" on public.fcm_tokens for select using (auth.uid() = user_id);
create policy "fcm_insert_own" on public.fcm_tokens for insert with check (auth.uid() = user_id);
create policy "fcm_update_own" on public.fcm_tokens for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "fcm_delete_own" on public.fcm_tokens for delete using (auth.uid() = user_id);

create policy "loc_all_own" on public.user_locations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "dogs_all_own" on public.dogs for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "dog_images_all_own" on public.dog_images for all
  using (exists (select 1 from public.dogs d where d.id = dog_id and d.owner_id = auth.uid()))
  with check (exists (select 1 from public.dogs d where d.id = dog_id and d.owner_id = auth.uid()));
```

- [ ] **Step 2: 적용**

Run: `npx supabase migration up`
Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0002_rls.sql
git commit -m "feat(db): enable RLS with owner-only policies"
```

---

### Task 5: 가입 트리거 + 위치 RPC (0003_functions_triggers.sql)

**Files:**
- Create: `supabase/migrations/0003_functions_triggers.sql`

- [ ] **Step 1: 함수/트리거 SQL 작성**

`supabase/migrations/0003_functions_triggers.sql`:
```sql
-- 가입 시 profiles 행 자동 생성
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 사용자당 최신 1개 위치 upsert (lat/lng → geography)
create or replace function public.upsert_my_location(lat double precision, lng double precision)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_locations(user_id, geom, updated_at)
  values (auth.uid(), st_setsrid(st_makepoint(lng, lat), 4326)::geography, now())
  on conflict (user_id) do update set geom = excluded.geom, updated_at = now();
end; $$;
```

- [ ] **Step 2: 적용**

Run: `npx supabase migration up`
Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0003_functions_triggers.sql
git commit -m "feat(db): signup trigger + upsert_my_location RPC"
```

---

### Task 6: Storage 버킷 + 정책 (0004_storage.sql)

**Files:**
- Create: `supabase/migrations/0004_storage.sql`

- [ ] **Step 1: Storage SQL 작성**

`supabase/migrations/0004_storage.sql`:
```sql
insert into storage.buckets (id, name, public)
values ('dog-images', 'dog-images', false)
on conflict (id) do nothing;

create policy "dog_images_insert_own" on storage.objects for insert
  with check (bucket_id = 'dog-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "dog_images_select_own" on storage.objects for select
  using (bucket_id = 'dog-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "dog_images_update_own" on storage.objects for update
  using (bucket_id = 'dog-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "dog_images_delete_own" on storage.objects for delete
  using (bucket_id = 'dog-images' and (storage.foldername(name))[1] = auth.uid()::text);
```

- [ ] **Step 2: 적용**

Run: `npx supabase migration up`
Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0004_storage.sql
git commit -m "feat(db): dog-images storage bucket + per-user policies"
```

---

### Task 7: RLS 격리 통합 테스트

**Files:**
- Create: `supabase/tests/jest.rls.config.js`, `supabase/tests/rls.test.ts`

- [ ] **Step 1: RLS 테스트용 jest 설정**

`supabase/tests/jest.rls.config.js`:
```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '../../',
  testMatch: ['<rootDir>/supabase/tests/**/*.test.ts'],
  setupFiles: ['dotenv/config'],
};
```

Run: `npm i -D ts-jest`

- [ ] **Step 2: 실패하는 격리 테스트 작성**

`supabase/tests/rls.test.ts`:
```ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

async function makeUser(email: string): Promise<{ id: string; client: SupabaseClient }> {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: 'password123', email_confirm: true,
  });
  if (error) throw error;
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password: 'password123' });
  if (signIn.error) throw signIn.error;
  return { id: data.user!.id, client };
}

describe('RLS isolation', () => {
  let alice: { id: string; client: SupabaseClient };
  let bob: { id: string; client: SupabaseClient };

  beforeAll(async () => {
    const stamp = Date.now();
    alice = await makeUser(`alice-${stamp}@test.dev`);
    bob = await makeUser(`bob-${stamp}@test.dev`);
  });

  test('signup trigger created a profile for each user', async () => {
    const { data } = await alice.client.from('profiles').select('id').eq('id', alice.id).single();
    expect(data?.id).toBe(alice.id);
  });

  test('alice cannot read bob profile', async () => {
    const { data } = await alice.client.from('profiles').select('id').eq('id', bob.id);
    expect(data).toEqual([]); // RLS filters out, not error
  });

  test('alice cannot insert a dog owned by bob', async () => {
    const { error } = await alice.client.from('dogs').insert({ owner_id: bob.id, name: 'hack' });
    expect(error).not.toBeNull(); // WITH CHECK violation
  });

  test('alice dog is invisible to bob', async () => {
    await alice.client.from('dogs').insert({ owner_id: alice.id, name: 'choco' });
    const { data } = await bob.client.from('dogs').select('*');
    expect(data?.some((d: any) => d.name === 'choco')).toBe(false);
  });
});
```

- [ ] **Step 3: 테스트 실행 — 통과 확인**

먼저 로컬 supabase가 떠 있어야 한다(`npx supabase start`).
Run: `npx jest --config supabase/tests/jest.rls.config.js`
Expected: 4 tests PASS. (실패하면 RLS 정책/트리거 마이그레이션을 점검)

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/
git commit -m "test(db): RLS isolation + signup trigger integration tests"
```

---

## Phase 2 — Supabase 클라이언트 & 타입

### Task 8: 클라이언트 + DB 타입

**Files:**
- Create: `src/lib/supabase.ts`, `src/types/db.ts`

- [ ] **Step 1: DB 행 타입 작성**

`src/types/db.ts`:
```ts
export type Profile = {
  id: string; nickname: string | null; phone: string | null;
  avatar_url: string | null; created_at: string; updated_at: string;
};
export type Gender = 'male' | 'female' | 'unknown';
export type Dog = {
  id: string; owner_id: string; name: string; breed: string | null;
  gender: Gender | null; is_neutered: boolean | null; features: string | null;
  emergency_contact: string | null; created_at: string; updated_at: string;
};
export type DogImage = {
  id: string; dog_id: string; storage_path: string;
  is_primary: boolean; sort_order: number; created_at: string;
};
```

- [ ] **Step 2: secure-store 어댑터 + 클라이언트 작성**

`src/lib/supabase.ts`:
```ts
import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

const url = Constants.expoConfig?.extra?.supabaseUrl as string;
const anonKey = Constants.expoConfig?.extra?.supabaseAnonKey as string;

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
```

Run: `npx expo install expo-constants`

- [ ] **Step 3: 타입 컴파일 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase.ts src/types/db.ts
git commit -m "feat: supabase client with secure-store session + db types"
```

---

## Phase 3 — 검증 & 서비스 계층 (TDD)

### Task 9: 검증 순수 함수 (profile + dogs)

**Files:**
- Create: `src/validation/profile.ts`, `src/validation/profile.test.ts`, `src/validation/dogs.ts`, `src/validation/dogs.test.ts`
- Delete: Task 1의 플레이스홀더 내용 대체

- [ ] **Step 1: 실패하는 프로필 검증 테스트 작성**

`src/validation/profile.test.ts`:
```ts
import { isOnboardingComplete, normalizePhone, isValidPhone } from './profile';

describe('profile validation', () => {
  test('onboarding incomplete when nickname or phone missing', () => {
    expect(isOnboardingComplete({ nickname: null, phone: '01012345678' })).toBe(false);
    expect(isOnboardingComplete({ nickname: '철수', phone: null })).toBe(false);
    expect(isOnboardingComplete({ nickname: '철수', phone: '01012345678' })).toBe(true);
  });
  test('normalizePhone strips hyphens/spaces', () => {
    expect(normalizePhone('010-1234-5678')).toBe('01012345678');
    expect(normalizePhone('010 1234 5678')).toBe('01012345678');
  });
  test('isValidPhone accepts KR mobile, rejects junk', () => {
    expect(isValidPhone('010-1234-5678')).toBe(true);
    expect(isValidPhone('123')).toBe(false);
    expect(isValidPhone('')).toBe(false);
  });
});
```

- [ ] **Step 2: 실행하여 실패 확인**

Run: `npx jest src/validation/profile.test.ts`
Expected: FAIL ("isOnboardingComplete is not a function" 등)

- [ ] **Step 3: 최소 구현 작성**

`src/validation/profile.ts` (Task 1의 플레이스홀더 내용 전체 대체):
```ts
export function normalizePhone(raw: string): string {
  return raw.replace(/[\s-]/g, '');
}
export function isValidPhone(raw: string): boolean {
  const p = normalizePhone(raw);
  return /^01[016789]\d{7,8}$/.test(p);
}
export function isOnboardingComplete(p: { nickname: string | null; phone: string | null }): boolean {
  return !!p.nickname?.trim() && !!p.phone?.trim();
}
```

- [ ] **Step 4: 실행하여 통과 확인**

Run: `npx jest src/validation/profile.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 실패하는 반려견 검증 테스트 작성**

`src/validation/dogs.test.ts`:
```ts
import { validateDogForm } from './dogs';

describe('dog form validation', () => {
  test('name is required', () => {
    expect(validateDogForm({ name: '' }).valid).toBe(false);
    expect(validateDogForm({ name: '  ' }).valid).toBe(false);
  });
  test('valid with just a name', () => {
    expect(validateDogForm({ name: '초코' }).valid).toBe(true);
  });
  test('rejects invalid gender', () => {
    const r = validateDogForm({ name: '초코', gender: 'cat' as any });
    expect(r.valid).toBe(false);
  });
});
```

- [ ] **Step 6: 실행하여 실패 확인**

Run: `npx jest src/validation/dogs.test.ts`
Expected: FAIL

- [ ] **Step 7: 최소 구현 작성**

`src/validation/dogs.ts`:
```ts
import { Gender } from '../types/db';

export type DogFormInput = {
  name: string; breed?: string; gender?: Gender;
  is_neutered?: boolean | null; features?: string; emergency_contact?: string;
};
const GENDERS: Gender[] = ['male', 'female', 'unknown'];

export function validateDogForm(input: DogFormInput): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!input.name?.trim()) errors.push('이름은 필수입니다.');
  if (input.gender && !GENDERS.includes(input.gender)) errors.push('성별 값이 올바르지 않습니다.');
  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 8: 실행하여 통과 확인**

Run: `npx jest src/validation/`
Expected: PASS (6 tests)

- [ ] **Step 9: Commit**

```bash
git add src/validation/
git commit -m "feat: profile + dog form validation (TDD)"
```

---

### Task 10: 프로필 서비스

**Files:**
- Create: `src/services/profile.ts`, `src/services/profile.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성 (supabase 목)**

`src/services/profile.test.ts`:
```ts
import { getMyProfile, updateMyProfile } from './profile';

const single = jest.fn();
const eq = jest.fn(() => ({ single }));
const select = jest.fn(() => ({ eq }));
const update = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => ({ single })) })) }));
const from = jest.fn(() => ({ select, update }));

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: (...a: any[]) => from(...a),
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u1' } } } )) },
  },
}));

beforeEach(() => jest.clearAllMocks());

test('getMyProfile reads profiles by current user id', async () => {
  single.mockResolvedValueOnce({ data: { id: 'u1', nickname: '철수', phone: '0101' }, error: null });
  const p = await getMyProfile();
  expect(from).toHaveBeenCalledWith('profiles');
  expect(p?.nickname).toBe('철수');
});

test('updateMyProfile throws on error', async () => {
  single.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
  await expect(updateMyProfile({ nickname: 'x', phone: '0101' })).rejects.toThrow('boom');
});
```

- [ ] **Step 2: 실행하여 실패 확인**

Run: `npx jest src/services/profile.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: 구현 작성**

`src/services/profile.ts`:
```ts
import { supabase } from '../lib/supabase';
import { Profile } from '../types/db';

export async function getMyProfile(): Promise<Profile | null> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).single();
  if (error) throw new Error(error.message);
  return data as Profile;
}

export async function updateMyProfile(patch: { nickname: string; phone: string }): Promise<Profile> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) throw new Error('로그인이 필요합니다.');
  const { data, error } = await supabase
    .from('profiles')
    .update({ nickname: patch.nickname, phone: patch.phone, updated_at: new Date().toISOString() })
    .eq('id', uid)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as Profile;
}
```

- [ ] **Step 4: 실행하여 통과 확인**

Run: `npx jest src/services/profile.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/profile.ts src/services/profile.test.ts
git commit -m "feat: profile service (get/update) with tests"
```

---

### Task 11: 위치 서비스 (RPC 호출)

**Files:**
- Create: `src/services/location.ts`, `src/services/location.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/services/location.test.ts`:
```ts
import { upsertMyLocation } from './location';

const rpc = jest.fn();
jest.mock('../lib/supabase', () => ({ supabase: { rpc: (...a: any[]) => rpc(...a) } }));
beforeEach(() => jest.clearAllMocks());

test('calls upsert_my_location RPC with lat/lng', async () => {
  rpc.mockResolvedValueOnce({ error: null });
  await upsertMyLocation(37.65, 127.07);
  expect(rpc).toHaveBeenCalledWith('upsert_my_location', { lat: 37.65, lng: 127.07 });
});

test('throws on rpc error', async () => {
  rpc.mockResolvedValueOnce({ error: { message: 'nope' } });
  await expect(upsertMyLocation(1, 2)).rejects.toThrow('nope');
});
```

- [ ] **Step 2: 실행하여 실패 확인**

Run: `npx jest src/services/location.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현 작성**

`src/services/location.ts`:
```ts
import { supabase } from '../lib/supabase';

export async function upsertMyLocation(lat: number, lng: number): Promise<void> {
  const { error } = await supabase.rpc('upsert_my_location', { lat, lng });
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: 실행하여 통과 확인**

Run: `npx jest src/services/location.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/location.ts src/services/location.test.ts
git commit -m "feat: location upsert service via RPC"
```

---

### Task 12: FCM 토큰 서비스

**Files:**
- Create: `src/services/push.ts`, `src/services/push.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/services/push.test.ts`:
```ts
import { registerPushToken } from './push';

const upsert = jest.fn();
const from = jest.fn(() => ({ upsert }));
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: (...a: any[]) => from(...a),
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u1' } } })) },
  },
}));
beforeEach(() => jest.clearAllMocks());

test('upserts token keyed on token column', async () => {
  upsert.mockResolvedValueOnce({ error: null });
  await registerPushToken('tok-123', 'ios');
  expect(from).toHaveBeenCalledWith('fcm_tokens');
  expect(upsert).toHaveBeenCalledWith(
    { user_id: 'u1', token: 'tok-123', platform: 'ios', last_seen_at: expect.any(String) },
    { onConflict: 'token' },
  );
});
```

- [ ] **Step 2: 실행하여 실패 확인**

Run: `npx jest src/services/push.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현 작성**

`src/services/push.ts`:
```ts
import { supabase } from '../lib/supabase';

export type PushPlatform = 'ios' | 'android';

export async function registerPushToken(token: string, platform: PushPlatform): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) throw new Error('로그인이 필요합니다.');
  const { error } = await supabase
    .from('fcm_tokens')
    .upsert(
      { user_id: uid, token, platform, last_seen_at: new Date().toISOString() },
      { onConflict: 'token' },
    );
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: 실행하여 통과 확인**

Run: `npx jest src/services/push.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/push.ts src/services/push.test.ts
git commit -m "feat: FCM token registration service"
```

---

### Task 13: 반려견 서비스 + 이미지 업로드

**Files:**
- Create: `src/services/dogs.ts`, `src/services/dogs.test.ts`, `src/services/images.ts`, `src/services/images.test.ts`

- [ ] **Step 1: 실패하는 dogs 테스트 작성**

`src/services/dogs.test.ts`:
```ts
import { createDog, listMyDogs } from './dogs';

const single = jest.fn();
const selectAfterInsert = jest.fn(() => ({ single }));
const insert = jest.fn(() => ({ select: selectAfterInsert }));
const order = jest.fn();
const eq = jest.fn(() => ({ order }));
const select = jest.fn(() => ({ eq }));
const from = jest.fn(() => ({ insert, select }));
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: (...a: any[]) => from(...a),
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u1' } } })) },
  },
}));
beforeEach(() => jest.clearAllMocks());

test('createDog inserts with owner_id and returns row', async () => {
  single.mockResolvedValueOnce({ data: { id: 'd1', name: '초코', owner_id: 'u1' }, error: null });
  const dog = await createDog({ name: '초코', gender: 'male' });
  expect(from).toHaveBeenCalledWith('dogs');
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ owner_id: 'u1', name: '초코', gender: 'male' }));
  expect(dog.id).toBe('d1');
});

test('listMyDogs queries by owner ordered by created_at', async () => {
  order.mockResolvedValueOnce({ data: [{ id: 'd1' }], error: null });
  const dogs = await listMyDogs();
  expect(eq).toHaveBeenCalledWith('owner_id', 'u1');
  expect(dogs).toHaveLength(1);
});
```

- [ ] **Step 2: 실행하여 실패 확인**

Run: `npx jest src/services/dogs.test.ts`
Expected: FAIL

- [ ] **Step 3: dogs 구현 작성**

`src/services/dogs.ts`:
```ts
import { supabase } from '../lib/supabase';
import { Dog } from '../types/db';
import { DogFormInput } from '../validation/dogs';

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) throw new Error('로그인이 필요합니다.');
  return data.user.id;
}

export async function createDog(input: DogFormInput): Promise<Dog> {
  const owner_id = await uid();
  const { data, error } = await supabase
    .from('dogs')
    .insert({
      owner_id,
      name: input.name.trim(),
      breed: input.breed ?? null,
      gender: input.gender ?? null,
      is_neutered: input.is_neutered ?? null,
      features: input.features ?? null,
      emergency_contact: input.emergency_contact ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as Dog;
}

export async function listMyDogs(): Promise<Dog[]> {
  const owner_id = await uid();
  const { data, error } = await supabase
    .from('dogs').select('*').eq('owner_id', owner_id).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Dog[];
}
```

- [ ] **Step 4: 실행하여 통과 확인**

Run: `npx jest src/services/dogs.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: 실패하는 images 테스트 작성**

`src/services/images.test.ts`:
```ts
import { buildImagePath } from './images';

test('buildImagePath nests under user/dog with jpg extension', () => {
  const path = buildImagePath('u1', 'd1', 'abc');
  expect(path).toBe('u1/d1/abc.jpg');
});
```

- [ ] **Step 6: 실행하여 실패 확인**

Run: `npx jest src/services/images.test.ts`
Expected: FAIL

- [ ] **Step 7: images 구현 작성**

`src/services/images.ts`:
```ts
import { supabase } from '../lib/supabase';

export function buildImagePath(userId: string, dogId: string, fileId: string): string {
  return `${userId}/${dogId}/${fileId}.jpg`;
}

/**
 * 로컬 사진 URI 배열을 Storage에 업로드하고 dog_images 행을 만든다.
 * 부분 실패 시 업로드된 객체를 정리(고아 방지)한다.
 */
export async function uploadDogImages(
  userId: string,
  dogId: string,
  localUris: string[],
): Promise<void> {
  const uploaded: string[] = [];
  try {
    for (let i = 0; i < localUris.length; i++) {
      const fileId = `${Date.now()}-${i}`;
      const path = buildImagePath(userId, dogId, fileId);
      const res = await fetch(localUris[i]);
      const blob = await res.arrayBuffer();
      const up = await supabase.storage.from('dog-images').upload(path, blob, {
        contentType: 'image/jpeg', upsert: false,
      });
      if (up.error) throw new Error(up.error.message);
      uploaded.push(path);
      const row = await supabase.from('dog_images').insert({
        dog_id: dogId, storage_path: path, is_primary: i === 0, sort_order: i,
      });
      if (row.error) throw new Error(row.error.message);
    }
  } catch (e) {
    if (uploaded.length) await supabase.storage.from('dog-images').remove(uploaded);
    throw e;
  }
}
```

- [ ] **Step 8: 실행하여 통과 확인**

Run: `npx jest src/services/`
Expected: PASS (dogs + images + profile + location + push 전부)

- [ ] **Step 9: Commit**

```bash
git add src/services/dogs.ts src/services/dogs.test.ts src/services/images.ts src/services/images.test.ts
git commit -m "feat: dogs service + image upload with orphan cleanup"
```

---

## Phase 4 — 인증 · 네비게이션 · 온보딩 화면

### Task 14: 세션 컨텍스트 + 인증 서비스

**Files:**
- Create: `src/lib/session.ts`, `src/services/auth.ts`, `src/services/auth.test.ts`

- [ ] **Step 1: 실패하는 인증 서비스 테스트 작성**

`src/services/auth.test.ts`:
```ts
import { signInWithEmail, signUpWithEmail, signOut } from './auth';

const signInWithPassword = jest.fn();
const signUp = jest.fn();
const signOutFn = jest.fn();
jest.mock('../lib/supabase', () => ({
  supabase: { auth: {
    signInWithPassword: (...a: any[]) => signInWithPassword(...a),
    signUp: (...a: any[]) => signUp(...a),
    signOut: (...a: any[]) => signOutFn(...a),
  } },
}));
beforeEach(() => jest.clearAllMocks());

test('signInWithEmail throws friendly error on invalid creds', async () => {
  signInWithPassword.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } });
  await expect(signInWithEmail('a@b.com', 'x')).rejects.toThrow('이메일 또는 비밀번호가 올바르지 않습니다.');
});

test('signUpWithEmail passes email/password through', async () => {
  signUp.mockResolvedValueOnce({ data: {}, error: null });
  await signUpWithEmail('a@b.com', 'password123');
  expect(signUp).toHaveBeenCalledWith({ email: 'a@b.com', password: 'password123' });
});
```

- [ ] **Step 2: 실행하여 실패 확인**

Run: `npx jest src/services/auth.test.ts`
Expected: FAIL

- [ ] **Step 3: 인증 서비스 구현**

`src/services/auth.ts`:
```ts
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase } from '../lib/supabase';

const redirectTo = Linking.createURL('/auth-callback');

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.message.includes('Invalid login credentials')) {
      throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.');
    }
    if (error.message.toLowerCase().includes('not confirmed')) {
      throw new Error('이메일 인증이 필요합니다. 메일함을 확인해주세요.');
    }
    throw new Error(error.message);
  }
}

export async function signUpWithEmail(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
}

export async function signInWithProvider(provider: 'kakao' | 'google'): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider, options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw new Error(error.message);
  if (!data.url) throw new Error('OAuth URL 생성 실패');
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return; // 사용자가 취소 → 조용히 복귀
  const url = new URL(result.url);
  const code = url.searchParams.get('code');
  if (code) {
    const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
    if (exErr) throw new Error(exErr.message);
  }
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: 실행하여 통과 확인**

Run: `npx jest src/services/auth.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: 세션 컨텍스트 작성**

`src/lib/session.ts`:
```ts
import { createContext, useContext } from 'react';
import { Session } from '@supabase/supabase-js';

export type SessionState = { session: Session | null; loading: boolean };
export const SessionContext = createContext<SessionState>({ session: null, loading: true });
export const useSession = () => useContext(SessionContext);
```

- [ ] **Step 6: Commit**

```bash
git add src/services/auth.ts src/services/auth.test.ts src/lib/session.ts
git commit -m "feat: auth service (email + OAuth) + session context"
```

---

### Task 15: 루트 레이아웃 + 세션 provider + 진입 게이트

**Files:**
- Create: `app/_layout.tsx`, `app/index.tsx`
- Modify: `package.json` (main 엔트리)

- [ ] **Step 1: expo-router 엔트리 설정**

`package.json` 의 `"main"` 을 다음으로 변경:
```json
"main": "expo-router/entry"
```

- [ ] **Step 2: 루트 레이아웃 + 세션 구독 작성**

`app/_layout.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { Slot } from 'expo-router';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../src/lib/supabase';
import { SessionContext } from '../src/lib/session';

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <SessionContext.Provider value={{ session, loading }}>
      <Slot />
    </SessionContext.Provider>
  );
}
```

- [ ] **Step 3: 진입 게이트 작성 (세션→온보딩→홈 분기)**

`app/index.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useSession } from '../src/lib/session';
import { getMyProfile } from '../src/services/profile';
import { isOnboardingComplete } from '../src/validation/profile';

export default function Index() {
  const { session, loading } = useSession();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    if (!session) { setOnboarded(null); return; }
    getMyProfile().then((p) => setOnboarded(p ? isOnboardingComplete(p) : false)).catch(() => setOnboarded(false));
  }, [session]);

  if (loading) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;
  if (!session) return <Redirect href="/(auth)/login" />;
  if (onboarded === null) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;
  if (!onboarded) return <Redirect href="/(onboarding)/profile" />;
  return <Redirect href="/(app)/home" />;
}
```

- [ ] **Step 4: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 5: Commit**

```bash
git add app/_layout.tsx app/index.tsx package.json
git commit -m "feat: root layout with session provider + entry gate"
```

---

### Task 16: 로그인 화면 (카카오/구글/이메일 버튼)

**Files:**
- Create: `app/(auth)/_layout.tsx`, `app/(auth)/login.tsx`

- [ ] **Step 1: (auth) 그룹 레이아웃**

`app/(auth)/_layout.tsx`:
```tsx
import { Stack } from 'expo-router';
export default function AuthLayout() {
  return <Stack screenOptions={{ headerTitleAlign: 'center' }} />;
}
```

- [ ] **Step 2: 로그인 화면 작성**

`app/(auth)/login.tsx`:
```tsx
import { useState } from 'react';
import { View, Text, Pressable, Alert, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { signInWithProvider } from '../../src/services/auth';

export default function Login() {
  const [busy, setBusy] = useState(false);

  async function oauth(provider: 'kakao' | 'google') {
    try { setBusy(true); await signInWithProvider(provider); }
    catch (e: any) { Alert.alert('로그인 실패', e.message); }
    finally { setBusy(false); }
  }

  return (
    <View style={styles.c}>
      <Text style={styles.title}>멍백홈 🐶</Text>
      <Pressable style={[styles.btn, { backgroundColor: '#FEE500' }]} disabled={busy} onPress={() => oauth('kakao')}>
        <Text style={styles.btnDark}>카카오로 시작</Text>
      </Pressable>
      <Pressable style={[styles.btn, styles.outline]} disabled={busy} onPress={() => oauth('google')}>
        <Text style={styles.btnDark}>구글로 시작</Text>
      </Pressable>
      <Pressable style={[styles.btn, { backgroundColor: '#334155' }]} disabled={busy} onPress={() => router.push('/(auth)/email')}>
        <Text style={styles.btnLight}>이메일로 시작</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 32, fontWeight: '800', textAlign: 'center', marginBottom: 24 },
  btn: { padding: 14, borderRadius: 12, alignItems: 'center' },
  outline: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1' },
  btnDark: { fontWeight: '700', color: '#111' },
  btnLight: { fontWeight: '700', color: '#fff' },
});
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: Commit**

```bash
git add "app/(auth)"
git commit -m "feat: login screen with kakao/google/email entry"
```

---

### Task 17: 이메일 로그인/가입 화면

**Files:**
- Create: `app/(auth)/email.tsx`

- [ ] **Step 1: 이메일 화면 작성**

`app/(auth)/email.tsx`:
```tsx
import { useState } from 'react';
import { View, Text, TextInput, Pressable, Alert, StyleSheet } from 'react-native';
import { signInWithEmail, signUpWithEmail } from '../../src/services/auth';

export default function EmailAuth() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [busy, setBusy] = useState(false);

  async function submit() {
    try {
      setBusy(true);
      if (mode === 'in') await signInWithEmail(email.trim(), pw);
      else { await signUpWithEmail(email.trim(), pw); Alert.alert('가입 완료', '인증 메일을 확인해주세요.'); }
    } catch (e: any) { Alert.alert('오류', e.message); }
    finally { setBusy(false); }
  }

  return (
    <View style={styles.c}>
      <TextInput style={styles.in} placeholder="이메일" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <TextInput style={styles.in} placeholder="비밀번호 (6자 이상)" secureTextEntry value={pw} onChangeText={setPw} />
      <Pressable style={styles.btn} disabled={busy} onPress={submit}>
        <Text style={styles.btnText}>{mode === 'in' ? '로그인' : '가입'}</Text>
      </Pressable>
      <Pressable onPress={() => setMode(mode === 'in' ? 'up' : 'in')}>
        <Text style={styles.toggle}>{mode === 'in' ? '계정이 없나요? 가입하기' : '이미 계정이 있나요? 로그인'}</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  in: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, padding: 12, fontSize: 16 },
  btn: { backgroundColor: '#7c3aed', padding: 14, borderRadius: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
  toggle: { textAlign: 'center', color: '#7c3aed', marginTop: 8 },
});
```

- [ ] **Step 2: 타입체크 + 단위테스트 전체**

Run: `npx tsc --noEmit && npm test`
Expected: tsc 에러 없음, 모든 단위테스트 PASS

- [ ] **Step 3: Commit**

```bash
git add "app/(auth)/email.tsx"
git commit -m "feat: email login/signup screen"
```

---

### Task 18: 온보딩 화면 (닉네임·연락처 게이트)

**Files:**
- Create: `app/(onboarding)/profile.tsx`

- [ ] **Step 1: 온보딩 화면 작성**

`app/(onboarding)/profile.tsx`:
```tsx
import { useState } from 'react';
import { View, Text, TextInput, Pressable, Alert, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { updateMyProfile } from '../../src/services/profile';
import { isValidPhone, normalizePhone } from '../../src/validation/profile';

export default function Onboarding() {
  const [nickname, setNickname] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!nickname.trim()) return Alert.alert('확인', '닉네임을 입력해주세요.');
    if (!isValidPhone(phone)) return Alert.alert('확인', '올바른 휴대폰 번호를 입력해주세요.');
    try {
      setBusy(true);
      await updateMyProfile({ nickname: nickname.trim(), phone: normalizePhone(phone) });
      router.replace('/(app)/home');
    } catch (e: any) { Alert.alert('오류', e.message); }
    finally { setBusy(false); }
  }

  return (
    <View style={styles.c}>
      <Text style={styles.h}>프로필 설정</Text>
      <Text style={styles.label}>닉네임 *</Text>
      <TextInput style={styles.in} value={nickname} onChangeText={setNickname} placeholder="예: 초코아빠" />
      <Text style={styles.label}>연락처 *</Text>
      <TextInput style={styles.in} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="010-1234-5678" />
      <Text style={styles.note}>연락처는 앱 내부에서만 사용되며 알림·공개 페이지에 노출되지 않습니다.</Text>
      <Pressable style={styles.btn} disabled={busy} onPress={save}>
        <Text style={styles.btnText}>시작하기</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, justifyContent: 'center', padding: 24, gap: 8 },
  h: { fontSize: 24, fontWeight: '800', marginBottom: 12 },
  label: { fontWeight: '700', color: '#475569', marginTop: 8 },
  in: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, padding: 12, fontSize: 16 },
  note: { fontSize: 12, color: '#64748b', marginTop: 4 },
  btn: { backgroundColor: '#7c3aed', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  btnText: { color: '#fff', fontWeight: '700' },
});
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add "app/(onboarding)"
git commit -m "feat: onboarding profile gate (nickname + phone)"
```

---

## Phase 5 — 권한 적재 · 홈 · 반려견 등록

### Task 19: 권한 부트스트랩 훅 (FCM + 위치)

**Files:**
- Create: `src/lib/bootstrap.ts`

- [ ] **Step 1: 부트스트랩 훅 작성**

`src/lib/bootstrap.ts`:
```ts
import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import messaging from '@react-native-firebase/messaging';
import { registerPushToken } from '../services/push';
import { upsertMyLocation } from '../services/location';

/** 로그인+온보딩 완료 후 1회 실행: 푸시 토큰 등록 + 위치 적재. 실패해도 앱은 진행. */
export function useBootstrapPermissions(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    (async () => {
      try {
        await messaging().registerDeviceForRemoteMessages();
        const authStatus = await messaging().requestPermission();
        const granted =
          authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
          authStatus === messaging.AuthorizationStatus.PROVISIONAL;
        if (granted) {
          const token = await messaging().getToken();
          await registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
          messaging().onTokenRefresh((t) =>
            registerPushToken(t, Platform.OS === 'ios' ? 'ios' : 'android').catch(() => {}),
          );
        }
      } catch { /* 푸시 실패는 무시, 나중에 설정에서 재시도 */ }

      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({});
          await upsertMyLocation(pos.coords.latitude, pos.coords.longitude);
        }
      } catch { /* 위치 실패는 무시 */ }
    })();
  }, [enabled]);
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add src/lib/bootstrap.ts
git commit -m "feat: permission bootstrap (FCM token + location) hook"
```

---

### Task 20: 홈 화면 + (app) 레이아웃

**Files:**
- Create: `app/(app)/_layout.tsx`, `app/(app)/home.tsx`

- [ ] **Step 1: (app) 그룹 레이아웃 작성**

`app/(app)/_layout.tsx`:
```tsx
import { Stack } from 'expo-router';
export default function AppLayout() {
  return <Stack screenOptions={{ headerTitleAlign: 'center' }} />;
}
```

- [ ] **Step 2: 홈 화면 작성 (부트스트랩 훅 + 반려견 목록/CTA)**

`app/(app)/home.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, Alert } from 'react-native';
import { router } from 'expo-router';
import { useBootstrapPermissions } from '../../src/lib/bootstrap';
import { listMyDogs } from '../../src/services/dogs';
import { signOut } from '../../src/services/auth';
import { Dog } from '../../src/types/db';

export default function Home() {
  const [dogs, setDogs] = useState<Dog[]>([]);
  useBootstrapPermissions(true);

  async function refresh() {
    try { setDogs(await listMyDogs()); } catch (e: any) { Alert.alert('오류', e.message); }
  }
  useEffect(() => { refresh(); }, []);

  return (
    <View style={styles.c}>
      <Text style={styles.h}>내 반려견</Text>
      <FlatList
        data={dogs}
        keyExtractor={(d) => d.id}
        ListEmptyComponent={<Text style={styles.empty}>아직 등록된 반려견이 없어요.</Text>}
        renderItem={({ item }) => <Text style={styles.row}>🐶 {item.name}</Text>}
      />
      <Pressable style={styles.cta} onPress={() => router.push('/(app)/dogs/new')}>
        <Text style={styles.ctaText}>＋ 반려견 등록</Text>
      </Pressable>
      <Pressable onPress={() => signOut()}><Text style={styles.signout}>로그아웃</Text></Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, padding: 24, paddingTop: 60 },
  h: { fontSize: 24, fontWeight: '800', marginBottom: 16 },
  empty: { color: '#64748b', paddingVertical: 24, textAlign: 'center' },
  row: { fontSize: 18, paddingVertical: 10, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  cta: { backgroundColor: '#7c3aed', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  signout: { textAlign: 'center', color: '#94a3b8', marginTop: 16 },
});
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/_layout.tsx" "app/(app)/home.tsx"
git commit -m "feat: home screen with dog list + bootstrap permissions"
```

---

### Task 21: 반려견 등록 화면 (폼 + 사진 업로드)

**Files:**
- Create: `app/(app)/dogs/new.tsx`

- [ ] **Step 1: 등록 화면 작성**

`app/(app)/dogs/new.tsx`:
```tsx
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, Alert, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../../src/lib/supabase';
import { createDog } from '../../../src/services/dogs';
import { uploadDogImages } from '../../../src/services/images';
import { validateDogForm } from '../../../src/validation/dogs';
import { Gender } from '../../../src/types/db';

const GENDERS: { k: Gender; label: string }[] = [
  { k: 'male', label: '수컷' }, { k: 'female', label: '암컷' }, { k: 'unknown', label: '모름' },
];

export default function NewDog() {
  const [name, setName] = useState('');
  const [breed, setBreed] = useState('');
  const [gender, setGender] = useState<Gender>('unknown');
  const [neutered, setNeutered] = useState<boolean | null>(null);
  const [features, setFeatures] = useState('');
  const [contact, setContact] = useState('');
  const [uris, setUris] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function pick() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, quality: 0.6,
    });
    if (!res.canceled) setUris(res.assets.map((a) => a.uri));
  }

  async function submit() {
    const v = validateDogForm({ name, gender });
    if (!v.valid) return Alert.alert('확인', v.errors.join('\n'));
    try {
      setBusy(true);
      const dog = await createDog({
        name, breed: breed || undefined, gender,
        is_neutered: neutered, features: features || undefined,
        emergency_contact: contact || undefined,
      });
      if (uris.length) {
        const { data } = await supabase.auth.getUser();
        await uploadDogImages(data.user!.id, dog.id, uris);
      }
      router.back();
    } catch (e: any) { Alert.alert('등록 실패', e.message); }
    finally { setBusy(false); }
  }

  return (
    <ScrollView contentContainerStyle={styles.c}>
      <Pressable style={styles.photo} onPress={pick}>
        {uris[0]
          ? <Image source={{ uri: uris[0] }} style={styles.photoImg} />
          : <Text style={styles.photoText}>＋ 사진 추가 {uris.length > 1 ? `(${uris.length}장)` : ''}</Text>}
      </Pressable>

      <Text style={styles.label}>이름 *</Text>
      <TextInput style={styles.in} value={name} onChangeText={setName} placeholder="초코" />

      <Text style={styles.label}>견종</Text>
      <TextInput style={styles.in} value={breed} onChangeText={setBreed} placeholder="예: 말티즈" />

      <Text style={styles.label}>성별</Text>
      <View style={styles.seg}>
        {GENDERS.map((g) => (
          <Pressable key={g.k} style={[styles.segItem, gender === g.k && styles.segOn]} onPress={() => setGender(g.k)}>
            <Text style={gender === g.k ? styles.segOnText : styles.segText}>{g.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>중성화</Text>
      <View style={styles.seg}>
        {[{ v: true, l: '예' }, { v: false, l: '아니오' }, { v: null, l: '모름' }].map((o) => (
          <Pressable key={o.l} style={[styles.segItem, neutered === o.v && styles.segOn]} onPress={() => setNeutered(o.v)}>
            <Text style={neutered === o.v ? styles.segOnText : styles.segText}>{o.l}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>특징</Text>
      <TextInput style={[styles.in, { height: 72 }]} multiline value={features} onChangeText={setFeatures} placeholder="색·크기·습관 등" />

      <Text style={styles.label}>비상연락처</Text>
      <TextInput style={styles.in} value={contact} onChangeText={setContact} keyboardType="phone-pad" placeholder="비우면 프로필 번호 사용" />

      <Pressable style={styles.btn} disabled={busy} onPress={submit}>
        <Text style={styles.btnText}>{busy ? '등록 중...' : '등록하기'}</Text>
      </Pressable>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  c: { padding: 24, gap: 6 },
  photo: { height: 120, borderRadius: 14, backgroundColor: '#f1f5f9', borderWidth: 2, borderColor: '#cbd5e1', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  photoImg: { width: '100%', height: '100%', borderRadius: 12 },
  photoText: { color: '#64748b' },
  label: { fontWeight: '700', color: '#475569', marginTop: 8 },
  in: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, padding: 12, fontSize: 16 },
  seg: { flexDirection: 'row', gap: 6 },
  segItem: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1', alignItems: 'center' },
  segOn: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  segText: { color: '#334155' },
  segOnText: { color: '#fff', fontWeight: '700' },
  btn: { backgroundColor: '#7c3aed', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 20 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
```

- [ ] **Step 2: 타입체크 + 전체 단위테스트**

Run: `npx tsc --noEmit && npm test`
Expected: tsc 에러 없음, 모든 단위테스트 PASS

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/dogs/new.tsx"
git commit -m "feat: dog registration screen with photo upload"
```

---

## Phase 6 — 실기기 검증 (수동, 자동화 불가 항목)

### Task 22: Dev Client 빌드 & 외부 키 연결 & 수동 QA

> 이 태스크는 외부 콘솔 설정(카카오/구글/Firebase)과 실기기가 필요해 자동 테스트로 대체 불가하다. 체크리스트로 수행한다.

**Files:**
- Modify: `app.config.ts` (Firebase plist/json 경로), `.env`(원격 Supabase 키 — 실기기는 localhost 접근 불가)

- [ ] **Step 1: 외부 프로젝트 키 발급**
  - Supabase 대시보드에서 **클라우드 프로젝트** 생성(또는 `supabase link`) → URL·anon key를 `.env`에 (실기기는 `127.0.0.1` 접근 불가하므로 클라우드 또는 LAN IP 사용)
  - Supabase Auth → Providers → **Kakao, Google 활성화** + redirect URL에 `meongbackhome://auth-callback` 추가
  - 카카오 개발자 콘솔: 앱 생성, REST API 키, Redirect URI 등록 → Supabase Kakao provider에 입력
  - 구글 OAuth 클라이언트 생성 → Supabase Google provider에 입력
  - Firebase 프로젝트 생성 → iOS `GoogleService-Info.plist`, Android `google-services.json` 다운로드 → 루트에 배치하고 `app.config.ts`의 `ios.googleServicesFile`·`android.googleServicesFile`에 경로 지정

- [ ] **Step 2: prebuild + Dev Client 빌드**

Run:
```bash
npx expo prebuild --clean
eas build --profile development --platform ios   # 또는 android
```
(`eas.json`에 development 프로필이 없으면 `eas build:configure`로 생성)

- [ ] **Step 3: 실기기 수동 QA 체크리스트**
  - [ ] 카카오 로그인 → 인앱 브라우저 → 앱 복귀 → 세션 유지(앱 재시작 후 자동 로그인)
  - [ ] 구글 로그인 동일 확인
  - [ ] 이메일 가입 → 인증 메일 수신 → 인증 후 로그인
  - [ ] 신규 계정 로그인 시 온보딩 화면 강제 노출, 닉네임/연락처 저장 후 홈 이동
  - [ ] 푸시 권한 허용 → Supabase `fcm_tokens`에 행 생성 확인
  - [ ] 위치 권한 허용 → `user_locations`에 좌표 적재 확인 / 거부 시 앱 정상 진행
  - [ ] 반려견 등록(사진 2장) → `dogs` + `dog_images` 행 + Storage 객체 확인, 대표사진 `is_primary=true`
  - [ ] 위치/푸시 거부 후에도 앱이 크래시 없이 동작

- [ ] **Step 4: Commit (설정 변경분)**

```bash
git add app.config.ts eas.json
git commit -m "chore: dev client build config + external providers"
```

> `GoogleService-Info.plist`·`google-services.json`·`.env`는 비밀이므로 `.gitignore`에 추가하고 커밋하지 않는다. 필요한 항목을 `.gitignore`에 더한다.

---

## Self-Review (작성자 점검 결과)

**1. Spec coverage** — 스펙 섹션별 매핑:
- 데이터 모델 5개 테이블+RLS+트리거 → Task 3–7 ✅
- Storage 버킷/정책 → Task 6 ✅
- 인증/온보딩 흐름(카카오·구글·이메일+비번+인증, 온보딩 게이트) → Task 14–18 ✅
- 위치 거부 graceful → Task 19(try/catch, 진행) ✅
- FCM 토큰 발급·등록(발송 제외) → Task 12, 19 ✅
- 반려견 등록(성별·중성화 포함) + 사진 업로드(고아 정리) → Task 9, 13, 21 ✅
- 가입 시 연락처 수집 → Task 18 ✅
- 테스트 전략(단위 TDD + RLS 통합 + 수동 실기기) → Task 7, 9–14, 22 ✅
- 에러 처리(친절한 메시지, 부분 업로드 정리) → Task 13, 14 ✅

**2. Placeholder scan** — "TODO/TBD/적절히 처리" 없음. 모든 코드 스텝에 실제 코드 포함. 외부 콘솔 설정(Task 22)은 본질적으로 수동이라 체크리스트로 명시(플레이스홀더 아님).

**3. Type consistency** — `Gender`('male'|'female'|'unknown'), `DogFormInput`, `Profile`, `Dog`, `registerPushToken(token, platform)`, `upsertMyLocation(lat, lng)`, `createDog(input)`, `uploadDogImages(userId, dogId, uris)`, `buildImagePath(userId, dogId, fileId)` 등 후속 태스크에서 동일 시그니처 사용 확인.

> **알려진 한계(정직 기록):** `app/(auth)`·`(onboarding)`·`(app)` 화면들은 단위테스트 대신 `tsc --noEmit` + 실기기 수동 QA(Task 22)로 검증한다. 화면 단위 컴포넌트 테스트(@testing-library/react-native)는 가치 대비 비용이 높아 본 묶음에서는 핵심 분기(진입 게이트 로직)를 서비스/검증 함수로 끌어내려 단위테스트하는 방식으로 대체했다.
