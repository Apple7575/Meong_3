# 설계: 멍백홈 — Sub-project 2 「밀도 엔진 (산책 기록)」

- **작성일**: 2026-06-02
- **방식**: superpowers:brainstorming (시각 동반 도구 사용)
- **상위 전략 문서**: `~/.gstack/projects/MeongBackHome/cruel-unknown-design-20260601-224226.md` (office-hours, APPROVED)
- **선행**: Sub-project 1 「기반 & 신원」 (`feat/foundation-identity`, PR #1) — 본 묶음은 그 위에 올라감
- **스택**: React Native (Expo, Dev Client + EAS) · Supabase(PostgreSQL/PostGIS) · expo-location + expo-task-manager
- **상태**: 설계 승인됨 → 구현 플랜 작성 대기

---

## 1. 배경 & 위치

4개 하위 프로젝트 분해(SP1 설계 문서 참조)에서 **Sub-project 2 = 밀도 엔진**이다. 전략적으로 load-bearing: 제보 경로를 A(앱 전용)로 택했기 때문에, **산책 기능으로 평상시 앱 설치·리텐션을 키워 밀도를 확보**해야 위기 코어 루프(SP3)가 작동한다. 산책 기록 품질이 낮으면 이 전략 자체가 흔들리므로, 추적 품질을 1순위로 둔다.

**이번 묶음 범위 (승인됨):** 산책 기록 + 통계·리텐션 훅.

---

## 2. 범위

**포함:**
- GPS 경로 기록 (시작 / 일시정지 / 재개 / 종료)
- 백그라운드 추적 (화면 꺼져도 기록)
- 종료 요약 (경로 지도 + 거리·시간·평균속도 + 실종 활용 동의 토글)
- 히스토리 (지난 산책 목록 + 경로)
- 통계·리텐션 훅 (누적 거리·총 횟수·이번 주 횟수·연속 기록 스트릭)
- 강제 종료 복구 (미저장 산책 감지 후 저장 제안)
- `walk_records` 테이블 + RLS + 통계 RPC

**제외 (다른 묶음/후순위):**
- 실종 수색에 산책 경로를 실제로 활용하는 로직 — SP3(동의 게이트 하에). SP2는 동의 **토글 저장**까지만.
- 소셜/공유(동네 산책 피드 등)
- 산책 경로의 PostGIS 공간 쿼리 — 필요해지면 SP3에서 저장된 GeoJSON으로부터 파생

---

## 3. 데이터 모델

**새 마이그레이션 `supabase/migrations/0005_walks.sql`** (SP1의 0001~0004에 이어짐)

### `walk_records`
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `user_id` | uuid NOT NULL | → `profiles(id)` ON DELETE CASCADE (소유자) |
| `dog_id` | uuid NULL | → `dogs(id)` ON DELETE SET NULL. **선택** — 강아지 없이도 산책 기록 가능 |
| `route_geojson` | jsonb NOT NULL | GeoJSON `LineString` (좌표 배열) |
| `distance_m` | double precision NOT NULL | 요약 거리(미터). 종료 시 계산해 비정규화 저장 |
| `duration_s` | int NOT NULL | 이동 시간(초, 일시정지 제외) |
| `started_at` | timestamptz NOT NULL | |
| `ended_at` | timestamptz NOT NULL | |
| `use_for_missing_search` | boolean NOT NULL default false | 실종 수색 활용 동의 (민감 위치라 기본 OFF) |
| `created_at` | timestamptz NOT NULL default now() | |
| 인덱스 | `(user_id, started_at desc)` | 히스토리 조회 |

### RLS
소유자 전용 — `walks_all_own` for all using/with check `auth.uid() = user_id`. (SP1 패턴 동일)

### 경로 저장 방식 (결정)
`route_geojson` jsonb로 저장 + 요약 컬럼(`distance_m`·`duration_s`)을 종료 시 계산해 비정규화. SP2에선 경로를 공간 쿼리하지 않음(지도 렌더 + 거리 계산만). PostGIS geometry(LineString)는 SP3 실종 수색에서 필요해지면 그때 파생. **YAGNI.**

### 통계 RPC `my_walk_stats()`
`security definer`, `auth.uid()` 기준으로 다음을 SQL에서 계산해 1행 반환:
- `total_distance_m` (double precision) — 전체 합
- `total_count` (int) — 전체 산책 수
- `this_week_count` (int) — 이번 주(월요일 시작) 산책 수
- `current_streak` (int) — **산책한 날의 연속 일수** (오늘 또는 어제부터 역순으로 연속된 distinct 날짜 수). 스트릭은 SQL에서 정확히 계산(클라이언트 계산 회피).

### 프라이버시 (전략 문서 반영)
- 경로는 민감 데이터 → `use_for_missing_search` 기본 false, 소유자 전용 RLS.
- 산책 시작점이 집일 가능성이 높음 → **SP3 메모**: 실종 수색 활용 시 동의한 산책만, 시작/끝 구간 마스킹 검토. (SP2 구현 범위 아님, 스펙에 기록만.)

---

## 4. 백그라운드 추적 아키텍처

### 구성
- **`expo-location` + `expo-task-manager`**: `Location.startLocationUpdatesAsync(WALK_TASK, opts)`로 백그라운드 위치 업데이트 등록, `TaskManager.defineTask(WALK_TASK, cb)`가 화면이 꺼져도 좌표 배치 수신.
- **권한 / 네이티브 설정** (`app.config.ts`의 `expo-location` 플러그인):
  - iOS: 위치 권한 문구(`locationWhenInUsePermission`, `locationAlwaysAndWhenInUsePermission`) + 백그라운드 모드 `location`.
  - Android: `ACCESS_BACKGROUND_LOCATION` + **포그라운드 서비스**(산책 중 지속 알림).
  - 포그라운드 + 백그라운드 권한 모두 요청.

### 산책 세션 싱글톤 `src/lib/walkSession.ts`
상태 머신: `idle → recording → paused → recording → (stopped)`.
- **시작**: 위치 태스크 등록, `started_at` 기록, 버퍼 초기화.
- **좌표 수신**(태스크 콜백마다): ① 메모리 버퍼에 누적, ② **AsyncStorage에 영속**(강제 종료 대비), ③ 등록 리스너에 통지(산책 화면이 실시간 지도·거리 갱신).
- **일시정지/재개**: `paused` 플래그 — 일시정지 중 좌표는 버퍼에 넣지 않음(거리 미증가).
- **종료**: 버퍼 → 노이즈 필터 → 거리·시간 계산 → GeoJSON LineString 생성 → `walks.saveWalk()` 호출 → 버퍼/AsyncStorage 클리어.

### 거리 계산 + 노이즈 처리 (품질 핵심)
- 연속 좌표 간 **하버사인** 누적.
- **노이즈 필터**(`src/lib/geo.ts`, 순수 함수, TDD): 정확도(accuracy)가 임계값보다 나쁜 좌표 버림; 직전 점과 이동 거리가 임계(예: 5m) 미만이면 무시 — GPS 지터의 거리 부풀림 방지.

### 강제 종료 복구
앱이 산책 중 종료되면 AsyncStorage에 미저장 경로가 남음 → 재실행 시 감지하여 "진행 중이던 산책이 있어요. 저장할까요?" 제안. 저장 또는 폐기.

---

## 5. 화면

홈에 "산책" 진입점 추가. 라우트: `app/(app)/walk/`.
- **산책 중** (`walk/index.tsx`): 실시간 지도(경로 그려짐) + 상단 거리·시간 타이머 + [일시정지]/[종료]. 시작 전 상태에서 (선택) 강아지 선택 + [산책 시작].
- **종료 요약** (`walk/summary.tsx`): 완성 경로 지도 + 거리·시간·평균속도 + **실종 활용 동의 토글(기본 OFF)** + [삭제]/[저장].
- **히스토리 & 통계** (`walk/history.tsx`): 상단 통계 카드(🔥연속 기록·누적 거리·총 횟수·이번 주) + 지난 산책 목록(경로 썸네일·거리·시간·강아지·시각).

> 지도 렌더링: SP1에선 지도가 없었음. SP2에서 Kakao Map을 처음 도입 — 네이티브 SDK는 config plugin 필요. 구현 플랜에서 Kakao Map 연동(네이티브 vs WebView)을 첫 태스크로 다룬다.

---

## 6. 에러 처리 · 엣지 케이스
- **백그라운드 권한 거부** → 추적 불가 안내 + 포그라운드 전용 대체(화면 켠 상태) 또는 설정 유도. 산책 자체는 막지 않음.
- **GPS 신호 끊김** → 마지막 점 유지, 복귀 시 이어붙임(노이즈 필터가 튄 점 제거).
- **저장 실패(네트워크)** → 버퍼 유지 + 재시도. 산책 데이터 절대 분실 금지.
- **강제 종료 복구** → 재실행 시 미저장 산책 감지 후 저장 제안.
- **너무 짧은 산책**(< 1분 또는 < 50m) → 저장 전 확인(실수 시작 방지).

---

## 7. 테스트 전략
- **단위(TDD)**: `geo.ts`(하버사인 정확도, 노이즈 필터가 저정확도·지터 점 제거, 거리 누적) / `walkSession` 상태 전이(시작→일시정지→재개→종료, 위치·AsyncStorage 목) / `walks` 서비스(supabase 목) / 통계 포맷팅.
- **통합(로컬 Supabase)** ⭐: `my_walk_stats()` RPC — 한 사용자에 산책 여러 건 insert 후 누적 거리·횟수·**연속 일수(스트릭)** 정확도 검증. + `walk_records` RLS 격리(타인 산책 안 보임).
- **수동/실기기**: 실제 백그라운드 추적(폰 잠그고 걷기 → 경로 정확도), 포그라운드 서비스 알림 — 자동화 불가, 체크리스트로.

---

## 8. 의존성 · 사전 준비
- SP1 완료(profiles·dogs 테이블, Expo+Supabase 골격, 세션) — 본 묶음의 전제.
- `expo-task-manager` 추가 설치, `expo-location` 백그라운드 설정.
- **Kakao Map** SDK 키 + config plugin (SP2에서 지도 첫 도입).
- iOS 백그라운드 위치 모드 / Android 포그라운드 서비스 권한 (EAS Dev Client 빌드 필요 — SP1 Task 22와 합류).

---

## 9. 미해결 질문
- Kakao Map 연동을 네이티브 SDK(config plugin) vs WebView 중 무엇으로 할지 — 구현 플랜 첫 태스크에서 결정.
- 좌표 샘플링 주기(거리/시간 간격) 기본값 — 구현 중 실측으로 튜닝(배터리 vs 정확도).
- 스트릭의 "하루" 경계 타임존 처리(KST 고정 가정) — 구현 시 확정.
